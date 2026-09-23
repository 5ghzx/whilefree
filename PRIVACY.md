# WhileFree privacy policy

Last updated: 23 September 2026

WhileFree is a browser extension that sends one prompt to several AI chat sites in the tabs you
already have open, and times how long each answer takes. This policy describes exactly what it does
with your data. It is short because the extension does very little with it.

**In one sentence: nothing you type, nothing an AI writes back, and no timing data ever leaves your
computer, because there is no server for it to be sent to.**

## What WhileFree stores

All of it is in your browser's own extension storage (`chrome.storage.local` / `browser.storage.local`),
on your device:

| Stored | Why |
| --- | --- |
| How long you spent writing, waiting and reading, per AI and per day | The dashboard and the three-way time split |
| Per-answer timings: when a prompt was sent, when the first words appeared, when it finished, how long the tab was out of sight, and **the number of characters** typed or produced | Head-to-head answer times, cost per prompt, longest waits |
| Counts: prompts sent, answers landed, follow-ups | Totals and the cost table |
| Your settings: which AIs are switched on, pacing, chime and alert rules | To make the extension behave the way you asked |
| The monthly prices you type for your subscriptions | The "is this subscription earning its keep" table |
| Whether a site currently needs you (signed out, out of quota, showing a check) | The warning in the panel |

## What WhileFree never stores

- **The text of your prompts.** A prompt is read from the page and written into the other tabs'
  message boxes, and it exists in memory only for the length of that fan-out. It is never written to
  disk. Only its **character count** is recorded.
- **Anything an AI writes back.** To know whether an answer is still arriving, the extension watches
  how the page's DOM changes and measures the **length** of the assistant's output. It never reads,
  stores, transmits or analyses the content.
- **What you type while you type it.** "Writing time" is measured by noticing that input events are
  happening, not by reading their values.
- **Your passwords or session cookies.** You sign in to each AI yourself. The extension never touches
  a credential, and it has no access to any site other than the five it drives.
- **Any identifiers.** There is no user id, no device id, no install id, and no fingerprinting.

## What WhileFree sends over the network

Nothing. There is no backend, no API, no analytics, no crash reporting, no remote configuration and
no update check beyond the one your browser performs for the extension itself.

The only network activity connected to this extension is the ordinary loading of the five AI sites
you already have open, in your existing tabs, using your existing session. The extension does not
proxy, intercept or modify that traffic beyond putting text in a message box and clicking the site's
own send button.

## Permissions, and why each one is needed

| Permission | Why |
| --- | --- |
| `storage` | To keep the timings, counts, settings and prices described above on your device |
| `scripting` | To re-enter pages that were already open when the extension was installed or updated |
| `notifications` | Only if you switch on "also raise a system notification" |
| Host access to `chatgpt.com`, `chat.openai.com`, `claude.ai`, `gemini.google.com`, `perplexity.ai`, `chat.deepseek.com` | To type into their message boxes, press their send buttons, and watch whether an answer is still arriving. This is the entire function of the extension. |

Note what is **not** requested: `tabs`, `history`, `cookies`, `webRequest`, `clipboardRead`, `<all_urls>`.
Host permissions for those five sites are enough to read the URLs of those tabs, so WhileFree cannot
see the address of any other page you have open, and cannot read any other page's content.

## Third parties

There are none. No data is sold, shared, transferred or disclosed to anyone, because no data leaves
your device. This matches the two Chrome Web Store data-use declarations: data is not sold to third
parties, and is not used or transferred for purposes unrelated to the extension's single purpose.

## Your controls

- **Delete everything**: dashboard → *Your data* → *Delete everything*. This removes all stored data
  immediately.
- **Export / import**: dashboard → *Your data*. The export is a plain JSON file containing timings and
  counts only, with no prompt or answer text in it.
- **Uninstall**: removes the extension's storage along with it.

## Children

Not directed at children, and no personal information is collected from anyone.

## Changes

Any change to this policy will be committed to this repository, and the extension's own behaviour is
auditable in the source: see `src/lib/storage.js` for every key that is written, and
`src/background/tracker.js` for every value that goes into them.

## Contact

Open an issue at <https://github.com/whilefree/whilefree/issues>.
