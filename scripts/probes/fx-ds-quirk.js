// Does WhileFree's DeepThink/Search quirk do what it says on a signed-in DeepSeek tab?
//
//   node scripts/rdp.mjs eval deepseek @scripts/probes/fx-ds-quirk.js
//
// It reads the toggles, runs the real quirk path (`WF.sites.applyQuirks`, the same call
// `sendPrompt` makes before every send) and reads them again. The two halves are the rdp
// pattern for watching an async call from a world with no top-level await: the first returns
// what the page says now, the second — after the call has had time to click and settle — says
// what it says afterwards. A toggle that reads *more* on after a call meant to switch it off is
// the finding, and `svgCurrent` is there because `QUIRKS.toggleOff` treats an inner
// `svg[fill="currentColor"]` as evidence the mode is on.
(() => {
  const toggles = () =>
    [...document.querySelectorAll('.ds-toggle-button')].map((el) => ({
      text: (el.textContent || '').trim(),
      selected: /ds-toggle-button--selected/.test(el.className || ''),
      cls: String(el.className || '')
        .split(/\s+/)
        .filter((c) => /selected|active|on\b|enabled/.test(c))
        .join(' '),
      aria: el.getAttribute('aria-label'),
      role: el.getAttribute('role'),
      svgFill: [...el.querySelectorAll('svg')].map((s) => s.getAttribute('fill')).join(','),
      svgCurrent: !!el.querySelector('svg[fill="currentColor"]'),
      labelMatched: /deep\s?think/i.test(el.textContent || ''),
    }));

  const site = WF.sites.byId('deepseek');
  const settings = { disableSlowModes: { deepseek: true } };
  globalThis.__wfQuirkDone = null;
  globalThis.__wfQuirk = WF.sites
    .applyQuirks(site, { doc: document, warn: (m) => console.warn('[wf]', m) }, settings)
    .then((r) => {
      globalThis.__wfQuirkDone = r === undefined ? 'void' : JSON.stringify(r);
    });

  return JSON.stringify({ before: toggles() }, null, 1);
})()
// ::after 4000
(() => {
  return JSON.stringify(
    {
      after: [...document.querySelectorAll('.ds-toggle-button')].map((el) => ({
        text: (el.textContent || '').trim(),
        selected: /ds-toggle-button--selected/.test(el.className || ''),
      })),
      quirkResolved: globalThis.__wfQuirkDone,
    },
    null,
    1
  );
})()
