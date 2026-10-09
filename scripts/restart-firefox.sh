#!/usr/bin/env sh
#
# Restart the rig Firefox on a profile copy, with the URLs given as its whole tab list.
#
# The live-testing loop needs the rig to come back the same way every time, and doing that by
# hand is where the two ways it goes wrong live.
#
# The first is that Firefox does not exit when it is told to, it exits when it is finished: a
# profile with ten loaded SPAs takes seconds to tear down, and a launch that arrives during that
# window *fails quietly* — run-firefox.sh prints "that profile is already open" into the log and
# exits, while the previous browser keeps answering on the debug port. The next command then
# reads a browser one or two launches old and believes it, which is the worst possible failure
# for this rig: every finding afterwards is about the wrong build, and nothing looks wrong.
# So this waits for the process to be really gone before it starts one.
#
# The second is the sessionstore. A killed Firefox writes one, and a profile with
# `browser.startup.page` 3 restores it, so every restart adds the previous session's tabs to the
# ones on the command line — and restores them *unloaded*: tab titles that look right, no
# documents behind them, no content scripts, and a fan-out that reaches nothing. Deleting the
# file is what makes the command line the entire tab list.
#
# A kill pattern worth copying: the process at the top of a launched Firefox is the wrapper
# (`.../firefox --profile X`), not `firefox-bin`, so a pattern written against firefox-bin
# matches nothing and a `pkill` built from it silently does not kill anything. Match on the
# profile argument instead, and put a bracket in it — `--profile /tmp/wf[-]fx-copy` — because a
# plain pattern also matches the command line of the shell running the search, which is how a
# `pkill -f` ends up killing the shell that invoked it.
#
#   WF_PROFILE=/tmp/wf-fx-copy sh scripts/restart-firefox.sh https://chatgpt.com/ ...
#
# It defaults to /tmp/wf-fx-copy and refuses the real profile's path: this script kills whatever
# is using the profile and deletes its sessionstore, and "restart Firefox" on the profile
# somebody is reading their mail in is not a thing a script should be able to say by accident.
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REAL="$HOME/.config/mozilla/firefox/bnbak5b7.devtab"
PROFILE="${WF_PROFILE:-/tmp/wf-fx-copy}"
PORT="${WF_RDP_PORT:-6000}"
LOG="/tmp/wf-fx-rig.log"

if [ ! -d "$PROFILE" ]; then
  echo "no such profile: $PROFILE" >&2
  echo "make a copy first, caches and locks left out:" >&2
  echo "  rsync -a --exclude storage --exclude cache2 --exclude '*.sqlite-wal' \\" >&2
  echo "    --exclude '*.sqlite-shm' --exclude .parentlock --exclude lock \\" >&2
  echo "    \"$REAL/\" \"$PROFILE/\"" >&2
  exit 1
fi
if [ "$(cd "$PROFILE" && pwd)" = "$(cd "$REAL" 2>/dev/null && pwd || echo /nonexistent)" ]; then
  echo "refusing: $PROFILE is the profile someone is browsing in" >&2
  exit 1
fi

# `-x` won't do: the launched process is a wrapper and the browser is its child, and both carry
# the profile argument. Waiting for both to be gone is the only exit that means anything.
holders() { pgrep -f -- "$1" 2>/dev/null || true; }
pattern="--profile $PROFILE"

if [ -n "$(holders "$pattern")" ]; then
  pkill -f -- "$pattern" || true
  waited=0
  while [ -n "$(holders "$pattern")" ] && [ "$waited" -lt 40 ]; do
    sleep 1
    waited=$((waited + 1))
  done
  if [ -n "$(holders "$pattern")" ]; then
    echo "still running after 40s:" >&2
    for pid in $(holders "$pattern"); do echo "  $pid $(tr '\0' ' ' < "/proc/$pid/cmdline" | cut -c1-100)" >&2; done
    echo >&2
    echo "A second browser on one profile is refused, so nothing has been started." >&2
    echo "Stop that one by hand (its profile is $PROFILE) and run this again." >&2
    exit 1
  fi
  echo "stopped the previous instance"
fi

rm -f "$PROFILE/sessionstore.jsonlz4"
rm -rf "$PROFILE/sessionstore-backups"

WF_PROFILE="$PROFILE" setsid nohup sh "$ROOT/scripts/run-firefox.sh" "$@" >"$LOG" 2>&1 </dev/null &

# Wait for the devtools server, not for a fixed number of seconds. The port is the thing the
# next command in a chain actually needs, and its arrival is the moment the browser is usable —
# a fixed sleep is either wasted time or a lie.
node -e '
  const net = require("net");
  const port = Number(process.argv[1]);
  const deadline = Date.now() + 60000;
  const attempt = () =>
    new Promise((resolve) => {
      const socket = net.connect({ host: "127.0.0.1", port });
      socket.on("connect", () => { socket.destroy(); resolve(true); });
      socket.on("error", () => { socket.destroy(); resolve(false); });
    });
  (async () => {
    while (Date.now() < deadline) {
      if (await attempt()) {
        console.log(`devtools server up on ${port} — log at ${process.argv[2]}`);
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    console.error(`nothing listening on ${port} after 60s — read ${process.argv[2]}`);
    process.exit(1);
  })();
' "$PORT" "$LOG"
