#!/bin/sh
# Put this build into a Firefox profile, so testing happens against the code you just wrote.
#
#   sh scripts/install-firefox.sh              # the dev profile this project is tested in
#   WF_PROFILE=/path/to/profile sh scripts/install-firefox.sh
#
# A profile that has the extension at `extensions/<id>.xpi` loads that file at startup, which
# is why this needs a restart to take effect — an app-profile install is read once, not
# watched. Temporary add-ons loaded from about:debugging are the alternative, and they vanish
# every time the browser closes, which is worse for a test you want to keep coming back to.
#
# The copy is a rename, not a `cp`.  Overwriting the XPI in place truncates the same file a
# running Firefox already has open as a zip: the add-on still looks loaded (its manifest is in
# memory) but every file it reloads out of that jar resolves against stale offsets and fails --
# the popup 404s at its own moz-extension:// URL until the browser restarts.  Renaming a fresh
# file over the top leaves a running browser reading a consistent older copy instead.
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${WF_PROFILE:-$HOME/.config/mozilla/firefox/bnbak5b7.devtab}"
ID="whilefree@whilefree.app"

if [ ! -d "$PROFILE" ]; then
  echo "No such profile: $PROFILE" >&2
  echo "Set WF_PROFILE to the profile that should get the extension." >&2
  exit 1
fi

VERSION=$(node -e "console.log(require('$ROOT/src/manifest.base.json').version)")
ZIP="$ROOT/dist/whilefree-firefox-$VERSION.zip"

cd "$ROOT"
node scripts/build.mjs >/dev/null
node scripts/package.mjs >/dev/null

mkdir -p "$PROFILE/extensions"
TMP="$PROFILE/extensions/.$ID.xpi.$$"
trap 'rm -f "$TMP"' EXIT INT TERM
cp "$ZIP" "$TMP"
mv -f "$TMP" "$PROFILE/extensions/$ID.xpi"
trap - EXIT INT TERM

echo "installed $ID $VERSION -> $PROFILE/extensions/$ID.xpi"
echo "$(du -h "$PROFILE/extensions/$ID.xpi" | cut -f1), $(date -r "$PROFILE/extensions/$ID.xpi" '+%H:%M:%S')"
echo

RUNNING=$(pgrep -f "firefox.*$PROFILE" 2>/dev/null | head -n1 || true)
if [ -n "$RUNNING" ]; then
  echo "Firefox (pid $RUNNING) has this profile open and is still reading the build it loaded"
  echo "at startup, so restart it to get the code above. The add-on's identity does not change,"
  echo "so its moz-extension:// URL keeps working across restarts and a saved popup link is safe."
  echo
  echo "A running Firefox can pick the new build up without a restart, if it was started with"
  echo "the DevTools server open (scripts/run-firefox.sh): node scripts/rdp.mjs reload"
else
  echo "Restart Firefox to load it. Sessions and tabs come back on their own."
fi
