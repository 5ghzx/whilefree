/**
 * What we delivered, as fingerprints.
 *
 * Two decisions need to know whether a prompt has been seen before, and neither of them
 * needs the prompt itself:
 *
 *   1. A prompt typed into an AI's own message box is usually us: we put it there a
 *      moment ago and the site is echoing it back as a user message. Fanning that out
 *      again would send it twice, so an echo is dropped.
 *   2. A retry after a failed send must know whether the prompt already landed, or it
 *      double-posts.
 *
 * So this holds `hash -> {at, source}` and nothing else. Session storage, because it is
 * about the last few minutes and should not outlive the browser: no prompt text, no
 * lasting record of what you asked, gone on restart.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});
  const bg = (WF.bg = WF.bg || {});
  const B = WF.browser;

  const KEY = 'wf:ledger';
  const TTL_MS = 10 * 60 * 1000;
  const MAX = 200;

  let chain = Promise.resolve();

  /** One serialized mutation chain, so two fan-outs cannot clobber each other. */
  function mutate(fn) {
    chain = chain.then(fn, fn).catch(() => undefined);
    return chain;
  }

  function prune(map, now) {
    const entries = Object.entries(map || {}).filter(
      ([, value]) => value && typeof value.at === 'number' && now - value.at < TTL_MS
    );
    entries.sort((a, b) => b[1].at - a[1].at);
    return Object.fromEntries(entries.slice(0, MAX));
  }

  async function raw() {
    const stored = await B.sessionGet(KEY);
    return stored && typeof stored === 'object' ? stored : {};
  }

  async function load(now) {
    const nowMs = now || Date.now();
    const map = prune(await raw(), nowMs);
    return map;
  }

  async function save(map) {
    await B.sessionSet(KEY, map);
    return map;
  }

  /** Record that we put this prompt into that conversation. */
  function remember(hash, siteId, source) {
    if (!hash) return Promise.resolve(null);
    return mutate(async () => {
      const now = Date.now();
      const map = await load(now);
      map[hash] = { at: now, siteId: siteId || null, source: source || 'delivery' };
      await save(map);
      return map[hash];
    });
  }

  /** The raw record for a prompt, so a caller can judge how recent it needs it to be. */
  async function entry(hash) {
    if (!hash) return null;
    const map = await load();
    return map[hash] || null;
  }

  /** Did we deliver this prompt to this site in the last few minutes? */
  async function has(hash, siteId) {
    if (!hash) return false;
    const map = await load();
    const entry = map[hash];
    if (!entry) return false;
    if (siteId === undefined || siteId === null) return true;
    return entry.siteId === null || entry.siteId === siteId;
  }

  /** Every site we delivered this prompt to. Used to spot a capture of our own fan-out. */
  async function sitesFor(hash) {
    const map = await load();
    const entry = map[hash];
    return entry ? [entry.siteId].filter(Boolean) : [];
  }

  function forget(hash) {
    return mutate(async () => {
      const map = await load();
      delete map[hash];
      await save(map);
      return true;
    });
  }

  function clear() {
    return mutate(async () => {
      await save({});
      return true;
    });
  }

  async function size() {
    return Object.keys(await load()).length;
  }

  bg.ledger = { remember, has, entry, sitesFor, forget, clear, size, TTL_MS, MAX };
})();
