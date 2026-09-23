# Site behaviour inventory

The niche, undocumented things. Each entry is a behaviour of a real page that a naive implementation
gets wrong, why it matters, and where the fix lives.

**Status column:** `code` means the handling exists and is exercised by the test suite where it is
testable; `live?` means it has **not** yet been confirmed against the real site in a browser. Nothing
here has been verified live — see [Verification](#verification) for the five-minute-per-site routine.

---

## Cross-site mechanics

| # | Behaviour | Why a naive version breaks | Handling | Status |
| --- | --- | --- | --- | --- |
| 1 | **Rich editors ignore `element.value` / `textContent`.** ProseMirror (ChatGPT, Le Chat), Lexical, Quill (Gemini) keep their own model. | The text appears in the box but the framework never sees it, so the send button stays disabled or sends nothing. | `execCommand('insertText')` first, then a real `ClipboardEvent('paste')` with `DataTransfer`, then DOM write + `InputEvent`. Each attempt is verified by reading the box back. | code |
| 2 | **React-controlled `<textarea>` ignores a direct `.value` assignment.** Copilot, Grok, Qwen, DeepSeek. | React's `onChange` never fires; the button stays disabled; the prompt silently never sends. | Set the value through the **native prototype setter** (`HTMLTextAreaElement.prototype.value`) then dispatch `input`. | code |
| 3 | **Some send controls are not `<button>`.** DeepSeek's is a `div[role=button]`; Kimi's is a styled `div`. | `querySelector('button')` finds nothing and the send is reported as failed. | Adapters list `[role="button"]` candidates, and `send.mode: 'enter'` makes Enter the primary path with a click fallback. | code |
| 4 | **Enter inserts a newline in some editors** (Shift+Enter semantics vary per site). | The prompt sits in the box with a trailing newline and nothing is sent. | If Enter produces no send evidence within 5s, we click the button instead — and vice versa for click-first sites. | code |
| 5 | **The send button does not exist until the box has text.** ChatGPT and Gemini render it conditionally. | Looking for the button before inserting finds nothing. | Insert first, *then* resolve the button; the fallback heuristics run after insertion. | code |
| 6 | **The stop button appears only after the first token on some sites.** | Using "stop button present" as the send confirmation reports a failed send on a slow first token. | Three independent signals: stop button, box emptied, or answer length grew. Any one confirms. | code |
| 7 | **Long conversations are virtualised, so the DOM shrinks.** | A total-character measurement goes *down* when an old turn unmounts; a naive "changed ⇒ still streaming" test never concludes, and the answer times out. | Length is tracked as a **high-water mark**. Only increases count as output; completion is judged against the peak. | code |
| 8 | **A usage limit or human check can arrive mid-answer.** | The wait runs to the timeout and reports "no answer seen in time" — the least useful possible message. | Attention is re-checked on every tick while streaming, and a banner is a terminal state. | code |
| 9 | **Conversation text can mention limits.** | A conversation *about* rate limiting trips a naive text scan, so the extension warns that the AI is out of quota when it is fine. | Only banner-shaped containers are scanned (`[role=alert/dialog/status]`, `[class*=banner/toast/modal/captcha/challenge]`), never the message list. Pinned by a test. | code |
| 10 | **A login link can be visible while signed in** (sidebar, "switch account"). | Reporting "signed out" whenever a login link exists produces constant false warnings. | Login selectors are only trusted when the URL matches a login path, or when **no composer exists** at all. | code |
| 11 | **Our own insertion fires `input` events.** | Time you spent "writing" would be credited to the script, inflating the writing bucket on every broadcast. | A programmatic guard window suppresses tracker input during insertion. Signals are also required to be `isTrusted`. | code |
| 12 | **Sites keep the old text in the box on a failed send.** | Without clearing, the next prompt is appended to the previous one. | Every insertion selects the whole box first and verifies the read-back matches exactly. | code |
| 13 | **Single-page apps navigate without a page load.** | The content script never re-runs, so the tab looks dead after switching conversations. | An 800 ms href watcher re-sends `HELLO` and re-evaluates site status. | code |
| 14 | **Hidden tabs have their timers throttled to ~1/minute.** | "Waiting while you were elsewhere" is impossible to measure honestly from inside the page. | That one metric is measured in the **background**, which is not throttled: a 5 s sampler over live jobs. Content-side waiting is counted only while the tab has focus, so the two never overlap. | code |
| 15 | **A page's CSP can block an injected `<style>`.** | The in-page overlay renders unstyled — invisible text over the page. | A **constructable stylesheet** via `adoptedStyleSheets` (not subject to `style-src`), with a `<style>` fallback. | code |
| 16 | **Tabs opened before the extension loaded have no content script.** | The most recently used AI tab is the one most likely to be open, and it is exactly the one that would fail. | Ping → `scripting.executeScript` injection → ping again, with a one-retry send. | code |
| 17 | **Several tabs of the same AI.** | Duplicate "answers ready" rows for one conversation, and the wrong tab brought forward. | Newest answer per AI replaces older ones; the tab is chosen by `lastAccessed`; closing a tab drops its entry. | code |
| 18 | **An answer can finish before the first poll.** | Very fast answers never show a stop button and the "grew" signal fires late. | The quiet-period rule concludes a finished answer without ever needing the stop button. | code |
| 19 | **Sites remember a slow mode between visits.** See DeepSeek below. | Every broadcast answer is slow *and* the returned answer is not the standard one, so the head-to-head comparison is unfair. | Per-site toggles, off by default except DeepSeek; only clicked when the control reads as **on** (`aria-pressed`, `aria-checked`, active class). | partly live? |
| 20 | **The tab you started from is also an answer.** | Excluding it makes "fastest on shared prompts" compare only the AIs you did *not* type in, which is the wrong question. | Capture-phase `keydown`/`click` detects your own send, and joining the group means your own AI competes too. | code |
| 21 | **A prompt sent by hand is still a prompt.** | Only broadcast sends being timed leaves the dashboard's per-AI totals missing most of your real usage. | Manual sends are detected (trusted events only, box had text, evidence of a send) and timed identically. | code |

## Per site

| Site | The specific quirk | Status |
| --- | --- | --- |
| **DeepSeek** | **DeepThink (R1) is sticky**: switching it on once makes every later visit slow, and the JSON-blob toggle keeps state across sessions. Also has a separate Search toggle, a `div[role=button]` send control, and a plain `<textarea>` that needs the native setter. | code, **live? — highest priority**, because it is the one their listing names explicitly. |
| **ChatGPT** | Composer is `#prompt-textarea`, a ProseMirror div whose id survives redesigns better than its classes. Send/stop are `data-testid` buttons. Assistant turns carry `data-message-author-role="assistant"`. A "deep research" toggle can persist. | code, live? |
| **Claude** | `div.ProseMirror[contenteditable]`, send is `aria-label="Send message"`, stop is `aria-label="Stop response"`, assistant output is `div.font-claude-message`. Has an **extended thinking** switch that persists. | code, live? |
| **Gemini** | Composer is a Quill `div.ql-editor` — class-based selection is fragile, and the editor needs a real input event. Answers are `<model-response>` custom elements. Accounts login lives on a different origin. Has **Deep Research**. | code, live? |
| **Perplexity** | Composer is `#ask-input` (id stable), send is `aria-label="Submit"`. **Research / Pro Search** is sticky and makes answers take minutes instead of seconds. Answer blocks are `[id^="markdown-content"]` plus a generic `.prose`. | code, live? |
| **Grok** | Plain `<textarea>` needing the native setter; submit is a `button[type=submit]`; stop is `aria-label="Stop model response"`. Has **Think** and **DeepSearch** toggles. | code, live? |
| **Copilot** | `textarea#userInput` is React-controlled (`data-testid="composer-input"`), send is `data-testid="submit-button"` with an `aria-label` variant. Has **Think Deeper**. Microsoft login is a cross-origin redirect. | code, live? |
| **Le Chat** | ProseMirror composer, `button[type=submit]` send. Answer blocks are plain `.prose`, so the selector is broad — the high-water mark does the real work here. | code, live? |
| **Qwen** | `textarea#chat-input`; the send control is a `div` and Enter is primary; answer blocks are `.markdown-content`. **Thinking** toggle. | code, live? |
| **Kimi** | Contenteditable `#chat-input`, `div`-based send and stop controls, `div[class*="segment-content"]` answers, **Long thinking** toggle. Also reachable at `kimi.moonshot.cn`. | code, live? |

---

## Verification

Per site, about five minutes:

1. Load the extension, open the site, sign in.
2. Toolbar icon → **Check this tab's markup**. All four lines should be populated:
   `composer`, `send`, `stop button`, `answers`. Anything saying `NOT FOUND` is a selector to fix.
3. Type a short prompt, press **Ask all** in the launcher. The other AIs should receive it, and this
   site's own send should still be yours to press.
4. Confirm the in-page list shows `first, Xs` on the winner and `answered in Xs` on the rest, and the
   badge count matches the number that landed.
5. For a site with a slow mode (DeepSeek above all): switch the mode **on** by hand, then broadcast
   again and confirm it was switched off before the prompt went in. That is quirk #19, and it is the one
   with the least confidence behind it.

If a step fails, the diagnostic text from step 2 is the whole bug report. Open an issue with it;
a fix is usually a single line in `src/lib/sites.js`.
