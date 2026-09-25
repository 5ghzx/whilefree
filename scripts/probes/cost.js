// What does each probe cost on this page, in milliseconds, warm?
//
//   WF_WORLD=ext node scripts/cdp.mjs eval chatgpt.com @scripts/probes/cost.js
//
// A content script that looks cheap can be expensive on a page whose DOM is large, so the
// numbers here are the ones that decide where the time goes. Repeated, because a single
// call can be fast by luck and the loop is what the page actually pays.
(async () => {
  const WF = globalThis.WF;
  const site = WF.sites.fromUrl(location.href);
  const time = (label, fn, runs = 20) => {
    const started = performance.now();
    let last = null;
    for (let i = 0; i < runs; i += 1) last = fn();
    const each = (performance.now() - started) / runs;
    return { label, ms: Number(each.toFixed(3)), last: last === undefined ? null : last };
  };

  const out = {
    page: { url: location.href.slice(0, 50), elements: document.querySelectorAll('*').length, buttons: document.querySelectorAll('a, button, [role="button"]').length },
    probes: [],
  };

  if (!site) return { error: 'no adapter for this page' };

  out.probes.push(time('findComposer', () => !!WF.dom.findComposer(document, site)));
  out.probes.push(time('loginDoor', () => WF.dom.loginDoor(document)));
  out.probes.push(time('bannerText', () => WF.dom.bannerText(document).length));
  out.probes.push(time('assistantChars', () => WF.dom.assistantChars(document, site).chars));
  out.probes.push(time('detectAttention', () => WF.dom.detectAttention(document, site, location.href, true)));
  out.probes.push(time('findSendButton', () => !!WF.dom.findSendButton(document, site, WF.dom.findComposer(document, site))));
  out.probes.push(time('diagnose', () => Object.keys(WF.dom.diagnose(document, site, location.href)).length, 5));
  return out;
})();
