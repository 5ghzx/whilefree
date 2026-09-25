// One insertion, one read-back, character by character.
//
//   WF_WORLD=ext node scripts/cdp.mjs eval perplexity.ai @scripts/probes/insert-readback.js
//
// The composer's own text is the only thing used to verify that the prompt landed, so a
// read-back that never equals the prompt is what makes the extension type the same thing
// again with the next strategy.
(() => {
  const WF = globalThis.WF;
  const site = WF.sites.fromUrl(location.href);
  const composer = WF.dom.findComposer(document, site);
  const text = 'wf probe';
  const codes = (s) => [...String(s)].map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126 ? `${c.charCodeAt(0)}` : c)).join('');

  // Clear the box the way the first strategy does, then insert exactly once.
  WF.dom.selectAll(composer);
  const cleared = composer.textContent;
  const inserted = document.execCommand('insertText', false, text);
  const afterTextContent = composer.textContent;
  const afterInnerText = composer.innerText;
  const afterComposerText = WF.dom.composerText(composer);
  const normalized = WF.dom.normalize(afterComposerText);

  return {
    picked: { tag: composer.tagName, id: composer.id, contentEditable: composer.getAttribute('contenteditable') },
    clearedHadContent: codes(cleared).slice(0, 20),
    insertTextReturned: inserted,
    readBack: {
      textContent: codes(afterTextContent),
      innerText: codes(afterInnerText),
      composerText: codes(afterComposerText),
      normalized: codes(normalized),
      matches: normalized === text,
    },
    childNodes: [...composer.childNodes].slice(0, 6).map((n) => ({
      type: n.nodeType,
      name: n.nodeName,
      text: codes((n.textContent || '').slice(0, 30)),
      html: codes(((n.outerHTML || '') + '').slice(0, 60)),
    })),
    // Something is holding text that is not the input: a placeholder, a ghost node, a label.
    placeholders: [...composer.querySelectorAll('[class*="placeholder" i], [data-placeholder], [aria-placeholder]')]
      .map((n) => codes((n.textContent || '').slice(0, 30))),
  };
})();
