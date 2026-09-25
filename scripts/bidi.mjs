/**
 * Talk to a running Firefox over WebDriver BiDi.
 *
 * The counterpart to scripts/cdp.mjs, and not a port of it. Chromium's DevTools protocol and
 * Firefox's Remote Agent are different protocols with different ideas about what a "target"
 * is: CDP attaches a session to a target and can reach any execution context inside it,
 * including a content script's world, while BiDi addresses a browsing context or a realm and
 * reaches only the realms it will admit to. So this tool does what BiDi can do — list and drive
 * pages, evaluate in a page's own world, read the console — and `scripts/rdp.mjs` does the rest:
 * the extension's background page and the isolated world a content script runs in, both of
 * which are DevTools-protocol business on Firefox.
 *
 * Start the browser first:
 *
 *   sh scripts/run-firefox.sh
 *
 * Then:
 *
 *   node scripts/bidi.mjs status                     what the agent says about sessions
 *   node scripts/bidi.mjs list                       every browsing context, with its id
 *   node scripts/bidi.mjs realms [target]            the realms one context admits to
 *   node scripts/bidi.mjs open <url> [--background]  a new tab, prints its context id
 *   node scripts/bidi.mjs close <target>             close a tab
 *   node scripts/bidi.mjs eval <target> <js>         evaluate in that tab's own world
 *   node scripts/bidi.mjs logs [target]              the page's console messages, newest last
 *   node scripts/bidi.mjs raw <method> [json]        any protocol method, printed as-is
 *
 * Any expression may be `@path/probe.js` instead, which reads it from disk, and any command's
 * last argument may be a browsing context id instead of a url substring.
 *
 * `<target>` matches on a substring of the context's url, or on its id.
 *
 * One session at a time, and the agent means it: `session.new` answers "Maximum number of
 * active sessions" while another exists, and — unlike Chromium, which drops a target's
 * session when the client's socket closes — a Firefox session outlives the socket that made
 * it. Reconnecting does not adopt it and a cold `session.end` is told "invalid session id",
 * so a client that dies without ending its session holds the slot until the browser is
 * restarted. Every command here therefore ends its session on the way out, and the failure
 * to connect says so out loud rather than timing out.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { readFileSync } from 'node:fs';

const PORT = process.env.WF_BIDI_PORT || 9223;
const URL = `ws://127.0.0.1:${PORT}/session`;

let nextId = 1;
const pending = new Map();

/** Everything the page said, so `logs` can report what the content script's page logged. */
const events = [];
const subscribed = new Set();

function open() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.addEventListener('open', () => resolve(ws), { once: true });
    ws.addEventListener('error', () => reject(new Error(`no Remote Agent on ${URL} — is Firefox running with --remote-debugging-port?`)), { once: true });
  });
}

function send(ws, method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: params || {} }));
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${method} timed out`));
      }
    }, Number(process.env.WF_BIDI_TIMEOUT || 30000));
  });
}

function wire(ws) {
  ws.addEventListener('message', (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (err) {
      return;
    }
    if (msg.type === 'event') {
      events.push(msg);
      return;
    }
    if (!msg.id || !pending.has(msg.id)) return;
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.type === 'error' || msg.error) reject(new Error(msg.message || msg.error));
    else resolve(msg.result || {});
  });
}

/**
 * A session. The one command this tool does not route through `send`, because there is no
 * session yet to route it through.
 */
async function connect() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const ws = await open();
    try {
      const id = nextId++;
      const answer = new Promise((resolve, reject) => {
        const onMessage = (event) => {
          const msg = JSON.parse(event.data);
          if (msg.id !== id) return;
          ws.removeEventListener('message', onMessage);
          resolve(msg);
        };
        ws.addEventListener('message', onMessage);
        setTimeout(() => reject(new Error('session.new timed out')), 10000);
      });
      ws.send(JSON.stringify({ id, method: 'session.new', params: { capabilities: { alwaysMatch: {} } } }));
      const reply = await answer;
      if (reply.type === 'error') {
        const text = reply.message || 'session.new failed';
        if (/active sessions/i.test(text)) {
          throw new Error(
            'the Remote Agent already holds a session: a client died without ending its\n' +
              'session and Firefox does not release it — restart Firefox to get the slot back'
          );
        }
        throw new Error(text);
      }
      wire(ws);
      return ws;
    } catch (err) {
      ws.close();
      if (attempt === 2 || /Remote Agent already holds/.test(err.message)) throw err;
      await sleep(500);
    }
  }
  throw new Error('unreachable');
}

/**
 * Give the session back before exiting.
 *
 * This is not politeness, it is the only way the next command can work: see the note at the
 * top. The wait for `close` matters too — exiting the instant `close()` is called is what
 * leaves the frame unsent and the session behind.
 */
async function release(ws) {
  try {
    await send(ws, 'session.end', {});
  } catch (err) {
    // A command that already ended the session, or one that never started it, is not a
    // failure here; the socket is about to go regardless.
  }
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 1000);
    ws.addEventListener('close', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    ws.close();
  });
}

/** A connection that has no session of its own, for the one command that must ask about one. */
async function status(ws) {
  const answer = await send(ws, 'session.status', {});
  return answer;
}

async function contexts(ws) {
  const { contexts: list } = await send(ws, 'browsingContext.getTree', {});
  const flat = [];
  const walk = (nodes) => {
    for (const node of nodes || []) {
      flat.push(node);
      walk(node.children);
    }
  };
  walk(list);
  return flat.filter((c) => !c.url.startsWith('about:') || c.url === 'about:blank');
}

function pick(list, wanted) {
  if (!wanted) {
    if (!list.length) throw new Error('no browsing contexts');
    return list[0];
  }
  const matches = list.filter((c) => c.context === wanted || (c.url || '').includes(wanted));
  if (!matches.length) {
    throw new Error(
      `no context matching "${wanted}"\n${list.map((c) => `  ${c.context} ${c.url}`).join('\n')}`
    );
  }
  return matches[matches.length - 1];
}

function expression(source) {
  if (!source || !source.startsWith('@')) return source;
  return readFileSync(source.slice(1), 'utf8');
}

/** Unwrap a BiDi remote value into something worth printing. `type: 'undefined'` is not JSON. */
function value(result) {
  if (!result) return null;
  if (result.type === 'undefined') return undefined;
  if ('value' in result) return result.value;
  return result;
}

async function evaluate(ws, context, source) {
  const outcome = await send(ws, 'script.evaluate', {
    expression: source,
    target: { context },
    awaitPromise: true,
    userActivation: true,
  });
  if (outcome.type === 'exception') {
    const detail = outcome.exceptionDetails;
    throw new Error(`${detail.text || 'evaluation failed'}: ${value(detail.exception) ?? ''}`);
  }
  return value(outcome.result);
}

/**
 * The commands, in one function so that the session can be handed back in a `finally`.
 *
 * A command that throws used to exit without ending its session, which on this agent is not
 * a failed command but a browser that no client can use again until it restarts. The
 * finally is the fix, and it is the reason this is a function rather than a free-standing
 * if-chain.
 */
async function run(ws, command, args) {
if (command === 'status') {
  // Reported, not trusted: Firefox answers `ready: false, "Session already started"` on a
  // browser that has never had a client, so this says what the agent says and nothing more.
  // The signal that a session is really held is `session.new` failing.
  console.log(JSON.stringify(await status(ws), null, 1));
} else if (command === 'list') {
  const list = await contexts(ws);
  for (const c of list) console.log(`${c.context}  ${c.url}`);
} else if (command === 'realms') {
  const target = pick(await contexts(ws), args[0]);
  const { realms } = await send(ws, 'script.getRealms', { context: target.context });
  for (const r of realms) console.log(`${r.realm}  ${r.type}  ${r.origin || ''}`);
} else if (command === 'open') {
  const background = args.includes('--background');
  const url = args.filter((a) => a !== '--background')[0];
  if (!subscribed.has('log')) {
    await send(ws, 'session.subscribe', { events: ['log.entryAdded'] });
    subscribed.add('log');
  }
  const { context } = await send(ws, 'browsingContext.create', { type: 'tab', ...(background ? { background: true } : {}) });
  // A failed navigation is the whole answer for a probe run — print it. A tab that sits at
  // about:blank because the url was refused looks exactly like a page that loaded nothing.
  try {
    await send(ws, 'browsingContext.navigate', { context, url, wait: 'complete' });
  } catch (err) {
    console.error(`could not open ${url}: ${err.message}`);
  }
  console.log(context);
} else if (command === 'close') {
  const target = pick(await contexts(ws), args[0]);
  await send(ws, 'browsingContext.close', { context: target.context });
  console.log(`closed ${target.url}`);
} else if (command === 'eval') {
  const list = await contexts(ws);
  const target = pick(list, args[0]);
  console.log(JSON.stringify(await evaluate(ws, target.context, expression(args.slice(1).join(' '))), null, 1));
} else if (command === 'logs') {
  const target = args[0] ? pick(await contexts(ws), args[0]) : null;
  await send(ws, 'session.subscribe', { events: ['log.entryAdded'] });
  await sleep(Number(process.env.WF_BIDI_LOGS_MS || 1200));
  const wanted = (e) => !target || e.source.context === target.context;
  for (const e of events.filter((x) => x.method === 'log.entryAdded' && wanted(x.params))) {
    const entry = e.params;
    console.log(`${entry.level}  ${entry.source.context || ''}  ${entry.text}`);
  }
} else if (command === 'raw') {
  const params = args[1] ? JSON.parse(args[1]) : {};
  console.log(JSON.stringify(await send(ws, args[0], params), null, 1));
} else {
  throw new Error('usage: bidi.mjs status | list | realms [target] | open <url> | close <target> | eval <target> <js> | logs [target] | raw <method> [json]');
}
}

const [command, ...args] = process.argv.slice(2);
const ws = await connect();
let failed = false;
try {
  await run(ws, command, args);
} catch (err) {
  failed = true;
  console.error(err.message || String(err));
} finally {
  await release(ws);
}
process.exit(failed ? 1 : 0);
