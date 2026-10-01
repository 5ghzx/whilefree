# WhileFree

**Type one prompt. Every AI you use answers it — in its own tab, in your own account.**

WhileFree sends the prompt you just typed in ChatGPT, Claude, Gemini, Perplexity, DeepSeek, Grok,
Copilot, Le Chat, Qwen or Kimi to the others you switch on, then tells you when each answer lands and
keeps count of where your AI hours actually go. Ten AIs, not five — and no cap on how many at once.

Free and open source, with every feature in it. No account, no API keys, no server in the middle,
no analytics. Nothing is sold, gated, trialled or throttled.

---

## What it does

**Ask once, get several answers.** Type in whichever AI you are already in and press *Ask all*.
The same prompt goes to every AI you switched on that is **already open** — the one you are looking
at included — all at once. Each one answers in its own tab, in your own account, in its standard
mode.

Nothing is opened on your behalf unless you ask for it. A fan-out used to open a tab for every AI
that was closed, which meant one prompt typed in an existing conversation could leave seven new tabs
behind you; now those AIs are reported as *skipped* and the ones you have open get the prompt. The
switch that opens tabs is in the popup (*Open a tab for AIs you have not opened*), and when it is on
those tabs land in one window of their own, behind the one you are working in, so a fan-out never
lands on top of what you were doing — and closing that window once the answers are in takes all of
them with it.

**One switch, if you want one.** The popup opens with the master switch at the top of the *Send to*
card, and it is the feature itself rather than a shortcut for the switches below it. Off means nothing
is sent anywhere — *Send*, the right-click menu, and a prompt typed into an AI's own page all stop —
and the AIs you picked stay picked, so turning it back on asks exactly the AIs it asked before. What
it will not do is spend a sign-in check: switching the feature off and on again leaves the per-AI
switches exactly as they were.

**Your list is yours, and a send only goes where a page agrees.** An AI's own switch is the list of
AIs you use: turning one on opens nothing and asks nobody. What decides a fan-out is the page — a
prompt is typed only into a tab whose own page has said you are signed in, and one that has not said
so is drawn as *not checked yet* and passed by, rather than reported as a pile of silence, which is
the one failure that reads as a bug here rather than as a tab that needs you. There is no setting for
the gate and nothing to choose: an AI that cannot be reached is not a target, and a switch that said
otherwise would only produce silence. A reading is not a licence to stop looking either: the page is
asked again a moment before a prompt is typed into it — and once more before that, because a page
that is still loading has signed-out chrome on screen for as long as its session takes to arrive. A
session that really has ended is caught at the moment it matters, named, and left out.

**The corner says what a press will reach.** The launcher at the bottom right of every AI page counts
the AIs a prompt can actually be delivered to — switched on, signed in, and, while *Open a tab for
AIs you have not opened* is off, already open — so ten switched on and none signed in reads *Ask 0 of
10* rather than promising ten answers, and an AI whose row says *closed* is not inside the number
either. It is the same count, in the same words, as the popup's *Goes to X of Y*, and the page learns
which AIs have tabs open from the background rather than guessing. Hover it and the list opens: every
AI, what its own page last said (*signed in*, *not checked yet*, *off*, or *closed* for a signed-in AI
with no tab open), with the one you are looking at marked as *this page*. A press that gets refused holds that
list open beside the reason, and the master switch being off is named on the pill with the one press
that fixes it. What a refusal says also leaves on its own — a deadline rather than a bare timer, so a
tab that was in the background cannot come back to a message that is no longer true — and it has a ×.

**The panel asks rather than remembers.** Every time the popup opens, each AI that has a tab open is
asked what its page is showing, so a reading from an hour ago is never presented as the present tense.
A site with no tab open has nothing to be wrong about anyway, and the row says so.

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

**Yours to keep.** Export everything as JSON, or as CSV — one row per day per AI, and one row per timed
answer. Import it on another computer, or delete it all. Everything on this list is free. There is no
paid tier, no trial, and no licence check anywhere in the code.

## Ten providers

| | |
| --- | --- |
| ChatGPT | Claude |
| Gemini | Perplexity |
| DeepSeek | Grok |
| Copilot | Le Chat (Mistral) |
| Qwen | Kimi |

Adding another is a one-file change: an adapter in `src/lib/sites.js`, plus its host permission. Every
provider is available by default, so a new one is never silently missing. Kimi moved to
**kimi.ai**, which is where new conversations are opened — the old addresses still work and are still
claimed, so a tab you opened before the move keeps counting.

## What it deliberately does not do

- It does not solve CAPTCHAs, "verify you are human" checks, or anything shaped like a bot test.
- It does not work around usage limits, and it does not open hidden or logged-out sessions.
- It does not pretend to be a different browser or hide what it is.
- When a site wants a human — signed out, out of quota, showing a check — it **stops and tells you
  which AI is stuck and why**. Three of the five states it watches for are exactly this.

That is the whole point of the design: it drives the tabs you are already signed in to, one prompt at
a time per site, and it hands control back the moment something looks like it needs a person.

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

### From a release

Every release on [the releases page](https://github.com/5ghzx/whilefree/releases) carries both builds
— `whilefree-chrome-<version>.zip` and `whilefree-firefox-<version>.zip` — attached by
[`verify.yml`](.github/workflows/verify.yml) from the tagged commit, so the zips and the tag are the
same code. Unzip the Chrome one before loading it (*Load unpacked* wants a directory); Firefox takes
the XPI as it is.

### From source (unpacked)

```bash
git clone https://github.com/5ghzx/whilefree.git
cd whilefree
npm run build          # writes dist/chrome and dist/firefox
```

**Chrome** — `chrome://extensions` → enable Developer mode → *Load unpacked* → pick `dist/chrome`.

**Firefox** — `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on* → pick
`dist/firefox/manifest.json`.

Temporary add-ons are gone after a browser restart, so for a profile that keeps it, drop the packaged
XPI into the profile and start Firefox with signature checks off (Developer Edition or Nightly):

```bash
npm run package
cp dist/whilefree-firefox-*.zip "$PROFILE/extensions/whilefree@whilefree.app.xpi"
```

The XPI is a plain zip of the build directory with `manifest.json` at the root, so the store upload and
the local install are the same file. `extensions.autoDisableScopes` must be `0` for Firefox to load a
profile-scope add-on without a confirmation click. [`web-ext`](https://extensionworkshop.com/documentation/develop/getting-started-with-web-ext/)
works too, with a disposable profile:

```bash
npx web-ext run --source-dir dist/firefox
```

### First run

Installing opens the dashboard at its welcome card, and that card is the one thing WhileFree asks of
you: which AIs you use. Every AI starts switched **on**, because that list is what you want rather
than what a page has confirmed — so there is nothing to decide before the first prompt, and nothing
is switched off out of the box. The first prompt is where the other half shows up: it goes to the AIs
whose own page has said you are signed in, the rest are named as left out, and a row still reading
*not checked yet* is one whose page has not been asked yet. The same list sits in the *Sites* card
below, so it can be changed at any time without reinstalling.

### The development loop

```bash
npm run dev            # rebuilds dist/firefox on every save
npm run dev -- chrome  # or the other target
```

Leave that running and, in Firefox, hit **Reload** on the extension card in
`about:debugging#/runtime/this-firefox` after a change. `about:debugging` keeps the profile you are
already signed into — which matters here, because testing any of this needs a real ChatGPT or Claude
session. Two things behave differently in Firefox and are expected to: the answer chime falls back to a
tone played inside an AI tab (Firefox has no offscreen API, so it cannot sound while you are in another
app), and `about:debugging` add-ons are temporary, so they are gone after a browser restart.

Then sign in to each AI you want to use, once. Open one, type a prompt, and press **Ask all** in the
launcher at the bottom right of the page.

## Using it

1. Open any of the AIs and type your prompt as usual.
2. Press **Ask all N** in the small launcher — *N* is the number of AIs a prompt can reach, and
   hovering it lists them. The prompt stays in *your* box on that page — press that site's own send
   button when you are ready, or leave it.
3. Carry on with your work. The toolbar badge counts the answers as they land.
4. Click an entry in the panel to jump to that conversation. The entry clears itself.

You can also type straight into the popup and send from there, without opening anything first.

## How it works

One source tree, two stores, no bundler.

```
src/
  lib/          shared, dual-mode files (classic script *and* ES module)
  content/      runs on the ten AI sites
  background/   the worker: fan-out, tabs, timings
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
npm test         # node --test: the pure logic, plus the background against a fake browser
npm run build    # both browsers into dist/
npm run icons    # regenerate the PNGs from scratch (pure JS, no dependencies)
npm run verify   # check + test + build
```

There are no runtime dependencies and no development dependencies. Node 18+ is the only requirement.

`npm run check` is the typechecker this project does not have, and it is not cosmetic: it fails the
build if a file listed in `src/lib/files.js` is missing, **or if a file exists that nothing loads**, if a
`MSG.*` constant is used without being declared, if a `WF.x.y` reference has no definition in a file that
is in the same load list, if a selector list drifts out of shape, if a shared file starts using `import`,
or if a `console.log` or a credential reaches `src/`.

Those last two exist because all three of the worst bugs found so far passed everything else:
`WF.browser.storageGet` built an API call from a dotted method name and so persisted nothing at all,
`content/netwatch.js` and `background/ledger.js` were shipped but never loaded, and the "mark this one
done" escape hatch reached for a watcher nothing published. `tests/background.test.mjs` loads the real
background against a fake browser for the same reason.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the conventions, and
[docs/STORE_LISTING.md](docs/STORE_LISTING.md) for the store submission material.

## More documentation

- **[docs/FEATURE-PARITY.md](docs/FEATURE-PARITY.md)** — every claim in the product's specification,
  checked off against what this code actually does, including the gaps.
- **[docs/SITE-BEHAVIOUR.md](docs/SITE-BEHAVIOUR.md)** — the niche, undocumented per-site behaviours
  (sticky slow modes, React-controlled textareas, virtualised conversations, `div`-based send buttons)
  and how each is handled. This is the file to read before fixing a broken site.
- **[docs/UPSTREAM-FINDINGS.md](docs/UPSTREAM-FINDINGS.md)** — what reading the published WhileAI
  bundle turned up: how their toolbar count decides what to show, the alert rules, and the per-site
  behaviours that are documented nowhere else — plus exactly which of it we adopted and which we
  deliberately did not.
- **[docs/ROADMAP.md](docs/ROADMAP.md)** — what to build next, and what deliberately not to build.
- **[PRIVACY.md](PRIVACY.md)** — the data promises, written so they can be checked against the code.

## Scope

This extension automates *your* browser using *your* sessions, in the tab you already have open. It
does not use anyone's API, it is not affiliated with OpenAI, Anthropic, Google, Perplexity or
DeepSeek, and it is not endorsed by any of them. Site markup changes; if a site breaks, the adapter
is one file and the fix is usually one line.

## Licence

MIT. See [LICENSE](LICENSE).
