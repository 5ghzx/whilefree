// Switch every AI on in the panel — the state a fresh install starts in.
//
//   node scripts/rdp.mjs bg whilefree@whilefree.app @scripts/probes/fx-panel-all.js
//
// `fx-panel-one.js` leaves the other nine switched off, which is what a single-target send
// wants and the wrong state to leave a rig in: the next fan-out then reaches one AI and looks
// like five sites broke. This puts them back, so the panel is the panel again.
(async () => {
  const rows = Array.from(document.getElementById('sites').children);
  const turnedOn = [];
  for (const row of rows) {
    const switchEl = row.querySelector('.switch');
    if (!switchEl || switchEl.disabled) continue;
    if (switchEl.getAttribute('aria-checked') !== 'true') {
      switchEl.click();
      turnedOn.push((row.innerText || '').split('·')[0].trim());
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  }
  return JSON.stringify({
    turnedOn,
    summary: (document.getElementById('target-summary') || {}).textContent,
  });
})()
