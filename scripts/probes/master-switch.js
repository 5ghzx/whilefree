// Drive the popup's master switch and report what the user would have seen.
//
//   node scripts/cdp.mjs eval popup @scripts/probes/master-switch.js
//
// The switch is a real click on the rendered control, so this tests the popup's own wiring
// as much as the settings behind it: one press turns the feature off, the AIs the user picked
// stay picked, and the row count above the Send button does not move — because turning the
// feature off is not a way to lose the one-at-a-time sign-in check a site has already passed.
// The profile's own settings are read first and written back afterwards, because a probe that
// leaves the browser in a different state than it found it is a probe nobody runs twice.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const el = (id) => document.getElementById(id);
  const rows = () =>
    [...document.querySelectorAll('#sites .site')].map((row) => ({
      name: row.querySelector('.name').textContent.trim(),
      on: row.querySelector('.switch').getAttribute('aria-checked') === 'true',
      state: row.querySelector('.state').textContent.trim(),
    }));
  const read = () => ({
    summary: el('target-summary').textContent.trim(),
    master: el('all-switch').getAttribute('aria-checked'),
    hint: el('all-hint').textContent.trim(),
    on: rows().filter((r) => r.on).length,
    rows: rows(),
  });

  const settingsKey = Object.keys(await chrome.storage.local.get(null)).find((k) => k.endsWith('settings'));
  const original = settingsKey ? (await chrome.storage.local.get(settingsKey))[settingsKey] : null;

  const report = { settingsKey, before: read() };

  // One press: the feature off, the picks kept.
  el('all-switch').click();
  await sleep(1200);
  report.afterOff = read();

  // One press again: back on, and the rows it kept are the rows it shows.
  el('all-switch').click();
  await sleep(900);
  report.afterOnAgain = read();

  if (settingsKey) {
    if (original === undefined) await chrome.storage.local.remove(settingsKey);
    else await chrome.storage.local.set({ [settingsKey]: original });
  }
  report.restored = true;
  return report;
})();
