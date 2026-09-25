/**
 * Talk to a running Firefox over its DevTools protocol, to reach the worlds the extension
 * actually runs in.
 *
 * Why there are two tools: WebDriver BiDi (scripts/bidi.mjs) addresses a page and its own
 * world, and that is all it will admit to existing — `script.getRealms` on a page with a
 * content script in it lists exactly one realm, the page's. The isolated world a content script
 * lives in is not a realm BiDi has a name for, so the question "what does our own code see
 * here" cannot be asked through the port that replaces CDP. Firefox's DevTools protocol can:
 * it has content-script targets, one per (extension, document), each with a console actor that
 * evaluates in that sandbox with `WF` in scope. It is also the protocol about:debugging uses,
 * so what this tool does is what a human clicking around there would be doing.
 *
 * Start the browser with the devtools server open (scripts/run-firefox.sh does both ports):
 *
 *   Firefox 157 ignores --start-debugger-server unless devtools.debugger.remote-enabled and
 *   devtools.chrome.enabled are both true, and says so in a console error rather than failing.
 *
 * Then:
 *
 *   node scripts/rdp.mjs tabs                     the tab descriptors, with their actors
 *   node scripts/rdp.mjs addons                   installed add-ons, with their actors
 *   node scripts/rdp.mjs worlds <tab>             the content-script worlds in one tab
 *   node scripts/rdp.mjs eval <tab> <js|@file>    evaluate in the extension's world in that tab
 *   node scripts/rdp.mjs bg <addon> <js|@file>    evaluate in the add-on's own background world
 *   node scripts/rdp.mjs install <dir|xpi>        load a build as a temporary add-on (hot reload)
 *   node scripts/rdp.mjs reload [addon]           re-read a temporary add-on's files from disk
 *
 * `install` is the answer to the one thing that makes Firefox development miserable: an add-on
 * installed into a profile from its `extensions/` directory is read *once*, at startup, so every
 * edit to a popup or a content script costs a browser restart. A temporary add-on is read from
 * the directory it was loaded from, and `reload` re-reads it in place — the popup's HTML, its
 * scripts and the background page all come back as the build on disk, with the same add-on id
 * and the same moz-extension:// URL. It lives until the browser exits, which is the trade: the
 * profile copy is what survives a restart, this is what survives an edit.
 *
 * `<tab>` matches on a substring of the tab's url or on its title; `<addon>` on the add-on's id.
 * WF_ADDON_ID picks which extension's content script counts as ours (default
 * whilefree@whilefree.app); WF_WORLD=page evaluates in the page's own world instead, which is
 * the control for any reading taken in ours.
 *
 * An expression file may carry a second half, which is what makes an asynchronous reading
 * possible in a world with no top-level await — and that applies to `bg` as much as to `eval`: the console actor evaluates and returns, and a promise
 * cannot be waited on through it (evaluateJSAsync's `awaitResult` path is only taken when the
 * client has mapped a top-level `await`, which a plain `mapped` object does not do). So a probe
 * that needs to watch a page for a few seconds starts the wait, returns what it has, and leaves
 * the answer somewhere for a later evaluation:
 *
 *   JSON.stringify(readingNow());          // first half, printed immediately
 *   // ::after 3000
 *   JSON.stringify(globalThis.__wfReading) // second half, printed after 3s
 *
 * A packet is `<byteLength>:<json>`, and the first packet on every connection is the root form
 * — a greeting, not a reply to anything.
 */
import { connect } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const HOST = process.env.WF_RDP_HOST || '127.0.0.1';
const PORT = Number(process.env.WF_RDP_PORT || 6000);
const ADDON = process.env.WF_ADDON_ID || 'whilefree@whilefree.app';
const TIMEOUT = Number(process.env.WF_RDP_TIMEOUT || 15000);

class Devtools {
  constructor() {
    this.socket = connect({ host: HOST, port: PORT });
    this.buffer = Buffer.alloc(0);
    this.events = [];
    this.waiters = [];
    this.nextId = 1;
    this.ready = new Promise((resolve, reject) => {
      this.socket.on('connect', resolve);
      this.socket.on('error', reject);
    });
    this.socket.on('data', (chunk) => this.#read(chunk));
  }

  #read(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const colon = this.buffer.indexOf(0x3a);
      if (colon < 0) break;
      const length = Number(this.buffer.subarray(0, colon).toString('utf8'));
      const start = colon + 1;
      if (!Number.isFinite(length) || this.buffer.length < start + length) break;
      const body = this.buffer.subarray(start, start + length).toString('utf8');
      this.buffer = this.buffer.subarray(start + length);
      let packet;
      try {
        packet = JSON.parse(body);
      } catch (err) {
        continue;
      }
      // The greeting: every connection opens with the root form. It is the only packet with no
      // type and a testConnectionPrefix, and mistaking it for a reply is how a first request
      // comes back looking like the root actor.
      if (packet.testConnectionPrefix) continue;
      this.events.push(packet);
      for (const waiter of this.waiters.slice()) {
        if (!waiter.match(packet)) continue;
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(packet);
      }
    }
  }

  send(packet) {
    const body = JSON.stringify(packet);
    this.socket.write(`${Buffer.byteLength(body)}:${body}`);
  }

  /** A request, resolved by the reply from the actor asked — which is a packet with no type. */
  request(packet, { timeoutMs = TIMEOUT } = {}) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${packet.to}: no reply to ${packet.type} in ${timeoutMs}ms`)), timeoutMs);
      this.waiters.push({
        match: (p) => p.from === packet.to && !p.type,
        resolve: (p) => {
          clearTimeout(timer);
          // Every actor reports failures as `{error, message}` in a normal reply.
          if (p.error) reject(new Error(`${packet.to}.${packet.type}: ${p.message || p.error}`));
          else resolve(p);
        },
      });
      this.send(packet);
    });
  }

  /** An event, resolved by the one that matches — including one that arrived before asking. */
  waitFor(type, predicate, { timeoutMs = TIMEOUT } = {}) {
    const match = (p) => p.type === type && (!predicate || predicate(p));
    return new Promise((resolve, reject) => {
      const already = this.events.find(match);
      if (already) {
        resolve(already);
        return;
      }
      const timer = setTimeout(() => reject(new Error(`no ${type} event in ${timeoutMs}ms`)), timeoutMs);
      this.waiters.push({ match, resolve: (p) => { clearTimeout(timer); resolve(p); } });
    });
  }

  /**
   * Evaluate `text` in a console actor's world, and resolve with the value.
   *
   * The reply to `evaluateJSAsync` is only a receipt: the value arrives in a separate
   * `evaluationResult` event carrying the resultID the server chose.
   */
  async evaluate(consoleActor, text) {
    // `mapped.await` is the flag a client sets when it rewrote a top-level `await` into a promise
    // chain. Sending it ourselves is what makes the server do the waiting for us: without it the
    // reply to an expression whose value is a promise is a grip on the unsettled promise, and a
    // probe that reads a page for two seconds comes back as `class: "Promise"`. The text is not
    // rewritten by this — the flag only asks the server to await whatever comes back.
    const reply = await this.request({ to: consoleActor, type: 'evaluateJSAsync', text, eager: false, mapped: { await: true } });
    const event = await this.waitFor('evaluationResult', (p) => p.resultID === reply.resultID);
    if (event.hasException) {
      const message = event.exceptionMessage || (event.exception && event.exception.preview && event.exception.preview.message) || 'evaluation failed';
      throw new Error(`${message}${event.exceptionStack ? `\n${event.exceptionStack}` : ''}`);
    }
    return this.#resolveGrip(event.result);
  }

  /** A string longer than the grip's short form arrives in pieces, by actor. */
  async #resolveGrip(grip) {
    if (grip && grip.type === 'longString') {
      const { substring } = await this.request({ to: grip.actor, type: 'substring', start: 0, end: grip.length });
      return substring;
    }
    return grip;
  }

  close() {
    this.socket.destroy();
  }
}

function expression(source) {
  if (!source || !source.startsWith('@')) return source;
  return readFileSync(source.slice(1), 'utf8');
}

/** Split a probe file into the half to run now and the half to run after a pause. */
function halves(source) {
  const marker = /^[ \t]*\/\/[ \t]*::after[ \t]+(\d+)[ \t]*$/m;
  const match = marker.exec(source);
  if (!match) return [{ text: source, after: 0 }];
  return [
    { text: source.slice(0, match.index), after: Number(match[1]) },
    { text: source.slice(match.index + match[0].length), after: 0 },
  ];
}

function show(label, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 1);
  console.log(`${label}: ${text === undefined ? 'undefined' : text}`);
}

/** The tab descriptor for a url fragment or a title. */
function pickTab(tabs, wanted) {
  const matches = tabs.filter((t) => (t.url || '').includes(wanted) || (t.title || '').includes(wanted) || t.actor === wanted);
  if (!matches.length) {
    throw new Error(`no tab matching "${wanted}"\n${tabs.map((t) => `  ${t.actor}  ${t.isZombieTab ? '(zombie) ' : ''}${t.title}  ${t.url}`).join('\n')}`);
  }
  return matches[matches.length - 1];
}

/** A watcher on a tab, whose session context is what decides which target types exist. */
async function tabWatcher(tools, tab) {
  const reply = await tools.request({ to: tab.actor, type: 'getWatcher', isServerTargetSwitchingEnabled: true });
  const watcher = reply.watcher || reply.actor;
  if (!watcher) throw new Error(`no watcher from ${tab.actor}: ${JSON.stringify(reply)}`);
  return watcher;
}

/**
 * The content-script target of our extension in this tab.
 *
 * Content-script targets only exist for sessions that watch a *tab* (or everything) — never
 * for the extension's own watcher, which is a deliberate fork in Firefox: an extension toolbox
 * does not show its own content scripts. So the way in is per tab, and the extension is picked
 * out of the forms by addonId.
 */
async function contentWorld(tools, watcher, { addonId = ADDON, url } = {}) {
  await tools.request({ to: watcher, type: 'watchTargets', targetType: 'content_script' });
  const event = await tools.waitFor('target-available-form', (p) => p.target.addonId === addonId, {
    // A tab that has just loaded has no content script yet; the target appears when it does.
    timeoutMs: Number(process.env.WF_RDP_SCRIPT_WAIT || 12000),
  });
  return event.target;
}

/** The page's own top-level world in this tab, for the control reading. */
async function pageWorld(tools, watcher) {
  await tools.request({ to: watcher, type: 'watchTargets', targetType: 'frame' });
  const event = await tools.waitFor('target-available-form', (p) => p.target.isTopLevelTarget);
  return event.target;
}

const [command, ...args] = process.argv.slice(2);
const tools = new Devtools();
await tools.ready;

if (command === 'tabs') {
  const { tabs } = await tools.request({ to: 'root', type: 'listTabs' });
  for (const tab of tabs) console.log(`${tab.actor}  ${tab.isZombieTab ? '(zombie) ' : ''}${tab.title}  ${tab.url}`);
} else if (command === 'addons') {
  const { addons } = await tools.request({ to: 'root', type: 'listAddons' });
  for (const addon of addons) {
    console.log(`${addon.actor}  ${addon.debuggable ? 'debuggable' : 'not so'}  ${addon.id}  ${addon.name}`);
  }
} else if (command === 'install') {
  const addonPath = args[0];
  if (!addonPath) throw new Error('usage: rdp.mjs install <directory-with-manifest.json|xpi>');
  const path = resolve(addonPath);
  // The reply is the add-on's form, or a refusal: Firefox will not run two copies of one add-on
  // and says so as an error rather than silently picking one, which is worth reading rather than
  // guessing at.
  const { addon } = await tools.request({ to: 'root', type: 'installTemporaryAddon', addonPath: path });
  show('installed', `${addon.id} ${addon.name}${addon.temporary ? ' (temporary)' : ''}`);
} else if (command === 'reload') {
  const { addons } = await tools.request({ to: 'root', type: 'listAddons' });
  const wanted = args[0] || ADDON;
  const addon = addons.find((a) => a.id === wanted || a.actor === wanted);
  if (!addon) throw new Error(`no add-on matching "${wanted}"\n${addons.map((a) => `  ${a.actor}  ${a.id}`).join('\n')}`);
  await tools.request({ to: addon.actor, type: 'reload' });
  show('reloaded', addon.id);
} else if (command === 'worlds') {
  const { tabs } = await tools.request({ to: 'root', type: 'listTabs' });
  const tab = pickTab(tabs, args[0]);
  const watcher = await tabWatcher(tools, tab);
  await tools.request({ to: watcher, type: 'watchTargets', targetType: 'content_script' });
  await sleep(Number(process.env.WF_RDP_SETTLE_MS || 1500));
  const forms = tools.events.filter((p) => p.type === 'target-available-form').map((p) => p.target);
  console.log(`${tab.title}  ${tab.url}`);
  for (const form of forms) {
    console.log(`  ${form.addonId}  innerWindowId=${form.innerWindowId}  console=${form.consoleActor}  ${form.title}`);
  }
} else if (command === 'eval' || command === 'bg') {
  const wanted = args[0];
  const source = expression(args.slice(1).join(' '));
  if (command === 'bg') {
    const { addons } = await tools.request({ to: 'root', type: 'listAddons' });
    const addon = addons.find((a) => a.id === wanted || a.actor === wanted);
    if (!addon) throw new Error(`no add-on matching "${wanted}"\n${addons.map((a) => `  ${a.actor}  ${a.id}`).join('\n')}`);
    // The extension's watcher is scoped to the add-on's own documents, so its frame targets are
    // the background page and whatever extension pages are open — not web pages. There is more
    // than one (the event page and the empty document Firefox keeps for the add-on when it is
    // idle), and only the real one has `browser`, so each is asked and its answer labelled.
    const reply = await tools.request({ to: addon.actor, type: 'getWatcher', isServerTargetSwitchingEnabled: true });
    const watcher = reply.watcher || reply.actor;
    await tools.request({ to: watcher, type: 'watchTargets', targetType: 'frame' });
    await sleep(Number(process.env.WF_RDP_SETTLE_MS || 1500));
    const forms = tools.events.filter((p) => p.type === 'target-available-form').map((p) => p.target);
    // The same two-half trick as `eval`: a probe that has to watch something for a while needs
    // the first half to return before the answer exists. Sending the whole file as one
    // expression instead runs both halves at once, which reads the state you were waiting to
    // see change — a mistake that looks like the extension being broken.
    for (const half of halves(source)) {
      if (half.after) await sleep(Number(process.env.WF_RDP_AFTER || half.after));
      for (const form of forms) {
        try {
          show(`${form.url || form.actor}`, await tools.evaluate(form.consoleActor, half.text));
        } catch (err) {
          console.error(`${form.url || form.actor}: ${err.message}`);
        }
      }
    }
  } else {
    const { tabs } = await tools.request({ to: 'root', type: 'listTabs' });
    const tab = pickTab(tabs, wanted);
    const watcher = await tabWatcher(tools, tab);
    const target = process.env.WF_WORLD === 'page' ? await pageWorld(tools, watcher) : await contentWorld(tools, watcher);
    for (const half of halves(source)) {
      if (half.after) await sleep(Number(process.env.WF_RDP_AFTER || half.after));
      show('reading', await tools.evaluate(target.consoleActor, half.text));
    }
  }
} else {
  console.error(
    'usage: rdp.mjs tabs | addons | worlds <tab> | eval <tab> <js|@file> | bg <addon> <js|@file> | install <dir> | reload [addon]'
  );
  process.exitCode = 1;
}

tools.close();
process.exit(process.exitCode || 0);
