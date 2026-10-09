/**
 * The panel's rows as the panel drew them, one line each.
 *
 * The popup's own markup is the only place its text exists: `#target-summary` is the reach
 * sentence, and each row under `#sites` carries the AI's name, its switch, and whatever it
 * knows about that AI's session. Reading the rendered text is how a rig checks the sentence a
 * user would actually read, rather than the state object behind it — the two have disagreed
 * before, on one line, which is exactly what row 26 of docs/SITE-BEHAVIOUR.md is about.
 *
 * Run against the popup page opened as a tab (scripts/probes/fx-popup-tab.js):
 *
 *   node scripts/rdp.mjs bg whilefree@whilefree.app @scripts/probes/fx-panel-rows.js
 */
(() => {
  const sites = document.getElementById('sites');
  if (!sites) return 'not the popup page';
  const rows = Array.from(sites.children).map((row) => {
    const switchEl = row.querySelector('.switch');
    return {
      text: (row.innerText || '').replace(/\n+/g, ' · ').trim(),
      on: switchEl ? switchEl.getAttribute('aria-checked') : null,
      disabled: switchEl ? switchEl.disabled : null,
    };
  });
  return JSON.stringify(
    {
      version: (document.getElementById('app-version') || {}).textContent,
      summary: (document.getElementById('target-summary') || {}).textContent,
      allSwitch: (document.getElementById('all-switch') || {}).getAttribute?.('aria-checked'),
      rows,
    },
    null,
    1
  );
})()
