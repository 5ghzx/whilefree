/**
 * Talk to a running Chromium over the DevTools protocol.
 *
 * The point of this is to test the extension in a real browser without a hand on the
 * mouse: open its popup and dashboard as pages, ask a live AI page whether the content
 * script is running there, and call into the background service worker. It is a dev tool,
 * so it is deliberately tiny and has no dependencies — node 22 has fetch and WebSocket.
 *
 * Start the browser with a debugging port first:
 *
 *   sh scripts/run-chromium.sh --remote-debugging-port=9222
 *
 * Then:
 *
 *   node scripts/cdp.mjs list                        every open target
 *   node scripts/cdp.mjs open <url>                  a new tab, prints its target id
 *   node scripts/cdp.mjs eval <target> <expression>  evaluate in that target, print JSON
 *   node scripts/cdp.mjs sw <expression>             shorthand for the background worker
 *   node scripts/cdp.mjs profile [ms] [target]       sample the main thread and name the hot functions
 *   WF_WORLD=ext node scripts/cdp.mjs eval <target> …   evaluate inside the content script
 *
 * Any expression may be `@path/to/probe.js` instead, which reads it from disk.
 *
 * `<target>` matches on a substring of the url, or on `service_worker` / `page`.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { readFileSync } from 'node:fs';

const PORT = process.env.WF_CDP_PORT || 9222;
const BASE = `http://127.0.0.1:${PORT}`;

let nextId = 1;
const pending = new Map();
/** targetId -> sessionId, so one call can attach and evaluate in a single round trip. */
const sessions = new Map();

function send(ws, method, params, sessionId) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {}, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }
    }, Number(process.env.WF_CDP_TIMEOUT || 20000));
  });
}

async function connect() {
  const version = await fetch(`${BASE}/json/version`).then((r) => r.json());
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error(`no DevTools on ${BASE} — is it running?`)));
  });
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  return ws;
}

async function targets(ws) {
  const { targetInfos } = await send(ws, 'Target.getTargets');
  return targetInfos.filter((t) => t.type !== 'browser');
}

async function attach(ws, targetId) {
  if (sessions.has(targetId)) return sessions.get(targetId);
  const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
  sessions.set(targetId, sessionId);
  return sessionId;
}

/** The extension's own id, from whichever page is open, so `sw` can wake a sleeping worker. */
function extensionId(list) {
  if (process.env.WF_EXT_ID) return process.env.WF_EXT_ID;
  const found = list.find((t) => t.url.startsWith('chrome-extension://'));
  return found ? found.url.split('/')[2] : null;
}

/**
 * A service worker that is not doing anything is stopped, and a stopped worker is not a
 * target. Opening one of the extension's pages is what starts it, which is also what
 * happens when a human clicks the toolbar icon.
 */
async function wakeWorker(ws, list) {
  const id = extensionId(list);
  if (!id) throw new Error('no extension page open to learn the id from — set WF_EXT_ID');
  await send(ws, 'Target.createTarget', { url: `chrome-extension://${id}/popup/popup.html` });
  await sleep(1500);
  return targets(ws);
}

function pick(list, wanted) {
  if (!wanted) return list[0];
  // Live sites register service workers of their own, so "service_worker" has to mean the
  // extension's worker, not whichever site happened to be looked at first.
  if (wanted === 'service_worker') {
    const own = list.find((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://'));
    if (own) return own;
  }
  const matches = list
    .filter((t) => t.url.includes(wanted) || t.type === wanted || t.targetId.startsWith(wanted))
    // Sites register service workers of their own, and a worker's url contains the site's
    // name in the same way a page's does. "perplexity" has to mean the page.
    .sort((a, b) => (a.type === 'page' ? -1 : 0) - (b.type === 'page' ? -1 : 0));
  if (!matches.length) {
    throw new Error(
      `no target matching "${wanted}"\n${list.map((t) => `  ${t.type} ${t.url}`).join('\n')}`
    );
  }
  return matches[0];
}

/**
 * `@file` instead of an expression: shell quoting around selectors is a minefield, and a
 * probe worth running twice is worth keeping as a file.
 */
function expression(source) {
  if (!source || !source.startsWith('@')) return source;
  return readFileSync(source.slice(1), 'utf8');
}

/**
 * The isolated world a content script runs in.
 *
 * A page's own JavaScript cannot see `WF`, so an evaluation in the page's main world says
 * the extension is not there even when it is. Content scripts get their own execution
 * context, named after the extension that owns it, and that is the world to ask.
 */
async function extensionWorld(ws, sessionId, id) {
  const contexts = [];
  const onMessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.executionContextCreated') contexts.push(msg.params.context);
  };
  // Runtime.enable replays the contexts that already exist, so this is not a race.
  ws.addEventListener('message', onMessage);
  await send(ws, 'Runtime.enable', {}, sessionId);
  await sleep(250);
  ws.removeEventListener('message', onMessage);
  // The world is named after the extension, but named by hand: match the origin instead of
  // the label, so renaming the extension does not break the tool.
  const isolated = contexts.filter((c) => c.auxData && c.auxData.isDefault === false);
  const wanted = id
    ? isolated.find((c) => String(c.origin || '').startsWith(`chrome-extension://${id}`))
    : // No extension page is open to learn the id from, so any isolated world on this page
      // that belongs to an extension will do. Without this, a probe works only while a popup
      // happens to be open, which is a tool that lies about its own failures.
      isolated.find((c) => String(c.origin || '').startsWith('chrome-extension://'));
  return wanted ? wanted.id : null;
}

/** Every execution context on a target, so `WF_WORLD=ext` can be pointed at the right one. */
async function listContexts(ws, target) {
  const sessionId = await attach(ws, target.targetId);
  const contexts = [];
  const onMessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.method === 'Runtime.executionContextCreated') contexts.push(msg.params.context);
  };
  ws.addEventListener('message', onMessage);
  await send(ws, 'Runtime.enable', {}, sessionId);
  await sleep(300);
  ws.removeEventListener('message', onMessage);
  return contexts.map((c) => ({
    id: c.id,
    name: c.name,
    origin: c.origin,
    default: !!(c.auxData && c.auxData.isDefault),
  }));
}

/**
 * Sample this target for `ms` and report where its main thread went.
 *
 * The point is to name the hot function instead of guessing: a content script that looks
 * cheap can still sit on a page whose DOM is enormous. Self time is the useful column —
 * time inside a function, not in what it called.
 */
async function profile(ws, target, ms, extId) {
  const sessionId = await attach(ws, target.targetId);
  await send(ws, 'Profiler.enable', {}, sessionId);
  await send(ws, 'Profiler.setSamplingInterval', { interval: 200 }, sessionId);
  await send(ws, 'Profiler.start', {}, sessionId);
  await sleep(ms);
  const { profile: captured } = await send(ws, 'Profiler.stop', {}, sessionId);

  const byId = new Map(captured.nodes.map((n) => [n.id, n]));
  const self = new Map();
  const ticks = captured.samples ? captured.samples.length : 0;
  const micros = (captured.timeDeltas || []).reduce((a, b) => a + b, 0);
  for (let i = 0; i < (captured.samples || []).length; i += 1) {
    const node = byId.get(captured.samples[i]);
    if (!node) continue;
    const frame = node.callFrame;
    const key = `${frame.functionName || '(anonymous)'} — ${String(frame.url || '').replace(/^chrome-extension:\/\/[^/]+/, 'ext')}:${frame.lineNumber + 1}`;
    const delta = (captured.timeDeltas || [])[i] || 0;
    const entry = self.get(key) || { ms: 0, samples: 0 };
    entry.ms += delta / 1000;
    entry.samples += 1;
    self.set(key, entry);
  }

  const rows = [...self.entries()]
    .sort((a, b) => b[1].ms - a[1].ms)
    .slice(0, Number(process.env.WF_PROFILE_TOP || 22))
    .map(([key, value]) => ({ key, ms: Math.round(value.ms), samples: value.samples }));

  const ourMs = rows.filter((r) => r.key.includes('ext')).reduce((a, r) => a + r.ms, 0);
  return { samples: ticks, totalMs: Math.round(micros / 1000), ofOursMs: ourMs, extId: extId || null, rows };
}

async function evaluate(ws, target, expression, world) {
  const sessionId = await attach(ws, target.targetId);
  let contextId = null;
  if (world === 'ext') {
    const list = await targets(ws);
    // A page that is still loading has no content script yet. Waiting a moment beats
    // re-running the command, which is how a slow site looks like a broken tool.
    for (let attempt = 0; attempt < 6 && !contextId; attempt += 1) {
      if (attempt) await sleep(700);
      contextId = await extensionWorld(ws, sessionId, extensionId(list));
    }
    if (!contextId) throw new Error('no content-script world on this page (WF is main-world only?)');
  }
  const result = await send(
    ws,
    'Runtime.evaluate',
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
      ...(contextId ? { contextId } : {}),
    },
    sessionId
  );
  if (result.exceptionDetails) {
    const text =
      (result.exceptionDetails.exception && result.exceptionDetails.exception.description) ||
      result.exceptionDetails.text;
    throw new Error(text);
  }
  return result.result.value;
}

const [command, ...args] = process.argv.slice(2);
const ws = await connect();

if (command === 'list') {
  for (const t of await targets(ws)) console.log(`${t.type.padEnd(16)} ${t.url}`);
} else if (command === 'open') {
  const { targetId } = await send(ws, 'Target.createTarget', { url: args[0] });
  // A page needs a moment before it has a document to evaluate in.
  await sleep(1200);
  console.log(targetId);
} else if (command === 'close') {
  const target = pick(await targets(ws), args[0]);
  await send(ws, 'Target.closeTarget', { targetId: target.targetId });
  console.log(`closed ${target.url}`);
} else if (command === 'profile') {
  const ms = Number(args[0] || 10000);
  const want = args[1];
  let list = await targets(ws);
  const target = pick(list, want);
  console.log(JSON.stringify(await profile(ws, target, ms, extensionId(list)), null, 1));
} else if (command === 'worlds') {
  const target = pick(await targets(ws), args[0]);
  console.log(JSON.stringify(await listContexts(ws, target), null, 1));
} else if (command === 'eval' || command === 'sw') {
  const wanted = command === 'sw' ? 'service_worker' : args[0];
  const source = expression(command === 'sw' ? args[0] : args.slice(1).join(' '));
  let list = await targets(ws);
  if (command === 'sw' && !list.some((t) => t.type === 'service_worker')) list = await wakeWorker(ws, list);
  const target = pick(list, wanted);
  console.log(JSON.stringify(await evaluate(ws, target, source, process.env.WF_WORLD || 'main'), null, 1));
} else {
  console.error('usage: cdp.mjs list | open <url> | close <target> | eval <target> <js> | sw <js>');
  process.exit(1);
}

ws.close();
process.exit(0);
