# Store submission material

Everything a store submission needs, in one place. **All copy below is written for this project —
do not paste text from any other extension's listing.** Store listings are copyrighted and copied
marketing copy is one of the fastest ways to get a listing pulled, independently of whether the
extension itself is fine.

## Names and lines

| Field | Value |
| --- | --- |
| Name (Chrome, 45 char max) | `WhileFree: Ask ChatGPT, Claude & Gemini at Once` |
| Name (Firefox, 50 char max) | `WhileFree: Ask ChatGPT, Claude & Gemini at Once` |
| Short description (Firefox, 250 max) | see below |
| Category | Productivity (Chrome: Tools) |
| Language | English |
| Licence | MIT |
| Homepage / support | https://github.com/5ghzx/whilefree |

## Short description

> Type one prompt and send it to ChatGPT, Claude, Gemini, Perplexity, DeepSeek, Grok, Copilot, Le Chat,
> Qwen and Kimi at once, in the tabs you are already signed in to. Know when each answer lands, and see
> where your AI time actually goes. Free and open source, with every feature in it.

## Long description

> **Ask once. Get every answer.**
>
> You have done this: typed a question into ChatGPT, pasted it into Claude, then into Gemini, to see
> who gets it right. WhileFree does the pasting.
>
> Type your prompt once, in whichever AI you are already using, and press Ask all. The same prompt
> goes to the others you switched on — each answering in its own tab, in its own account, at roughly
> the pace a person would type it.
>
> **Ten AIs, not five.** ChatGPT, Claude, Gemini, Perplexity, DeepSeek, Grok, Copilot, Le Chat, Qwen
> and Kimi. Switch on the ones you actually use; there is no cap on how many, and no paid tier to unlock
> the rest.
>
> **Then go and do something else.**
>
> A green count appears on the toolbar icon as answers land. The panel lists which AI finished, how
> long it took, and one click takes you straight to that conversation. There is a soft two-note chime
> if you want one.
>
> **See where your AI hours go.**
>
> Every minute in an AI tab is one of three things: writing the prompt, waiting for the answer, or
> reading it. The dashboard shows how your week splits between them. Most people expect waiting to be
> the biggest slice. It almost never is — which is the argument for being told when an answer lands,
> rather than watching a spinner.
>
> **Your own benchmark, not a lab test.**
>
> Which AI starts answering first, which finishes first on the prompts you sent to several at once,
> how many follow-ups each one needed, and how often you gave up and walked away. Measured on your
> prompts.
>
> **Is each subscription earning its keep?**
>
> Type what you pay per month and see the cost of every prompt and every hour of real use. If you pay
> $20 a month for an AI you sent two prompts to, it will say so, in those words.
>
> **Everything is free.** No trial, no paid tier, no feature gates, no account, no sign-up.
>
> **Take your numbers with you.** Export as JSON to move computers, or as CSV for a spreadsheet: one row
> per day per AI, and one row per timed answer.
>
> **Privacy is the design, not a setting.**
>
> WhileFree never stores or sends what the AIs write back — it only watches whether an answer is
> still arriving, so it can time it. Writing time is measured from the fact that you are typing, never
> from what you type. The prices you enter never leave your computer. You sign in to each AI yourself,
> so it never sees a password. There is no server, no analytics, and no account.
>
> **It stops when a site wants a human.** WhileFree types into the message box and presses the site's
> own send button. It does not solve CAPTCHAs, work around usage limits, open hidden sessions, or
> pretend to be a different browser. When a site is signed out, out of quota, or showing a check,
> WhileFree stops and tells you which AI needs you.
>
> Free and open source under the MIT licence. The whole thing is a few thousand lines of dependency-free
> JavaScript you can read in an afternoon.
>
> Not affiliated with OpenAI, Anthropic, Google, Perplexity or DeepSeek.

## Permission justifications

Chrome review asks for a written reason per permission. These are the answers.

**`storage`** — Stores per-day and per-AI durations (writing, waiting, reading), counts, the user's own
settings, and the monthly subscription prices the user types in. All of it stays in the browser; nothing
is transmitted anywhere.

**`scripting`** — Used only to re-inject the content script into the five supported AI sites when the tab
was already open before the extension was installed, was installed/updated, or navigated without a page
load. No injection happens into any other origin.

**`notifications`** — Optional. Only used when the user switches on "also raise a system notification", to
say that an answer has landed in a tab the user is not currently looking at.

**Host permissions (`chatgpt.com`, `claude.ai`, `gemini.google.com`, `perplexity.ai`, `chat.deepseek.com`)** —
These five sites are the entire functionality. On them, the extension: (1) reads the user's own typed
prompt from a message box, (2) writes that prompt into the corresponding box on the other enabled sites,
(3) clicks the site's own send button, and (4) observes DOM mutations and element lengths to know whether
an answer is still arriving so it can time it. It does not read or store the content of any answer.

**Remote code** — None. No remotely hosted code, no `eval`, no dynamic script injection from a network
source. The extension is fully self-contained.

**Single purpose** — Send one prompt to several AI chat sites at once, and measure the time spent.

## Data-use disclosures (Chrome)

- Does this item collect or use data? **No user data is collected, transmitted, or stored off-device.**
- Sold to third parties: **No.**
- Used or transferred for purposes unrelated to the single purpose: **No.**
- Used or transferred to determine creditworthiness or for lending: **No.**
- Website content: the extension reads on-page text (the user's own prompt) transiently, in memory,
  solely to place it in another site's message box at the user's request. It is never stored or
  transmitted. See `PRIVACY.md`.

## Suggested screenshots

Five, in this order, each 1280×800 (Chrome) or 1280×800 (Firefox):

1. **The fan-out.** One prompt box on the left, five AI rows on the right with "answered in 8s" beside
   each, one highlighted as first.
2. **Answers ready.** The panel with a green count, three entries, and Open actions.
3. **Where the time goes.** The three-way split bar plus the per-day stacked chart.
4. **Is each subscription earning its keep?** The price inputs and the verdict table.
5. **Your own benchmark.** The head-to-head table plus the heatmap.

If you add a sixth, show ten AI chips in the fan-out so the ten-provider claim is visible without
reading the description.

Capture them from the built dashboard, not by retyping any other product's artwork. Use your own
prompts in the screenshots.

## Firefox-specific notes

- `browser_specific_settings.gecko.id` is `whilefree@whilefree.app`; keep it stable across releases or
  Firefox treats an update as a different add-on.
- `strict_min_version` is `115.0` (manifest V3 support with event pages).
- `data_collection_permissions` is declared as `required: ["none"]`, which is accurate: no data leaves
  the device.
- Firefox MV3 runs the background as an **event page**, declared with `background.scripts`. The build
  generates this automatically; see `scripts/build.mjs`.

## Release checklist

1. Bump `version` in `src/manifest.base.json` **and** `package.json` (they must match; `npm run check`
   enforces it).
2. Update `CHANGELOG.md`.
3. `npm run verify`.
4. `npm run package` → `dist/whilefree-chrome-<version>.zip` and `dist/whilefree-firefox-<version>.zip`.
5. Load both unpacked and run through: broadcast from a page, broadcast from the popup, an answer
   landing while on another tab, the badge count, one click to open, a full dashboard render, export
   and re-import, and the markup check on all five sites.
6. Upload the zips. For Firefox, upload the source zip as well if prompted for it — this repository at
   the matching tag *is* the source.
