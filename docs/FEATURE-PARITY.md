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
| A queue, so your next prompt waits its turn instead of colliding | ➕ **Deliberately dropped.** Every AI is sent to at once, and a second prompt starts immediately rather than waiting in line. Two prompts cannot interleave in one message box: the second is told that site is busy and says so. | `engine.js` → `broadcast()`, `busySites` |
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
| Send to all five AIs at once | ✅ Ten, and switching a provider on is a one-file change. ➕ One master switch in the popup stops and starts the feature in one press — off means nothing is sent anywhere and your per-AI picks are kept, so the switch costs a click rather than a re-selection. | `lib/sites.js`, `popup/popup.js` |
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
| One prompt at a time, at the pace a person would | ➕ All targets are warmed in parallel and sent at once; the only pause left is inside one site, between typing and pressing send (`settleMs`, default 60–160 ms), because that is the one the page needs. | `settings.settleMs`, `content/composer.js` |
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
| You sign in yourself, so it never sees a password | ✅ No credential or cookie access; no `cookies` permission. Reading cookie *names* would be possible with the permission, and it is the wrong question: a session ends server-side while its cookie stays, so a stale cookie and a live one look identical from here, and this is the one answer that must never be wrong. The page is the only thing that can say whether it is signed in, so the page is asked — and it is asked without opening or raising anything unless the answer is no. It is asked *again* in the moment a prompt is about to be typed, because a session can end without the page's markup changing: a stored yes from last week is not evidence about the session in front of you. It is also asked *twice* before a "no" is believed, because these pages draw signed-out chrome while their session is still arriving, and one reading taken during that second is not a session that ended. The panel asks every open AI tab the same question whenever it is opened, so the answer shown is never a memory. | `manifest.base.json`, `background/engine.js`, `content/main.js`, `lib/status.js` |

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

*Rewritten after reading the published WhileAI `0.10.0` bundle. This list is source-level, not
spec-level: it says what their code does that ours does not, which is the only honest way to answer
"are we 1:1". Facts, provenance and the reasoning are in
[UPSTREAM-FINDINGS.md](UPSTREAM-FINDINGS.md).*

### Closed since the first audit

Every numbered gap below was implemented in the pass that followed this list. The audit stays here
because the reasoning is the useful part; the status line says where each one stands now.

1. ~~**Sending a prompt in the AI's own message box does not fan out.**~~ **Built.** A prompt sent in an
AI's own box fans out to the others with no second press, and a delivery ledger tells our own echo apart
from you asking something — without which the fan-out would loop forever.
2. **Answer completion is DOM-only.** **Partly built.** Their answer is endpoint patterns watched from a
page-world script; ours reads the page's own resource-timing timeline (`content/netwatch.js`) and treats
the first byte of the conversation stream as the first word, with the DOM as the fallback.
*Unverified against live pages* — this is the measurement to watch.
3. **No retry after a failed send.** **Built.** Two attempts by default, and the retry's first question is
whether the prompt already landed, so retrying cannot double-send.
4. **No per-AI model record.** **Built, and further than theirs.** They hardcode `model: null,
mode: "unknown"`; we read the label off the page and the dashboard splits a site into the models it was
really run on.
5. **No new-chat / continue choice.** **Built.** A switch in the popup and a select in the dashboard.
6. **No "lockstep".** **Built.** A prompt is held back if an enabled AI is signed out, out of quota or
showing a check, and one notification says which.
7. **Nothing is filed when a turn is abandoned.** **Built.** A five-minute alarm files it as `orphaned`,
and a later pass reclassifies a network-only turn as `noise` so it cannot drag the averages.
8. **Queue control is coarser.** **Built, then replaced.** There is no queue to control: a broadcast
goes out all at once, and each AI can still be stopped or retried on its own — including after the
broadcast has finished, from the outcome the popup leaves on screen — plus a comparison window for the
tabs that answered.
9. **"An AI needs you" reaches the badge and the popup, not the screen.** **Built.** A system
notification for a blocked AI and for "nothing was sent", on by default, deduplicated to one per five
minutes.
10. **The weekly report is on demand, not scheduled.** **Built.** An alarm delivers it, and the dashboard
has a *Send it now* button for when a week is longer than you want to wait.
11. **No tab groups and no comparison window.** **Built.** Broadcast tabs go into one group where the
browser supports it, and the popup can put the answering tabs side by side.
12. **Site adapters are unverified against live pages.** **Partly verified.** The content scripts have
now been confirmed running against a real chatgpt.com conversation and claude.ai, reporting the composer
they found; the sending, answer and stop selectors for all ten providers still need a live pass, and the
*Diagnose this tab* button in the popup is how to do it.

### Still open

- **Repairing a site that broke, by storing local selector overrides.** Their version is a remote
`selectors.json` plus an adapter-health POST to their own host; ours would be entirely local, which is the
only version that fits "no server in the middle". The *Diagnose* report already names which probe came
back empty, so this is the missing half of a diagnostic we already ship. ➖ **User-defined providers are
dropped**: a provider nobody has verified against a live page makes the timing and the diagnostic worse,
and adding one to `src/lib/sites.js` is a few lines for anyone who wants it.
- **A prompt library.** It would store *your* text, which the privacy policy currently promises never to
keep, so it needs a decision before it needs code.
- **Answer-consensus scoring.** Same conflict, louder: it has to read answers, which could only be
defensible as a one-shot, in-memory, explicitly-requested exception.
- **Alert rules of their kind** — chime for some AIs and not others exists, but "only waits over a minute"
applies to notifications rather than to the chime.

### Where we are already ahead

- **Ten providers to their five** — Grok, Copilot, Le Chat, Qwen and Kimi included, and no cap on how
many a broadcast can reach (theirs stops at two without Pro).
- **Firefox, as a first-class build** — they ship Chrome only.
- **No server, at all.** They fetch a remote `selectors.json` and POST adapter health (provider, failing
selectors, version) to their own host, and validate licences against Polar. We make no network requests
of our own; the only traffic is to the AI you asked.
- **Nothing is gated.** No licence check, no trial clock, no feature flag — including the alert rules,
CSV export, full history and heatmap that their Pro tier gates.
- **Readable source.** MIT, no dependencies, no bundler, no minification. Their bundle is ~3000 lines of
minified service worker; ours can be read in an afternoon.
