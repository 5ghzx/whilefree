#!/usr/bin/env sh
#
# Launch Chromium with WhileFree loaded, in a profile of its own.
#
# Why a profile of its own: this extension drives the ten AI sites you are signed in to,
# and it should not share a profile with a different extension that drives the same sites
# — or with the browser you use for everything else, where ten tabs appearing is not a
# test but an intrusion. A dedicated user-data-dir is also the only way to know which
# install you are looking at.
#
# The path can be overridden, so a second profile for a second extension is one variable:
#
#   WF_PROFILE=~/snap/chromium/common/other-profile scripts/run-chromium.sh
#
# Chrome 137 and later ignore --load-extension unless this flag turns the block off, which
# is why it is here rather than in the docs. If the browser is old enough not to know the
# feature, the flag is ignored.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
dist="$root/dist/chrome"
profile=${WF_PROFILE:-$HOME/snap/chromium/common/whilefree-profile}

if [ ! -f "$dist/manifest.json" ]; then
  echo "no build in dist/chrome — run: npm run build" >&2
  exit 1
fi

browser=${WF_CHROMIUM:-}
if [ -z "$browser" ]; then
  for candidate in chromium chromium-browser google-chrome google-chrome-stable; do
    if command -v "$candidate" >/dev/null 2>&1; then
      browser=$(command -v "$candidate")
      break
    fi
  done
fi
if [ -z "$browser" ]; then
  echo "no Chromium-based browser found — set WF_CHROMIUM=/path/to/chromium" >&2
  exit 1
fi

mkdir -p "$profile"
echo "browser  $browser"
echo "profile  $profile"
echo "loading  $dist"

exec "$browser" \
  --user-data-dir="$profile" \
  --load-extension="$dist" \
  --disable-features=DisableLoadExtensionCommandLineSwitch \
  --no-first-run \
  --no-default-browser-check \
  "$@"
