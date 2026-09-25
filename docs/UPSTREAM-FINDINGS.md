# What we learned from WhileAI's bundle

Notes from reading the published WhileAI extension (Chrome, id `jkemgnopkjenepaohooaghojmoabplmp`,
version `0.10.0`, 131 KiB packed / 412 KiB unpacked, 32 files) against our own build.

## Provenance, and the line we held

The bundle was downloaded to a scratch directory **outside this repository** and never
committed. Its licence is proprietary — all rights reserved, sold through Polar — and
searches for a previously open-source release turned up nothing but the author's own
Reddit post, so there is no licence grant for us to stand on for its *code*.

So: **behaviour and facts were extracted; expression was not.** What follows is a list
of things that are true about these websites and about how the extension behaves —
selector lists, toggle labels, timing thresholds, state names. Those are interoperability
facts, and reimplementing from them is ordinary engineering. No file, function or
comment from that bundle was copied into this repo, and nothing in `src/` is a
transcription of theirs. Where our code now behaves the same way, it is because we wrote
it from the documented behaviour plus these notes.

Their file layout, for the record, because it is worth knowing how they split the work:

| Their file | Ours |
| --- | --- |
| `background.js` (~3000 lines, minified) | `background/*.js`, split by concern |
| `content.js`, `broadcast.js` | `content/*.js` |
| `main-world-<site>.js` (`world: MAIN`, per site) | `lib/dom.js` + page-world probe in `content/*` |
| `dashboard.js`, `popup.js` | `dashboard/`, `popup/` |
| `offscreen.html/js` | `offscreen/` (adopted, see below) |

## The toolbar count — how they do it

This was the specific question, and it is more considered than "show how many answered".

```js
badgeFor(problems, ready) {
  if (problems > 0) return { text: cap(problems), color: '#b45309', title: 'N AIs need your attention' };
  if (ready    > 0) return { text: cap(ready),    color: '#15803d', title: 'N answers are ready' };
  return { text: '', color: '#15803d', title: 'WhileAI' };
}
```

Five rules in that, all of which we now follow:

1. **Two counts, one icon.** *Problems* are AIs asking for the user (signed out, quota
   exhausted, behind a challenge) — stored with a **6 hour** life. *Ready answers* are
   finished answers not yet visited — **12 hour** life, capped at **20** entries.
2. **Attention outranks answers**, and changes the colour: amber `#b45309` beats green
   `#15803d`. An AI that is blocked is losing you time right now; a finished answer is
   merely waiting.
3. **One digit only**: `>9` renders `9+`, so the number never outgrows the badge.
4. Turning the answer count off (`badgeEnabled: false`) suppresses only the *ready*
   count — warnings still show. A muted notification is not the same as a missed one.
5. `action.setBadgeBackgroundColor` is only called when the text is non-empty, and the
   hover title always says the same thing as the badge. Hovering is a second way to read
   the count, which is why their tooltip is a sentence and not the product name.

**When it refreshes:** tab activated, window focus changed, tab removed, a turn
completes, install, startup, and their queue alarm. Activating a tab also **deletes the
ready entry for that tab** — visiting the conversation is the same as clicking it, so
the count falls without the user tidying up.

**The thing we expected and did not find:** there is **no OS notification for a finished
answer** in 0.10.0. `notifications.create` is called for exactly four things — an AI that
needs you, the free-tier target limit, "nothing was sent", and the weekly report. The
answer descriptor they build (`"<AI> has answered"`, "Ready after 42s. Click to open the
conversation.") is computed every time and then used *only* as a boolean gate for the
ready list and the chime. So their "an answer landed" alert really is: the green count,
the hover title, the chime, and the popup list. Our optional system notification is an
addition on top of parity, not a gap.

**Answer alerting rules**, which we adopted in full:

- Notify only if the tab was **not** the focused, visible one ("still watching" — an
  answer you watched arrive is not news).
- A minimum wait threshold, clamped to a fixed ladder `[0, 5s, 10s, 30s, 60s, 2m, 5m]`.
- Per-AI sound muting, plus a plan-gated "notification rules" switch.
- Clicking a notification focuses that AI's tab; clicking the weekly report opens the
  dashboard at `#week`. The notification is `clear`ed after the click.
- The chime plays from an **offscreen document** with `AUDIO_PLAYBACK`, created on
  demand and closed ~4s later. Their HTML comments say why: a service worker has no
  audio output, and macOS ignores `silent: false` on a notification, so the "play a
  sound" setting silently did nothing. Their chime is a two-note bell in `chime.wav`.
  We generate our own tone (`scripts/make-audio.mjs`); theirs is not ours to ship.

## Undocumented behaviour worth knowing about

The reason for the pass. None of this is in the store listing.

1. **Network is the real clock; the DOM is the fallback.** Four of the five sites have
   `streamingSelector: null` and instead carry `endpointPatterns` —
   `/backend-(api|alt)/(f/)?conversation` (ChatGPT), `/completion` (Claude),
   `/StreamGenerate` (Gemini), `/rest/sse/perplexity_ask` (Perplexity),
   `/api/v0/chat/completion` (DeepSeek). They watch those requests from a MAIN-world
   script, which is what produces a real time-to-first-token (`ttftMs`) rather than a
   guess from how fast the DOM moved. **This is the single biggest architectural
   difference from our build**, which is DOM-only today.
2. **DeepSeek's slow mode is a toggle that stays on.** Their DeepSeek entry is the only
   one with `modeResetSelectors`, and it is a *selected* toggle: `.ds-toggle-button.ds-toggle-button--selected`. Sending with DeepThink already on silently changes the
   answer's cost and latency, so they click the selected toggles off before every send.
   Neither ChatGPT's nor Claude's deep-thinking switch is touched by default.
3. **"Thinking" is a separate state from "streaming".** ChatGPT and Claude carry
   `thinkingSelector: '[data-testid="thinking-indicator"]'`; Claude additionally has
   `streamingSelector: '[data-is-streaming="true"]'`. A stop button appearing is not the
   same as an answer arriving, and the list of candidates they match for Claude's stop
   control includes `button[data-state="open"][aria-label*="top"]` and
   `fieldset button[type="submit"][aria-busy="true"]` — the send button *becomes* the
   stop button, which is exactly the trap in treating "did the send button disappear"
   as confirmation.
4. **A send button that only exists once the box has text.** Their ChatGPT list includes
   `[data-testid="composer-send-button"]` and `#composer-submit-button` alongside
   `[data-testid="send-button"]`; Gemini matches `button:has(mat-icon[fonticon="arrow_upward"])`
   and, notably, Turkish labels (`button[aria-label="Mesaj gönder"]`). Localised
   `aria-label`s are a real failure mode on Google properties.
5. **Your own prompt comes back as a user message.** They read it to detect their own
   echo: per-site `userMessageSelectors`, a SHA-256 of the trimmed prompt stored in a
   10-minute `echoLedger`, and `mayHaveLanded` retry semantics — if insertion or
   submission failed *after* the text was already in the box, the retry asks for state
   and checks `lastUserHash` before sending again, so a retry can never double-send.
6. **Fan-out is not exclusive to their UI.** `captureFromAnyTab` means typing a prompt
   into any enabled AI tab triggers the broadcast. Anything you type, not only what you
   type into their popup.
7. **Duplicate suppression on the prompt itself**: the same hash within 10s is ignored
   outright; a "re-offer" of an identical prompt is allowed after 45s.
8. **Pacing and patience**: a 3s minimum gap between two runs *on the same provider*;
   60s default wait per run (30 minutes when "long mode" is on for that provider);
   queue ticks driven by `alarms` so the worker survives suspension.
9. **Terminal states are per-AI, not global.** `needs_login` and `blocked_challenge`
   pause that provider and raise an amber problem; every other site carries on. Error
   codes are a closed set (`NO_COMPOSER`, `QUOTA_EXHAUSTED`, `NOT_ACCEPTED`,
   `ADAPTER_BROKEN`, `NO_SCRIPT`, `TAB_GONE`, `CONVERSATION_PAUSED`, …), each with a
   written-for-humans message.
10. **Closing an AI's last tab switches that AI off.** With no tab left, the provider is
    disabled in settings and its outstanding runs are cancelled — rather than leaving a
    queue pointed at a browser window that no longer exists.
11. **They file orphans rather than losing them.** A turn with no completion, idle >90s
    or older than 1h, is stored with `status: "orphaned"`, `confidence: "low"`, and its
    platform, so the totals stay honest. A 30s `capture-poll` alarm probes open AI tabs
    and re-arms stranded watchers after the worker is suspended.
12. **Noise is a status.** A turn with `totalWaitMs <= 5` whose only signal was network
    is reclassified to `status: "noise"` on a later pass — background chatter that
    looked like a turn gets walked back instead of deflating the averages.
13. **The turn record is designed for model-level tracking**, whether or not it is
    populated: `platform, model, mode, startedAt, totalWaitMs, ttftMs, streamMs,
    visibleMs, hiddenMs, focusMs, escapeCount, bytes, status, confidence, signals,
    adapterVersion, schemaVersion`, with a `schemaVersion` migration map and csv/json
    export keyed on the same columns. Their `modelSelectors` exist per site, so the
    tracking path can name the model — but **in 0.10.0 both write paths I read hardcode
    `model: null, mode: "unknown"`**, so the headline "model-level tracking" is schema
    and UI, not capture, as shipped.
14. **Tab groups and a comparison window.** Broadcast tabs are grouped (`tabGroups`,
    title "whileAI", blue) and there is a second window for side-by-side comparison,
    plus window/tab ids held in `storage.session`.

## Their self-healing adapters, and why ours will differ

They ship two mechanisms, both server-dependent:

- `https://ahmetaytar.com/whileai/selectors.json` — remote selector config, validated
  strictly on arrival (every field type-checked, every `endpointPatterns` entry compiled
  to a `RegExp` to prove it parses, and a candidate config is refused unless its version
  is >= the built-in one and it does not drop a platform).
- `https://ahmetaytar.com/whileai/health/ping` — telemetry when an adapter looks broken
  or degraded: provider, state, the failing selectors, config version, extension
  version (values truncated to 160 chars, at most once per day per provider/state).

Consecutive failures (>2 on a degraded adapter) trigger the config re-fetch; strict
validation means a bad remote config cannot brick an install. It is a sensible design,
and it is also **two phone-homes**, which is why it conflicts with the privacy line we
are keeping: WhileFree makes no requests at all, and a user's AI usage is not something
we want to learn about indirectly through adapter health.

Their selector config is also gated behind that same fetch — which is how "the site
changed and the extension fixed itself overnight" is possible. Our answer is the one
the project actually wants: **repair locally.** Per-site selector overrides the user (or
a contributor) can paste in when a site redesigns, and user-defined providers for sites
we do not ship. No server, no telemetry, and a broken adapter is fixed by the person who
noticed it rather than by whoever is watching a dashboard.

## What changed in our code because of this pass

| Adopted | Where |
| --- | --- |
| Attention outranks answers; amber/green; `9+` cap; hover title | `lib/badge.js`, `tests/badge.test.mjs` |
| 12h / 20-entry life for the ready list; 6h for problems | `lib/badge.js` |
| `badgeEnabled` mutes the answer count but never the warnings | `lib/settings.js`, dashboard |
| Visiting a tab clears its entry, so the count falls on its own | `background/background.js` |
| One condition gates badge, list, chime and toast: were they watching? | `background/tracker.js`, `background/answers.js` |
| Chime that sounds when no AI tab is focused (offscreen document) | `background/..`, `offscreen/`, `scripts/make-audio.mjs` |
| Notification click opens the conversation it is about | `background/background.js` |

| Deliberately not adopted | Why |
| --- | --- |
| Remote `selectors.json` + health ping | Would make us phone home. Local repair instead. |
| Licence/Polar machinery | There is no paid tier to enforce. |
| Hardcoded five providers | We ship ten and users can add their own. |
| Their selector strings wholesale | We keep our own candidate lists; see the facts above for the specific gaps worth closing. |
| `tabGroups` + comparison window | Good idea, not yet built. On the roadmap. |

## Still open (see `docs/ROADMAP.md`)

- **Network-level completion detection** (fact 1) — the largest remaining accuracy gap.
- **Per-AI model capture** (fact 13) — the DOM knows the model name; we do not record it.
- **`mayHaveLanded` retry semantics** (fact 5) — guard against double-sends on retry.
- **Orphan filing and the noise reclassification** (facts 11, 12).
- **Tab groups and the comparison window** (fact 14).
