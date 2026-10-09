// Drive a one-AI broadcast from the panel itself: switch the others off, type, press Send.
//
//   node scripts/rdp.mjs bg whilefree@whilefree.app @scripts/probes/fx-panel-one.js
//
// A single-target send is what a site's own timing is measured on, and the panel's switches are
// the honest way to get one: an engine send with one target, started by the same click a user
// makes. Reading a target from a global instead is fragile in this rig — `bg` evaluates a probe
// in every one of the add-on's frames, so a value set in a previous command lands in whichever
// frame answered, not necessarily the background page that sends.
//
// WF_ONE_SITE picks the site (default deepseek) and the prompt is short enough to finish inside
// a wait but long enough to stream for a while, because the question being asked of DeepSeek is
// when the watch decides the answer has ended.
(async () => {
  const siteId = globalThis.__wfOneSite || 'deepseek';
  const prompt =
    globalThis.__wfOnePrompt || 'Write a 200 word paragraph about how rivers shape valleys.';
  const rows = Array.from(document.getElementById('sites').children);
  const nameOf = (row) => (row.innerText || '').split('·')[0].trim();
  const switchedOff = [];

  for (const row of rows) {
    const name = nameOf(row).toLowerCase();
    const isWanted = name.startsWith(siteId.toLowerCase()) || name === siteId.toLowerCase();
    const switchEl = row.querySelector('.switch');
    if (!switchEl || isWanted) continue;
    if (switchEl.getAttribute('aria-checked') === 'true' && !switchEl.disabled) {
      switchEl.click();
      switchedOff.push(name);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }

  const box = document.getElementById('prompt');
  const send = document.getElementById('send');
  box.value = prompt;
  box.dispatchEvent(new Event('input', { bubbles: true }));
  const summaryBefore = (document.getElementById('target-summary') || {}).textContent;
  send.click();
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const targets = document.getElementById('job-targets');
  return JSON.stringify(
    {
      siteId,
      prompt,
      switchedOff,
      summaryBefore,
      jobTitle: (document.getElementById('job-title') || {}).textContent,
      targets: targets ? Array.from(targets.children).map((row) => (row.innerText || '').replace(/\n+/g, ' · ').trim()) : [],
    },
    null,
    1
  );
})()
