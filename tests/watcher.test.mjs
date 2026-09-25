import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/lib/browser.js');
await import('../src/lib/util.js');
await import('../src/lib/protocol.js');
await import('../src/lib/sites.js');
await import('../src/lib/dom.js');
await import('../src/content/detect.js');

const WF = globalThis.WF;
// The real DOM module, kept by reference so it survives the harness below replacing
// `WF.dom` with its own small one.
const REAL_DOM = WF.dom;

/**
 * Watching an answer across the site's own URL change.
 *
 * These come from a live send to Claude: the prompt went out, the page moved from /new to
 * /chat/<id> as it created the conversation, the answer arrived — and the extension had
 * already stopped watching, because a URL change was treated as leaving the page. The popup
 * said "no answer" about a conversation with the answer printed in it. Six sites do this on
 * the first message of a conversation, so this is the default path, not an edge case.
 *
 * The clock is faked so a wait of almost four seconds is a loop, not a sleep, and the DOM is
 * three numbers: how many assistant characters are on screen, whether a stop button is up,
 * and what the address reads.
 */

function makeHarness() {
  const state = {
    now: 1_000_000,
    chars: 0,
    stopButton: false,
    href: 'https://claude.ai/new',
  };
  const phases = [];

  const realNow = Date.now;
  Date.now = () => state.now;

  const realDom = WF.dom;
  WF.dom = {
    assistantChars: () => ({ chars: state.chars, nodes: state.chars ? 1 : 0 }),
    findStopButton: () => (state.stopButton ? { tag: 'button' } : null),
    detectAttention: () => null,
    modelLabel: () => null,
  };
  // The network half of the watcher is left out: a stream that closes is the strongest
  // completion signal there is, and it is tested by the background suite's fake content.
  const realNetwatch = WF.content.netwatch;
  WF.content.netwatch = {};

  const doc = {
    body: { nodeName: 'BODY' },
    location: { get href() { return state.href; } },
    hasFocus: () => true,
    hidden: false,
  };
  const site = WF.sites.byId('claude');

  return {
    state,
    phases,
    site,
    doc,
    /** Advance the clock and let the watcher look at the page, as its own timer would. */
    tick(ms = 900) {
      state.now += ms;
      watcher.tick();
    },
    make() {
      watcher = new WF.content.detect.AnswerWatcher({
        doc,
        site,
        jobId: 'job_test',
        onPhase: (payload) => phases.push(payload),
      });
      return watcher;
    },
    restore() {
      Date.now = realNow;
      WF.dom = realDom;
      WF.content.netwatch = realNetwatch;
    },
  };
}

let watcher = null;

test('the send is timed from the press, not from the moment it was confirmed', () => {
  const h = makeHarness();
  try {
    watcher = h.make();
    // Confirming a send watches the page for up to a few seconds. The prompt left a second
    // before this call, and the site's own request left with it.
    const pressedAt = h.state.now - 1000;
    const sentAt = watcher.start(pressedAt);
    assert.equal(sentAt, pressedAt, 'the clock starts at the press');

    h.state.chars = 10;
    h.tick(600);
    // A second of confirming, then 600ms of waiting: the wait is 1600ms, not 600ms.
    assert.equal(watcher.firstWordAt - watcher.sentAt, 1600, 'the wait is measured from the press');
  } finally {
    if (watcher) watcher.stop('test');
    h.restore();
  }
});

test('a press in the future is ignored rather than trusted', () => {
  const h = makeHarness();
  try {
    watcher = h.make();
    const sentAt = watcher.start(h.state.now + 60000);
    assert.equal(sentAt, h.state.now, 'a clock we cannot have is the clock we have');
  } finally {
    if (watcher) watcher.stop('test');
    h.restore();
  }
});

test('a container holding the prompt is not assistant output', () => {
  // Claude puts its streaming attribute on a wrapper around the whole exchange while a
  // reply is arriving, so the prompt inside it was counted as output the moment it painted —
  // a four-second answer recorded as arriving in fourteen milliseconds.
  const make = (text, holdsUserTurn) => ({
    textContent: text,
    querySelector: (selector) =>
      holdsUserTurn && selector.includes('user-message') ? { textContent: text } : null,
  });
  const answerOnly = make('Claude responded: PONG', false);
  const wrapper = make('Reply with exactly: PONGClaude responded: PONG', true);

  const doc = {
    querySelectorAll: (selector) => (/assistant-message|data-is-streaming/.test(selector) ? [wrapper, answerOnly] : []),
  };
  const site = { answer: { selectors: ['[data-testid="assistant-message"]', 'div[data-is-streaming]'] } };

  const nodes = REAL_DOM.assistantNodes(doc, site);
  assert.deepEqual(nodes, [answerOnly], 'only the answer itself is measured');
  assert.equal(REAL_DOM.assistantChars(doc, site).chars, 'Claude responded: PONG'.length);
});

test('a page that moves to its own conversation address keeps the watch', () => {
  const h = makeHarness();
  try {
    watcher = h.make();
    const sentAt = watcher.start();

    // Output starts arriving.
    h.state.chars = 12;
    h.tick();
    assert.equal(watcher.phase, WF.PHASE.STREAMING, 'growth is seen as streaming');

    // The site creates the conversation and moves the page to it, painting the prompt and
    // the answer so far at the new address.
    h.state.href = 'https://claude.ai/chat/abc123';
    h.state.chars = 40;
    watcher.rebase();

    assert.equal(watcher.running, true, 'a move that stays on this site does not end the wait');
    assert.equal(watcher.sentAt, sentAt, 'the timing still starts where the prompt was sent');
    assert.equal(watcher.baselineChars, 40, 'measured again from what the new page shows');

    // The answer finishes: no more output, and the stop button is gone.
    h.state.chars = 55;
    h.tick();
    h.state.stopButton = false;
    h.tick();
    h.tick(1200);

    const done = h.phases.find((p) => p.phase === WF.PHASE.DONE);
    assert.ok(done, `expected a done phase, got ${h.phases.map((p) => p.phase).join(', ')}`);
    assert.equal(done.sentAt, sentAt);
    assert.equal(done.doneAt, h.state.now, 'the wait ends on the tick that saw it settle');
    assert.equal(done.charsAdded, 15, 'the answer is measured from the new address, not the old');
  } finally {
    if (watcher) watcher.stop('test');
    h.restore();
  }
});

test('an answer that finishes during the move is still reported as an answer', () => {
  const h = makeHarness();
  try {
    watcher = h.make();
    watcher.start();

    h.state.chars = 20;
    h.tick();
    assert.equal(h.phases.filter((p) => p.phase === WF.PHASE.STREAMING).length, 1);

    // The whole answer landed before the address changed: on the new page the text is there
    // and nothing else happens. This is the case that used to be reported as a failure.
    h.state.href = 'https://claude.ai/chat/def456';
    h.state.chars = 62;
    watcher.rebase();
    h.tick();
    h.tick(1200);

    const phases = h.phases.map((p) => p.phase);
    assert.ok(phases.includes(WF.PHASE.DONE), `expected done, got ${phases.join(', ')}`);
    assert.equal(phases.includes(WF.PHASE.ERROR), false, 'finished output is never "no answer"');
  } finally {
    if (watcher) watcher.stop('test');
    h.restore();
  }
});

test('a watch that saw nothing at all still fails rather than hanging', () => {
  const h = makeHarness();
  try {
    watcher = h.make();
    watcher.start();
    for (let i = 0; i < 45; i += 1) h.tick();

    const error = h.phases.find((p) => p.phase === WF.PHASE.ERROR);
    assert.ok(error, 'a prompt that produced nothing is reported');
    assert.equal(error.reason, 'no-answer-detected');
    assert.equal(watcher.running, false);
  } finally {
    if (watcher) watcher.stop('test');
    h.restore();
  }
});
