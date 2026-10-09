/**
 * Which way of typing into a Lexical editor actually sticks, given a moment to settle.
 *
 * The six-strategy probe (scripts/probes/insert-strategies.js) reads the box on the tick after
 * each attempt, and on a Lexical editor that is the wrong tick: Lexical renders from its own
 * model, so a DOM write is visible for exactly as long as it takes the editor to reconcile —
 * and a dispatched event is what makes it reconcile. The read therefore says "empty" for every
 * strategy, including the ones the editor accepted, which is how Perplexity looked like a site
 * with six broken insert paths when it may have none.
 *
 * This waits ~900ms after each attempt and reads both the visible text and Lexical's own
 * `[data-lexical-text]` spans, which is the render that the site will actually send.
 *
 *   WF_WORLD=page node scripts/rdp.mjs eval perplexity @scripts/probes/fx-lexical-insert.js
 *
 * The box is left as clean as the site allows; nothing is sent.
 */
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const composer = document.querySelector('#ask-input') || document.querySelector('[data-lexical-editor="true"]');
  if (!composer) return JSON.stringify({ composer: false });
  const view = document.defaultView;
  const marker = 'wfprobe';
  const domText = () => (composer.innerText || '').replace(/\s+/g, ' ').trim();
  const lexicalText = () =>
    Array.from(composer.querySelectorAll('[data-lexical-text="true"]'))
      .map((node) => node.textContent || '')
      .join('');
  const clean = () => {
    composer.focus();
    const selection = view.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection.removeAllRanges();
    selection.addRange(range);
    if (selection.deleteFromDocument) selection.deleteFromDocument();
  };

  const results = [];
  const attempt = async (name, run) => {
    clean();
    await sleep(250);
    let returned = null;
    let error = null;
    try {
      returned = await run();
    } catch (err) {
      error = String((err && err.message) || err);
    }
    await sleep(900);
    results.push({
      name,
      returned,
      error,
      dom: domText().slice(0, 30),
      lexical: lexicalText().slice(0, 30),
      html: (composer.innerHTML || '').replace(/</g, '‹').slice(0, 60),
      stuck: domText().includes(marker),
    });
    clean();
    await sleep(300);
  };

  await attempt('focus + execCommand(insertText)', () => document.execCommand('insertText', false, marker));
  await attempt('paste ClipboardEvent + DataTransfer', () => {
    const data = new DataTransfer();
    data.setData('text/plain', marker);
    return composer.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
    );
  });
  await attempt('textContent then input(insertText)', () => {
    composer.textContent = marker;
    composer.dispatchEvent(new view.InputEvent('input', { bubbles: true, inputType: 'insertText', data: marker }));
    return true;
  });
  await attempt('textContent alone, no event', () => {
    composer.textContent = marker;
    return true;
  });
  await attempt('beforeinput(insertText) alone', () =>
    composer.dispatchEvent(
      new view.InputEvent('beforeinput', {
        inputType: 'insertText',
        data: marker,
        bubbles: true,
        cancelable: true,
        composed: true,
      })
    )
  );

  return JSON.stringify({ marker, results }, null, 1);
})()
