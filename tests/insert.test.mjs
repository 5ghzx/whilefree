import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/lib/browser.js');
await import('../src/lib/util.js');
await import('../src/lib/protocol.js');
await import('../src/lib/sites.js');
await import('../src/lib/dom.js');

const dom = globalThis.WF.dom;

/**
 * Putting a prompt in a message box, and knowing whether it got there.
 *
 * Every rule below comes from a live page. Perplexity and Kimi both run Lexical editors, and
 * on Perplexity one call to `setComposerText` left the prompt in the box **three times**:
 * `execCommand('insertText')` had worked, the read-back did not agree (because the editor
 * reconciles a frame later), so the next strategy added another copy, and the one after that
 * added a third. A prompt posted three times is a question the user pays for three times.
 */

class FakeEvent {
  constructor(type, init) {
    this.type = type;
    Object.assign(this, init || {});
  }
}

/** A document and window just real enough for the composer code. */
function makeEnv({ execCommandOk = false, selectionDeletes = true } = {}) {
  const view = {
    InputEvent: FakeEvent,
    Event: FakeEvent,
    KeyboardEvent: FakeEvent,
    getSelection: () => ({
      rangeCount: selectionDeletes ? 1 : 0,
      removeAllRanges() {},
      addRange() {},
      deleteFromDocument() {},
      getRangeAt: () => ({ deleteContents() {} }),
    }),
  };
  const doc = {
    defaultView: view,
    createRange: () => ({ selectNodeContents() {} }),
    execCommand: null,
  };
  return { view, doc, execCommandOk };
}

/** A contenteditable whose text can be written, with an editor that may overwrite us. */
function makeComposer(doc, { model = '', revertsOnInput = false } = {}) {
  const el = {
    tagName: 'DIV',
    ownerDocument: doc,
    _text: model,
    focused: false,
    focus() {
      el.focused = true;
    },
    dispatchEvent() {
      if (revertsOnInput) el._text = el._model;
      return true;
    },
    get textContent() {
      return el._text;
    },
    set textContent(value) {
      el._text = value;
    },
    // What the editor's own state holds, which is what it re-renders from.
    _model: model,
    setEditorModel(value) {
      el._model = value;
      el._text = value;
    },
  };
  return el;
}

test('the prompt already in the box is not typed again', () => {
  const { doc } = makeEnv();
  const el = makeComposer(doc, { model: 'Reply with exactly: PONG' });
  const written = dom.setComposerText(doc, el, 'Reply with exactly: PONG');
  assert.equal(written.ok, true);
  assert.equal(written.method, 'already-there');
  assert.equal(dom.readComposer(el, 'Reply with exactly: PONG').copies, 1, 'still exactly one copy');
});

test('execCommand replaces the contents on an editor that supports it', () => {
  const { doc } = makeEnv();
  const el = makeComposer(doc, { model: 'an older draft' });
  doc.execCommand = (command, ui, text) => {
    if (command !== 'insertText') return false;
    el.textContent = text;
    return true;
  };

  const written = dom.setComposerText(doc, el, 'a new prompt');
  assert.equal(written.ok, true);
  assert.equal(written.method, 'insertText');
  assert.equal(el.textContent, 'a new prompt', 'the draft is gone, not appended to');
});

test('a background tab still gets the text, through the DOM', () => {
  // `execCommand` needs document focus, and a broadcast types into tabs nobody is looking at.
  const { doc } = makeEnv();
  const el = makeComposer(doc, { model: 'an older draft' });
  doc.execCommand = () => false;

  const written = dom.setComposerText(doc, el, 'a new prompt');
  assert.equal(written.method, 'dom');
  assert.equal(written.ok, true);
  assert.equal(el.textContent, 'a new prompt');
});

test('an editor that will not take the text is reported, not doubled', () => {
  const { doc } = makeEnv();
  const el = makeComposer(doc, { model: 'the editor keeps this', revertsOnInput: true });
  doc.execCommand = () => false;

  const written = dom.setComposerText(doc, el, 'a new prompt');
  assert.equal(written.ok, false);
  assert.equal(written.reason, 'other-text', 'the box holds the editor’s text, not the prompt');
  assert.equal(dom.readComposer(el, 'a new prompt').copies, 0);
});

test('a box left holding two copies is emptied rather than sent', () => {
  // Selecting the contents and deleting them is what the live Perplexity editor accepts, so
  // the fake selection has to actually delete for this to mean anything.
  const { doc, view } = makeEnv();
  const el = makeComposer(doc);
  view.getSelection = () => ({
    rangeCount: 1,
    removeAllRanges() {},
    addRange() {},
    deleteFromDocument() {
      el.textContent = '';
    },
    getRangeAt: () => ({ deleteContents: () => { el.textContent = ''; } }),
  });
  doc.execCommand = (command, ui, text) => {
    if (command !== 'insertText') return false;
    // An editor that inserts *and* had already put the text there.
    el.textContent = `${text}${text}`;
    return true;
  };

  const written = dom.setComposerText(doc, el, 'a new prompt');
  assert.equal(written.ok, false);
  assert.equal(written.reason, 'doubled');
  assert.equal(el.textContent.trim(), '', 'the box is emptied, so nothing is sent twice');
});

test('invisible characters do not make a landed prompt look like a failure', () => {
  const { doc } = makeEnv();
  const el = makeComposer(doc);
  doc.execCommand = (command, ui, text) => {
    if (command !== 'insertText') return false;
    // Editors sprinkle zero-width marks and bidi controls into what they render.
    el.textContent = `\u200b${text}\u2060`;
    return true;
  };

  const written = dom.setComposerText(doc, el, 'a new prompt');
  assert.equal(written.ok, true, `read back as ${JSON.stringify(el.textContent)}`);
  assert.equal(written.method, 'insertText');
});

test('a textarea is written through its own value, as before', () => {
  const { doc } = makeEnv();
  const el = {
    tagName: 'TEXTAREA',
    ownerDocument: doc,
    value: 'an older draft',
    focus() {},
    dispatchEvent: () => true,
  };
  // `setNativeValue` writes through the native descriptor, which on a real textarea lives on
  // the prototype. A plain object needs both halves to agree on where the value is kept.
  doc.defaultView.HTMLTextAreaElement = {
    prototype: {
      get value() {
        return el.value;
      },
      set value(v) {
        el.value = v;
      },
    },
  };

  const written = dom.setComposerText(doc, el, 'a new prompt');
  assert.equal(written.ok, true);
  assert.equal(written.method, 'value');
  assert.equal(el.value, 'a new prompt');
});
