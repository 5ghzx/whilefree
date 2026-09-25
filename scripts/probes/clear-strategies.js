// Which way of emptying a rich-text composer does the editor actually accept?
//
//   WF_WORLD=ext node scripts/cdp.mjs eval perplexity.ai @scripts/probes/clear-strategies.js
//
// Written after a live Perplexity box ended up holding the prompt three times from one
// `setComposerText` call: a strategy that cannot tell "I put the text there" from "the text
// was already there" layers on another copy instead of replacing what is in the box.
(() => {
  const WF = globalThis.WF;
  const site = WF.sites.fromUrl(location.href);
  const composer = WF.dom.findComposer(document, site);
  const text = 'wf probe';
  const tail = () => WF.dom.normalize(WF.dom.composerText(composer)).slice(-24);
  const results = [];

  const fill = () => {
    composer.focus();
    document.execCommand('insertText', false, text);
  };

  const strategies = {
    'range + execCommand(delete)': () => {
      WF.dom.selectAll(composer);
      document.execCommand('delete');
    },
    'execCommand(selectAll) + delete': () => {
      composer.focus();
      document.execCommand('selectAll');
      document.execCommand('delete');
    },
    'range + deleteFromDocument': () => {
      WF.dom.selectAll(composer);
      const sel = document.getSelection();
      if (sel && sel.deleteFromDocument) sel.deleteFromDocument();
      else if (sel && sel.rangeCount) sel.getRangeAt(0).deleteContents();
    },
    'selectAll + backspace key': () => {
      composer.focus();
      document.execCommand('selectAll');
      const view = document.defaultView;
      for (const type of ['keydown', 'keypress', 'keyup']) {
        composer.dispatchEvent(
          new view.KeyboardEvent(type, { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true, cancelable: true })
        );
      }
      document.execCommand('delete');
    },
  };

  for (const [name, clear] of Object.entries(strategies)) {
    fill();
    const filled = tail();
    let error = null;
    try {
      clear();
    } catch (err) {
      error = String((err && err.message) || err);
    }
    results.push({ name, afterFill: filled, afterClear: tail(), empty: WF.dom.composerText(composer).trim() === '', error });
  }

  return { composer: { tag: composer.tagName, id: composer.id }, results };
})();
