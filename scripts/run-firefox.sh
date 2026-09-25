#!/usr/bin/env sh
#
# Launch Firefox with WhileFree loaded and its debugging ports open, so a test can talk
# to the pages the extension is sitting in.
#
# Two ports, because Firefox has two protocols and neither does the other's job:
#
#   --remote-debugging-port   the Remote Agent, which speaks WebDriver BiDi. This is the one
#                             that replaces the DevTools protocol for driving pages, and it
#                             is what `scripts/bidi.mjs` talks to. There is no CDP here: a
#                             `curl /json/version` answers 404, because Chromium's debugger
#                             protocol is Chromium's.
#   --start-debugger-server   the DevTools protocol (RDP), the one about:debugging uses. It is
#                             the only way to reach a *content script's* world by name, and
#                             the only way to evaluate inside the background page. Pages come
#                             from the first port; the extension's own contexts come from here.
#
# The profile matters more here than in Chromium. Chromium's rig gets a user-data-dir of its
# own because it should not share a profile with the browser you use; on Firefox this project
# tests against the real dev profile (scripts/install-firefox.sh), which is where the AI
# sessions are. That profile cannot be opened twice: a running Firefox holds it, and
# --no-remote does not make a locked profile usable, it makes the command line fail instead of
# handing itself to the running instance. So:
#
#   WF_PROFILE=/tmp/wf-copy sh scripts/run-firefox.sh     # a copy, when the real one is busy
#
# Copy the profile with caches left behind and take the lock files out of the copy — a copy
# holding `.parentlock` and `lock` is a profile Firefox refuses to open. See docs/TESTING.md.
#
#   sh scripts/run-firefox.sh [extra firefox arguments]
#
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
profile=${WF_PROFILE:-$HOME/.config/mozilla/firefox/bnbak5b7.devtab}
bidi_port=${WF_BIDI_PORT:-9223}
rdp_port=${WF_RDP_PORT:-6000}

if [ ! -d "$profile" ]; then
  echo "no such profile: $profile" >&2
  exit 1
fi

# Which Firefox. A wrapper on PATH is not necessarily this profile's browser: snap Firefox is a
# different build in its own sandbox and cannot read ~/.config/mozilla at all, so handing it this
# profile either starts a browser with none of the sessions in it or none at all — quietly, with
# the profile path accepted on the command line. The build that owns the profile is a local one,
# so that is looked for first and PATH is only the fallback.
browser=${WF_FIREFOX:-}
if [ -z "$browser" ]; then
  for candidate in "$HOME/.local/opt/firefox/firefox" "/opt/firefox/firefox" "$HOME/firefox/firefox"; do
    if [ -x "$candidate" ]; then
      browser=$candidate
      break
    fi
  done
fi
if [ -z "$browser" ]; then
  for candidate in firefox firefox-bin; do
    if command -v "$candidate" >/dev/null 2>&1; then
      browser=$(command -v "$candidate")
      break
    fi
  done
fi
if [ -z "$browser" ]; then
  echo "no Firefox found — set WF_FIREFOX=/path/to/firefox" >&2
  exit 1
fi

# Who is holding the profile. This must not be `pgrep -f "firefox.*--profile $profile"`: the
# pattern matches the shell running *this* script, because the profile path is in its command
# line, so the check fires on an empty profile and the launch it was guarding never happens.
# So walk the processes that really are a browser and read their own command lines.
profile_holders() {
  for pid in $(pgrep -x firefox 2>/dev/null) $(pgrep -x firefox-bin 2>/dev/null); do
    [ "$pid" = "$$" ] && continue
    if tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | grep -q -- "--profile $profile"; then
      echo "$pid"
    fi
  done
}

holders=$(profile_holders)
if [ -n "$holders" ]; then
  echo "that profile is already open in a running Firefox:" >&2
  for pid in $holders; do echo "  $pid $(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null | cut -c1-120)" >&2; done
  echo >&2
  echo "Firefox refuses a second instance on one profile, and killing the one you are using" >&2
  echo "to browse with is not this script's decision. Copy the profile instead:" >&2
  echo >&2
  echo "  rsync -a --exclude storage --exclude cache2 --exclude '*.sqlite-wal' \\" >&2
  echo "    --exclude '*.sqlite-shm' --exclude .parentlock --exclude lock \\" >&2
  echo "    \"$profile/\" /tmp/wf-fx-copy/" >&2
  echo "  WF_PROFILE=/tmp/wf-fx-copy sh scripts/run-firefox.sh" >&2
  exit 1
fi

if [ ! -e "$profile/extensions/whilefree@whilefree.app.xpi" ]; then
  echo "warning: no WhileFree xpi in $profile/extensions" >&2
  echo "         run: sh scripts/install-firefox.sh" >&2
fi

# --start-debugger-server is ignored, with a console error rather than a failure, unless both of
# these are true. Nothing else in the dev loop needs them; the DevTools protocol does, and without
# it every edit to the popup costs a browser restart — which is the whole reason this script
# exists. A profile that is not running cannot lose anything by having them set.
ensure_pref() {
  grep -q "^user_pref(\"$1\"" "$profile/prefs.js" 2>/dev/null || {
    printf 'user_pref("%s", true);\n' "$1" >> "$profile/prefs.js"
    echo "set $1 in $profile/prefs.js"
  }
}
ensure_pref devtools.debugger.remote-enabled
ensure_pref devtools.chrome.enabled

echo "browser  $browser"
echo "profile  $profile"
echo "bidi     ws://127.0.0.1:$bidi_port/session   (scripts/bidi.mjs)"
echo "devtools ws://127.0.0.1:$rdp_port              (content-script and background worlds)"
echo

exec "$browser" \
  --profile "$profile" \
  --no-remote \
  --new-instance \
  --remote-debugging-port "$bidi_port" \
  --start-debugger-server "$rdp_port" \
  "$@"
