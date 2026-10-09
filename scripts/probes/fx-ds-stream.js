// What DeepSeek's composer controls do across one answer, sampled every 1.2s.
//
//   node scripts/rdp.mjs eval deepseek @scripts/probes/fx-ds-stream.js     # starts sampling
//   ... kick a send from the background world ...
//   node scripts/rdp.mjs eval deepseek "JSON.stringify(globalThis.__wfSamples, null, 1)"
//
// The stop control only exists while an answer is streaming, so a single reading either misses
// it or reads it as absent — the two conclusions this probe exists to separate. Each sample
// carries the button set around the box, whether the extension's own `findStopButton` sees a
// stop, and every label on the page containing "stop", so "the answer had already finished"
// and "our stop selector is wrong" stop looking alike.
(() => {
  const site = WF.sites.byId('deepseek');
  const controls = () => {
    const area = document.querySelector('textarea');
    if (!area) return [];
    const scope = area.closest('form') || area.parentElement.parentElement.parentElement;
    return [...scope.querySelectorAll('button, [role="button"]')].slice(0, 6).map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        cls: String(el.className || '')
          .replace(/ds-button/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 70),
        label: WF.dom.labelOf(el) || '(none)',
        svg: [...el.querySelectorAll('path')].map((p) => (p.getAttribute('d') || '').slice(0, 18)).join('|'),
        x: Math.round(rect.left),
        w: Math.round(rect.width),
        disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      };
    });
  };
  const stopLabels = () =>
    [...document.querySelectorAll('[aria-label], [title]')]
      .map((el) => el.getAttribute('aria-label') || el.getAttribute('title'))
      .filter((label) => /stop/i.test(label || ''))
      .slice(0, 4);

  globalThis.__wfSamples = [];
  const started = Date.now();
  globalThis.__wfSampler = setInterval(() => {
    if (Date.now() - started > 90000) {
      clearInterval(globalThis.__wfSampler);
      return;
    }
    globalThis.__wfSamples.push({
      at: Math.round((Date.now() - started) / 100) / 10,
      chars: WF.dom.assistantChars(document, site).chars,
      wfStop: !!WF.dom.findStopButton(document, site),
      stopLabels: stopLabels(),
      controls: controls(),
    });
  }, 1200);
  return JSON.stringify({ sampling: true, url: location.href });
})()
