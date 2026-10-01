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
  assert.ok(s.enabledSites.length >= 10, 'every provider in the registry is enabled');
  assert.equal(s.chimeEnabled, true);
  assert.equal(s.disableSlowModes.deepseek, true, 'the one slow mode we know is on by default');
});

test('a broadcast reaches the AIs you have open and opens nothing by default', () => {
  const s = settings.normalize({});
  // Off by default, and this is the half of it that is a decision rather than a feature: a
  // fan-out is something you do from a conversation you are already in, and a tab for every
  // other AI arriving behind your back is the loudest complaint this extension has had. Ten
  // tabs is a heavier thing to do to someone than three skipped AIs, so the tab is the thing
  // that gets asked for — and `autoOpenTabs` is where they ask.
  assert.equal(s.autoOpenTabs, false);
  // What it opens when it does, it opens in a window of its own: tabs appearing in the middle
  // of the window you are working in was the other complaint, so the separate window is not
  // something to go and find in settings.
  assert.equal(s.singleWindow, true);
  assert.equal(settings.normalize({ singleWindow: false }).singleWindow, false, 'and it can be turned off');
  // The opt-in works, but only on a record that has already been through the version 2 upgrade:
  // an old record saying `true` is the old default, not a request, and the migration above is
  // the one place that distinction is made.
  assert.equal(settings.normalize({ version: 2, autoOpenTabs: true }).autoOpenTabs, true, 'as can the tab opening');
});

test('a settings record from before the tab default changed is migrated once', () => {
  // Version 1 stored `autoOpenTabs: true`, because that was the default then — not because
  // anyone chose it. Carrying it forward would mean the new default reached only new installs,
  // and the people who complained about the tabs are exactly the people who already had it on.
  // So the switch is reset on the way up, once, and the record is stamped with the new version.
  const carried = settings.normalize({ version: 1, autoOpenTabs: true });
  assert.equal(carried.autoOpenTabs, false, 'the old default is not mistaken for a decision');
  assert.equal(carried.version, 2, 'and the upgrade is recorded, so it happens once');

  // After that, the user's own setting is the only thing that decides.
  assert.equal(
    settings.normalize({ version: 2, autoOpenTabs: true }).autoOpenTabs,
    true,
    'a deliberate yes survives a round trip'
  );
  // And a record that has never been written is simply the new default.
  assert.equal(settings.normalize({}).autoOpenTabs, false);
});

test('unknown site ids are dropped, and an empty selection stays empty', () => {
  assert.deepEqual(settings.normalize({ enabledSites: ['chatgpt', 'nope'] }).enabledSites, ['chatgpt']);
  // Nothing switched on is a state the turn-on flow can genuinely reach — switching an AI
  // on means having verified it, so an empty list has to survive a round trip rather than
  // being quietly replaced by the first provider in the registry.
  assert.deepEqual(settings.normalize({ enabledSites: [] }).enabledSites, []);
});

test('whether an AI may be sent to is not a setting, and an old record cannot say otherwise', () => {
  // The switch that used to live here was the only way to reach a fan-out into pages that had
  // never said they were signed in, which comes back as "no answer" from every tab and reads as a
  // bug. It is gone, and a stored value from it has to go with it: a merge would otherwise carry
  // the key forward forever, and the popup and the fan-out would disagree about what a switch means.
  assert.equal('requireSignIn' in settings.DEFAULTS, false, 'not a default any more');
  assert.equal('requireSignIn' in settings.normalize({}), false, 'and not in a normalised record');
  assert.equal(
    'requireSignIn' in settings.normalize({ requireSignIn: false }),
    false,
    'a stored false is dropped rather than honoured'
  );
  assert.equal(
    'requireSignIn' in settings.normalize({ requireSignIn: true }),
    false,
    'and a stored true too — the key is gone in both directions'
  );
});

test('the settle window is clamped into a sane range and always ordered', () => {
  assert.deepEqual(settings.normalize({ settleMs: [5, 999999] }).settleMs, [5, 5000]);
  assert.deepEqual(settings.normalize({ settleMs: [2000, 500] }).settleMs, [2000, 2000]);
  assert.deepEqual(settings.normalize({ settleMs: 'nonsense' }).settleMs, settings.DEFAULTS.settleMs);
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
  assert.equal(targets.length, sites.ORDER.length - 1);
  // From the popup there is no origin, so everything switched on is fair game.
  assert.equal(settings.targetsFor(s, null).length, sites.ORDER.length);
});

test('adding a provider in the registry makes it available without a settings edit', () => {
  // The default is deliberately implicit (null), so a new adapter is not silently
  // missing from a fresh install until someone remembers to enumerate it here.
  assert.equal(settings.DEFAULTS.enabledSites, null);
  const fresh = settings.normalize({});
  assert.deepEqual(fresh.enabledSites, sites.ORDER);
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
