// The gap between "the request closed" and "the answer appears", sampled on DeepSeek.
//
//   node scripts/rdp.mjs eval deepseek @scripts/probes/fx-ds-gap.js      # starts sampling
//   ... start a send ...
//   node scripts/rdp.mjs eval deepseek "JSON.stringify(globalThis.__wfGap, null, 1)"
//
// Run 2 of the paired deepseek sends recorded 388 characters of a 1322-character answer and
// declared it finished 2.6s after the press, which is the same failure as before in a new
// disguise: DeepSeek unmounts older turns while the new one paints, so the *total* on screen
// falls and the monotone high-water mark never rises — no growth is seen, so "the page has
// stopped painting" is true from the first moment. This samples everything that could tell the
// difference: the total, the last answer's own length, the loading spinner, the stop control
// and the watcher's own idea of where it is.
(() => {
  const site = WF.sites.byId('deepseek');
  const started = Date.now();
  globalThis.__wfGap = [];
  globalThis.__wfGapTimer = setInterval(() => {
    const nodes = [...document.querySelectorAll('div[class*="ds-markdown"]')];
    const last = nodes[nodes.length - 1];
    const w = WF.content.watcher;
    const circle = document.querySelector('div[role="button"].ds-button--primary.ds-button--circle');
    globalThis.__wfGap.push({
      at: Math.round((Date.now() - started) / 100) / 10,
      total: WF.dom.assistantChars(document, site).chars,
      nodes: nodes.length,
      lastLen: last ? last.innerText.length : 0,
      loading: document.querySelectorAll('.ds-loading').length,
      stopUp: !!WF.dom.findStopButton(document, site),
      circle: circle ? (/--disabled/.test(circle.className) ? 'off' : 'on') : 'none',
      phase: w ? w.phase : null,
      running: w ? w.running : null,
      highWater: w ? w.highWater : null,
      doneAt: w && w.doneAt ? Math.round(w.doneAt - started) : null,
      sentAt: w ? Math.round(w.sentAt - started) : null,
    });
    if (globalThis.__wfGap.length > 220) clearInterval(globalThis.__wfGapTimer);
  }, 400);
  return JSON.stringify({ sampling: true, url: location.href });
})()
