/**
 * The paths a Lexical editor owns, as opposed to the DOM it renders.
 *
 * A Lexical root is a render target: anything written into its DOM survives until the editor's
 * next reconciliation and no longer, so the four strategies in lib/dom.js all fail on it and
 * the failure looks identical from the outside. What a Lexical editor *does* accept is an event
 * one of its own handlers reads — a paste, a drop — or a command the browser fires for a real
 * edit. This tries the candidates that do not need a trusted event, and prints the focus state
 * that decides whether any of them can work at all: an unfocused document is the one condition
 * a fan-out into a background tab creates by definition.
 *
 *   WF_WORLD=page node scripts/rdp.mjs eval perplexity @scripts/probes/fx-lexical-paths.js
 */
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const composer = document.querySelector('#ask-input') || document.querySelector('[data-lexical-editor="true"]');
  if (!composer) return JSON.stringify({ composer: false });
  const view = document.defaultView;
  const marker = 'wfdrop';
  const read = () => (composer.innerText || '').replace(/\s+/g, ' ').trim();
  const results = [];
  const clear = async () => {
    composer.focus();
    const selection = view.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(composer);
      selection.removeAllRanges();
      selection.addRange(range);
      if (selection.deleteFromDocument) selection.deleteFromDocument();
    }
    await sleep(250);
  };
  const attempt = async (name, run) => {
    await clear();
    let returned = null;
    let error = null;
    try {
      returned = await run();
    } catch (err) {
      error = String((err && err.message) || err);
    }
    await sleep(900);
    results.push({ name, returned, error, text: read().slice(0, 40), stuck: read().includes(marker) });
    await clear();
  };

  await attempt('drop DragEvent + DataTransfer text/plain', () => {
    const data = new DataTransfer();
    data.setData('text/plain', marker);
    const event = new view.DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      composed: true,
      dataTransfer: data,
    });
    return composer.dispatchEvent(event);
  });
  await attempt('paste with insertFromPaste inputType after', () => {
    const data = new DataTransfer();
    data.setData('text/plain', marker);
    const paste = composer.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
    );
    const input = composer.dispatchEvent(
      new view.InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: null, dataTransfer: data })
    );
    return { paste, input };
  });
  await attempt('click then execCommand(insertText)', () => {
    composer.dispatchEvent(new view.MouseEvent('mousedown', { bubbles: true }));
    composer.dispatchEvent(new view.MouseEvent('mouseup', { bubbles: true }));
    composer.click();
    return document.execCommand('insertText', false, marker);
  });
  await attempt('focus + execCommand(insertParagraph) after textContent', () => {
    composer.textContent = marker;
    return document.execCommand('insertParagraph', false);
  });

  return JSON.stringify(
    {
      marker,
      hasFocus: document.hasFocus(),
      activeElement: document.activeElement ? document.activeElement.tagName : null,
      lexical: composer.getAttribute('data-lexical-editor'),
      contenteditable: composer.getAttribute('contenteditable'),
      ariaReadonly: composer.getAttribute('aria-readonly'),
      spellcheck: composer.getAttribute('spellcheck'),
      results,
    },
    null,
    1
  );
})()
