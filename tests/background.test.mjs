/**
 * The background worker, run for real against a fake browser.
 *
 * Everything else in tests/ checks pure logic. This one loads the actual background
 * scripts in order, exactly as the manifest does, and drives the message router. It is
 * the only test here that would have caught `bg.storage.setSiteStatusFor` (a namespace
 * that does not exist), `content/netwatch.js` never being registered, or a storage call
 * built from a dotted method name — all of which pass every other check and leave a
 * broken extension at runtime.
 *
 * There is no DOM. A tab either has a stub content script or has none, which is exactly
 * what an AI site looks like before its page has been reloaded into the extension.
 *
 * Sends are gated per tab: a test can hold a site mid-send, look at what the popup would
 * see, and then let it finish. That is what makes the assertions here deterministic
 * instead of a race against the pace between two sites.
 */
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'src');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// A browser, small enough to hold in one hand
// ---------------------------------------------------------------------------

const calls = {
  badge: [],
  title: [],
  notifications: [],
  menus: [],
  alarms: [],
  activated: [], // tab ids that were brought to the front, in order
  windows: [], // windows.create props
  windowUpdates: [], // windows.update props
  moved: [], // tabs.move calls
};
const local = new Map();
const session = new Map();
const tabs = new Map();
let nextTabId = 100;
// The window the user is sitting in. Everything lands here unless the extension makes a
// window of its own — which is what the `singleWindow` tests are about.
const USER_WINDOW = 1;
let nextWindowId = USER_WINDOW + 1;

const listeners = {
  message: [],
  installed: [],
  startup: [],
  alarm: [],
  notifyClick: [],
  tabRemoved: [],
  tabActivated: [],
  windowFocus: [],
  menuClick: [],
  storageChanged: [],
};

/** tabId -> what that site's content script replies with (object or handler). */
const siteTabs = new Map();

// Per-tab gates, applied only to SEND: everything else (ping, job updates, settings
// changes) has to keep flowing, or the tab would look dead while it is being held.
const gates = new Map();
function holdTab(tabId) {
  gates.set(tabId, { open: false, waiting: [] });
}
function releaseTab(tabId) {
  const gate = gates.get(tabId);
  if (!gate) return;
  gate.open = true;
  for (const resolve of gate.waiting.splice(0)) resolve();
}
function throughGate(tabId) {
  const gate = gates.get(tabId);
  if (!gate || gate.open) return Promise.resolve();
  return new Promise((resolve) => gate.waiting.push(resolve));
}

const area = (map, name) => ({
  async get(key) {
    if (key === undefined || key === null) return Object.fromEntries(map);
    if (typeof key === 'string') return map.has(key) ? { [key]: map.get(key) } : {};
    const out = {};
    for (const k of key) if (map.has(k)) out[k] = map.get(k);
    return out;
  },
  async set(items) {
    for (const [key, value] of Object.entries(items)) map.set(key, value);
    if (name === 'local') {
      const changes = Object.fromEntries(Object.keys(items).map((k) => [k, { newValue: items[k] }]));
      for (const handler of listeners.storageChanged) handler(changes, 'local');
    }
  },
  async remove(key) {
    map.delete(key);
  },
  async clear() {
    map.clear();
  },
});

/**
 * The origins the browser is holding shut.
 *
 * Firefox grants the host permissions in a manifest at install time, and an origin added to the
 * manifest afterwards is simply not among them until the user agrees — the site gets no content
 * script, so it never answers, and nothing about that state looks different from a page that
 * has not drawn yet. This set is that state, and `permissions` below is how the extension asks.
 */
const deniedOrigins = new Set();
const permissionRequests = [];

function denyOrigin(pattern) {
  deniedOrigins.add(pattern);
}

function grantOrigin(pattern) {
  deniedOrigins.delete(pattern);
}

globalThis.chrome = {
  permissions: {
    async contains({ origins }) {
      const list = origins || [];
      return list.every((pattern) => !deniedOrigins.has(pattern));
    },
    async request({ origins }) {
      permissionRequests.push([...(origins || [])]);
      for (const pattern of origins || []) grantOrigin(pattern);
      return true;
    },
  },
  runtime: {
    getURL: (rel) => `chrome-extension://whilefree/${rel}`,
    getManifest: () => ({ name: 'WhileFree', version: '0.1.0' }),
    onMessage: { addListener: (fn) => listeners.message.push(fn) },
    onInstalled: { addListener: (fn) => listeners.installed.push(fn) },
    onStartup: { addListener: (fn) => listeners.startup.push(fn) },
    async sendMessage() {
      return undefined;
    },
  },
  storage: {
    local: area(local, 'local'),
    session: area(session, 'session'),
    onChanged: { addListener: (fn) => listeners.storageChanged.push(fn) },
  },
  tabs: {
    async query(query) {
      const all = [...tabs.values()];
      if (!query) return all;
      if (query.url) {
        const patterns = Array.isArray(query.url) ? query.url : [query.url];
        return all.filter((tab) =>
          patterns.some((pattern) =>
            new RegExp(
              `^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`
            ).test(tab.url || '')
          )
        );
      }
      if (query.windowId !== undefined) return all.filter((tab) => tab.windowId === query.windowId);
      if (query.active) return all.filter((tab) => tab.active);
      return all;
    },
    async get(tabId) {
      return tabs.get(tabId);
    },
    async create(props) {
      return addTab(props.url, null, {
        active: props.active !== false,
        windowId: props.windowId === undefined ? USER_WINDOW : props.windowId,
      });
    },
    async update(tabId, props) {
      const tab = tabs.get(tabId) || { id: tabId };
      if (props.active === true) {
        // One active tab per window, the way a browser behaves. The focus detour is only
        // meaningful if activating a tab really does deactivate the one the user was on.
        for (const other of tabs.values()) if (other.id !== tabId) other.active = false;
        calls.activated.push(tabId);
      }
      Object.assign(tab, props);
      tabs.set(tabId, tab);
      return tab;
    },
    async move(tabIds, props) {
      calls.moved.push({ tabIds, ...props });
      const moving = Array.isArray(tabIds) ? tabIds : [tabIds];
      for (const id of moving) {
        const tab = tabs.get(id);
        if (tab) tab.windowId = props.windowId;
      }
      return moving.map((id) => tabs.get(id)).filter(Boolean);
    },
    async remove(tabId) {
      tabs.delete(tabId);
    },
    async reload() {},
    async sendMessage(tabId, message) {
      const reply = siteTabs.get(tabId);
      if (!reply) {
        // No content script in this tab: an AI site whose page predates the extension.
        throw new Error('Could not establish connection. Receiving end does not exist.');
      }
      if (message && message.type === globalThis.WF.MSG.SEND) await throughGate(tabId);
      return typeof reply === 'function' ? reply(message) : reply;
    },
    onRemoved: { addListener: (fn) => listeners.tabRemoved.push(fn) },
    onActivated: { addListener: (fn) => listeners.tabActivated.push(fn) },
  },
  action: {
    async setBadgeText({ text }) {
      calls.badge.push(text);
    },
    async setBadgeBackgroundColor({ color }) {
      calls.badge.push(color);
    },
    async setTitle({ title }) {
      calls.title.push(title);
    },
  },
  alarms: {
    async create(name, info) {
      calls.alarms.push({ name, ...info });
    },
    onAlarm: { addListener: (fn) => listeners.alarm.push(fn) },
  },
  notifications: {
    async create(id, options) {
      calls.notifications.push({ id, ...options });
    },
    async clear() {},
    onClicked: { addListener: (fn) => listeners.notifyClick.push(fn) },
  },
  contextMenus: {
    async removeAll() {},
    create(item) {
      calls.menus.push(item);
      return item.id;
    },
    onClicked: { addListener: (fn) => listeners.menuClick.push(fn) },
  },
  windows: {
    onFocusChanged: { addListener: (fn) => listeners.windowFocus.push(fn) },
    async create(props) {
      const id = nextWindowId++;
      calls.windows.push({ id, ...(props || {}) });
      // An empty window with a tab already in it, or a `tabId` moved in: Chrome and
      // Firefox both hand back the window's tabs only when `populate` was asked for, which
      // is modelled here rather than assumed away.
      if (props && props.tabId !== undefined) {
        const tab = tabs.get(props.tabId);
        if (tab) tab.windowId = id;
      }
      let made = [];
      if (props && props.url && props.populate) made = [addTab(props.url, null, { active: true, windowId: id })];
      return { id, tabs: made };
    },
    async update(windowId, props) {
      calls.windowUpdates.push({ windowId, ...props });
      return { id: windowId };
    },
  },
};

// Load the background exactly as the manifest does, in order.
await import(pathToFileURL(path.join(SRC, 'lib', 'files.js')).href);
const files = globalThis.WF.files.backgroundScripts();
for (const rel of files) {
  await import(pathToFileURL(path.join(SRC, rel)).href);
}
const WF = globalThis.WF;

/** Route a message the way the browser would, and resolve with the reply. */
function send(message, sender) {
  const listener = listeners.message[0];
  assert.ok(listener, 'the background must register a message listener');
  return new Promise((resolve) => {
    const handled = listener(message, sender || { tab: { id: 1, url: 'https://chatgpt.com/' } }, resolve);
    if (handled === false) resolve(undefined);
  });
}

/** A content script that answers the handful of messages the engine sends. */
function aiContentScript(overrides = {}) {
  return (message) => {
    // The real reply also carries the page's own live verdict on its session, which is what
    // a fan-out reads before it types anything into the tab.
    if (message.type === WF.MSG.PING) {
      return (
        overrides.ping || { ok: true, siteId: 'stub', hasComposer: true, signedIn: true, attention: null }
      );
    }
    // The warm-up. A real content script answers this only once its page has drawn a
    // message box; a stub that stays silent is how every target fails at once.
    if (message.type === WF.MSG.READY) {
      return overrides.ready || { ok: true, siteId: 'stub', url: 'https://stub/' };
    }
    if (message.type === WF.MSG.VERIFY_SITE) {
      return (
        overrides.verify || {
          ok: true,
          siteId: 'stub',
          signedIn: true,
          hasComposer: true,
          attention: null,
        }
      );
    }
    if (message.type === WF.MSG.SEND) {
      return overrides.send || { ok: true, method: 'enter', via: 'button', sentAt: Date.now() };
    }
    if (message.type === WF.MSG.PROBE) {
      return overrides.probe || { ok: true, inComposer: false, lastUserMatches: false };
    }
    if (message.type === WF.MSG.TEST_SITE) return { ok: true, diagnostic: { siteId: 'stub' } };
    if (message.type === WF.MSG.NEW_CHAT) return { ok: true };
    return { ok: true };
  };
}

/** An open AI tab whose content script answers. */
/**
 * A tab that exists and whose content script answers.
 *
 * A tab the extension opens itself gets a stub too: in a real browser the page loads and
 * its content script starts answering a moment later, and without that a tab we had to
 * open is a tab nothing can ever reply from — every warm-up would run out its timeout.
 */
/** Does a match pattern cover a url? The same rules the tabs query above uses. */
function matchesOrigin(pattern, url) {
  const rx = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return rx.test(url || '');
}

function addTab(url, reply, options = {}) {
  const id = nextTabId++;
  const tab = {
    id,
    url,
    active: options.active === true,
    windowId: options.windowId === undefined ? USER_WINDOW : options.windowId,
  };
  tabs.set(id, tab);
  // A tab on an origin the browser has not granted the extension gets no content script at
  // all — not in a tab the user opened, and not in one we opened ourselves. There is nothing
  // to answer and nothing to say hello, which is exactly the state that used to be silent.
  if ([...deniedOrigins].some((pattern) => matchesOrigin(pattern, url))) return tab;
  siteTabs.set(id, reply || aiContentScript());
  // A real page's content script says hello the moment it boots, which is how the
  // background learns a tab is worth talking to. Without it, a tab the extension opens
  // itself is a tab nothing ever replies from, and every warm-up runs out its timeout.
  const site = WF.sites.fromUrl(url);
  queueMicrotask(() => {
    const listener = listeners.message[0];
    if (!listener) return;
    listener({ type: WF.MSG.HELLO, siteId: site ? site.id : 'stub', url, hasComposer: true }, { tab }, () => {});
  });
  return tab;
}

/** An open AI tab whose content script answers. */
function openAiTab(siteId, reply) {
  const site = WF.sites.byId(siteId);
  return addTab(site.matchPatterns[0].replace('*', ''), reply).id;
}

const state = () => send({ type: WF.MSG.GET_STATE });

test('turning an AI on asks its tab first and moves nothing when the answer is yes', async () => {
  const tab = openAiTab('chatgpt');
  await patch({ enabledSites: [], autoOpenTabs: false });

  const check = await send({ type: WF.MSG.VERIFY_SITE, siteId: 'chatgpt' });
  assert.equal(check.verified, true);
  assert.deepEqual(calls.activated, [], 'no tab was raised, because none needed to be');
  assert.equal((await state()).settings.enabledSites.includes('chatgpt'), true, 'and the switch is on');

  // The one outcome the user has to act on is the one that comes to the front.
  siteTabs.set(
    tab,
    aiContentScript({
      verify: { ok: true, siteId: 'chatgpt', signedIn: false, hasComposer: true, attention: WF.ATTENTION.SIGNED_OUT },
    })
  );
  await send({ type: WF.MSG.SET_SETTINGS, patch: { enabledSites: [] } });
  const bad = await send({ type: WF.MSG.VERIFY_SITE, siteId: 'chatgpt' });
  assert.equal(bad.verified, false);
  assert.ok(calls.activated.includes(tab), 'a signed-out page is put in front of the user');
});

const patch = (values) => send({ type: WF.MSG.SET_SETTINGS, patch: values });
const targetFor = (snapshot, siteId) =>
  snapshot && snapshot.targets ? snapshot.targets.find((target) => target.siteId === siteId) : null;

/** Poll until `check` passes, or fail with what was last seen. */
async function waitFor(label, check, budgetMs = 8000) {
  const deadline = Date.now() + budgetMs;
  let last = null;
  while (Date.now() < deadline) {
    const snapshot = await state();
    last = snapshot.job && snapshot.job.activeJob;
    if (check(snapshot, last)) return last;
    await sleep(25);
  }
  assert.fail(`timed out waiting for ${label}; last saw ${JSON.stringify(last)}`);
}

async function waitUntilIdle(budgetMs = 8000) {
  const deadline = Date.now() + budgetMs;
  let last = null;
  while (Date.now() < deadline) {
    const snapshot = await state();
    // `activeJob` is the last broadcast's *outcome* once nothing is in flight, so it is
    // `running` — not its absence — that means the fan-out is over.
    const active = snapshot.job.activeJob;
    if (!active || active.running === false) return snapshot;
    last = snapshot.job;
    await sleep(25);
  }
  assert.fail(`the broadcast never finished: ${JSON.stringify(last)}`);
}

/**
 * A fresh browser between tests.
 *
 * The engine remembers which tab each site is in, and the record lives in storage, so
 * without this a later test would send into an earlier test's tab — which is how a
 * suite starts passing for the wrong reason.
 */
beforeEach(async () => {
  tabs.clear();
  siteTabs.clear();
  gates.clear();
  for (const key of ['activated', 'windows', 'windowUpdates', 'moved']) calls[key].length = 0;
  // Stop whatever the previous test left running, then wait for the engine to settle.
  await send({ type: WF.MSG.CANCEL });
  await waitUntilIdle(3000);
  // Settings are reset by removing the key rather than by patching the defaults: a
  // merge is exactly how one test's switches leak into the next.
  await WF.browser.storageRemove(WF.storage.KEYS.settings);
  // The baseline every test starts from: nothing is opened for an AI that is closed, and
  // the pacing is as tight as the settings allow. A test that needs a tab opens one.
  await WF.storage.setSettings({
    autoOpenTabs: false,
    groupTabs: false,
    singleWindow: false,
    // Sign-in gating has its own tests; every other test starts with sites that are
    // already checked, because a fan-out that refuses to start would make them all fail
    // for a reason that has nothing to do with what they are testing.
    requireSignIn: false,
    focusOnRetry: false,
    settleMs: [0, 0],
    retryAttempts: 1,
  });
  await WF.bg.store.invalidate();
  await WF.storage.setAnswers([]);
  await WF.storage.setSiteStatus({});
  await WF.storage.setEvents([]);
  await WF.storage.setMeta({});
});

after(() => {
  // By design the worker keeps watchdogs and intervals alive; a real one is suspended,
  // a test process would wait out a five-minute watchdog. Every test has finished and
  // its output has flushed by now.
  setTimeout(() => process.exit(0), 50);
});

// ---------------------------------------------------------------------------

test('the background loads and answers GET_STATE with the popup contract', async () => {
  const first = await state();
  assert.equal(first.ok, true);
  assert.ok(first.sites.length >= 10, 'every provider is listed');
  assert.equal(first.settings.enabledSites.length, WF.sites.list().length);
  assert.equal(first.job.activeJob, null);
  assert.deepEqual(first.job.jobs, [], 'there is no queue to be holding anything');
  assert.ok(first.today && first.week, 'the popup and dashboard share this payload');
  assert.equal(typeof first.version, 'string');
});

test('settings round-trip through the router, and junk values fall back', async () => {
  const res = await patch({ chimeEnabled: false, sendMode: 'new_chat' });
  assert.equal(res.ok, true);
  assert.equal(res.settings.chimeEnabled, false);
  assert.equal(res.settings.sendMode, 'new_chat');

  // Re-read through a different route: a setting that is only returned but never
  // persisted is the failure mode that looks like success.
  const reread = await state();
  assert.equal(reread.settings.chimeEnabled, false);
  assert.equal(reread.settings.sendMode, 'new_chat');

  const bad = await patch({ sendMode: 'sideways', retryAttempts: 99 });
  assert.equal(bad.settings.sendMode, 'continue');
  assert.equal(bad.settings.retryAttempts, 4);

  await patch({ sendMode: 'continue', chimeEnabled: true });
});

test('every target is warmed and sent at once, and each reports its own outcome', async () => {
  const claudeTab = openAiTab('claude', aiContentScript({ send: { ok: false, reason: WF.ATTENTION.NO_COMPOSER } }));
  const geminiTab = openAiTab('gemini');
  const perplexityTab = openAiTab('perplexity', aiContentScript({ send: { ok: false, reason: WF.ATTENTION.SEND_FAILED } }));
  for (const id of [claudeTab, geminiTab, perplexityTab]) holdTab(id);

  await patch({
    enabledSites: ['claude', 'gemini', 'perplexity'],
    autoOpenTabs: false,
    groupTabs: false,
    autoCapture: false,
  });

  const job = await send({ type: WF.MSG.BROADCAST, prompt: 'hello there' });
  assert.equal(job.ok, true);
  assert.equal(job.started, true, 'the fan-out is already going by the time the popup hears back');
  assert.deepEqual(job.targets, ['claude', 'gemini', 'perplexity'], 'every switched-on AI');

  // The whole point of the parallel fan-out: all three are mid-send at the same moment.
  // Under the old queue only one of them could ever have been in this state.
  const holding = await waitFor('all three to be attempted together', (_s, active) =>
    ['claude', 'gemini', 'perplexity'].every((id) => {
      const target = targetFor(active, id);
      return target && target.state === 'sending' && target.attempts >= 1;
    })
  );
  const claude = targetFor(holding, 'claude');
  assert.equal(claude.name, 'Claude', 'the popup shows a name, not an id');
  assert.equal(claude.attempts, 1);
  assert.equal(claude.error, null, 'nothing has gone wrong yet');
  assert.equal(targetFor(holding, 'gemini').state, 'sending');
  assert.equal(targetFor(holding, 'perplexity').state, 'sending');

  // One fails with no composer, one succeeds, one fails at the press — all at the same time.
  releaseTab(claudeTab);
  releaseTab(geminiTab);
  releaseTab(perplexityTab);
  const finished = await waitFor('every target to reach an end state', (_s, active) =>
    ['claude', 'gemini', 'perplexity'].every((id) => {
      const target = targetFor(active, id);
      return target && ['sent', 'error', 'attention', 'timeout'].includes(target.state);
    })
  );

  assert.equal(targetFor(finished, 'claude').state, 'error');
  assert.equal(targetFor(finished, 'claude').errorCode, WF.CODE.NO_COMPOSER);
  assert.ok(String(targetFor(finished, 'claude').error).length, 'and it says why');

  assert.equal(targetFor(finished, 'gemini').state, 'sent');
  assert.equal(targetFor(finished, 'gemini').tabId, geminiTab, 'the popup can open that tab');

  assert.equal(targetFor(finished, 'perplexity').state, 'error');
  assert.equal(targetFor(finished, 'perplexity').errorCode, WF.CODE.SUBMIT_FAILED);

  await waitUntilIdle();
});

test('a tab whose session has ended is not typed into, whatever its record says', async () => {
  // The check the switch was turned on with is a week of trust, and a session can end in a
  // moment: signed out in another tab, an expired cookie, a revoked token. None of that is
  // visible in the page's markup once its own app has drawn itself, so the record goes on
  // saying "signed in" — and the page is the only thing that knows otherwise. The ping the
  // fan-out already sends before it types anything is what asks it.
  let sends = 0;
  openAiTab('copilot', (message) => {
    if (message.type === WF.MSG.PING) {
      return {
        ok: true,
        siteId: 'copilot',
        hasComposer: true,
        signedIn: false,
        attention: WF.ATTENTION.SIGNED_OUT,
      };
    }
    if (message.type === WF.MSG.SEND) {
      sends += 1;
      return { ok: true, method: 'click', via: 'button', sentAt: Date.now() };
    }
    return aiContentScript()(message);
  });
  await patch({
    enabledSites: ['copilot'],
    autoOpenTabs: false,
    requireSignIn: true,
    groupTabs: false,
    singleWindow: false,
  });
  await WF.storage.setSiteStatus({
    copilot: { verifiedAt: Date.now(), hasComposer: true, attention: null, at: Date.now() },
  });

  const job = await send({ type: WF.MSG.BROADCAST, prompt: 'are you there' });
  assert.equal(job.ok, true, 'the record still passes the gate — that is the trap');
  const finished = await waitFor('the target to be refused', (_s, active) => {
    const target = targetFor(active, 'copilot');
    return target && ['sent', 'error', 'attention', 'timeout'].includes(target.state);
  });
  await waitUntilIdle();

  const target = targetFor(finished, 'copilot');
  assert.equal(target.state, 'attention');
  assert.equal(target.errorCode, WF.CODE.NEEDS_HUMAN);
  assert.equal(target.error, WF.ATTENTION.SIGNED_OUT, 'and it says which, rather than blaming the box');
  assert.equal(sends, 0, 'nothing was typed into a page with no session behind it');

  const status = (await WF.storage.getSiteStatus()).copilot;
  assert.equal(status.attention, WF.ATTENTION.SIGNED_OUT);
  assert.equal(status.verifiedAt, 0, 'the check is cleared, so nothing reads as signed in any more');
  assert.equal(WF.status.isVerified(status, Date.now()), false);
});

test('a page that says it is signed in now re-stamps the check it is trusted on', async () => {
  // The other half of the same rule: a tab we are about to type into is asked, and when the
  // answer is yes the record becomes a statement about this session rather than a memory of
  // an older one. Nothing moves, opens or focuses to make that happen.
  const tab = openAiTab('copilot');
  const checkedYesterday = Date.now() - 24 * 60 * 60 * 1000;
  await patch({
    enabledSites: ['copilot'],
    autoOpenTabs: false,
    requireSignIn: true,
    groupTabs: false,
    singleWindow: false,
  });
  await WF.storage.setSiteStatus({
    copilot: { verifiedAt: checkedYesterday, hasComposer: true, attention: null, at: checkedYesterday },
  });

  await send({ type: WF.MSG.BROADCAST, prompt: 'still you?' });
  const finished = await waitFor('the prompt to be sent', (_s, active) => {
    const target = targetFor(active, 'copilot');
    return target && target.state === 'sent';
  });
  await waitUntilIdle();

  assert.equal(targetFor(finished, 'copilot').tabId, tab, 'the tab it was already talking to');
  assert.deepEqual(calls.activated, [], 'confirming a session is not worth stealing the screen for');
  const status = (await WF.storage.getSiteStatus()).copilot;
  assert.ok(
    status.verifiedAt > checkedYesterday,
    `the check was confirmed against the page itself: ${status.verifiedAt} vs ${checkedYesterday}`
  );
  assert.equal(status.attention, null);
});

test('the tabs a broadcast has to open go into a window of its own, never into yours', async () => {
  // The shipped defaults: open what is closed, and put what you open in one window of its
  // own. Nothing is open for either AI, so both tabs have to be made.
  await patch({
    enabledSites: ['claude', 'gemini'],
    autoOpenTabs: true,
    singleWindow: true,
    groupTabs: false,
    autoCapture: false,
  });

  const job = await send({ type: WF.MSG.BROADCAST, prompt: 'open what you have to open' });
  assert.equal(job.ok, true);
  // Wait for the fan-out to be over, not merely for both to have been reported: the tab
  // count below is only the whole story once nothing is still being opened.
  await waitFor('both to be sent', (_s, active) =>
    active.targets.every((target) => target.state === 'sent')
  );
  const finished = (await waitUntilIdle()).job.activeJob;
  assert.equal(finished.targets.length, 2, 'both AIs were asked');
  for (const target of finished.targets) assert.ok(target.tabId, `${target.siteId} was sent from a tab`);
  assert.notEqual(
    finished.targets[0].tabId,
    finished.targets[1].tabId,
    'each AI was asked in its own tab, not both in whichever window was made first'
  );

  assert.equal(calls.windows.length, 1, 'one window for the broadcast, not one per AI');
  const [own] = calls.windows;
  assert.ok(own && own.url, 'made around the tab it needed, rather than empty and filled');
  assert.equal(own.focused, false, 'behind the window the user is in');

  const opened = [...tabs.values()];
  assert.equal(opened.length, 2, `both AIs were opened: ${JSON.stringify(opened)}`);
  for (const tab of opened) {
    assert.equal(tab.windowId, own.id, `${tab.url} was opened in the user's own window`);
  }
  assert.deepEqual(calls.moved, [], 'they were opened in there, not moved in afterwards');
});

test('a prompt typed in an AI page gets its own window too, and your own tab stays put', async () => {
  const mine = openAiTab('chatgpt');
  await patch({
    enabledSites: ['chatgpt', 'claude'],
    autoOpenTabs: true,
    singleWindow: true,
    groupTabs: false,
    autoCapture: true,
  });

  const started = await send(
    { type: WF.MSG.CAPTURE, siteId: 'chatgpt', prompt: 'typed into my own box', hash: 'h1', url: 'https://chatgpt.com/' },
    { tab: { id: mine, url: 'https://chatgpt.com/' } }
  );
  assert.equal(started.ok, true);
  await waitFor('the AI it has to open to be sent', (_s, active) => {
    const target = targetFor(active, 'claude');
    return target && target.state === 'sent';
  });
  await waitUntilIdle();

  // The capture path is the one that most often opens a tab, because it is what a prompt
  // typed in an AI's own box turns into — so it is the one where the clutter was worst.
  assert.equal(calls.windows.length, 1, 'the tab it had to open got a window of its own');
  const claudeTab = targetFor((await state()).job.activeJob, 'claude').tabId;
  assert.equal(tabs.get(claudeTab).windowId, calls.windows[0].id);
  assert.equal(tabs.get(mine).windowId, USER_WINDOW, 'the tab you typed in was never moved');
});

test('with the separate window switched off, an opened tab lands in the window you are using', async () => {
  await patch({
    enabledSites: ['claude'],
    autoOpenTabs: true,
    singleWindow: false,
    groupTabs: false,
    autoCapture: false,
  });

  const started = await send({ type: WF.MSG.BROADCAST, prompt: 'no window for this one' });
  assert.equal(started.ok, true);
  await waitFor('the one target to be sent', (_s, active) => {
    const target = targetFor(active, 'claude');
    return target && target.state === 'sent';
  });
  await waitUntilIdle();

  assert.deepEqual(calls.windows, [], 'no window was made');
  const claudeTab = targetFor((await state()).job.activeJob, 'claude').tabId;
  assert.equal(tabs.get(claudeTab).windowId, USER_WINDOW, 'the tab opened where the user is');
});

test('one AI can be stopped or retried without touching the others', async () => {
  const claudeTab = openAiTab('claude');
  const geminiTab = openAiTab('gemini');
  holdTab(claudeTab);
  holdTab(geminiTab);

  await patch({ enabledSites: ['claude', 'gemini'], autoOpenTabs: false, retryAttempts: 1 });
  const job = await send({ type: WF.MSG.BROADCAST, prompt: 'hold the line' });
  assert.deepEqual(job.targets, ['claude', 'gemini']);

  await waitFor('claude to be held mid-send', (_s, active) => {
    const target = targetFor(active, 'claude');
    return target && target.state === 'sending';
  });

  const tooLate = await send({ type: WF.MSG.RETRY_TARGET, jobId: job.jobId, siteId: 'claude' });
  assert.equal(tooLate.ok, false);
  assert.equal(tooLate.reason, 'still-running', 'a retry cannot race a send already going');

  releaseTab(claudeTab);
  await waitFor('claude to be sent', (_s, active) => {
    const target = targetFor(active, 'claude');
    return target && target.state === 'sent';
  });

  const stopped = await send({ type: WF.MSG.CANCEL_TARGET, jobId: job.jobId, siteId: 'claude' });
  assert.equal(stopped.ok, true);
  const afterStop = (await state()).job.activeJob;
  assert.equal(targetFor(afterStop, 'claude').state, 'cancelled');
  // Stopping one AI does not disturb the next one in line, which is held mid-send and
  // therefore cannot have failed while we looked.
  assert.ok(
    ['queued', 'sending'].includes(targetFor(afterStop, 'gemini').state),
    `gemini: ${JSON.stringify(targetFor(afterStop, 'gemini'))}`
  );

  const missing = await send({ type: WF.MSG.CANCEL_TARGET, jobId: 'nope', siteId: 'claude' });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, 'not-found');

  // A target that was stopped can be sent again on its own.
  const retry = await send({ type: WF.MSG.RETRY_TARGET, jobId: job.jobId, siteId: 'claude' });
  assert.equal(retry.ok, true);
  await waitFor('claude to be retried', (_s, active) => {
    const target = targetFor(active, 'claude');
    return target && target.state === 'sent' && target.attempts >= 1;
  });

  releaseTab(geminiTab);
  await send({ type: WF.MSG.CANCEL, jobId: job.jobId });
  await waitUntilIdle();
});

test('a second prompt starts immediately; one message box is never typed into twice', async () => {
  const claudeTab = openAiTab('claude');
  holdTab(claudeTab);
  await patch({ enabledSites: ['claude'], autoOpenTabs: false });

  // The tab a broadcast is sent from is answered too: it is where the in-page status list
  // lives, and what it is told about each target is collected here.
  const updates = [];
  siteTabs.set(1, (message) => {
    if (message.type === WF.MSG.JOB_TARGET) updates.push(message.patch);
    return { ok: true };
  });

  const first = await send({ type: WF.MSG.BROADCAST, prompt: 'one' });
  const second = await send({ type: WF.MSG.BROADCAST, prompt: 'two' });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true, 'a second prompt is accepted rather than queued');
  assert.equal(second.started, true);
  await sleep(50);

  // The one thing that must not happen is two prompts interleaved in one message box. The
  // second job says the site is busy instead of typing over the first — said in a target
  // update the panel is handed, which outlives the moment: the refusal is over in the same
  // breath it is made, so a snapshot taken afterwards no longer holds it.
  const refused = updates.some(
    (patch) => patch.status === 'error' && patch.errorCode === WF.CODE.BUSY
  );
  assert.ok(refused, `the second job was told the site is busy: ${JSON.stringify(updates)}`);
  const both = await state();
  assert.equal(both.job.jobs.length, 1, 'and it is over, with the first still going out');
  assert.equal(both.job.jobs[0].prompt, 'one');

  releaseTab(claudeTab);
  await send({ type: WF.MSG.CANCEL });
  await waitUntilIdle();
});

test('the context menu asks every AI, using the selection or the page', async () => {
  const selection = await WF.bg.background.askFromMenu(
    { menuItemId: 'wf-ask-selection', selectionText: '  explain this error  ' },
    { id: 7, title: 'Docs', url: 'https://example.com/a' }
  );
  assert.equal(selection.ok, true);

  const page = await WF.bg.background.askFromMenu(
    { menuItemId: 'wf-ask-page' },
    { id: 7, title: 'Docs', url: 'https://example.com/a' }
  );
  assert.equal(page.ok, true);

  // Nothing to ask about: a no-op, not a prompt made of the word "null".
  const nothing = await WF.bg.background.askFromMenu({ menuItemId: 'wf-ask-page' }, null);
  assert.equal(nothing.ok, false);
  assert.equal(nothing.reason, 'empty');

  // Asking and being refused is the case that must tell you: a menu item that does
  // nothing at all reads as a broken extension.
  await patch({ broadcastEnabled: false });
  const refused = await WF.bg.background.askFromMenu(
    { menuItemId: 'wf-ask-selection', selectionText: 'still this' },
    { id: 7, title: 'Docs', url: 'https://example.com/a' }
  );
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'off');
  assert.ok(calls.notifications.some((n) => n.title === 'Nothing was sent'));
  await patch({ broadcastEnabled: true });

  assert.deepEqual(
    calls.menus.map((item) => item.id).sort(),
    ['wf-ask-page', 'wf-ask-selection']
  );
  assert.ok(listeners.menuClick.length, 'the click handler is registered');
  await send({ type: WF.MSG.CANCEL });
  await waitUntilIdle();
});

test('a prompt typed in an AI page fans out, and its own echo does not', async () => {
  const prompt = 'what changed in this release';
  const hash = WF.util.fingerprint(prompt);

  // You typed it yourself in ChatGPT: it goes to the others without a second press.
  const mine = await send({
    type: WF.MSG.CAPTURE,
    siteId: 'chatgpt',
    prompt,
    hash,
    url: 'https://chatgpt.com/',
  });
  assert.equal(mine.ok, true);
  assert.equal(mine.echo, undefined);
  assert.ok(mine.targets.includes('claude'));

  // The same prompt coming back out of a page we just delivered to is an echo, not a
  // new request: this is the loop that would otherwise never stop.
  const delivered = await send({
    type: WF.MSG.CAPTURE,
    siteId: 'claude',
    prompt,
    hash,
    url: 'https://claude.ai/',
  });
  assert.equal(delivered.ok, true);
  assert.equal(delivered.echo === true || delivered.duplicate === true, true, 'delivered twice');

  await send({ type: WF.MSG.CANCEL });
  await waitUntilIdle();

  // And with auto-send switched off, nothing is captured at all.
  await patch({ autoCapture: false });
  const off = await send({ type: WF.MSG.CAPTURE, siteId: 'gemini', prompt: 'another one', hash: 'x' });
  assert.equal(off.reason, 'auto-off');
  await patch({ autoCapture: true });
});

test('the badge counts answers, then clears when you visit the tab', async () => {
  // Sent, then answered, exactly as a content script reports it.
  const sentAt = Date.now() - 42000;
  const sender = { tab: { id: 555, url: 'https://claude.ai/' } };
  tabs.set(555, { id: 555, url: 'https://claude.ai/', active: false });

  await send({ type: WF.MSG.STATE, jobId: 'job-badge', siteId: 'claude', phase: WF.PHASE.SENT, sentAt }, sender);
  await send(
    {
      type: WF.MSG.STATE,
      jobId: 'job-badge',
      siteId: 'claude',
      phase: WF.PHASE.DONE,
      sentAt,
      firstWordAt: sentAt + 2000,
      doneAt: Date.now(),
      awayMs: 0,
    },
    sender
  );
  await sleep(80);

  const counts = calls.badge.filter((value) => /^\d+\+?$/.test(value));
  assert.equal(counts[counts.length - 1], '1', 'an answer landing sets the count');
  assert.ok(
    calls.title.some((title) => /ready|answered/i.test(title)),
    'the tooltip says the same thing the badge does'
  );

  const entry = (await WF.storage.getAnswers()).find((answer) => answer.siteId === 'claude');
  assert.ok(entry, 'the answer is listed for the popup');
  assert.equal(entry.tabId, 555, 'and it remembers which tab to open');
  assert.ok(entry.waitedMs >= 40000, 'timed from the send, not from when we noticed');

  // The count is persisted, so it survives the worker being torn down and restarted.
  assert.ok(local.has(WF.storage.KEYS.answers), 'the ready list was written to storage');

  // Going to that tab yourself is the same as clicking through the list.
  const before = calls.badge.length;
  listeners.tabActivated[0]({ tabId: 555 });
  await sleep(120);
  assert.ok(calls.badge.length > before, 'the badge is recomputed on tab activation');
  assert.equal(calls.badge[calls.badge.length - 1], '', 'and the count clears');
  assert.deepEqual(await WF.storage.getAnswers(), []);
});

test('an AI that needs you takes the icon over from unanswered answers', async () => {
  await send({
    type: WF.MSG.SITE_STATUS,
    siteId: 'gemini',
    attention: { reason: WF.ATTENTION.QUOTA, evidence: 'you have reached your limit' },
    hasComposer: false,
    url: 'https://gemini.google.com/',
  });
  await sleep(80);

  const lastColor = [...calls.badge].reverse().find((value) => String(value).startsWith('#'));
  assert.ok(lastColor, 'a colour is set');
  assert.notEqual(lastColor.toLowerCase(), '#15803d', 'amber, not the green of an answer');
  assert.ok(
    calls.title.some((title) => /attention|need/i.test(title)),
    'the tooltip says which problem it is'
  );
  assert.equal((await WF.storage.getSiteStatus()).gemini.attention, WF.ATTENTION.QUOTA);

  await send({ type: WF.MSG.SITE_STATUS, siteId: 'gemini', attention: null, hasComposer: true });
  await sleep(50);
});

test('sweep settles an abandoned answer instead of leaving it open forever', async () => {
  const old = Date.now() - 30 * 60 * 1000;
  await WF.storage.setEvents([
    { id: 'e1', siteId: 'gemini', group: 'g', sentAt: old, firstWordAt: null, doneAt: null },
  ]);
  const result = await WF.bg.background.sweep();
  assert.equal(result.changed, 1, `sweep reported ${JSON.stringify(result)}`);

  const event = (await WF.storage.getEvents()).find((e) => e.id === 'e1');
  assert.ok(event.status === 'orphaned' || event.status === 'noise', `unexpected: ${event.status}`);
  assert.equal(WF.stats.usable(event), false, 'an orphan is never counted as an answer');
});

test('the weekly report is sent once a week, and on demand', async () => {
  // Something to report: without a prompt on the record there is no digest at all.
  const tree = WF.stats.emptyStats(0);
  WF.stats.addUsage(tree, {
    siteId: 'chatgpt',
    day: WF.util.dayKey(),
    hour: 9,
    weekday: 1,
    deltas: { writing: 60000, waiting: 40000, reading: 90000 },
    counts: { prompts: 3, answers: 3 },
  });
  await WF.storage.setStats(tree);

  const first = await WF.bg.background.maybeWeeklyReport(false);
  assert.equal(first.reason, 'started', 'the clock starts rather than reporting on nothing');

  const tooSoon = await WF.bg.background.maybeWeeklyReport(false);
  assert.equal(tooSoon.reason, 'wait');
  assert.ok(tooSoon.nextAt > Date.now());

  const now = await WF.bg.background.maybeWeeklyReport(true);
  assert.equal(now.ok, true, 'the button in the dashboard bypasses the clock');
  await sleep(20);
  assert.ok(calls.notifications.some((n) => String(n.id).startsWith('wf-weekly')));
});

test('the file lists the runtime loads are the ones the manifest ships', async () => {
  const manifest = JSON.parse(await readFile(path.join(SRC, 'manifest.base.json'), 'utf8'));
  assert.equal(files[files.length - 1], 'background/background.js', 'it self-initialises, so last');
  assert.deepEqual(WF.files.backgroundScripts(), files);
  assert.deepEqual(
    WF.files.contentScripts().filter((rel) => rel.startsWith('content/')),
    WF.files.CONTENT
  );
  // Without contextMenus, installMenus is a no-op and the menu items never appear.
  assert.ok(manifest.permissions.includes('contextMenus'));
  assert.ok(calls.alarms.some((alarm) => alarm.name === 'wf:sweep'), 'the sweep alarm is armed');
});

test('a finished broadcast keeps its outcome, and one AI can still be retried from it', async () => {
  const claudeTab = openAiTab(
    'claude',
    aiContentScript({ send: { ok: false, reason: WF.ATTENTION.NO_COMPOSER } })
  );
  await patch({ enabledSites: ['claude'], autoOpenTabs: false, retryAttempts: 1, focusOnRetry: false });

  const job = await send({ type: WF.MSG.BROADCAST, prompt: 'left behind' });
  assert.equal(job.ok, true);
  const finished = await waitFor('the only target to fail', (_s, active) => {
    const target = targetFor(active, 'claude');
    return target && target.state === 'error';
  });
  assert.equal(finished.running, false, 'nothing is in flight any more');

  const after = await state();
  assert.equal(after.job.jobs.length, 0, 'the in-flight list is empty');
  // The card is the last broadcast's *outcome*, not its absence: a fan-out where three
  // sites failed used to vanish the moment it ended, taking the reasons with it.
  assert.equal(targetFor(after.job.activeJob, 'claude').errorCode, WF.CODE.NO_COMPOSER);

  // The Retry next to that failure still reaches the prompt, even though the job is over.
  siteTabs.set(claudeTab, aiContentScript());
  const retry = await send({ type: WF.MSG.RETRY_TARGET, jobId: job.jobId, siteId: 'claude' });
  assert.equal(retry.ok, true);
  await waitFor('the retried target to be sent', (_s, active) => {
    const target = targetFor(active, 'claude');
    return target && target.state === 'sent';
  });
  await waitUntilIdle();
});

test('ask all uses the tab you are looking at for that AI, not another one', async () => {
  const other = openAiTab('chatgpt');
  const current = openAiTab('chatgpt');
  // The *other* tab was touched more recently, so only the "ask all asks the AI you are
  // on" rule can lead the job to `current`. A test where the answer is also the most
  // recently used tab would pass with the rule removed.
  tabs.get(other).lastAccessed = Date.now();
  tabs.get(current).lastAccessed = Date.now() - 60000;
  const claudeTab = openAiTab('claude');
  await patch({ enabledSites: ['chatgpt', 'claude'], autoOpenTabs: false });

  const job = await send(
    { type: WF.MSG.BROADCAST, prompt: 'which tab does this land in' },
    { tab: { id: current, url: 'https://chatgpt.com/c/abc' } }
  );
  assert.deepEqual([...job.targets].sort(), ['chatgpt', 'claude'], 'including the one you are on');

  const done = await waitFor('both to be sent', (_s, active) =>
    active.targets.every((target) => target.state === 'sent')
  );
  assert.equal(targetFor(done, 'chatgpt').tabId, current, 'the tab the prompt was pressed in');
  assert.equal(targetFor(done, 'claude').tabId, claudeTab);
  await waitUntilIdle();
});

test('a site that will not take a prompt in the background gets its tab brought forward once', async () => {
  const userTab = openAiTab('chatgpt');
  tabs.get(userTab).active = true; // this is where the user is
  let attempts = 0;
  const geminiTab = openAiTab('gemini', (message) => {
    if (message.type === WF.MSG.READY) return { ok: true, siteId: 'gemini' };
    if (message.type === WF.MSG.PING) return { ok: true, siteId: 'gemini', hasComposer: true };
    if (message.type === WF.MSG.SEND) {
      attempts += 1;
      // What Gemini actually does: the press does nothing until the tab is in front.
      return attempts === 1
        ? { ok: false, reason: WF.ATTENTION.NO_COMPOSER }
        : { ok: true, method: 'enter', via: 'button', sentAt: Date.now() };
    }
    return { ok: true };
  });

  await patch({ enabledSites: ['chatgpt', 'gemini'], autoOpenTabs: false, focusOnRetry: true });
  const started = await send(
    { type: WF.MSG.BROADCAST, prompt: 'this only works when visible' },
    { tab: { id: userTab, url: 'https://chatgpt.com/' } }
  );
  assert.equal(started.ok, true, `the broadcast started: ${JSON.stringify(started)}`);

  // The detour is quick and the job leaves `jobs` as soon as it ends, so the outcome is
  // read from the finished broadcast the popup is left looking at.
  const done = await waitFor('gemini to be sent after the detour', (_s, active) => {
    const target = targetFor(active, 'gemini');
    return target && target.state === 'sent';
  });
  assert.equal(attempts, 2, 'one attempt in the background, one with the tab in front');
  assert.ok(calls.activated.includes(geminiTab), 'its tab was brought to the front');
  assert.equal(calls.activated[calls.activated.length - 1], userTab, 'and the user was put back');
  assert.equal(targetFor(done, 'gemini').attempts, 2);
  await waitUntilIdle();
});

test('an AI is only a target once its own page has said it is signed in', async () => {
  // Back to shipped defaults for this one: the gate is the default, and a test that turns
  // it off to make other tests convenient cannot prove that.
  await WF.browser.storageRemove(WF.storage.KEYS.settings);
  await WF.bg.store.invalidate();
  assert.equal((await state()).settings.requireSignIn, true, 'checking before sending is the default');

  const signedOut = aiContentScript({
    verify: {
      ok: true,
      siteId: 'gemini',
      signedIn: false,
      hasComposer: false,
      attention: WF.ATTENTION.SIGNED_OUT,
    },
  });
  const geminiTab = openAiTab('gemini', signedOut);
  await patch({ enabledSites: ['chatgpt', 'gemini'], autoOpenTabs: false });

  // Enabled, but nothing has been checked: the fan-out refuses rather than reporting a
  // pile of "no answer" for sites that were never signed in.
  const refused = await send({ type: WF.MSG.BROADCAST, prompt: 'nobody has been checked' });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'no-verified-targets');
  assert.deepEqual(refused.skipped, ['chatgpt', 'gemini'], 'and it says which AIs were left out');

  // Switching it on opens its tab and asks the page. Signed out, so it stays off.
  const check = await send({ type: WF.MSG.VERIFY_SITE, siteId: 'gemini' });
  assert.equal(check.ok, true);
  assert.equal(check.verified, false);
  assert.equal(check.attention, WF.ATTENTION.SIGNED_OUT);
  assert.ok(calls.activated.includes(geminiTab), 'its tab is opened in front of the user');
  const afterCheck = await state();
  assert.ok(!afterCheck.settings.enabledSites.includes('gemini'), 'and the switch stays off');
  assert.equal(
    afterCheck.sites.find((site) => site.id === 'gemini').verified,
    false,
    'the site list says why rather than showing it as on'
  );

  // Signed in now: the same switch turns it on, and a fan-out goes there.
  siteTabs.set(
    geminiTab,
    aiContentScript({
      verify: { ok: true, siteId: 'gemini', signedIn: true, hasComposer: true, attention: null },
    })
  );
  const raisedBefore = calls.activated.length;
  const good = await send({ type: WF.MSG.VERIFY_SITE, siteId: 'gemini' });
  assert.equal(good.verified, true);
  assert.equal(
    calls.activated.length,
    raisedBefore,
    'a page that is already signed in is checked without being brought forward'
  );
  const afterGood = await state();
  assert.ok(afterGood.settings.enabledSites.includes('gemini'));
  assert.equal(afterGood.sites.find((site) => site.id === 'gemini').verified, true);

  const sent = await send({ type: WF.MSG.BROADCAST, prompt: 'now it can be sent to' });
  assert.ok(sent.targets.includes('gemini'));
  assert.ok(
    !sent.targets.includes('chatgpt'),
    'and the site nobody checked is still left out'
  );

  await send({ type: WF.MSG.CANCEL });
  await waitUntilIdle();
});

test('with every AI switched on and care off, a fan-out asks all ten, checked or not', async () => {
  // The state a user reaches with the per-AI switches plus the careful-mode switch: every AI on,
  // checking off. The fan-out then asks every one of them — a page still gets its say at the
  // moment of sending, per AI, and says it on that AI's own row instead of quietly shrinking the
  // fan-out in advance. The master switch deliberately no longer sets this state up for you; see
  // the test below for what it does instead.
  openAiTab('deepseek');
  // Careful mode, the mode every other test turns off: a target has to have been checked.
  await patch({ autoOpenTabs: false, groupTabs: false, singleWindow: false, requireSignIn: true });
  await WF.storage.setSiteStatus({});

  const before = await send({ type: WF.MSG.BROADCAST, prompt: 'who is listening' });
  assert.equal(before.ok, false);
  assert.equal(before.reason, 'no-verified-targets');
  assert.deepEqual(before.skipped, WF.sites.ORDER, 'nothing has been checked, so nothing goes');

  const switched = await send({
    type: WF.MSG.SET_SETTINGS,
    patch: { enabledSites: WF.sites.ORDER.slice(), requireSignIn: false },
  });
  assert.equal(switched.settings.requireSignIn, false, 'one press is what turns the checking off');

  const after = await send({ type: WF.MSG.BROADCAST, prompt: 'now who is listening' });
  assert.equal(after.ok, true);
  assert.deepEqual(after.targets, WF.sites.ORDER, 'every AI, in the order the popup lists them');
  assert.deepEqual(after.skipped, [], 'and none of them is left out behind the user\'s back');

  await send({ type: WF.MSG.CANCEL });
  await waitUntilIdle();
});

test('the master switch stops sending and keeps the AI picks across an off and on again', async () => {
  // The switch is the feature, not a shortcut for the list under it. What it must never do is
  // forget the selection: off is something you press to stop a fan-out, and turning it back on has
  // to ask the same AIs it asked before. An off switch that costs a re-selection every time is a
  // switch nobody dares touch, which is exactly what the first version of this one was.
  openAiTab('deepseek');
  await patch({ autoOpenTabs: false, groupTabs: false, singleWindow: false, requireSignIn: false });

  const picked = ['deepseek', 'chatgpt'];
  await patch({ enabledSites: picked.slice() });

  await patch({ broadcastEnabled: false });
  const stopped = await send({ type: WF.MSG.BROADCAST, prompt: 'nobody should see this' });
  assert.equal(stopped.ok, false);
  assert.equal(stopped.reason, 'off');

  const kept = await state();
  assert.deepEqual(kept.settings.enabledSites, picked, 'the off switch left the picks alone');
  assert.equal(kept.settings.requireSignIn, false, 'and the careful-mode switch it sits next to');

  await patch({ broadcastEnabled: true });
  const back = await send({ type: WF.MSG.BROADCAST, prompt: 'and this one goes out' });
  assert.equal(back.ok, true, 'on again means sending again');
  assert.deepEqual(back.targets, picked, 'to exactly the AIs that were picked');

  await send({ type: WF.MSG.CANCEL });
  await waitUntilIdle();
});

test('opening the site list asks the pages, and a stale sign-out corrects itself', async () => {
  // The record a misread leaves behind: signed out, and the check cleared with it. It used to be
  // permanent — the AI was switched off by the bad reading, an off AI's page goes dormant and
  // stops running its timer, and the only thing that could have cleared it was the switch the
  // bad reading had just turned off.
  const tab = openAiTab('kimi');
  await patch({ enabledSites: ['kimi'], requireSignIn: true, autoOpenTabs: false });
  await WF.storage.setSiteStatus({
    kimi: {
      verifiedAt: 0,
      attention: WF.ATTENTION.SIGNED_OUT,
      attentionEvidence: 'Sign in',
      hasComposer: true,
      at: Date.now() - 5 * 60 * 1000,
    },
  });
  assert.equal((await state()).sites.find((site) => site.id === 'kimi').verified, false);

  await send({ type: WF.MSG.GET_STATE, refresh: true });
  await waitFor('the reading to be corrected', (snapshot) => {
    const found = snapshot.sites.find((entry) => entry.id === 'kimi');
    return found && !found.attention && found.verified === true;
  });
  const site = (await state()).sites.find((entry) => entry.id === 'kimi');
  assert.equal(site.enabled, true);
  assert.equal(site.attention, null, 'the page that was there all along is asked, and believed');
  assert.equal(site.openTabs, 1);
  assert.equal((await WF.storage.getSiteStatus()).kimi.verifiedAt > 0, true, 'the check is stamped again');

  // On a clock, so two popup opens in a row do not scan ten pages twice — and on demand, which
  // is what the popup and the dashboard use.
  assert.equal((await WF.bg.engine.refreshStatuses({ force: true })).ran, true);
  assert.equal((await WF.bg.engine.refreshStatuses()).ran, false, 'the sweep is throttled');
  assert.equal((await WF.bg.engine.refreshStatuses({ force: true })).ran, true);
  assert.equal(tab, (await WF.browser.getTab(tab)).id);
});

/**
 * A tab on an AI site where nothing answers, whatever the browser thinks of the origin.
 *
 * No content script and no hello: the two things a granted origin would have and a denied one
 * would not. A test that wants the granted-but-silent case (a page that has not drawn yet)
 * gets it by deleting the reply; the denied case would not have had one anyway.
 */
function openSilentTab(siteId) {
  const site = WF.sites.byId(siteId);
  const id = nextTabId++;
  tabs.set(id, { id, url: site.matchPatterns[0].replace('*', ''), active: false, windowId: USER_WINDOW });
  siteTabs.delete(id);
  return id;
}

test('an AI the browser never let us into says so, and is never blamed on the page', async () => {
  // What kimi.ai looked like on a real Firefox profile: an AI named in the manifest whose
  // origin Firefox had never granted, so the site was silent from the moment it was opened.
  const KIMI = ['https://kimi.ai/*', 'https://www.kimi.ai/*'];
  for (const pattern of KIMI) denyOrigin(pattern);
  try {
    const tab = openSilentTab('kimi');
    await patch({ enabledSites: ['kimi'], requireSignIn: true });

    // Opening the panel asks every AI with a tab open what its page is showing. This one cannot
    // answer at all — so the only question left is whether that is the page's doing.
    const swept = await WF.bg.engine.refreshStatuses({ force: true });
    assert.equal(swept.asked, 0, 'nothing answered');
    assert.equal(swept.changed, 1, 'but the site that cannot answer is now named');

    const status = (await WF.storage.getSiteStatus()).kimi;
    assert.equal(status.attention, WF.ATTENTION.NO_ACCESS);
    assert.equal(status.hasComposer, false);
    assert.equal(status.verifiedAt, 0, 'a site nobody has looked at is not a checked site');

    // And the row the user reads says it, rather than the "message box not found" a page that
    // never showed its box leaves behind — which is what sent people hunting for a redesign.
    const site = (await state()).sites.find((entry) => entry.id === 'kimi');
    assert.equal(site.attention, WF.ATTENTION.NO_ACCESS);
    assert.equal(site.attentionFresh, true);
    assert.equal(WF.attentionLabel(site.attention), 'This browser has not allowed it here');

    // The extension never asks for a permission by itself: Firefox only accepts the request
    // from inside a click, so the asking belongs to the panel's own switch.
    assert.deepEqual(permissionRequests, []);
    assert.equal((await WF.browser.getTab(tab)).id, tab);
  } finally {
    for (const pattern of KIMI) grantOrigin(pattern);
  }
});

test('a silent page the browser does have is left alone, not blamed', async () => {
  // The control for the test above: the same silence, with the grant in place. A page that has
  // not drawn yet has told us nothing, and "nothing" must not be written down as a verdict —
  // otherwise every slow load would put a warning next to an AI that is fine.
  const tab = openSilentTab('kimi');
  await patch({ enabledSites: ['kimi'], requireSignIn: true });

  const swept = await WF.bg.engine.refreshStatuses({ force: true });
  assert.equal(swept.asked, 0, 'nothing answered');
  assert.equal(swept.changed, 0, 'and nothing was invented about it either');
  assert.equal((await WF.storage.getSiteStatus()).kimi, undefined);
  assert.equal(tab, (await WF.browser.getTab(tab)).id);
});
