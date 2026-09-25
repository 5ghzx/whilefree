/**
 * The one rule that decides whether an AI may be sent to.
 *
 * It is read by the popup, the dashboard, the badge and the send path, so a mistake here is not
 * a wrong pixel — it is an AI that is quietly left out of every fan-out, or a prompt typed into a
 * page with no session behind it. The tests below come from a real report: a browser where three
 * AIs read "Signed out" for days while the user was signed in to all three, because a reading
 * taken once was never allowed to expire.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/lib/status.js');

const { status } = globalThis.WF;
const now = Date.now();
const minutes = (n) => n * 60 * 1000;

const record = (patch) => ({ hasComposer: true, ...patch });

test('a sign-in check is trusted for a week, and no longer', () => {
  assert.equal(status.isVerified(record({ verifiedAt: now - minutes(5) }), now), true);
  assert.equal(status.isVerified(record({ verifiedAt: now - 6 * 24 * 60 }), now), true);
  assert.equal(status.isVerified(record({ verifiedAt: now - status.TTL_MS - 1 }), now), false);
  assert.equal(status.isVerified(record({ verifiedAt: 0 }), now), false, 'never checked is not checked');
  assert.equal(status.isVerified(record({}), now), false);
  assert.equal(status.isVerified(null, now), false);
});

test('a page that needs you overrides the check, while it is still about now', () => {
  const verified = { verifiedAt: now, hasComposer: true };
  assert.equal(status.isVerified({ ...verified, attention: 'signed-out', attentionAt: now }, now), false);
  assert.equal(
    status.isVerified({ ...verified, attention: 'signed-out', attentionAt: now - minutes(9) }, now),
    false,
    'nine minutes is still this conversation'
  );
});

test('a page that needed you ten minutes ago is history, not a reason to withhold', () => {
  // The bug, from the other side. The reading is kept — the popup still shows it, and the send
  // that follows asks the page itself and gets the truth in a few hundred milliseconds — but it
  // stops deciding who is in the fan-out. Without this, one misread at any point in the last week
  // took an AI off the list until a human argued with a switch, and the switch was off because of
  // the misread.
  const stale = {
    verifiedAt: now - minutes(60),
    hasComposer: true,
    attention: 'signed-out',
    attentionAt: now - status.ATTENTION_TTL_MS - 1,
  };
  assert.equal(status.isVerified(stale, now), true);
  assert.equal(status.attentionIsFresh(stale, now), false);
});

test('when the page said it is a separate fact from when the record was written', () => {
  // A record is rewritten by plenty of things that are not the page's verdict — a hello from a
  // tab that navigated, a settings change — and each of those moves `at` forward. Reading the
  // verdict's age off `at` is how an attention from this morning looked eternally new, and stayed
  // in the way of every prompt for the rest of the day.
  const freshStamp = {
    verifiedAt: now,
    hasComposer: true,
    attention: 'signed-out',
    attentionAt: now - status.ATTENTION_TTL_MS - 1,
    at: now, // written a moment ago, by something that was not the verdict
  };
  assert.equal(status.isVerified(freshStamp, now), true, 'the verdict is old, whatever `at` says');

  // And the records that predate the field: `at` is all there is, so it is what gets read, and it
  // errs towards the block rather than away from it.
  const oldRecord = { verifiedAt: now, hasComposer: true, attention: 'quota', at: now - minutes(2) };
  assert.equal(status.isVerified(oldRecord, now), false);
  assert.equal(status.attentionAt(oldRecord), now - minutes(2));
});

test('a verdict with no timestamp at all is not quietly dropped', () => {
  // No stamp means no evidence that it is stale, and believing a page needs you when it does not
  // costs one wasted attempt that the send-time check catches immediately.
  const untimed = { verifiedAt: now, hasComposer: true, attention: 'quota' };
  assert.equal(status.isVerified(untimed, now), false);
  assert.equal(status.attentionIsFresh(untimed, now), true);
  assert.equal(status.attentionIsFresh({ attention: null }, now), false);
  assert.equal(status.attentionIsFresh(null, now), false);
});
