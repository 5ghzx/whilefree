import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/lib/browser.js');
await import('../src/lib/util.js');
await import('../src/lib/protocol.js');
await import('../src/lib/sites.js');
await import('../src/lib/settings.js');
await import('../src/lib/dom.js');
await import('../src/content/composer.js');

const { dom, sites, ATTENTION, content } = globalThis.WF;

/**
 * These tests come from a real browser.
 *
 * Every adapter was passing while a logged-out ChatGPT and a logged-out Gemini were both
 * reported as ready to answer. The cause was an ordering assumption — "look for a sign-in
 * door only when there is no message box" — and these tests hold the rule that replaced it:
 * a visible sign-in door means no session, whether or not the page is willing to chat
 * anyway.
 */

/** The smallest thing that satisfies dom.isVisible: a laid-out, styled, on-screen node. */
function node(text, { hidden = false, size = 20, attrs = null } = {}) {
  const rect = { width: size, height: size, top: 10, left: 10, right: 10 + size, bottom: 10 + size };
  return {
    textContent: text,
    getAttribute: (name) => (attrs && attrs[name] !== undefined ? attrs[name] : null),
    getClientRects: () => (hidden ? [] : [rect]),
    getBoundingClientRect: () => rect,
    ownerDocument: {
      defaultView: {
        getComputedStyle: () => ({ display: hidden ? 'none' : 'block', visibility: 'visible', opacity: '1' }),
      },
    },
  };
}

/** A page: what the selector probes see, and the nodes the door-scan walks. */
function page({ nodes = [], composer = false, loginLink = false, banners = [] } = {}) {
  const doc = {
    querySelectorAll(selector) {
      const selectors = String(selector).split(',').map((s) => s.trim());
      // The door scan asks for 'a, button, [role="button"]' in one go.
      if (selectors.includes('a') && selectors.includes('button')) return nodes;
      if (selectors.includes('a')) return nodes.filter((n) => n.tag === 'a');
      if (selectors.includes('button')) return nodes.filter((n) => n.tag === 'button');
      if (selectors.includes('textarea') || selectors.includes('[contenteditable="true"]')) {
        return composer ? [node('composer')] : [];
      }
      return banners;
    },
    querySelector(selector) {
      if (loginLink) return node('login anchor');
      if (composer && /textarea|contenteditable/.test(String(selector))) return node('composer');
      return null;
    },
  };
  return doc;
}

function withTag(tag, text, options) {
  const n = node(text, options);
  n.tag = tag;
  return n;
}

test('the sign-in vocabulary means what the sites mean by it', () => {
  const matches = (text) => sites.SIGN_IN_WORDS.some((p) => p.test(text));
  for (const yes of [
    'Log in',
    'Login',
    'Sign in',
    'Sign up',
    'Sign up for free',
    'Log in to get answers',
    // Copilot's entire front page is federated doors and nothing else.
    'Sign in with Microsoft',
    'Sign in with Google',
    'Sign in to Copilot',
  ]) {
    assert.equal(matches(yes), true, `"${yes}" is a sign-in door`);
  }
  for (const no of ['Log out', 'Signed in as Hadi', 'Sign out', 'How do I log in somewhere else?', '']) {
    assert.equal(matches(no), false, `"${no}" is not a sign-in door`);
  }
});

test('a visible sign-in button is found, a hidden or long one is not', () => {
  const visible = page({ nodes: [withTag('button', 'Log in')] });
  assert.equal(dom.loginDoor(visible), 'Log in');

  const hidden = page({ nodes: [withTag('a', 'Sign in', { hidden: true })] });
  assert.equal(dom.loginDoor(hidden), null, 'an off-screen door is not a door');

  // The vocabulary matches these words wherever they start a label, so the length of the
  // label is what keeps marketing copy out of it — "Sign in with Microsoft" is a door,
  // "Sign in with Microsoft to unlock more features" is a paragraph.
  for (const prose of [
    'Log in to get answers based on your saved chats and history',
    'Sign in with Microsoft to unlock more features and history across devices',
  ]) {
    const long = page({ nodes: [withTag('a', prose)] });
    assert.equal(dom.loginDoor(long), null, `a sentence is not a button: ${prose}`);
  }

  assert.equal(dom.loginDoor({ querySelectorAll: () => [] }), null);
});

test('a sign-in control with no words on it is still a door', () => {
  // An icon-only control carries no text at all: a picture of a person whose accessible name is
  // "Sign in" is how these headers draw a signed-out account. Reading `textContent` alone found
  // nothing there, which is how a signed-out page with a message box on it could be reported as
  // signed in.
  const copilot = sites.byId('copilot');
  const youAreOut = page({
    composer: true,
    nodes: [withTag('button', '', { attrs: { 'aria-label': 'Sign in' } })],
  });
  assert.deepEqual(dom.detectAttention(youAreOut, copilot, 'https://copilot.microsoft.com/', true), {
    reason: ATTENTION.SIGNED_OUT,
    evidence: 'Sign in',
  });

  // And the labels that belong to a session are not doors, or every signed-in page would
  // read as signed out: an account menu is what you have *because* you are signed in.
  const youAreIn = page({
    composer: true,
    nodes: [
      withTag('button', '', { attrs: { 'aria-label': 'Account' } }),
      withTag('button', '', { attrs: { title: 'Your profile' } }),
      withTag('button', 'New chat'),
    ],
  });
  assert.equal(dom.detectAttention(youAreIn, copilot, 'https://copilot.microsoft.com/', true), null);
});

test('a page that will chat anonymously is still signed out', () => {
  // The bug, exactly: ChatGPT and Gemini both give a stranger a working message box.
  const doc = page({ composer: true, nodes: [withTag('button', 'Log in')] });
  const chatgpt = sites.byId('chatgpt');
  assert.deepEqual(dom.detectAttention(doc, chatgpt, 'https://chatgpt.com/', true), {
    reason: ATTENTION.SIGNED_OUT,
    evidence: 'Log in',
  });
});

test('a signed-in page with a composer is not flagged at all', () => {
  const doc = page({ composer: true, nodes: [withTag('button', 'New chat')] });
  const chatgpt = sites.byId('chatgpt');
  assert.equal(dom.detectAttention(doc, chatgpt, 'https://chatgpt.com/', true), null);
});

test('a missing composer is still its own reason, not a sign-in problem', () => {
  const doc = page({ composer: false });
  const gemini = sites.byId('gemini');
  const attention = dom.detectAttention(doc, gemini, 'https://gemini.google.com/app', false);
  assert.equal(attention.reason, ATTENTION.NO_COMPOSER);
});

/**
 * A page that shows a door for its first `reads` readings and not after.
 *
 * That is the shape of every one of these sites while they hydrate: the server sends
 * signed-out chrome, the session arrives, and the header swaps the "Sign in" control for an
 * account. How long the door stands is a property of the handshake, not of the user, which is
 * why a single reading of it was never a fact about anybody's session.
 */
function settlingPage({ doorReadings = 1 } = {}) {
  const base = page({ composer: true, nodes: [withTag('button', 'Sign in')] });
  let reads = 0;
  return {
    querySelectorAll(selector) {
      const selectors = String(selector).split(',').map((s) => s.trim());
      if (selectors.includes('a') && selectors.includes('button')) {
        reads += 1;
        return reads <= doorReadings ? base.querySelectorAll(selector) : [];
      }
      return base.querySelectorAll(selector);
    },
    querySelector: (selector) => base.querySelector(selector),
  };
}

test('a sign-in door that was the loading screen is not a session that ended', async () => {
  const copilot = sites.byId('copilot');
  const url = 'https://copilot.microsoft.com/';
  const fast = 5; // the wait is not what is under test here

  const flash = settlingPage({ doorReadings: 1 });
  assert.deepEqual(dom.detectAttention(flash, copilot, url, true), {
    reason: ATTENTION.SIGNED_OUT,
    evidence: 'Sign in',
  });
  assert.equal(
    await content.composer.settledAttention(flash, copilot, url, true, fast),
    null,
    'the page settled into a session, so there is nothing to report'
  );

  // The other half, and the reason the wait is not just a delay before believing everything:
  // a door still standing after the page has settled is a door, and the AI is signed out.
  const real = settlingPage({ doorReadings: 99 });
  assert.deepEqual(await content.composer.settledAttention(real, copilot, url, true, fast), {
    reason: ATTENTION.SIGNED_OUT,
    evidence: 'Sign in',
  });

  // And a page that is already fine is never made to wait for it.
  const fine = settlingPage({ doorReadings: 0 });
  const started = Date.now();
  assert.equal(await content.composer.settledAttention(fine, copilot, url, true, 500), null);
  assert.ok(Date.now() - started < 400, 'a clean reading is returned as it was read');
});

test('a URL that is a sign-in page needs no second opinion', () => {
  const doc = page({ composer: true });
  const chatgpt = sites.byId('chatgpt');
  const attention = dom.detectAttention(doc, chatgpt, 'https://chatgpt.com/auth/login', true);
  assert.deepEqual(attention, { reason: ATTENTION.SIGNED_OUT, evidence: 'url' });
});
