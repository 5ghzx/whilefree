// Drive the popup's real switches and report what the user would have seen.
//
//   node scripts/cdp.mjs open "chrome-extension://<id>/popup/popup.html"
//   node scripts/cdp.mjs eval popup @scripts/probes/turn-on-flow.js
//
// Every step is a real click on the rendered switch, so this tests the popup's own wiring
// as much as the background flow behind it: turning an AI on has to open its tab, check it
// and only then let the switch stay on.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rows = () =>
    [...document.querySelectorAll('#sites .site')].map((row) => ({
      name: row.querySelector('.name').textContent.trim(),
      on: row.querySelector('.switch').getAttribute('aria-checked') === 'true',
      state: row.querySelector('.state').textContent.trim(),
    }));
  const rowOf = (name) => [...document.querySelectorAll('#sites .site')].find(
    (b) => b.querySelector('.name').textContent.trim() === name
  );
  const note = () => {
    for (const id of ['action-note', 'send-result']) {
      const node = document.getElementById(id);
      if (node && !node.hidden && node.textContent) return node.textContent.trim();
    }
    return '';
  };
  const summary = () => (document.getElementById('target-summary') || {}).textContent || '';

  /** Click one switch, then wait for the note to stop changing — however it reads. */
  async function flip(name, timeoutMs = 60000) {
    const row = rowOf(name);
    if (!row) return { name, error: 'no such row' };
    const wasOn = row.querySelector('.switch').getAttribute('aria-checked') === 'true';
    row.querySelector('.switch').click();

    const started = Date.now();
    let last = '';
    let settledFor = 0;
    while (Date.now() - started < timeoutMs) {
      await sleep(400);
      const text = note();
      settledFor = text && text === last ? settledFor + 400 : 0;
      last = text;
      if (settledFor >= 1200) break;
      if (!wasOn && Date.now() - started > 3000 && !text) break;
    }
    return { name, wasOn, note: note(), summary: summary(), row: rows().find((r) => r.name === name) };
  }

  await sleep(1500);
  const initial = { rows: rows(), summary: summary() };

  // A known starting line: nothing on at all. Turning an AI off is a plain settings write,
  // no tab and no check.
  for (const row of rows().filter((r) => r.on)) await flip(row.name);

  const chatgpt = await flip('ChatGPT');
  const claude = await flip('Claude');
  const after = { rows: rows(), summary: summary(), sendDisabled: document.getElementById('send').disabled };

  return { initial, chatgpt, claude, after };
})();
