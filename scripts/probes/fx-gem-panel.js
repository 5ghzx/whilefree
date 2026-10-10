// Drive a one-AI broadcast at Gemini from the panel itself, then read the card again later.
//
//   node scripts/rdp.mjs bg whilefree@whilefree.app @scripts/probes/fx-gem-panel.js
//
// The same click a user makes: the other switches are turned off, a 200-word prompt is typed and
// Send is pressed. The first half returns the panel's first reaction; the second half (after the
// `::after` marker) reads the job rows again, so one command covers both the claim and the
// outcome. The site itself is read separately with fx-site-truth.js.
(async () => {
  // WF_GEM_PROMPT reaches the popup frame via a prior `bg` evaluation:
  //   node scripts/rdp.mjs bg whilefree@whilefree.app "globalThis.__wfPrompt='Reply with exactly one word: pong'; 'set'"
  const prompt = globalThis.__wfPrompt || 'Write a 200 word paragraph about how rivers shape valleys.';
  const rows = Array.from(document.getElementById('sites').children);
  const nameOf = (row) => (row.innerText || '').split('·')[0].trim().toLowerCase();
  const switchedOff = [];
  let geminiOn = null;

  for (const row of rows) {
    const name = nameOf(row);
    const switchEl = row.querySelector('.switch');
    if (!switchEl || switchEl.disabled) continue;
    if (name.startsWith('gemini')) {
      geminiOn = switchEl.getAttribute('aria-checked');
      if (geminiOn !== 'true') {
        switchEl.click();
        geminiOn = 'true';
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      continue;
    }
    if (switchEl.getAttribute('aria-checked') === 'true') {
      switchEl.click();
      switchedOff.push(name);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  const box = document.getElementById('prompt');
  const send = document.getElementById('send');
  box.value = prompt;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  const enabledAfterTyping = !send.disabled;
  const summaryBefore = (document.getElementById('target-summary') || {}).textContent;
  send.click();
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const targets = document.getElementById('job-targets');
  return JSON.stringify(
    {
      prompt,
      geminiOn,
      switchedOff,
      enabledAfterTyping,
      summaryBefore,
      jobTitle: (document.getElementById('job-title') || {}).textContent,
      targets: targets
        ? Array.from(targets.children).map((row) => (row.innerText || '').replace(/\n+/g, ' · ').trim())
        : [],
    },
    null,
    1
  );
})()
// ::after 20000
(async () => {
  const targets = document.getElementById('job-targets');
  const row = targets && Array.from(targets.children).find((r) => /gemini/i.test(r.innerText || ''));
  return JSON.stringify(
    {
      jobTitle: (document.getElementById('job-title') || {}).textContent,
      geminiRow: row ? (row.innerText || '').replace(/\n+/g, ' · ').trim() : null,
      geminiTitle: row ? row.getAttribute('title') : null,
      geminiClasses: row ? row.className : null,
    },
    null,
    1
  );
})()
