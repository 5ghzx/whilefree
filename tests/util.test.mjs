import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/lib/util.js');
const U = globalThis.WF.util;

test('day keys are local calendar days, not UTC ones', () => {
  // 23:30 local must stay on that local day even east of UTC.
  const late = new Date(2026, 8, 23, 23, 30, 0);
  assert.equal(U.dayKey(late.getTime()), '2026-09-23');
  const early = new Date(2026, 8, 23, 0, 15, 0);
  assert.equal(U.dayKey(early.getTime()), '2026-09-23');
});

test('shiftDay and dayRange cross month and year boundaries', () => {
  assert.equal(U.shiftDay('2026-09-30', 1), '2026-10-01');
  assert.equal(U.shiftDay('2026-01-01', -1), '2025-12-31');
  assert.deepEqual(U.dayRange('2026-02-27', '2026-03-02'), [
    '2026-02-27',
    '2026-02-28',
    '2026-03-01',
    '2026-03-02',
  ]);
  assert.equal(U.dayRange('2026-01-01', '2026-01-01').length, 1);
});

test('dayRange is capped so a corrupt date cannot hang the dashboard', () => {
  const keys = U.dayRange('1900-01-01', '2026-01-01');
  assert.ok(keys.length <= 5000);
});

test('weekdays are Monday-first so the heatmap reads like a calendar', () => {
  // 2026-09-21 is a Monday.
  assert.equal(U.weekdayIndex(new Date(2026, 8, 21, 12).getTime()), 0);
  assert.equal(U.weekdayIndex(new Date(2026, 8, 23, 12).getTime()), 2);
  assert.equal(U.weekdayIndex(new Date(2026, 8, 27, 12).getTime()), 6);
});

test('durations read the way a person writes them', () => {
  assert.equal(U.humanDuration(0), '0s');
  assert.equal(U.humanDuration(44000), '44s');
  assert.equal(U.humanDuration(12 * 60000 + 6000), '12m 6s');
  assert.equal(U.humanDuration(5 * 3600000 + 44 * 60000), '5h 44m');
  assert.equal(U.humanDuration(-5000), '0s');
});

test('short durations keep a decimal only while it is useful', () => {
  assert.equal(U.humanShort(1600), '1.6s');
  assert.equal(U.humanShort(11000), '11s');
  assert.equal(U.humanShort(67000), '1m 7s');
  assert.equal(U.humanShort(null), '--');
  assert.equal(U.humanShort(undefined), '--');
  assert.equal(U.humanShort(NaN), '--');
});

test('axis ticks stay short enough for a narrow gutter', () => {
  assert.equal(U.humanTick(0), '0s');
  assert.equal(U.humanTick(32000), '32s');
  assert.equal(U.humanTick(21 * 60000 + 29000), '21m');
  assert.equal(U.humanTick(2 * 3600000), '2h');
  assert.equal(U.humanTick(3600000 + 20 * 60000), '1h 20m');
});

test('relative times degrade from just now to days', () => {
  const now = Date.now();
  assert.equal(U.relativeTime(now - 5000, now), 'just now');
  assert.equal(U.relativeTime(now - 5 * 60000, now), '5m ago');
  assert.equal(U.relativeTime(now - 3 * 3600000, now), '3h ago');
  assert.equal(U.relativeTime(now - 2 * 86400000, now), '2d ago');
});

test('money gets more precision the smaller the amount, with no trailing zeros', () => {
  assert.equal(U.money(0), '$0');
  assert.equal(U.money(0.1), '$0.10');
  assert.equal(U.money(3.133), '$3.13');
  assert.equal(U.money(10), '$10');
  assert.equal(U.money(10.5), '$10.50');
  assert.equal(U.money(20), '$20', 'a subscription price should read as $20, not $20.0');
  assert.equal(U.money(214), '$214');
  assert.equal(U.money(199.4), '$199');
  assert.equal(U.money(Infinity), '--');
});

test('percentages survive a zero whole', () => {
  assert.equal(U.pct(1, 0), 0);
  assert.equal(U.pct(1, 4), 25);
  assert.equal(U.pct(1, 3), 33);
});

test('deepMerge replaces arrays and merges nested objects', () => {
  const base = { a: 1, nested: { x: 1, y: 2 }, list: [1, 2, 3] };
  const merged = U.deepMerge(base, { nested: { y: 9 }, list: [7], b: 2 });
  assert.equal(merged.a, 1);
  assert.deepEqual(merged.nested, { x: 1, y: 9 });
  assert.deepEqual(merged.list, [7], 'arrays are replaced, not concatenated');
  assert.equal(merged.b, 2);
  assert.deepEqual(base, { a: 1, nested: { x: 1, y: 2 }, list: [1, 2, 3] }, 'the base is not mutated');
});

test('escaping is safe for names that come from a page title', () => {
  assert.equal(U.escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(U.escapeHtml("it's \"quoted\" & done"), 'it&#39;s &quot;quoted&quot; &amp; done');
  assert.equal(U.escapeHtml(undefined), '');
});

test('truncate never splits a surrogate pair', () => {
  assert.equal(U.truncate('abcdef', 3), 'ab\u2026');
  assert.equal(U.truncate('abc', 10), 'abc');
  const emoji = U.truncate('a\u{1F600}\u{1F600}\u{1F600}', 3);
  assert.equal(emoji.includes('\uFFFD'), false);
});

test('uid values are unique across a burst of calls', () => {
  const ids = new Set();
  for (let i = 0; i < 500; i += 1) ids.add(U.uid('job'));
  assert.equal(ids.size, 500);
  assert.match([...ids][0], /^job_/);
});

test('debounce runs once with the last arguments', async () => {
  let calls = [];
  const fn = U.debounce((value) => calls.push(value), 10);
  fn(1);
  fn(2);
  fn(3);
  await U.sleep(40);
  assert.deepEqual(calls, [3]);
});
