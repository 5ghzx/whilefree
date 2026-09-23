# Contributing

The most valuable contribution to this project is not a feature. It is **a one-line selector fix
when a site changes its page**, because that is the thing that breaks, and it is the thing users
cannot fix themselves.

## The five-minute version

```bash
git clone https://github.com/5ghzx/whilefree.git
cd whilefree
npm run verify     # check + test + build
```

No dependencies are installed. There is nothing to `npm install`.

## Reporting a broken site

1. Load the extension (`dist/chrome` or `dist/firefox`).
2. Open the AI that is misbehaving.
3. Popup → **Check this tab's markup** (or dashboard → *Sites* → **Check markup**).
4. Paste that output into an issue.

It says which probe came back empty — composer, send button, stop button, answer nodes — which is
usually enough to name the fix without any further digging.

## Conventions

These are unusual on purpose. They are what keeps a two-browser extension buildable with no bundler.

### 1. Shared files are dual-mode

Every file under `src/lib`, `src/content` and `src/background` is an IIFE that attaches what it
exports to a single `globalThis.WF` namespace:

```js
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});
  WF.thing = { doStuff };
})();
```

- **Never** use `import` or `export` in those files. They are loaded as *classic scripts* by content
  scripts and by Firefox's background event page, where `import` is a syntax error.
- The `WF` object must be created at the top of every file, because load order is the manifest's
  business, not a module graph's.
- Files that are *only* ever loaded as modules — `src/background/entry.chrome.js`,
  `src/popup/popup.js`, `src/dashboard/dashboard.js` — do use `import`.

`npm run check` enforces all of this.

### 2. Adding a file means registering it

Add it to the right list in `src/lib/files.js`. That single registry drives both manifests, the
build, and the runtime re-injection path. `npm run check` fails if the lists and the directory
disagree, or if the load order would run a file before its dependencies.

### 3. Site knowledge lives in one file

Selectors, hosts, timeouts and per-site quirks all live in `src/lib/sites.js`, as *candidate lists*
tried in order:

```js
send: {
  mode: 'click',
  selectors: ['button[data-testid="send-button"]', 'button[aria-label="Send prompt"]'],
},
```

Add the new selector **at the front** of the list if it is the most reliable. Never replace the whole
list with one clever selector: the fallbacks in `src/lib/dom.js` and the layer of candidates after it
are what keep the extension working between fixes.

### 4. Only durations and counts may be stored

Adding anything that could contain prompt or answer text, or a page title that reveals either, is a
privacy regression and a bug. See `PRIVACY.md` — it makes specific promises that the code has to keep.

### 5. Nothing may try to defeat a site's protections

No CAPTCHA solving, no usage-limit evasion, no hiding from detection, no faking the user agent. When
a site puts up a check, the correct behaviour is to stop and tell the user, which is what
`WF.ATTENTION` exists for. Pull requests that go the other way will be closed.

### 6. Messages go through the protocol

Declare every message type in `src/lib/protocol.js` and use `WF.MSG.*`. `npm run check` fails if you
use a constant you have not declared, which is how this codebase avoids the classic extension bug of
two contexts quietly disagreeing about a string.

## Tests

`npm test` runs `node --test` over `tests/`. Everything covered there is pure logic — stats, settings
resolution, adapter shape, helpers — because that is the part that can be tested without a browser.
The DOM heuristics cannot be unit-tested honestly; they are checked against real pages with the
markup diagnostic instead.

If you add a stat, a setting or an adapter, add the test that pins its behaviour.

## Commit messages

One line, imperative, explaining *why* rather than restating the diff. If it fixes a site, say which
site and what changed about it.

## Review

`npm run verify` must pass. Beyond that, the review question is always the same: does this need
another permission, another stored field, or another site-specific branch? Prefer the answer that
adds neither.
