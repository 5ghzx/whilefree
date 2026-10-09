// What says "DeepSeek is generating" — beyond the button icon.
//
//   node scripts/rdp.mjs eval deepseek @scripts/probes/fx-ds-streaming.js   # starts sampling
//   ... kick a send with a long answer ...
//   node scripts/rdp.mjs eval deepseek "JSON.stringify(globalThis.__wfStream, null, 1)"
//
// The stop control on this site carries no label at all (see fx-ds-stream.js), so the only
// things that can stand in for one are the icon inside the button and whatever the answer
// itself wears while it is being written. This samples both, plus every element on the page
// whose class says streaming/typing/cursor/loading, so the choice is made from evidence.
(() => {
  const site = WF.sites.byId('deepseek');
  const circle = () =>
    [...document.querySelectorAll('div[role="button"].ds-button--circle')].map((el) => ({
      cls: String(el.className || '').replace(/ds-button--?/g, '').replace(/\s+/g, ' ').trim().slice(0, 60),
      disabled: /--disabled/.test(el.className || ''),
      html: (el.innerHTML || '').replace(/\s+/g, ' ').slice(0, 220),
    }));

  globalThis.__wfStream = [];
  const started = Date.now();
  globalThis.__wfStreamer = setInterval(() => {
    if (Date.now() - started > 90000) {
      clearInterval(globalThis.__wfStreamer);
      return;
    }
    const hits = [];
    for (const el of document.querySelectorAll('[class]')) {
      const cls = String(el.className);
      if (/stream|typing|cursor|loading|spin|generat|think/i.test(cls)) {
        hits.push(`${el.tagName.toLowerCase()}.${cls.replace(/\s+/g, '.').slice(0, 60)}`);
        if (hits.length > 12) break;
      }
    }
    globalThis.__wfStream.push({
      at: Math.round((Date.now() - started) / 100) / 10,
      chars: WF.dom.assistantChars(document, site).chars,
      wfStop: !!WF.dom.findStopButton(document, site),
      hits,
      circle: circle(),
    });
  }, 900);
  return JSON.stringify({ sampling: true, url: location.href });
})()
