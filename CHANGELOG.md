# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **The launcher says what a press will reach, and opens the list.** The pill in the corner of every AI
  page counted the switches the user had turned on, which is the list and not the reach: a fresh
  install with ten on and none signed in read *Ask all 10* over a send that could not go anywhere.
  It now counts the reach — the same switch, sign-in and open-tab conjunction the popup's *Goes to X
  of Y* counts, from the same record and through the same rule — while the master switch being off is
  named on the pill itself. Hovering it opens an overview of all ten: what each page last said (*signed in*, *not
  checked yet*, an attention reason, or *off*), the page you are on marked as *this page*, and the one
  press that fixes the two dead ends — turning WhileFree back on, which used to be advice with a walk
  to the popup attached. A refused press holds that card open next to the reason, so the two land
  together. The card is written in the popup's own words, because two sentences about one fact is how
  a fact starts to look doubtful.
- **The install shows the AI list instead of hiding it.** The welcome card the installer opens now
  carries the same list as the *Sites* card, built from one row builder so the two can never disagree
  about what a switch means. It is there because a fresh install used to start with all ten switches
  off — a rule that read as a broken extension on the one screen a new user sees first.

### Changed

- **The count says what a send can be delivered to, not what the list holds.** *Goes to X of Y* was
  counting a signed-in AI with no tab open as reachable — while the row beside it said *closed* and
  the send skipped it with `no tab open`. That is the one term the tab default had just changed the
  meaning of, and a number that ignores it describes a fan-out twice the size of the one that runs.
  The reach is now the conjunction the engine enforces a moment before it types: switched on, signed
  in, and — while *Open a tab for AIs you have not opened* is off — already open. It is one rule and
  one sentence (`lib/reach.js`), read by the popup's summary and by the launcher's pill, card header,
  row text (*closed* is now a row state, beside *signed in*) and tooltip, so the corner and the panel
  cannot disagree about a number the user is asked to trust. The page gets the one term it cannot see
  for itself from the background, which answers a page that asks and pushes to the open AI pages when
  that set changes.
- **A fan-out reaches the AIs you have open, and opens nothing by default.** Asking a question in an
  existing conversation used to leave a tab behind for every other AI — one prompt in, seven tabs
  born, each one loading a page you did not ask for. The tab is now the thing you request: a send
  goes to the AIs that are already open, the rest are reported as *skipped* with `no tab open` on
  their row, and no amber badge is raised for them, because nothing was attempted and nothing is
  broken. When nothing at all is open the send is refused outright — from the popup, the context
  menu, or a prompt typed into a page — and it says which switch opens tabs instead of starting a
  job that would skip every target. *Open a tab for AIs you have not opened*, under the AI list in
  the popup, restores the old behaviour; the tabs it opens still go into a window of their own.
- **The build refuses to ship one browser differing from the other without saying so.**
  `scripts/build.mjs` compares the two generated manifests key by key and fails when they disagree
  outside the four differences that are deliberate: the background form (a service worker against an
  event page), Chrome's `offscreen` permission, `minimum_chrome_version`, and Firefox's
  `browser_specific_settings`. A permission added to one browser's list, or a content script dropped
  from one, used to become a feature that worked on one side only and was invisible in review.
- **An AI's switch is the user's list, and the sign-in gate moved to send time.** The switch used to
  mean *switched on and verified*: pressing it opened the site's tab, asked the page, and an answer of
  no took that AI off the list. So a fresh install was ten switches off — not what was stored, and not
  anything the user had chosen — and an unrelated look at a page could switch a deliberately
  switched-on AI off. Now `enabledSites` is exactly the list the user keeps: a switch opens nothing,
  a row whose page has not confirmed a session reads *not checked yet*, and the fan-out refuses any AI
  whose page has not said it is signed in — reported as *skipped*, and as `no-verified-targets` when
  nothing is sendable. The check itself (`engine.verifySite`) only writes the reading; it no longer
  has any say over the list.

### Fixed

- **A message in the corner can no longer outlive its own expiry.** A toast was taken away by its
  timer and nothing else, and a timer is the one thing this cannot rest on: a background tab throttles
  it towards *eventually*, so a refusal could still be sitting there — *turn WhileFree on in the
  popup* — long after WhileFree was on. Every toast now carries a deadline that every render enforces,
  the expired one is swept the moment the tab is looked at, and there is a × for the impatient. The
  same delegation is what makes the refusal path honest: it was the message, not the state, that
  people were reading.
- **Turning the in-page launcher off and on again is not a one-way door.** The setting took the
  launcher out of every open AI page and nothing put it back, so the switch only worked in the
  direction that removes it; a page that has already booted now remounts it.

### Removed

- **The *Only send to AIs that say they are signed in* option.** With the behaviour unconditional it
  had nothing left to control, and leaving it off was the direct cause of "no answer" from every tab
  at once. `settings.requireSignIn` is deleted on the way in, so a stored `false` from an older build
  cannot survive a merge or keep a hand-edited record skipping sites.

## [0.1.0] - 2026-09-25

First release: everything built before the tag, the initial import and the work on top of
it. All of it is free — there is no paid tier, no trial, no licence check and no feature gate
anywhere in the code. It includes a pass over the published WhileAI bundle; see[`docs/UPSTREAM-FINDINGS.md`](docs/UPSTREAM-FINDINGS.md) for what that turned up.

### Added

- **Broadcast.** Type a prompt in any supported AI and press *Ask all* to send the same prompt to the
  others you switched on, one at a time, spaced out at a human pace.
- **Ten providers**: ChatGPT, Claude, Gemini, Perplexity, DeepSeek, Grok, Copilot, Le Chat (Mistral),
  Qwen and Kimi. All enabled by default; adding another is a one-file change.
- **Popup composer**, for sending without opening any AI first.
- **Queue**, so a second prompt waits its turn instead of colliding with the first.
- **Answers-ready list**, in the popup and in a panel inside the page, with one-click *Open* that
  brings the right tab forward and clears its own entry.
- **Toolbar badge** counting answers that landed while you were elsewhere.
- **Chime** per answer — synthesised, no audio file — switchable globally and per AI, with quiet hours.
- **Warnings when a site needs you**: signed out, out of quota, showing a check, message box not found,
  or a send that did not go through. It stops and says which AI is stuck; it never tries to solve a check.
- **Time tracking** in three states — writing, waiting, reading — per AI and per day, with waiting spent
  on other tabs counted separately.
- **Dashboard**: three-way split, per-day stacked charts, per-AI totals, head-to-head answer times,
  "fastest on shared prompts", follow-ups, attention detail, and a weekday × hour waiting heatmap.
- **Subscription cost table**: enter what you pay per month and see cost per prompt, cost per hour of
  real use, and a plain verdict on anything you are paying for but barely touching.
- **Shareable summary** as plain text, with copy and download, for a calendar week, a calendar month, a
  rolling window, or everything recorded.
- **Export/import** as JSON, and two **CSV** exports: one row per day per AI, and one row per timed
  answer. Plus *Delete everything*.
- **Markup check** across every open AI, from the popup and the dashboard in one press, so a site
  redesign is a five-second diagnosis rather than a broken extension.
- **Slow-mode handling**: DeepSeek's DeepThink and Search toggles are switched off before a broadcast,
  since the site remembers them between visits. Nine further slow modes (Gemini Deep Research,
  Perplexity Research, Grok Think, Copilot Think Deeper, Qwen and Kimi thinking, Claude extended
  thinking) are catalogued and individually opt-in, so a switch the user chose is never clicked.
- **Toolbar tooltip** counts answers ready, so the count is visible without opening the popup.
- **"first, 6s"** in the in-page list, marking the AI that answered first rather than only how long each
  one took.
- Two browser build targets from one source tree, with no bundler: Chrome MV3 (module service worker)
  and Firefox MV3 (event page).

- **One master switch, at the top of the popup's *Send to* card.** Ten presses — each going through
  a sign-in check that could say no and leave that AI off — was the wrong shape for what the extension
  is for: the button says *ask every AI*, so one press has to be enough to mean it.
  It is the feature's own switch, not a shortcut for the list under it: off stops every send (the
  popup, the context menu and a prompt typed into an AI page all read the same flag), and the per-AI
  picks are left untouched, so turning it back on asks exactly the AIs it asked before. Rewriting
  `enabledSites` on the way past — which is what the first version did — made an off switch cost a
  re-selection every time, and flipping careful mode behind the user's back moved a switch they had
  set themselves. *Only send to AIs that say they are signed in* is still the switch that decides
  whether an unchecked AI joins the fan-out.
  `scripts/probes/master-switch.js` drives it as real clicks in a real browser.
- **The site list is re-asked every time it is opened.** The popup asks every AI that has a tab open
  what its page is showing right now — one message per open tab, throttled to twenty seconds, the
  answers arriving as storage writes the popup is already listening for. A reading that was wrong once
  used to be wrong for as long as the record lived.
- **A live-page test rig** (`scripts/cdp.mjs` plus `scripts/probes/`): drives a real Chromium over
  DevTools, types with the extension's own insertion code, reads the extension's own storage and
  profiles the tab's main thread. Everything in the `Fixed` section below was found with it, on the
  sites themselves rather than in a fixture.
- **Right-click → Ask every AI.** With a selection it uses that text; on a page it uses the title and
  address. It never fails silently: being switched off or having nothing to ask about raises one
  notification saying so.
- **Which model actually answered**, a dashboard table splitting one AI into the models it was really
  run on, with the same first-word, typical and slowest-1-in-10 measures as head to head. The model name
  is read from the site's own switcher — a label, never the answer text.
- **Per-AI control in the popup**: stop or retry one AI without touching the rest, and put the answering
  tabs side by side. The last broadcast's outcome stays on the card after it finishes — the per-AI
  tally used to vanish the moment the fan-out ended, taking the reasons with it — so a failed AI can
  be retried from the report that named it.
- Switches that had settings behind them but no interface: fresh chat versus continue, wait for every AI
  before sending, and a *Send it now* button for the weekly report.
- `tests/background.test.mjs`: the real background scripts loaded in order against a fake browser, driving
  the message router, the fan-out, the per-AI controls, the context menu, the badge and the alarms. Sends
  are gated per tab, so a target can be held mid-send and inspected — which is how the three fixed bugs
  below were caught.
- Two consistency checks in `scripts/check.mjs`: every source file must be loaded by something, and every
  `WF.x.y` / `bg.x.y` / `content.x.y` reference must resolve to a definition in a file that is in the
  same load list.
- `npm run firefox` puts the current build into the Firefox dev profile, so testing happens against the
  code that was just written rather than the release, and reports which browser still has to restart.

- `scripts/make-audio.mjs` generates the chime (`src/assets/chime.wav`) rather than shipping someone
  else's audio, the same way the icons are generated.
- A setting for the answered-count badge, so warnings still show when the count is switched off.
- The engine now passes the sender's tab id through on every phase report, so an answer can still be
  cleared by visiting its tab even if the worker restarted between "sent" and "done".

### Fixed

- **"Signed out" on an AI the user was signed in to.** Reported three times, and it was two bugs at
  once. The reading: a sign-in door only counts when it is *still there* after the page has had its
  moment to hydrate. These pages are server-rendered signed-out chrome that a session replaces, and on
  a tab opened in the background — every tab of an ordinary fan-out — the handshake lands seconds after
  the markup does; one reading taken during those seconds took the AI off the list. The record: nothing
  ever took that reading back. A site that read as signed out was switched off by that reading, an
  off site's page goes dormant and stops running the check it would have re-run, and the only thing that
  could clear the flag was the switch the same reading had just turned off. So the verdict is now
  confirmed before it is believed (a second reading 1.5s later decides), a "needs you" flag stops
  blocking once it is ten minutes old and the send's own live check takes over, and a page that says it
  is fine restores the check rather than leaving it cleared forever.
- **A stale reading was shown in the present tense.** In the reported browser, eight of ten rows read
  "Signed out" for days, because the record was a memory and the popup said it as if it were a reading.
  A flag older than the ten minutes `lib/badge.js` already stopped nagging at now shows as what it is —
  the row says *closed* or *N tabs open*, and the tooltip says what it was showing when it was last
  looked at.
- **A session that ended after the check was made still read as signed in.** This is the report that
  Copilot was "signed in" while its page was signed out. The check a switch collects is a fact about a
  moment, and a session can end without the page's markup changing at all: signed out in another tab, an
  expired token, an app shell still drawing a form it can no longer use. The ping every tab is already
  sent before a fan-out types into it now carries the page's own live verdict, so a page that says it is
  signed out is refused before a character is typed — its check is cleared, the popup says which AI needs
  you, and the failure is named instead of being reported as a missing message box. A page that says it
  is signed in has its check re-stamped, so the record is a statement about *this* session rather than a
  memory of an older one. Nothing is opened, raised or focused to find any of that out.
- **A sign-in control with no words on it was not a door.** The door scan read `textContent` only, so an
  icon-only control — a picture of a person whose accessible name is "Sign in", which is how these sites
  draw a signed-out header — was invisible to it, and a page with a working message box and no session
  behind it passed as ready. Labels are now read from `aria-label`/`title` first, the same order the
  model switcher already used, and the labels that belong to a session (an account menu) are covered by
  the same test so they cannot turn every signed-in page into a false warning.
- **Installing a build into Firefox broke the copy that was already running.** The install copied the
  new `.xpi` over the old one, which truncates the same file the running browser has open as a zip
  archive. The add-on kept its manifest and kept working in the parts that live in memory (it was
  still writing its storage minutes later), but every file it reloaded out of that archive resolved
  against offsets that no longer existed — so the popup answered its own, correct
  `moz-extension://<uuid>/popup/popup.html` with *file not found* until the browser restarted. The
  install now renames a completed copy into place, and says when Firefox is running the profile, rather
  than writing into a live archive.
- **A finished answer was thrown away whenever the site moved its own address.** The first prompt in a
  conversation changes the URL — `/new` becomes `/chat/<id>` — and the watcher treated that as leaving
  the page and stopped, silently and with no phase reported. The site answered, the extension waited,
  and the popup said *no answer* about a conversation with the answer printed in it. Six sites do this
  on the first message of a conversation, so it was the normal path, not an edge case. A URL change
  that stays on the site and keeps the message box now re-measures from the new page and keeps watching.
- **Sends were timed from the wrong moment.** `sentAt` was taken after the composer finished confirming
  the send, about a second after the prompt actually left — which put the site's own request *before*
  the watch started, so the network clock could not see the stream it was supposed to time, and every
  wait came out roughly a second short. The clock now starts at the press.
- **The prompt was being counted as the answer.** While a reply is arriving, Claude puts its streaming
  attribute on the wrapper around the whole exchange, and the prompt inside it registered as assistant
  output the moment it painted: a four-second answer was recorded as arriving in 14 milliseconds. A node
  that contains the user's own message is now recognised as a container and skipped.
- **One prompt could be typed three times into the same box.** `setComposerText` cleared the box by
  selecting its contents and inserting over the selection, which the editors Perplexity and Kimi use
  ignore — so the first strategy inserted the prompt, the read-back disagreed, and the next two
  strategies added two more copies. Measured live: three copies from one call. The box is now emptied
  with the one method those editors accept (deleting the selected range), a failed attempt is never
  used as the starting point for the next one, and a box left holding two copies is emptied rather than
  sent.
- **A prompt that landed a frame late was reported as "message box not found".** An editor can reconcile
  a programmatic write after the read that judges it. The send now looks again after the pause it takes
  anyway, and a box that took the text and a box that is not there are reported as the different problems
  they are.
- **Copilot's front page read as "message box not found"** when it was a sign-in wall. Its doors say
  *Sign in with Microsoft*, which the shared vocabulary did not know; it does now, so the status is the
  truth: signed out.
- **Storage never persisted anything in a real browser.** `WF.browser.storageGet` and friends built API
  calls from a dotted method name (`storage` + `local.get`), which resolves to no function at all, so
  every read came back undefined and every write was dropped. Settings, statistics, the answers list and
  the badge looked like they worked because each read returned defaults again. The API path is now walked
  properly.
- **Two files were loaded by nothing.** `content/netwatch.js` and `background/ledger.js` were referenced
  by shipped code and absent from the file registry, so the content script threw before it registered
  anything — a dead extension on every page — and retry-after-failure had no ledger to consult.
- **The "mark this one done" escape hatch was dead code.** It reached for a watcher that was never
  published, and the guard around it turned that into a silent no-op.
- `bg.storage.setSiteStatusFor` — a namespace that does not exist — would have thrown on the first site
  that needed a human.
- The popup's job list rendered each target as `[object Object]`.
- A `SITE_STATUS` report whose `attention` arrives as a bare reason string is now accepted rather than
  stored as nothing.

- **The chime did nothing while you were working elsewhere.** It was synthesised inside the focused AI
  tab, which is exactly the situation that does not apply when you walk away from a long answer. Chrome
  now plays it from an offscreen document; Firefox, which has no offscreen API, still uses the in-tab
  tone.
- Clicking an answer notification now opens that conversation and clears the notification, instead of
  doing nothing.
- A duplicate "markup check" line in this file.

### Changed

- **A broadcast's own tabs now open in a window of their own, by default.** Opening a tab per AI into the
  window you are working in is the one thing about a fan-out that is genuinely cluttering: ten tabs
  appear in the middle of what you were doing, and the prompt you were about to type is now a tab away.
  The window is made *around* the first tab rather than empty and filled, so the window you are in never
  flickers with a tab on its way out of it, and only tabs this broadcast opened go in — anything you
  already had open is never moved. Once the answers are in, the window closes as one unit. Turn the
  setting off and opened tabs land in the window you are using, as they did before.
- **Kimi moved to kimi.ai.** The adapter claims `kimi.ai` and `www.kimi.ai` and opens new conversations
  there; the old `kimi.com` and `kimi.moonshot.cn` addresses are still claimed, because a tab opened
  before the rebrand is still that site, and a tab on an address we no longer claim stops answering us
  without ever looking broken on screen.
- **Every AI is sent to at once.** A broadcast used to walk the sites one after another with a gap
  between them, which made a question asked of ten AIs take half a minute to leave the building. Now
  every page is warmed in parallel — each is asked to wait for its own message box — and only then do
  they all get the prompt in the same moment. The one thing that serialising was protecting, two
  prompts typed into the same message box, is still impossible: the second one is told that site is
  busy rather than silently queued behind the first.
- **"Ask all" includes the AI you pressed it in.** Excluding the page you happen to be looking at is
  not what "all" means to anyone, and the tab it came from is the one you meant: a prompt sent from the
  launcher on ChatGPT is asked *in* the ChatGPT conversation you have open, not in whichever ChatGPT tab
  was touched last.
- **An AI cannot be switched on until its page has said it is signed in.** Pressing a switch asks that
  AI's page — the only thing that can see the session — whether it is usable, and asks it *first*, with
  nothing raised: a session that is already fine is confirmed without a tab moving. The tab is only
  opened, or brought to the front, when the answer is no, because that is the one outcome to act on (and
  the one a switch-off reflects). Only a yes puts it on the list of targets, and a no takes it back off, so a switch that
  reads *off* is never quietly included in a fan-out. This is also the guard in front of every send: a
  prompt that would go to an unchecked site is held back and the AIs that were left out are named.
  Turning every AI off is now a state the settings can hold, rather than being silently replaced by the
  first provider in the registry.
- **The promise of the switch is the same in both surfaces.** The popup and the dashboard now draw an AI
  as on only when it is both switched on and checked, and both run the same check to get there. The
  rule that decides it lives in one file, `lib/status.js`, because two copies of it is how a switch
  reads on while the fan-out quietly leaves that AI out.
- **The expensive DOM probes ask the cheap question first.** `[role="alert"]` is an indexed lookup;
  `[class*="modal"]` walks every class attribute in the document. Measured on a page twenty times the
  size of a long conversation, the banner probe cost **36ms per scan**, and it ran every other tick of
  every answer — a forced layout every 1.8 seconds in the middle of the page streaming tokens. The
  role-based half now runs every time (1.5ms) and the substring half on a 15-second budget; the stop
  button and the sign-in door read a label before asking for geometry. The same page now scans in
  **1.7ms**, and the answer that took 36ms of main thread per tick no longer has one.
- **The in-page timers only run when something is happening.** The tracker, the answer watcher and the
  overlay used to poll on a fixed beat in every AI tab whether or not anything was going on; ten idle
  tabs is an ordinary thing to have open. Each now starts its timer on activity and stops it again when
  the activity does.
- **The toolbar count now has two sources and picks the right one.** An AI that needs you — signed out,
  out of quota, behind a check — takes the icon in amber; answers that landed show in green. Attention
  wins, because it is the one you can act on.
- **The count expires.** An unread answer stops counting after 12 hours and the list is capped at 20, so
  the number stays a nudge instead of a total that only ever climbs.
- **Visiting a conversation clears it.** Switching to the tab — or focusing its window — is the same as
  clicking *Open →*, so the count falls without you tidying up.
- **One condition now gates every alert.** If you were watching that tab when the answer landed, the
  badge, list, chime and notification all leave you alone; before, the chime and toast fired anyway.
- Chime and notification wording matches what the count says ("3 AIs have answered").

[0.1.0]: https://github.com/5ghzx/whilefree/releases/tag/v0.1.0
