# WhileFree

**Type one prompt. Every AI you use answers it — in its own tab, in your own account.**

WhileFree sends the prompt you just typed in ChatGPT, Claude, Gemini, Perplexity or DeepSeek to
the others you switch on, then tells you when each answer lands and keeps count of where your
AI hours actually go.

Free and open source, with every feature in it. No account, no API keys, no server in the middle,
no analytics. Nothing is sold, gated, trialled or throttled.

---

## What it does

**Ask once, get several answers.** Type in whichever AI you are already in and press *Ask all*.
The same prompt goes to the others you switched on, at roughly the pace a person would type it.
Each one answers in its own tab, in your own account, in its standard mode.

**Walk away.** A green count appears on the toolbar icon as answers land. The panel lists which AI
finished, how long it took, and one click takes you to that conversation. Soft two-note chime
optional, per AI if you like.

**Time, measured.** Every minute in an AI tab is one of three things — writing, waiting, reading —
and the dashboard shows how your week splits between them. Most people expect waiting to be the
biggest slice. It almost never is. Time spent waiting while you were *elsewhere* is counted
separately, which is the number that justifies being told when an answer is ready instead of
watching a spinner.

**Your own benchmark.** Which AI starts answering first, which finishes first on the prompts you
sent to several at once, how many follow-ups each one needed, and how often you gave up and walked
away. Measured on your prompts, not a lab test.

**Is each subscription earning its keep?** Type what you pay per month. You get cost per prompt and
cost per hour of real use, and a plain verdict on anything you are paying for but barely touching.
If you pay $20 a month for an AI you sent two prompts to, it says so.

**Attention detail.** How long you actually watched answers arrive, how much waiting happened while
you were elsewhere, and your longest waits.

**Your rules.** Only alert me for waits over a minute. Chime for these AIs and not those. Quiet
hours. Gap between sends. Which AIs a broadcast goes to.

**Yours to keep.** Export everything as JSON, import it on another computer, or delete it all.
Everything on this list is free. There is no paid tier.

## What it deliberately does not do

- It does not solve CAPTCHAs, "verify you are human" checks, or anything shaped like a bot test.
- It does not work around usage limits, and it does not open hidden or logged-out sessions.
- It does not pretend to be a different browser or hide what it is.
- When a site wants a human — signed out, out of quota, showing a check — it **stops and tells you
  which AI is stuck and why**. Three of the five states it watches for are exactly this.

That is the whole point of the design: it drives the tabs you are already signed in to, at a human
pace, and it hands control back the moment something looks like it needs a person.

## Privacy

- **No prompt or answer text is ever stored.** WhileFree reads the answer's *length* to know whether
  one is still arriving, and nothing else. Only durations, counts and site ids are written to disk.
- **Writing time is measured from the fact that you type**, not from what you type.
- **Nothing leaves your browser.** No account, no sync, no telemetry, no remote config, no server.
  The only network requests this extension makes are the pages you already have open.
- **No passwords.** You sign in to each AI yourself; the extension never sees a credential.
- **The prices you type never leave your computer.**
- The permissions are `storage`, `scripting` and `notifications`, plus host access to the five AI
  sites. Note what is *not* in that list: `tabs`. Host permissions are enough to see the URLs of
  those five sites, so WhileFree cannot read the address of anything else you have open.

Full detail: [PRIVACY.md](PRIVACY.md).

## Install

### From a store

- Chrome Web Store: _(listing pending)_
- Firefox Add-ons: _(listing pending)_

### From source (unpacked)

```bash
git clone https://github.com/whilefree/whilefree.git
cd whilefree
npm run build          # writes dist/chrome and dist/firefox
```

**Chrome** — `chrome://extensions` → enable Developer mode → *Load unpacked* → pick `dist/chrome`.

**Firefox** — `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → pick
`dist/firefox/manifest.json`. For a permanent install, zip `dist/firefox` and submit it, or use
[`web-ext`](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/):

```bash
npx web-ext run --source-dir dist/firefox
```

Then sign in to each AI you want to use, once. Open one, type a prompt, and press **Ask all** in the
launcher at the bottom right of the page.

## Using it

1. Open any of the five AIs and type your prompt as usual.
2. Press **Ask all N** in the small launcher. The prompt stays in *your* box on that page — press
   that site's own send button when you are ready, or leave it.
3. Carry on with your work. The toolbar badge counts the answers as they land.
4. Click an entry in the panel to jump to that conversation. The entry clears itself.

You can also type straight into the popup and send from there, without opening anything first.

## How it works

One source tree, two stores, no bundler.

```
src/
  lib/          shared, dual-mode files (classic script *and* ES module)
  content/      runs on the five AI sites
  background/   the worker: queue, tabs, timings
  popup/        the toolbar panel
  dashboard/    the full-page dashboard
```

**The dual-mode trick.** Chrome MV3 runs a module service worker; Firefox MV3 runs a classic event
page. Instead of building two bundles, every file in `src/lib`, `src/content` and `src/background` is
an IIFE that hangs its exports off one `globalThis.WF` object. That file parses and runs identically
as a classic script (Firefox's `background.scripts`, content scripts) and as a module (Chrome's
`service_worker`, popup, dashboard). The only files that use `import` are the ones that are *only*
ever loaded as modules, and `scripts/build.mjs` generates each browser's manifest from a single
file registry (`src/lib/files.js`) so the two can never drift apart.

**Site adapters.** Every selector for all five sites lives in `src/lib/sites.js` — candidate lists
tried in order, with a structural fallback in `src/lib/dom.js` (the biggest editable box low on the
page; the nearest button that says send) for when a site redesigns. When a site does change, the
popup's **Check this tab's markup** and the dashboard's **Check markup** will tell you exactly which
probe came back empty. A selector fix is usually a one-line pull request.

**How an answer is known to be finished.** New assistant output exists, it has not changed for
~1.1s, and the site's stop button is gone. Only the *length* of that output is ever read.

**No prompt is written to disk.** A broadcast holds the text in the worker's memory for the length
of the fan-out and never persists it. If the worker is torn down mid-job, the fan-out stops rather
than the prompt being saved anywhere. That is a deliberate trade.

## Develop

```bash
npm run check    # syntax, manifest, file-registry, message-type and leak checks
npm test         # node --test: stats, settings, adapters, helpers
npm run build    # both browsers into dist/
npm run icons    # regenerate the PNGs from scratch (pure JS, no dependencies)
npm run verify   # check + test + build
```

There are no runtime dependencies and no development dependencies. Node 18+ is the only requirement.

`npm run check` is the typechecker this project does not have, and it is not cosmetic: it fails the
build if a file listed in `src/lib/files.js` is missing, if a `MSG.*` constant is used without being
declared, if a selector list drifts out of shape, if a shared file starts using `import`, or if a
`console.log` or a credential reaches `src/`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the conventions, and
[docs/STORE_LISTING.md](docs/STORE_LISTING.md) for the store submission material.

## Scope

This extension automates *your* browser using *your* sessions, in the tab you already have open. It
does not use anyone's API, it is not affiliated with OpenAI, Anthropic, Google, Perplexity or
DeepSeek, and it is not endorsed by any of them. Site markup changes; if a site breaks, the adapter
is one file and the fix is usually one line.

## Licence

MIT. See [LICENSE](LICENSE).
