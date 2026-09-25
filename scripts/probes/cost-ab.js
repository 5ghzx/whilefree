// Old probe order vs new, on the same page — and on the same page made heavy.
//
//   WF_WORLD=ext node scripts/cdp.mjs eval chatgpt.com @scripts/probes/cost-ab.js
//
// The question is not how long a probe takes on a small page; it is how the order of its two
// questions scales when the page is large. Reading a label is a string. Asking `isVisible`
// costs client rects and computed style, which is a layout — and on a page that is streaming
// an answer, a layout forced from a content script lands in the middle of the page's own work.
(async () => {
  const WF = globalThis.WF;
  const site = WF.sites.fromUrl(location.href);
  const visible = WF.dom.isVisible;
  const label = WF.dom.labelOf;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const OLD_DOOR = (doc) => {
    const words = WF.sites.SIGN_IN_WORDS;
    for (const node of doc.querySelectorAll('a, button, [role="button"]')) {
      if (!visible(node)) continue;
      const text = (node.textContent || '').trim().replace(/\s+/g, ' ');
      if (!text || text.length > 40) continue;
      for (const word of words) if (word.test(text)) return text;
    }
    return null;
  };
  const OLD_STOP = (doc, s) => {
    const explicit = WF.dom.pick(doc, s.stop.selectors);
    if (explicit && visible(explicit)) return explicit;
    for (const node of doc.querySelectorAll('button, [role="button"]')) {
      if (!visible(node)) continue;
      if (/^(stop|stop generating|stop response|stop streaming)$/i.test(label(node))) return node;
    }
    return null;
  };

  const time = (fn, runs = 8) => {
    const started = performance.now();
    for (let i = 0; i < runs; i += 1) fn();
    return Number(((performance.now() - started) / runs).toFixed(2));
  };

  const measure = () => ({
    elements: document.querySelectorAll('*').length,
    doorOld: time(() => OLD_DOOR(document)),
    doorNew: time(() => WF.dom.loginDoor(document)),
    stopOld: time(() => OLD_STOP(document, site)),
    stopNew: time(() => WF.dom.findStopButton(document, site)),
    banner: time(() => WF.dom.bannerText(document)),
    attention: time(() => WF.dom.detectAttention(document, site, location.href, true)),
  });

  const light = measure();

  // Twenty copies of the page's own markup: a long conversation, in effect.
  const host = document.createElement('div');
  host.setAttribute('data-wf-benchmark', '');
  for (let i = 0; i < 20; i += 1) host.appendChild(document.body.cloneNode(true));
  host.style.position = 'absolute';
  host.style.left = '-10000px';
  host.style.top = '0';
  document.body.appendChild(host);
  await sleep(300);

  const heavy = measure();
  host.remove();

  return { site: site.id, light, heavy };
})();
