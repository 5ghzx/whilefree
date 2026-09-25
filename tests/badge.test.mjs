import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/lib/browser.js');
await import('../src/lib/util.js');
await import('../src/lib/badge.js');

const { badge } = globalThis.WF;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function answer(siteId, agoMs, now) {
  return { id: `ans-${siteId}`, siteId, readyAt: now - agoMs, tabId: 1, waitedMs: 4000 };
}

test('an AI that needs you takes the icon, in amber', () => {
  const b = badge.badgeFor(2, 5, 'WhileFree');
  assert.equal(b.text, '2');
  assert.equal(b.color, badge.COLORS.attention);
  assert.match(b.title, /2 AIs need your attention/);
});

test('answers show in green, and the count is a count of AIs', () => {
  const b = badge.badgeFor(0, 3, 'WhileFree');
  assert.equal(b.text, '3');
  assert.equal(b.color, badge.COLORS.ready);
  assert.equal(b.title, 'WhileFree: 3 AIs have answered');
});

test('one of anything is singular', () => {
  assert.match(badge.badgeFor(1, 0, 'W').title, /1 AI needs your attention/);
  assert.match(badge.badgeFor(0, 1, 'W').title, /1 AI has answered/);
});

test('a badge shows one digit, so ten and up are 9+', () => {
  assert.equal(badge.badgeFor(0, 9, 'W').text, '9');
  assert.equal(badge.badgeFor(0, 10, 'W').text, '9+');
  assert.equal(badge.badgeFor(42, 0, 'W').text, '9+');
});

test('nothing waiting clears the text but keeps a tooltip', () => {
  const b = badge.badgeFor(0, 0, 'WhileFree');
  assert.equal(b.text, '');
  assert.match(b.title, /WhileFree/);
});

test('an answer older than the window stops counting', () => {
  const now = 1_700_000_000_000;
  const items = [answer('chatgpt', 3 * HOUR, now), answer('claude', 13 * HOUR, now)];
  const live = badge.live(items, now);
  assert.equal(live.length, 1);
  assert.equal(live[0].siteId, 'chatgpt');
});

test('live entries are newest first and capped, so the number stays a nudge', () => {
  const now = 1_700_000_000_000;
  const items = [];
  for (let i = 0; i < badge.MAX_READY + 6; i += 1) {
    items.push(answer('chatgpt', i * MINUTE, now));
  }
  const live = badge.live(items, now);
  assert.equal(live.length, badge.MAX_READY);
  assert.equal(live[0].readyAt, now, 'the newest answer leads');
});

test('a clock that is slightly ahead does not delete a fresh answer', () => {
  const now = 1_700_000_000_000;
  assert.equal(badge.live([{ siteId: 'chatgpt', readyAt: now + 5_000 }], now).length, 1);
  assert.equal(badge.live([{ siteId: 'chatgpt', readyAt: now + 10 * MINUTE }], now).length, 0);
});

test('junk in storage cannot put a number on the icon', () => {
  const now = Date.now();
  const live = badge.live(
    [null, 'nonsense', { siteId: 'chatgpt' }, { readyAt: now, siteId: 7 }, answer('chatgpt', 0, now)],
    now
  );
  assert.equal(live.length, 1);
});

test('the at field is accepted, so both spellings of an entry count', () => {
  const now = Date.now();
  assert.equal(badge.live([{ siteId: 'claude', at: now - MINUTE }], now).length, 1);
});

test('attention older than its own window stops nagging, and a switched-off site never nags', () => {
  const now = 1_700_000_000_000;
  const statuses = {
    chatgpt: { attention: 'signed-out', at: now - MINUTE },
    claude: { attention: 'quota', at: now - 7 * HOUR },
    gemini: { attention: null, at: now },
    deepseek: { attention: 'check', at: now - MINUTE },
  };
  const stuck = badge.liveProblems(statuses, now, (id) => id !== 'deepseek');
  assert.deepEqual(
    stuck.map((s) => s.siteId),
    ['chatgpt']
  );
});

test('a status with no timestamp still counts, because the site is still blocked', () => {
  const now = Date.now();
  const stuck = badge.liveProblems({ perplexity: { attention: 'signed-out' } }, now);
  assert.equal(stuck.length, 1);
  assert.equal(stuck[0].reason, 'signed-out');
});
