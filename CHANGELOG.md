# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-09-23

First release. Everything in it is free: there is no paid tier, no trial, no licence check and no
feature gate anywhere in the code.

### Added

- **Broadcast.** Type a prompt in ChatGPT, Claude, Gemini, Perplexity or DeepSeek and press *Ask all*
  to send the same prompt to the others you switched on, one at a time, spaced out at a human pace.
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
- **Shareable summary** as plain text, with copy and download.
- **Export/import** as JSON, and *Delete everything*.
- **Markup check** for all five sites, from the popup and the dashboard, so a site redesign is a
  five-second diagnosis rather than a broken extension.
- **Slow-mode handling**: DeepSeek's DeepThink toggle is switched off before a broadcast, since the
  site remembers it between visits.
- Two browser build targets from one source tree, with no bundler: Chrome MV3 (module service worker)
  and Firefox MV3 (event page).

[0.1.0]: https://github.com/whilefree/whilefree/releases/tag/v0.1.0
