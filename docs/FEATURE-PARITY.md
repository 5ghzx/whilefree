# Feature parity audit

Every claim from the WhileAI store listing, checked against what this codebase actually does.

This audit is of the **published specification**, not of their source. Behaviour is not protectable,
so matching it feature-for-feature is legitimate; the only thing off-limits is copying their code
expression. Where a behaviour is undocumented, it is inventoried in
[SITE-BEHAVIOUR.md](SITE-BEHAVIOUR.md), which lists every site-specific quirk we handle and every one
still unverified.

Legend: **✅ same or better · ⚠️ partial · ➕ ours only · ⛔ deliberately not copied**

---

## Free tier, as they describe it

| Their claim | Ours | Where |
| --- | --- | --- |
| Unlimited prompts, sent to two AIs at a time | ✅ Unlimited, sent to **all ten** at once. No cap, because there is no paid tier to protect. | `background/engine.js` |
| A queue, so your next prompt waits its turn instead of colliding | ✅ Serialised job queue; a second press returns `queued: true` and the panel says so. | `engine.js` → `broadcast()` |
| An "answers ready" list | ✅ In the popup and in-page, newest per AI, `Ready after 48s · just now`, `Open →`. | `background/answers.js`, `content/overlay.js` |
| A count on the toolbar icon | ✅ Green badge, plus the toolbar **tooltip** now reads "N answers ready". | `answers.updateBadge()` |
| A chime for each answer, one switch away | ✅ Synthesised two-note chime, no audio file. Global switch, per-AI mute, quiet hours. | `content/overlay.js` → `chime()` |
| A warning when an AI needs you: signed out, out of quota, or showing a check | ✅ Five reasons: signed-out, quota, check, message box missing, send failed. Each stops and is labelled. | `lib/protocol.js` → `WF.ATTENTION` |
| Dashboard for the last 7 days: writing, waiting, reading + totals per AI | ✅ 7/30/90/all ranges, per-AI table, stacked per-day chart. | `dashboard/dashboard.js` |
| Weekly and monthly summary cards you can share | ✅ **This week** (calendar, Monday start), **this month**, 7/30 rolling, and everything. Copy or download as text. | `stats.weekKeys/monthKeys` |
| Export as JSON, import on another computer, or delete it | ✅ Also **CSV** (see below). Import merges by default so nothing is lost. | `lib/storage.js` |

## Pro tier, as they describe it — all free here

| Their claim | Ours | Where |
| --- | --- | --- |
| Send to all five AIs at once | ✅ Ten, and switching a provider on is a one-file change. | `lib/sites.js` |
| Your full history, not only the last 7 days | ✅ "All" range covers every day recorded, with no pruning of the rollups. | `stats.allKeys()` |
| A heatmap of when you use AI | ✅ Weekday × hour, Monday first, waiting time only. | `stats.heatMatrix()` |
| Is each subscription earning its keep? | ✅ Price per month per AI → cost per prompt, cost per hour of real use, verdict dot. | `stats.costRows()` |
| "If you pay 20 dollars a month for an AI you opened twice, it says so" | ✅ Generates that sentence, in those words, naming the worst offender and its yearly cost. | `stats.costNote()` |
| Head to head: starts answering first, finishes first on shared prompts, follow-ups each needed | ✅ First-words median, typical answer, slowest 1 in 10, wins on shared prompts with a FASTEST marker, switched-away %, follow-ups. | `stats.headToHead()` |
| Attention detail: watched answers arrive, waiting elsewhere, longest waits | ✅ All three, plus a ranked longest-waits list. | `stats.attentionDetail()` |
| A weekly report | ✅ On-demand weekly card. ➕ **Not scheduled** — see ROADMAP. | `stats.summaryCard()` |
| Your own alert rules: only waits over a minute | ✅ Selector: any / 30s / 1m / 2m / 5m, applied to both chime and system notification. | `settings.notifyMinWaitMs` |
| A chime for some AIs and not others | ✅ Per-AI mute chips. | `settings.chimeSites` |
| CSV export | ✅ **Two** CSVs: one row per day per AI, and one row per timed answer. | `storage.exportDailyCsv/exportAnswersCsv` |
| Pro is $5/mo, $39/yr, $49 once, 14-day trial, Polar | ⛔ Not copied. Everything above is free, permanently, with no licence check in the code. | — |

## How it behaves, as they describe it

| Their claim | Ours | Where |
| --- | --- | --- |
| Types into the message box and clicks send | ✅ Three insertion strategies, verified by reading the box back. Clicks the button **or** presses Enter, with the other as fallback. | `content/composer.js`, `lib/dom.js` |
| One prompt at a time, at the pace a person would | ✅ Serial fan-out with a configurable 900–1700 ms gap, plus a 220–650 ms pause between typing and sending. | `settings.paceMs/settleMs` |
| Standard mode, switching off a slow research/thinking mode the site left on (they name DeepSeek) | ✅ DeepSeek DeepThink + Search off by default. ➕ Nine more slow modes catalogued (Gemini Deep Research, Perplexity Research/Pro Search, Grok Think, Copilot Think Deeper, Qwen/Kimi Thinking, Claude extended thinking), each opt-in so we never click a switch the user chose. | `sites.togglesOff`, `sites.applyQuirks()` |
| Does not solve CAPTCHAs, work around usage limits, open hidden sessions, or fake a browser | ✅ None of it, anywhere. A human check is a **terminal state**, not an obstacle. | `WF.ATTENTION.CHECK` |
| When a site puts up a check or says you hit a limit, it stops and tells you | ✅ Detected during the wait too, not only before sending, so a mid-answer limit surfaces instead of timing out. | `content/detect.js` |

## Privacy, as they describe it

| Their promise | Ours | Where |
| --- | --- | --- |
| Prompts and timings stay in your browser, no account, no analytics | ✅ No network calls of our own at all; `PRIVACY.md` is auditable against `storage.js`. | — |
| Never stores or sends what the AIs write back; only watches whether an answer is still arriving | ✅ Only the character **count** is read. Prompts are held in memory for the fan-out and never persisted. | `content/detect.js`, `background/engine.js` |
| Writing time measured from the fact that you type, never from what you type | ✅ Input events set a timer; values are never read. Our own insertion is excluded by a guard window. | `content/tracker.js` |
| Prices never leave your computer | ✅ Plain field in local storage. | `settings.prices` |
| You sign in yourself, so it never sees a password | ✅ No credential or cookie access; no `cookies` permission. | `manifest.base.json` |

## Beyond parity — what we do that they do not

➕ **Ten providers instead of five**: Grok, Copilot, Le Chat, Qwen and Kimi alongside the original five.

➕ **No `tabs` permission.** Host permissions for the ten sites are enough to read *those* tab URLs, so
this extension cannot see the address of anything else you have open. Their listing does not mention
permissions at all, and the install warning is the first thing a careful user looks at.

➕ **A markup diagnostic.** Both the popup and the dashboard can report exactly which probe came back
empty on a live page. This is the only defence against the thing that will actually break, and it turns
a broken site from a bug report into a one-line pull request.

➕ **Self-documented invariants.** `npm run check` fails the build if a manifest, the file registry and
the message protocol disagree — including if the Chrome build loses its service worker, which it did
once during development.

➕ **An auditable provenance.** MIT, no dependencies, no minification, no remotely hosted code. The
whole extension can be read in an afternoon.

## Gaps, stated plainly

1. **Site adapters are unverified against live pages.** They were written from knowledge of each site's
   markup plus structural fallbacks. Nobody has run this in a browser yet. This is the one real gap and
   the reason the markup check exists. [SITE-BEHAVIOUR.md](SITE-BEHAVIOUR.md) lists what to test first.
2. **The weekly report is on demand, not scheduled.** The number is there; the automation is not.
3. **Their bundle has not been read**, so undocumented behaviour outside the list in
   SITE-BEHAVIOUR.md may still be missing. That pass is available on request — it is a fact-extraction
   exercise, and the boundary is that facts get reimplemented in our own structure.
