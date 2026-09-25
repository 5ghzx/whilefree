// Send a real prompt from the popup and report what the popup says happened.
//
//   node scripts/cdp.mjs open "chrome-extension://<id>/popup/popup.html"
//   node scripts/cdp.mjs eval popup @scripts/probes/send-from-popup.js
//
// The prompt text comes from `WF_TEST_PROMPT` on the popup's window, or defaults below.
// Nothing is stubbed: this types into a live AI's message box and presses its send button.
(async () => {
  const PROMPT = globalThis.WF_TEST_PROMPT || 'Reply with exactly: PONG';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const text = (id) => {
    const node = document.getElementById(id);
    return node && !node.hidden ? (node.textContent || '').trim() : '';
  };
  const jobRows = () =>
    [...document.querySelectorAll('#job-targets .target, #job-targets [data-site]')].map((row) =>
      (row.textContent || '').trim().replace(/\s+/g, ' ')
    );

  const input = document.getElementById('prompt');
  input.value = PROMPT;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await sleep(300);

  const send = document.getElementById('send');
  const disabledBefore = send.disabled;
  send.click();

  const started = Date.now();
  const seen = [];
  while (Date.now() - started < 90000) {
    await sleep(1000);
    const line = `${text('send-result')} | job: ${text('job-title')} ${jobRows().join(' / ')}`;
    if (seen[seen.length - 1] !== line) seen.push(line);
    // The send promise is done when the button is live again and there is a result line.
    if (!send.disabled && /Sent to|Nothing|held|refused|failed/i.test(text('send-result'))) break;
  }

  return {
    prompt: PROMPT,
    sendDisabledBefore: disabledBefore,
    sendResult: text('send-result'),
    answers: text('answers-count'),
    answerRows: [...document.querySelectorAll('#answers *')].map((n) => (n.textContent || '').trim()).filter(Boolean).slice(0, 8),
    timeline: seen,
  };
})();
