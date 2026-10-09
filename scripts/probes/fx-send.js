/**
 * Type a prompt into the panel and press Send — the two things a person does.
 *
 * The value is set and an `input` event dispatched, because the panel decides whether Send is
 * available from that event and not from the value: assigning `box.value` alone leaves the
 * button disabled and the test would conclude that sending is broken. The click afterwards is
 * the panel's own handler, so everything below it (the engine, the fan-out, the tab bookkeeping)
 * is the code under test rather than a description of it.
 *
 * The reading that comes back is taken a moment later and is the panel's first reaction —
 * whether the job card appeared and which targets it drew.
 *
 *   node scripts/rdp.mjs bg whilefree@whilefree.app @scripts/probes/fx-send.js
 *
 * WF_PROMPT overrides the prompt. Keep it short: a five-site fan-out with a one-line answer is
 * the fastest way to see every target reach `done`.
 */
(async () => {
  const prompt = globalThis.process?.env?.WF_PROMPT || 'Reply with exactly one word: pong';
  const box = document.getElementById('prompt');
  const send = document.getElementById('send');
  if (!box || !send) return 'not the popup page';
  box.value = prompt;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  const enabledAfterTyping = !send.disabled;
  const summaryBefore = (document.getElementById('target-summary') || {}).textContent;
  send.click();
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const targets = document.getElementById('job-targets');
  return JSON.stringify(
    {
      prompt,
      enabledAfterTyping,
      summaryBefore,
      jobCardVisible: !document.getElementById('job-card').hidden,
      jobTitle: (document.getElementById('job-title') || {}).textContent,
      targets: targets ? Array.from(targets.children).map((row) => (row.innerText || '').replace(/\n+/g, ' · ').trim()) : [],
    },
    null,
    1
  );
})()
