// One clear, one insert, one exact read-back — for the sites where the normal path fails.
//
//   WF_WORLD=ext node scripts/cdp.mjs eval perplexity.ai @scripts/probes/one-insert.js
(() => {
  const WF = globalThis.WF;
  const site = WF.sites.fromUrl(location.href);
  const composer = WF.dom.findComposer(document, site);
  const marker = 'whilefree check';
  const codes = (s) => [...String(s)].map((c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126 ? `[${c.charCodeAt(0)}]` : c)).join('');

  const cleared = WF.dom.clearComposer(document, composer);
  const afterClear = WF.dom.composerText(composer);
  const buttonBefore = WF.dom.findSendButton(document, site, composer);

  composer.focus();
  const inserted = document.execCommand('insertText', false, marker);
  const afterInsert = WF.dom.composerText(composer);
  const buttonAfter = WF.dom.findSendButton(document, site, composer);

  const state = {
    picked: { tag: composer.tagName, id: composer.id || null },
    focused: document.hasFocus(),
    clear: { ok: cleared.ok, empty: cleared.empty, readBack: codes(afterClear).slice(0, 30) },
    insert: { returned: inserted, readBack: codes(afterInsert), exact: WF.dom.normalize(afterInsert) === marker },
    button: {
      before: buttonBefore ? { label: WF.dom.labelOf(buttonBefore), disabled: !!buttonBefore.disabled } : null,
      after: buttonAfter ? { label: WF.dom.labelOf(buttonAfter), disabled: !!buttonAfter.disabled } : null,
    },
    // What the editor's own view says: is the text in its model, or only in the DOM?
    domNodes: [...composer.childNodes].map((n) => codes((n.textContent || '').slice(0, 40))).slice(0, 4),
    html: codes((composer.innerHTML || '').slice(0, 120)),
  };

  WF.dom.clearComposer(document, composer);
  return state;
})();
