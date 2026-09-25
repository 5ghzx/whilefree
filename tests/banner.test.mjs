import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/lib/browser.js');
await import('../src/lib/util.js');
await import('../src/lib/protocol.js');
await import('../src/lib/sites.js');
await import('../src/lib/dom.js');

const dom = globalThis.WF.dom;

/**
 * The banner probe, which is the most expensive thing the content script does.
 *
 * Measured on a page twenty times the size of a long conversation: the role-based half costs
 * 1.5ms and the `[class*="modal"]` half costs 36ms, because a substring attribute match has to
 * walk every element in the document. It used to run both on every other tick of an answer —
 * a forced layout every 1.8 seconds, in the middle of the page streaming tokens — which is a
 * tab that feels slow for no reason anyone can name.
 */

function node(text, { hidden = false } = {}) {
  const rect = {
    width: hidden ? 0 : 200,
    height: hidden ? 0 : 40,
    top: 0,
    left: 0,
    right: 200,
    bottom: 40,
  };
  return {
    textContent: text,
    getAttribute: () => null,
    getClientRects: () => (hidden ? [] : [rect]),
    getBoundingClientRect: () => rect,
    ownerDocument: {
      defaultView: {
        getComputedStyle: () => ({ display: hidden ? 'none' : 'block', visibility: 'visible', opacity: '1' }),
      },
    },
  };
}

/**
 * A document where each selector matches exactly one node, the way a real one does.
 *
 * A node belongs to one selector, not to every selector in a family: returning the same node
 * for each query would count it four times and make this file measure nothing.
 */
function page(map) {
  return {
    querySelectorAll(selector) {
      const found = map[selector];
      return found ? [found] : [];
    },
  };
}

/**
 * The module keeps one timestamp for the budget, so the clock is moved deliberately.
 *
 * One clock for the whole file, moving only forwards: a per-test clock that restarts would
 * rewind time under a throttle that is meant to be monotonic, and the tests would pass by
 * pretending the budget had rolled over.
 */
const realNow = Date.now;
let clock = realNow();
Date.now = () => clock;
const advance = (ms) => {
  clock += ms;
};

/** Start a test with an unspent budget, whatever the one before it did. */
function freshBudget() {
  advance(dom.SLOW_BANNER_MS + 1);
}

test('a role-based banner is read every time, without spending the budget', () => {
  freshBudget();
  const alert = page({ '[role="alert"]': node('You have reached your limit') });
  for (let i = 0; i < 5; i += 1) {
    assert.equal(dom.bannerText(alert), 'You have reached your limit');
  }
  // Nothing above needed the expensive half, so it is still available when it is.
  const modal = page({ '[class*="modal" i]': node('Verifying you are human') });
  assert.equal(dom.bannerText(modal), 'Verifying you are human');
});

test('the substring scan runs once per budget, not once per tick', () => {
  freshBudget();
  const modal = page({ '[class*="modal" i]': node('Verifying you are human') });
  assert.equal(dom.bannerText(modal), 'Verifying you are human', 'the first look pays for it');
  assert.equal(dom.bannerText(modal), '', 'and the next tick does not pay again');
  assert.equal(dom.bannerText(modal), '', 'nor the one after that');

  advance(dom.SLOW_BANNER_MS + 1);
  assert.equal(dom.bannerText(modal), 'Verifying you are human', 'and it returns when the budget rolls over');
});

test('a hidden banner is not text', () => {
  freshBudget();
  const hiddenAlert = page({ '[role="alert"]': node('Hidden news', { hidden: true }) });
  assert.equal(dom.bannerText(hiddenAlert), '');

  advance(dom.SLOW_BANNER_MS + 1);
  const hiddenModal = page({ '[class*="modal" i]': node('Hidden modal', { hidden: true }) });
  assert.equal(dom.bannerText(hiddenModal), '');
  assert.equal(realNow() > 0, true, 'the real clock was only borrowed');
});
