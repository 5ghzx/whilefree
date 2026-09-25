// Which insertion strategy does a Lexical editor accept?
//
//   WF_WORLD=ext node scripts/cdp.mjs eval perplexity.ai @scripts/probes/insert-strategies.js
//
// Perplexity and Kimi both render `<span data-lexical-text="true">`, and on both the normal
// path fails: `execCommand('insertText')` returns true and leaves the box empty. This tries
// each way of putting text in, one at a time, from a clean box each time.
(() => {
  const WF = globalThis.WF;
  const site = WF.sites.fromUrl(location.href);
  const composer = WF.dom.findComposer(document, site);
  const marker = 'wfchk';
  const view = document.defaultView;
  const clean = () => {
    composer.focus();
    WF.dom.selectAll(composer);
    const sel = view.getSelection();
    if (sel && sel.deleteFromDocument) sel.deleteFromDocument();
    return WF.dom.composerText(composer).trim() === '';
  };
  const read = () => WF.dom.normalize(WF.dom.composerText(composer));

  const strategies = {
    "execCommand('insertText')": () => document.execCommand('insertText', false, marker),
    "execCommand('insertHTML')": () => document.execCommand('insertHTML', false, marker),
    'ClipboardEvent paste + DataTransfer': () => {
      const dt = new DataTransfer();
      dt.setData('text/plain', marker);
      const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      return composer.dispatchEvent(event);
    },
    'beforeinput InputEvent + execCommand': () => {
      const event = new view.InputEvent('beforeinput', {
        inputType: 'insertText',
        data: marker,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      const notCancelled = composer.dispatchEvent(event);
      if (notCancelled) document.execCommand('insertText', false, marker);
      return notCancelled;
    },
    'textContent + input event': () => {
      composer.textContent = marker;
      composer.dispatchEvent(new view.InputEvent('input', { bubbles: true, inputType: 'insertText', data: marker }));
      return true;
    },
    'KeyboardEvent per character': () => {
      for (const ch of marker) {
        for (const type of ['keydown', 'keypress', 'keyup']) {
          composer.dispatchEvent(
            new view.KeyboardEvent(type, { key: ch, bubbles: true, cancelable: true, composed: true })
          );
        }
      }
      return true;
    },
  };

  const results = [];
  for (const [name, run] of Object.entries(strategies)) {
    const wasClean = clean();
    let returned = null;
    let error = null;
    try {
      returned = run();
    } catch (err) {
      error = String((err && err.message) || err);
    }
    const after = read();
    results.push({
      name,
      wasClean,
      returned,
      after: after.slice(0, 40),
      exact: after === marker,
      // What the editor rendered, which is the only copy that matters for sending.
      html: (composer.innerHTML || '').replace(/</g, '‹').slice(0, 70),
      error,
    });
  }
  clean();
  return { picked: { tag: composer.tagName, id: composer.id || null }, results };
})();
