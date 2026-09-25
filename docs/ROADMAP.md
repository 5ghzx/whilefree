# Beyond parity: what to build next

Parity is table stakes. This is where the product goes next, ranked by value per unit of work, with the
genuinely interesting bets called out separately.

Two constraints hold throughout. **No server** — anything that needs a backend is out, because that
promise is the product. And **no stored prompt or answer text** — which several of the best ideas below
have to be designed *around* rather than ignored. Where an idea needs a carve-out, it says so.

Several of the entries below are now informed by a read of the published WhileAI bundle; the facts that
came out of it, and where we already acted on them, are in
[UPSTREAM-FINDINGS.md](UPSTREAM-FINDINGS.md).

---

## Tier 1 — small, obviously worth it

**1. Keyboard shortcut to broadcast.** `commands` API, one entry, `Alt+Shift+Enter`. The entire value
proposition is "stop pasting", and the current flow still needs a mouse. Cheap and used daily.

**2. Side panel instead of a popup.** The popup closes the moment you click away, which is exactly when
an answer lands. Chrome's `sidePanel` API (and Firefox's `sidebar_action`) keeps the answers list open
beside the conversation. This is the single biggest usability win available.

**3. Right-click → "Send selection to every AI".** Highlight a paragraph anywhere, send it to all ten
as a prompt, optionally with a prefix you set once ("Explain this:"). Zero new privacy considerations:
the text is read once, sent, and never stored.

**4. Model-level tracking.** Every one of these sites shows which model answered ("GPT-5", "Claude 4.5
Sonnet", "Gemini 3 Pro"). Reading that one label — not the answer — would let the head-to-head table and
the cost table split by *model* rather than by site. It also answers the question users actually ask:
"is Pro worth it over Flash?" Small read, large analytical payoff, no privacy change.

**5. Answer length as a metric.** We already count characters to detect completion. Surfacing them gives
"which AI writes essays and which answers the question", plus tokens-per-second as a real throughput
number.

---

## Tier 2 — the good stuff, more work

**6. Auto-rebroadcast the follow-up.** When you send a second prompt in the origin tab mid-conversation,
offer to send it to the same group. This is the most-requested pattern in multi-AI workflows and it is
mostly plumbing on top of the existing job-group model.

**7. A real side-by-side compare view.** *(Design carefully.)* One page showing all N answers as live
panes squeezed next to each other, so you compare without tab-hopping. Reads answer **text** on screen
but stores nothing — the panes embed the real site pages (`<iframe>` or a tab grid), so the text never
touches extension storage. It preserves the promise; it just displays what is already on screen. This is
the feature that would make the extension worth installing for someone with two subscriptions.

**8. Schema-guarded flakiness report.** When a site's markup changes, right now a user has to notice and
file an issue. Instead: on N consecutive send failures, auto-collect the diagnostic (which probes
failed) and offer a one-click "copy this and file it" — prefilled issue URL. Turns a silent breakage
into a contribution.

**9. Slack-style digest instead of per-answer chimes.** "Quiet mode": batch everything that landed in the
last 10 minutes into one summary, delivered when you next focus a window. For people running 10
broadcasts an hour the chime is noise.

**10. Weekly digest that actually arrives.** Their "weekly report" is on-demand; make ours push: a Monday
notification with the week's split, the winner on shared prompts, and the subscription verdict. We have
every number already; it is one cron-ish alarm.

**11. Network-level completion detection.** The largest accuracy gap we know of. Four of the five big
sites expose no reliable "still streaming" element, and WhileAI instead observes the conversation
endpoints themselves (`/backend-api/conversation`, `/completion`, `/StreamGenerate`,
`/rest/sse/perplexity_ask`, `/api/v0/chat/completion`) from a page-world script. That is where their
sub-second time-to-first-token comes from, and it is why their answer timings hold when a DOM heuristic
guesses wrong. Our detector is DOM-only today. See fact 1 in
[UPSTREAM-FINDINGS.md](UPSTREAM-FINDINGS.md).

**12. Prompt-length ↔ latency correlation.** "Long prompts cost 3× the wait on Gemini but 1.2× on
ChatGPT." Cheap from data we already hold, and it changes behaviour rather than just describing it.

**13. Insight nudges with teeth.** "Perplexity cost you $41 this quarter for 6 prompts — its cost per
prompt is 12× the median." The cost table reports; this would decide. A monthly "worth cancelling?" card,
with the numbers that answer it.

---

## Tier 3 — ambitious, and the interesting ones

**14. Answer-consensus scoring.** *(Carve-out.)* Send a prompt to five, then ask a sixth to compare them.
Doing that requires reading the answers, which breaks the promise on its face — *unless* it runs in a
"one-shot, in-memory" mode where the comparison happens inside your browser with no storage and no
network traffic beyond the AI you already chose to ask. Worth building only with a very loud UI
explanation of the exception. Highest value-to-risk ratio of anything on this list.

**15. Local-only history of *your* prompts.** *(Carve-out.)* A prompt library with variables, so a
recurring question is one keystroke. This means storing prompt text, the one thing the extension currently
promises never to keep. Defensible if it is opt-in, clearly labelled, and excluded from export by default
— but it is a product decision, not a technical one, and the privacy policy has to change first.

**16. A real benchmark mode.** Run the same prompt N times across M AIs, on a schedule, and build a
statistically honest comparison with confidence intervals instead of medians of small samples. Turns the
head-to-head table from a curiosity into a benchmark. Also makes "is Gemini unusually slow *today*"
answerable, which is a monitoring product hiding inside a convenience one.

**17. Repairing a site that broke.** When a site redesigns, our selector list stops matching and the user
sees it first. Give them somewhere to act: per-site selector overrides, typed or picked by pointing at the
page once, stored locally, exportable as small JSON so a fix can be shared in an issue instead of
waiting for a release. `docs/SITE-BEHAVIOUR.md` plus the built-in *Diagnose* report already names which probe
failed, so this is the missing half of a diagnostic we ship today.

*Dropped: user-defined providers.* Letting a user add a site we do not ship — a name, a host pattern and
a set of selectors — was the same mechanism generalised, and it is now off the list. Ten maintained
adapters, each verified against a live page, are what makes the *Diagnose* report and the timing
reliable; a provider nobody has tested has neither, and its failures arrive as bug reports about this
extension rather than about the site. Anyone who needs a site we do not ship can add it in
`src/lib/sites.js` in a few lines — the registry is data, and the file is short.

**18. Opt-in cross-device sync.** `browser.storage.sync` for settings and rollups only — never events,
never prompts. The privacy policy gets one sentence longer and a laptop/desktop user stops re-entering
their subscription prices. Deliberately last on this list: "your data never leaves your browser" is
cleaner to say than "except the small sync blob".

**19. Firefox-and-Chrome parity test rig.** Automate the verification routine in
[SITE-BEHAVIOUR.md](SITE-BEHAVIOUR.md) with Playwright against saved HTML snapshots of each site's
composer, run in CI. Then a selector regression fails the build instead of waiting for a user to notice.
Boring, and it is the thing that would make the whole project sustainable.

---

## What not to build

- **Anything that needs a server.** It would convert the strongest claim in the privacy policy into a
  liability.
- **CAPTCHA, limit or bot-detection workarounds.** Terminal state, by design, forever.
- **A paid tier.** There is no licence check in the code and there should never be one.
- **Copying another extension's code.** Behaviour is fair game; expression is not. See
  [FEATURE-PARITY.md](FEATURE-PARITY.md).
