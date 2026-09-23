# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-09-23

First release. Everything in it is free: there is no paid tier, no trial, no licence check and no
feature gate anywhere in the code.

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
- **Markup check across every open AI** in one press, so a site redesign is a single diagnostic dump.
- **Markup check** for all five sites, from the popup and the dashboard, so a site redesign is a
  five-second diagnosis rather than a broken extension.
- **Slow-mode handling**: DeepSeek's DeepThink and Search toggles are switched off before a broadcast,
  since the site remembers them between visits. Nine further slow modes (Gemini Deep Research,
  Perplexity Research, Grok Think, Copilot Think Deeper, Qwen and Kimi thinking, Claude extended
  thinking) are catalogued and individually opt-in, so a switch the user chose is never clicked.
- **Toolbar tooltip** counts answers ready, so the count is visible without opening the popup.
- **"first, 6s"** in the in-page list, marking the AI that answered first rather than only how long each
  one took.
- Two browser build targets from one source tree, with no bundler: Chrome MV3 (module service worker)
  and Firefox MV3 (event page).

[0.1.0]: https://github.com/5ghzx/whilefree/releases/tag/v0.1.0
