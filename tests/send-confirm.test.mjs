import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/lib/browser.js');
await import('../src/lib/util.js');
await import('../src/lib/protocol.js');
await import('../src/lib/sites.js');
await import('../src/lib/settings.js');
await import('../src/lib/dom.js');
await import('../src/content/composer.js');

const { content, sites } = globalThis.WF;
const composer = content.composer;

/**
 * These tests come from Firefox, on Qwen and Le Chat.
 *
 * Sending on Qwen works — the prompt lands, the page moves to /c/<id> — and the extension
 * called it a failure, twice over: the composer is part of the new-chat surface and is swapped
 * out on submit, so the detached textarea still held the prompt and "the box emptied" never
 * became true; and Le Chat draws its send button on the render *after* the text, so a lookup
 * made at the moment of typing found nothing, fell back to Enter, and left the prompt sitting
 * in a ProseMirror box (where Enter starts a new line rather than sending).
 */

/** The smallest thing that satisfies dom.isVisible: a laid-out, styled, on-screen node. */
function node(text, { size = 20, attrs = null, tag = 'DIV' } = {}) {
  const rect = { width: size, height: size, top: 10, left: 10, right: 10 + size, bottom: 10 + size };
  return {
    tag,
    textContent: text,
    disabled: false,
    isConnected: true,
    getAttribute: (name) => (attrs && attrs[name] !== undefined ? attrs[name] : null),
    getClientRects: () => [rect],
    getBoundingClientRect: () => rect,
    parentElement: null,
    querySelectorAll: () => [],
    ownerDocument: {
      defaultView: {
        getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
      },
    },
  };
}

/** A page that matches nothing: no stop control, no answers, no send control. */
function emptyDoc() {
  return {
    documentElement: {},
    querySelectorAll: () => [],
    querySelector: () => null,
  };
}

test('a composer the page replaces counts as a send that went', async () => {
  const site = sites.byId('qwen');
  const input = node('', { tag: 'TEXTAREA' });
  input.value = 'the prompt';
  const doc = emptyDoc();
  // What the page looked like before the press...
  const before = composer.sendEvidence(doc, site, input);
  assert.equal(before.inputGone, false);
  // ...and after it: the box we typed into is no longer in the document, it never emptied, and
  // nothing else on the page has changed yet.
  input.isConnected = false;

  const res = await composer.confirmStarted(doc, site, input, before, 500, 1234);
  assert.equal(res.started, true);
  assert.equal(res.via, 'composer was replaced');
});

test('a box that was already gone is not evidence of a second send', async () => {
  const site = sites.byId('qwen');
  const input = node('', { tag: 'TEXTAREA' });
  input.value = 'the prompt';
  input.isConnected = false;
  const doc = emptyDoc();
  // This is a retry: the box had already left the page when the attempt began, so seeing it
  // gone again says nothing about this press. It must not be reported as a send.
  const before = composer.sendEvidence(doc, site, input);
  assert.equal(before.inputGone, true);

  const res = await composer.confirmStarted(doc, site, input, before, 200, 1234);
  assert.equal(res.started, false);
  assert.equal(res.via, null);
});

test('a send control that arrives after the text is waited for, not assumed away', async () => {
  const site = sites.byId('mistral');
  const button = node('', { tag: 'BUTTON', attrs: { 'aria-label': 'Send' } });
  button.querySelectorAll = () => [];
  const observed = [];
  const original = globalThis.MutationObserver;
  globalThis.MutationObserver = class {
    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      observed.push(this);
    }
    observe() {}
    disconnect() {
      this.disconnected = true;
    }
  };

  try {
    // Nothing there yet: this is Le Chat at the instant the prompt lands.
    let available = false;
    const doc = emptyDoc();
    doc.querySelectorAll = (selector) => {
      const wanted = String(selector).split(',').map((s) => s.trim());
      if (!available) return [];
      return wanted.includes('button[aria-label="Send"]') ? [button] : [];
    };

    const pending = composer.waitForSendControl(doc, site, null, 5000);
    // The render that follows the typing is what mounts it, and that render is what wakes us.
    available = true;
    observed[0].callback();

    assert.equal(await pending, button);
    assert.equal(observed[0].disconnected, true, 'the watcher lets go once it has its answer');
  } finally {
    globalThis.MutationObserver = original;
  }
});

test('a site that never draws a control is given up on rather than waited for forever', async () => {
  const site = sites.byId('mistral');
  const original = globalThis.MutationObserver;
  globalThis.MutationObserver = class {
    constructor() {}
    observe() {}
    disconnect() {}
  };
  try {
    assert.equal(await composer.waitForSendControl(emptyDoc(), site, null, 20), null);
  } finally {
    globalThis.MutationObserver = original;
  }
});
