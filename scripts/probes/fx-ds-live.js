// DeepSeek's controls in detail, idle or mid-answer.
//
//   node scripts/rdp.mjs eval deepseek @scripts/probes/fx-ds-live.js
//
// Run it twice — once with the page idle and once while an answer is streaming — and the
// difference is the whole question a selector list has to answer: what does the send control
// look like when there is something to send, and what replaces it while there is something to
// stop. `label` is the extension's own `WF.dom.labelOf`, so a node with an empty label is one
// no label-matcher in `findSendButton` can ever pick, however visible it is.
(() => {
  const brief = (el) => {
    const rect = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || '').slice(0, 90),
      role: el.getAttribute('role'),
      aria: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      testid: el.getAttribute('data-testid'),
      label: WF.dom.labelOf(el),
      disabled: el.disabled === true,
      ariaDisabled: el.getAttribute('aria-disabled'),
      rect: [Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)],
      svgFills: [...el.querySelectorAll('svg')].map((s) => s.getAttribute('fill') || '-').join(','),
      svgPaths: [...el.querySelectorAll('path')].map((p) => (p.getAttribute('d') || '').slice(0, 24)).join(' | '),
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30),
    };
  };

  const composer = document.querySelector('textarea');
  const site = WF.sites.byId('deepseek');

  // Walk up from the box; the controls that matter are siblings of it, not descendants.
  const chain = [];
  let node = composer;
  for (let up = 0; up < 5 && node; up += 1) {
    chain.push({
      tag: node.tagName.toLowerCase(),
      cls: String(node.className || '').slice(0, 70),
      controls: node.querySelectorAll('button, [role="button"]').length,
    });
    node = node.parentElement;
  }
  const scope = chain.length ? composer.closest('form') || composer.parentElement.parentElement.parentElement : null;

  const labelled = [...document.querySelectorAll('[aria-label], [title]')]
    .filter((el) => /stop|send|submit/i.test(el.getAttribute('aria-label') || el.getAttribute('title') || ''))
    .slice(0, 8)
    .map(brief);

  return JSON.stringify(
    {
      url: location.href,
      answering: !!WF.dom.findStopButton(document, site),
      answerChars: WF.dom.assistantChars(document, site).chars,
      composer: composer ? brief(composer) : null,
      chain,
      controls: scope ? [...scope.querySelectorAll('button, [role="button"]')].map(brief) : [],
      labelled,
      findSend: (() => {
        const found = WF.dom.findSendButton(document, site, composer);
        return found ? brief(found) : null;
      })(),
      explicitSend: site.send.selectors.map((selector) => {
        try {
          const el = document.querySelector(selector);
          return `${selector} -> ${el ? brief(el).label || '(no label)' : 'none'}`;
        } catch (err) {
          return `${selector} -> bad selector`;
        }
      }),
      explicitStop: site.stop.selectors.map((selector) => {
        try {
          const el = document.querySelector(selector);
          return `${selector} -> ${el ? brief(el).label || '(no label)' : 'none'}`;
        } catch (err) {
          return `${selector} -> bad selector`;
        }
      }),
    },
    null,
    1
  );
})()
