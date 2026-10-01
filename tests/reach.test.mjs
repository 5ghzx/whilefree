/**
 * The reach, and the sentence for it.
 *
 * One rule is read by three places — the popup's summary line, the launcher's pill and card in
 * every AI page, and (as the gate it describes) the engine before it types — so what is tested
 * here is the rule itself, on the cases the two readers used to disagree about: a signed-in AI
 * with no tab open, with tab-opening off and on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/lib/reach.js');

const { reach } = globalThis.WF;

// Signed in and switched on unless a case says otherwise: most of these tests are about the one
// term being left out, and a helper that silently dropped all three would test nothing.
const row = (open, verified = true, on = true) => ({ on, verified, open });

test('a closed AI is not part of the reach when nothing will open it a tab', () => {
  // The case the popup's own row text was already describing — *closed* — while the count above it
  // included it. With tab-opening off, `broadcast` skips it with `no tab open`, so a line saying
  // otherwise is a promise the send does not keep.
  const rows = [row(true), row(true), row(false), row(false, false)];
  const summary = reach.summarize(rows, { autoOpenTabs: false });
  assert.equal(summary.on, 4);
  assert.equal(summary.reach, 2, 'closed and unverified AIs are both out');
  assert.equal(summary.closed, 1);
  assert.equal(summary.unverified, 1);
  assert.equal(summary.title, 'Goes to 2 of 4');
  assert.match(summary.detail, /1 has not said they are signed in/);
  assert.match(summary.detail, /1 is signed in but closed/);
});

test('with tab-opening on, a closed AI is a place a press does land', () => {
  // The other half, and the reason this cannot be a blanket "count open tabs": with the switch on
  // the send opens the tab itself, so subtracting it would now under-count what a press reaches.
  const rows = [row(true), row(true), row(false)];
  const summary = reach.summarize(rows, { autoOpenTabs: true });
  assert.equal(summary.reach, 3);
  assert.equal(summary.closed, 0);
  assert.equal(summary.title, 'Goes to 3 AIs');
  assert.equal(summary.detail, 'Every one of them has said it is signed in.');
});

test('an unsigned-in AI is out, and that is said in the popup\'s own words', () => {
  const summary = reach.summarize([row(true), row(true), row(true, false)], { autoOpenTabs: false });
  assert.equal(summary.reach, 2);
  assert.equal(summary.title, 'Goes to 2 of 3');
  assert.equal(summary.detail, 'The rest have not said they are signed in');
  // And the mirror: signed-in-but-closed, said with the word the row itself uses.
  const closed = reach.summarize([row(true), row(true), row(false)], { autoOpenTabs: false });
  assert.equal(closed.title, 'Goes to 2 of 3');
  assert.equal(closed.detail, 'The rest are signed in but closed');
});

test('nothing reachable is a refusal, not a fraction of nothing', () => {
  const summary = reach.summarize([row(false), row(false, false)], { autoOpenTabs: false });
  assert.equal(summary.reach, 0);
  assert.equal(summary.title, 'Nothing will be sent');
  assert.equal(summary.detail, 'None of them is open and signed in');
  // With tab-opening on, closed is not a term at all — a closed AI is one the send opens — so the
  // only thing left that can empty the reach is the page's own word, and that is what it says.
  const openable = reach.summarize([row(true, false), row(false, false)], { autoOpenTabs: true });
  assert.equal(openable.closed, 0, 'a closed AI is not counted against a send that opens it');
  assert.equal(openable.title, 'Nothing will be sent');
  assert.equal(openable.detail, 'None of them has said it is signed in');
});

test('the words belong to the caller when the list is empty', () => {
  // No AI switched on is not a shortfall of the reach, and the popup and the card have their own
  // sentence for it — so the rule says nothing rather than inventing a fraction of zero.
  const summary = reach.summarize([row(true, true, false)], { autoOpenTabs: false });
  assert.equal(summary.on, 0);
  assert.equal(summary.reach, 0);
  assert.equal(summary.title, '');
  assert.equal(summary.detail, '');
});

test('a folded sentence continues a line instead of starting one', () => {
  // The popup writes the reason after a dash and the tooltip after a colon: a capital there reads as
  // a sentence that never ends.
  assert.equal(reach.fold('The rest are signed in but closed'), 'the rest are signed in but closed');
  assert.equal(reach.fold(''), '');
  assert.equal(reach.fold(undefined), '');
});

test('the switch is read the way the engine reads it, never as truthiness', () => {
  // `broadcast` tests `autoOpenTabs === false`; a missing value there means tabs get opened. An
  // absent option must not silently mean the opposite of what the send will do.
  const rows = [row(true), row(false)];
  assert.equal(reach.summarize(rows).reach, 2, 'no option at all is not "off"');
  assert.equal(reach.summarize(rows, {}).reach, 2);
  assert.equal(reach.summarize(rows, { autoOpenTabs: undefined }).reach, 2);
  assert.equal(reach.summarize(rows, { autoOpenTabs: false }).reach, 1);
});
