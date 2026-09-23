import { test } from 'node:test';
import assert from 'node:assert/strict';

await import('../src/lib/browser.js');
await import('../src/lib/util.js');
await import('../src/lib/protocol.js');
await import('../src/lib/sites.js');
await import('../src/lib/settings.js');

const { settings, sites } = globalThis.WF;

test('defaults switch every site on: there is no paid tier to hold back', () => {
  const s = settings.normalize({});
  assert.deepEqual(s.enabledSites, sites.ORDER);
  assert.equal(s.enabledSites.length, 5);
  assert.equal(s.chimeEnabled, true);
  assert.equal(s.disableSlowModes.deepseek, true);
});

test('unknown site ids are dropped and an empty selection falls back', () => {
  assert.deepEqual(settings.normalize({ enabledSites: ['chatgpt', 'nope'] }).enabledSites, ['chatgpt']);
  const empty = settings.normalize({ enabledSites: [] });
  assert.equal(empty.enabledSites.length, 1, 'never leave the user with nothing switched on');
});

test('pacing is clamped into a sane window and always ordered', () => {
  assert.deepEqual(settings.normalize({ paceMs: [5, 999999] }).paceMs, [150, 5000]);
  assert.deepEqual(settings.normalize({ paceMs: [2000, 500] }).paceMs, [2000, 2000]);
  assert.deepEqual(settings.normalize({ paceMs: 'nonsense' }).paceMs, [900, 1700]);
});

test('delayFrom stays inside the configured pair', () => {
  const pair = [1000, 1001];
  for (let i = 0; i < 50; i += 1) {
    const value = settings.delayFrom(pair);
    assert.ok(value >= 1000 && value <= 1001, `got ${value}`);
  }
});

test('targetsFor never sends back to the AI you started from', () => {
  const s = settings.normalize({});
  const targets = settings.targetsFor(s, 'chatgpt');
  assert.equal(targets.includes('chatgpt'), false);
  assert.equal(targets.length, 4);
  // From the popup there is no origin, so everything switched on is fair game.
  assert.equal(settings.targetsFor(s, null).length, 5);
});

test('targetsFor respects what the user switched off', () => {
  const s = settings.normalize({ enabledSites: ['chatgpt', 'gemini'] });
  assert.deepEqual(settings.targetsFor(s, 'chatgpt'), ['gemini']);
  assert.deepEqual(settings.targetsFor(s, 'claude'), ['chatgpt', 'gemini']);
});

test('the chime can be muted globally or one AI at a time', () => {
  const all = settings.normalize({});
  assert.equal(settings.chimeFor(all, 'chatgpt'), true);

  const muted = settings.normalize({ chimeSites: { chatgpt: false } });
  assert.equal(settings.chimeFor(muted, 'chatgpt'), false);
  assert.equal(settings.chimeFor(muted, 'claude'), true);

  const off = settings.normalize({ chimeEnabled: false, chimeSites: { chatgpt: true } });
  assert.equal(settings.chimeFor(off, 'chatgpt'), false, 'the master switch wins');
});

test('quiet hours handle a window that crosses midnight', () => {
  const overnight = settings.normalize({ quietHours: { from: 22, to: 7 } });
  const at = (hour) => {
    const d = new Date(2026, 8, 23, hour, 0, 0);
    return d.getTime();
  };
  assert.equal(settings.inQuietHours(overnight, at(23)), true);
  assert.equal(settings.inQuietHours(overnight, at(3)), true);
  assert.equal(settings.inQuietHours(overnight, at(12)), false);

  const daytime = settings.normalize({ quietHours: { from: 9, to: 17 } });
  assert.equal(settings.inQuietHours(daytime, at(10)), true);
  assert.equal(settings.inQuietHours(daytime, at(20)), false);
  assert.equal(settings.inQuietHours(settings.normalize({}), at(3)), false, 'off by default');
});

test('numeric settings survive junk input', () => {
  const s = settings.normalize({
    chimeVolume: 9,
    rangeDays: -4,
    notifyMinWaitMs: 'abc',
    eventsRetention: 1,
  });
  assert.equal(s.chimeVolume, 1);
  assert.equal(s.rangeDays, 1);
  assert.equal(s.notifyMinWaitMs, 0);
  assert.equal(s.eventsRetention, 200);
});

test('a user preference for a site that left the registry is kept', () => {
  const s = settings.normalize({ chimeSites: { retiredSite: false, chatgpt: false } });
  assert.equal(s.chimeSites.retiredSite, false);
  assert.equal(s.chimeSites.chatgpt, false);
});
