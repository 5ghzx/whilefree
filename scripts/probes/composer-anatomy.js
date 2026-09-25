// Why can't we type here?
//
//   node scripts/cdp.mjs open https://www.perplexity.ai/
//   WF_WORLD=ext node scripts/cdp.mjs eval perplexity.ai @scripts/probes/composer-anatomy.js
//
// Reports every element the adapter's input selectors match, whether it is really on
// screen, and what each insertion strategy does to it.
(() => {
  const WF = globalThis.WF;
  const site = WF.sites.fromUrl(location.href);
  if (!site) return { noAdapter: location.href };
  const short = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 50);
  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) };
  };

  const candidates = [];
  for (const selector of site.input.selectors) {
    let nodes = [];
    try {
      nodes = [...document.querySelectorAll(selector)];
    } catch (err) {
      candidates.push({ selector, error: 'bad selector' });
      continue;
    }
    for (const node of nodes) {
      candidates.push({
        selector,
        tag: node.tagName.toLowerCase(),
        contentEditable: node.getAttribute('contenteditable'),
        role: node.getAttribute('role'),
        visible: WF.dom.isVisible(node),
        rect: rect(node),
        aria: short(node.getAttribute('aria-label') || node.getAttribute('placeholder')),
        editable: node.isContentEditable,
      });
    }
  }

  const composer = WF.dom.findComposer(document, site);
  const before = WF.dom.composerText(composer || document.body);
  let outcome = null;
  if (composer) {
    const written = WF.dom.setComposerText(document, composer, 'wf probe');
    outcome = {
      method: written.method,
      ok: written.ok,
      readBack: short(WF.dom.composerText(composer)),
      before: short(before),
      stillThere: document.contains(composer),
      // Is the element we typed into the one with focus, and what does the page think?
      sameNodeAsFocus: document.activeElement === composer,
      inputEvents: typeof document.execCommand,
    };
    WF.dom.setComposerText(document, composer, '');
  }

  return {
    site: site.id,
    declaredKind: site.input.kind,
    candidates,
    picked: composer ? { tag: composer.tagName, editable: composer.isContentEditable, rect: rect(composer) } : null,
    outcome,
    // A second opinion: what would a plain keyboard-insertion find?
    editablesOnPage: [...document.querySelectorAll('[contenteditable="true"], textarea')]
      .filter((n) => WF.dom.isVisible(n))
      .map((n) => ({ tag: n.tagName.toLowerCase(), id: n.id || null, rect: rect(n), aria: short(n.getAttribute('aria-label') || n.getAttribute('placeholder')) })),
  };
})();
