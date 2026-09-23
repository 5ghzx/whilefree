import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/lib/browser.js');
await import('../src/lib/util.js');
await import('../src/lib/sites.js');
await import('../src/lib/stats.js');

const { stats, util } = globalThis.WF;

// A realistic send time. Epoch 0 is deliberately avoided: `sentAt` is used as a
// truthiness check in places, and a test that passes only because of a zero would be
// testing the wrong thing.
const T = 1758600000000;

function build() {
  const tree = stats.emptyStats(0);
  stats.addUsage(tree, {
    siteId: 'chatgpt',
    day: '2026-09-01',
    hour: 9,
    weekday: 0,
    deltas: { writing: 60000, waiting: 30000, reading: 120000, waitingAway: 10000 },
    counts: { prompts: 2, answers: 2 },
  });
  stats.addUsage(tree, {
    siteId: 'gemini',
    day: '2026-09-01',
    hour: 9,
    weekday: 0,
    deltas: { writing: 20000, waiting: 50000, reading: 40000 },
    counts: { prompts: 1, answers: 1 },
  });
  return tree;
}

test('addUsage accumulates per site, per day, and all time', () => {
  const tree = build();
  assert.equal(tree.days['2026-09-01'].sites.chatgpt.writing, 60000);
  assert.equal(tree.days['2026-09-01'].totals.writing, 80000);
  assert.equal(tree.days['2026-09-01'].totals.prompts, 3);
  assert.equal(tree.siteTotals.chatgpt.waiting, 30000);
  assert.equal(Object.keys(tree.heat).length, 1, 'only waiting-away is tracked in the heat grid');
  assert.equal(tree.heat['0:9'], 10000);
});

test('summarize splits the range into days, totals and per site', () => {
  const tree = build();
  const sum = stats.summarize(tree, util.dayRange('2026-08-31', '2026-09-02'));
  assert.equal(sum.days.length, 3);
  assert.equal(sum.totals.writing, 80000);
  assert.equal(sum.perSite.chatgpt.prompts, 2);
  assert.equal(sum.perSite.gemini.prompts, 1);
  assert.equal(sum.hasData, true);
  assert.equal(sum.activeDays, 1);
});

test('an empty range reports no data instead of dividing by zero', () => {
  const sum = stats.summarize(stats.emptyStats(0), ['2026-09-01']);
  const split = stats.split(sum.totals);
  assert.equal(sum.hasData, false);
  assert.equal(split.total, 0);
  assert.equal(split.waitingPct, 0);
});

test('split reports the three states as shares of the whole', () => {
  const tree = build();
  const sum = stats.summarize(tree, ['2026-09-01']);
  const split = stats.split(sum.totals);
  // writing 80s + waiting 80s + reading 160s = 320s. Waiting-away is counted
  // separately and deliberately kept out of the three-way bar.
  assert.equal(split.total, 320000);
  assert.equal(split.writingPct, 25);
  assert.equal(split.writingPct + split.waitingPct + split.readingPct, 100);
  assert.equal(split.away, 10000);
  assert.equal(split.readingIsBiggest, true, '160s of reading beats 80s of writing and waiting');
});

test('percentile and median behave on small samples', () => {
  assert.equal(stats.median([5, 1, 3]), 3);
  assert.equal(stats.median([4, 1, 3, 2]), 2.5);
  assert.equal(stats.median([]), null);
  assert.equal(stats.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
  assert.equal(stats.percentile([], 50), null);
});

test('head to head only counts the prompts sent to several AIs at once', () => {
  const events = [
    // One prompt sent to three AIs: chatgpt wins.
    { id: 'a1', group: 'g1', siteId: 'chatgpt', sentAt: T, firstWordAt: T + 1000, doneAt: T + 5000 },
    { id: 'a2', group: 'g1', siteId: 'gemini', sentAt: T, firstWordAt: T + 2000, doneAt: T + 7000 },
    { id: 'a3', group: 'g1', siteId: 'claude', sentAt: T, firstWordAt: T + 3000, doneAt: T + 9000 },
    // A solo prompt: it must not create a win for anyone.
    { id: 'b1', group: 'g2', siteId: 'chatgpt', sentAt: T + 10000, firstWordAt: T + 11000, doneAt: T + 12000 },
    // Never finished: counted as sent, not measured.
    { id: 'c1', group: 'g3', siteId: 'gemini', sentAt: T + 20000, aborted: true },
  ];
  const { rows, sharedGroups } = stats.headToHead(events);
  const byId = Object.fromEntries(rows.map((row) => [row.siteId, row]));

  assert.equal(sharedGroups, 1);
  assert.equal(byId.chatgpt.sharedWins, 1);
  assert.equal(byId.chatgpt.sharedEligible, 1);
  assert.equal(byId.gemini.sharedWins, 0);
  // Both of chatgpt's answers are measured: the 5s one from the shared prompt and the
  // 2s solo one. Median of two values is their midpoint. Shared-prompt wins are the
  // only metric narrowed to fan-outs; typical answer time covers everything measured.
  assert.equal(byId.chatgpt.answerMedian, 3500);
  assert.equal(byId.chatgpt.sent, 2, 'the solo prompt still counts as sent');
  assert.equal(byId.gemini.sent, 2, 'the aborted one counts as sent');
  assert.equal(byId.gemini.measured, 1);
  assert.equal(byId.claude.firstWordMedian, 3000);
});

test('head to head marks answers that arrived after the user left', () => {
  const events = [
    { id: 'a', group: 'g', siteId: 'chatgpt', sentAt: T, doneAt: T + 1000, abandoned: true },
    { id: 'b', group: 'g', siteId: 'claude', sentAt: T, doneAt: T + 2000, abandoned: false },
  ];
  const { rows } = stats.headToHead(events);
  const byId = Object.fromEntries(rows.map((row) => [row.siteId, row]));
  assert.equal(byId.chatgpt.abandonedPct, 100);
  assert.equal(byId.claude.abandonedPct, 0);
});

test('cost rows turn a price and real use into a verdict', () => {
  const perSite = {
    perplexity: { prompts: 2, writing: 60000, waiting: 60000, reading: 60000 },
    chatgpt: { prompts: 203, writing: 3600000, waiting: 3600000, reading: 3600000 },
  };
  const rows = stats.costRows(perSite, { perplexity: 20, chatgpt: 20 }, ['2026-09-01']);
  const byId = Object.fromEntries(rows.map((row) => [row.siteId, row]));

  assert.equal(byId.perplexity.yearly, 240);
  assert.equal(byId.perplexity.costPerPrompt, 10);
  assert.equal(byId.perplexity.verdict, 'barely-used');
  assert.equal(byId.chatgpt.verdict, 'earning');
  assert.equal(Math.round(byId.chatgpt.costPerHour), 7);
  // Sorted by what you pay, biggest first.
  assert.equal(rows[0].monthly, 20);

  const note = stats.costNote(rows);
  assert.match(note, /Perplexity costs you \$20 a month and you sent it 2 prompts/);
  assert.match(note, /\$240 a year/);
});

test('a site with no price is not given a verdict about money', () => {
  const rows = stats.costRows({ gemini: { prompts: 50 } }, {}, ['2026-09-01']);
  assert.equal(rows[0].verdict, 'no-price');
  assert.equal(rows[0].costPerPrompt, null);
  assert.equal(stats.costNote(rows), null);
});

test('the heat matrix is bounded to seven rows of twenty four hours', () => {
  const { matrix, max } = stats.heatMatrix({ '0:9': 500, '6:23': 1000, '9:5': 999, 'x:y': 5 });
  assert.equal(matrix.length, 7);
  assert.equal(matrix[0].length, 24);
  assert.equal(matrix[0][9], 500);
  assert.equal(matrix[6][23], 1000);
  assert.equal(max, 1000, 'out of range keys are ignored');
});

test('attention detail separates watching from waiting elsewhere', () => {
  const events = [
    { siteId: 'chatgpt', sentAt: T, firstWordAt: T + 1000, doneAt: T + 6000, awayMs: 3000 },
    { siteId: 'claude', sentAt: T, firstWordAt: T + 1000, doneAt: T + 31000, awayMs: 5000 },
  ];
  const detail = stats.attentionDetail(events);
  assert.equal(detail.count, 2);
  assert.equal(detail.watchedArriveMs, 5000 + 30000);
  assert.equal(detail.waitingElsewhereMs, 8000);
  assert.equal(detail.slowestMs, 31000);
  assert.equal(detail.longest[0].siteId, 'claude');
});

test('merging two trees adds them together', () => {
  const a = build();
  const b = build();
  const merged = stats.mergeStats(a, b);
  assert.equal(merged.days['2026-09-01'].totals.writing, 160000);
  assert.equal(merged.siteTotals.chatgpt.prompts, 4);
  assert.equal(merged.heat['0:9'], 20000);
});

test('the shareable summary carries numbers and no prompt text', () => {
  const tree = build();
  const sum = stats.summarize(tree, ['2026-09-01']);
  const text = stats.summaryCard(sum, { title: 'My AI day', headRows: [] });
  assert.match(text, /My AI day/);
  assert.match(text, /writing 25%/);
  assert.match(text, /3 prompts sent, 3 answers landed/);
  assert.match(text, /no prompt or answer text was ever stored/);
});
