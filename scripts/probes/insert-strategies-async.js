// The same strategies, but waiting for the editor before judging them.
//
//   WF_WORLD=ext node scripts/cdp.mjs eval perplexity.ai @scripts/probes/insert-strategies-async.js
//
// A rich-text editor can handle an insert in a microtask or on the next frame, so a
// read-back on the very next line says "nothing happened" about an insertion that is about to
// arrive. If that is what is happening, the next strategy is tried on top of a box that does
// contain the text — which is how one prompt becomes three.
(async () => {
  const WF = globalThis.WF;
  const site = WF.sites.fromUrl(location.href);
  const composer = WF.dom.findComposer(document, site);
  const marker = 'wfchk';
  const view = document.defaultView;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const read = () => WF.dom.normalize(WF.dom.composerText(composer));
  const clean = () => {
    composer.focus();
    WF.dom.selectAll(composer);
    const sel = view.getSelection();
    if (sel && sel.deleteFromDocument) sel.deleteFromDocument();
  };

  const strategies = {
    "execCommand('insertText')": () => {
      composer.focus();
      document.execCommand('insertText', false, marker);
    },
    'ClipboardEvent paste + DataTransfer': () => {
      const dt = new DataTransfer();
      dt.setData('text/plain', marker);
      composer.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    'textContent + input event': () => {
      composer.textContent = marker;
      composer.dispatchEvent(new view.InputEvent('input', { bubbles: true, inputType: 'insertText', data: marker }));
    },
  };

  const results = [];
  for (const [name, run] of Object.entries(strategies)) {
    clean();
    await sleep(400);
    const start = read();
    let error = null;
    try {
      run();
    } catch (err) {
      error = String((err && err.message) || err);
    }
    await sleep(700);
    const after = read();
    results.push({
      name,
      start: start.slice(0, 20),
      after: after.slice(0, 30),
      exact: after === marker,
      run: run.toString().slice(0, 0),
      error,
    });
  }
  clean();
  return { picked: { tag: composer.tagName, id: composer.id || null }, results };
})();
