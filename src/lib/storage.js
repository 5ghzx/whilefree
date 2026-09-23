/** Persistent storage: schema, accessors, export/import. */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});
  const B = WF.browser;

  const KEYS = {
    settings: 'wf:settings',
    stats: 'wf:stats',
    events: 'wf:events',
    answers: 'wf:answers',
    queue: 'wf:queue',
    siteStatus: 'wf:site-status',
    meta: 'wf:meta',
  };

  const SCHEMA_VERSION = 1;

  // The shapes live in lib/stats.js, with the maths that reads them, so the two can
  // never drift. Storage is only responsible for persistence.
  const emptySiteCounters = () => WF.stats.emptyCounters();
  const emptyStats = (now) => WF.stats.emptyStats(now);
  const emptyDay = () => WF.stats.emptyDay();

  async function getSettings() {
    const raw = await B.storageGet(KEYS.settings);
    return WF.settings.normalize(raw);
  }

  async function setSettings(patch) {
    const current = await getSettings();
    const next = WF.settings.normalize(WF.util.deepMerge(current, patch));
    await B.storageSet(KEYS.settings, next);
    return next;
  }

  async function getStats() {
    const raw = await B.storageGet(KEYS.stats);
    if (!raw || typeof raw !== 'object') return emptyStats();
    raw.days = raw.days || {};
    raw.heat = raw.heat || {};
    raw.siteTotals = raw.siteTotals || {};
    return raw;
  }

  async function setStats(stats) {
    await B.storageSet(KEYS.stats, stats);
  }

  async function getEvents() {
    const raw = await B.storageGet(KEYS.events);
    return Array.isArray(raw) ? raw : [];
  }

  async function setEvents(events) {
    await B.storageSet(KEYS.events, events);
  }

  async function appendEvent(event, retention) {
    const events = await getEvents();
    events.push(event);
    const cap = retention || 5000;
    const trimmed = events.length > cap ? events.slice(events.length - cap) : events;
    await setEvents(trimmed);
    return event;
  }

  async function updateEvent(id, patch) {
    const events = await getEvents();
    const idx = events.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    events[idx] = { ...events[idx], ...patch };
    await setEvents(events);
    return events[idx];
  }

  async function getAnswers() {
    const raw = await B.storageGet(KEYS.answers);
    return Array.isArray(raw) ? raw : [];
  }

  async function setAnswers(list) {
    await B.storageSet(KEYS.answers, list);
  }

  async function getQueue() {
    const raw = await B.sessionGet(KEYS.queue);
    return raw || { pending: [], active: null };
  }

  async function setQueue(queue) {
    await B.sessionSet(KEYS.queue, queue);
  }

  async function getSiteStatus() {
    const raw = await B.storageGet(KEYS.siteStatus);
    return raw && typeof raw === 'object' ? raw : {};
  }

  async function setSiteStatus(map) {
    await B.storageSet(KEYS.siteStatus, map);
  }

  async function setSiteStatusFor(siteId, patch) {
    const map = await getSiteStatus();
    map[siteId] = { ...(map[siteId] || {}), ...patch, at: Date.now() };
    await setSiteStatus(map);
    return map;
  }

  async function getMeta() {
    const raw = await B.storageGet(KEYS.meta);
    return raw && typeof raw === 'object' ? raw : { installedAt: Date.now() };
  }

  async function setMeta(patch) {
    const meta = await getMeta();
    const next = { ...meta, ...patch };
    await B.storageSet(KEYS.meta, next);
    return next;
  }

  /** Everything the user owns, in one JSON document. */
  async function exportAll() {
    const [settings, stats, events, answers, meta] = await Promise.all([
      B.storageGet(KEYS.settings),
      getStats(),
      getEvents(),
      getAnswers(),
      getMeta(),
    ]);
    return {
      kind: 'whilefree-export',
      schema: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      app: { name: 'WhileFree', version: WF.VERSION || null },
      settings: settings || {},
      stats,
      events,
      answers,
      meta,
    };
  }

  /**
   * Import a document produced by exportAll(). Prompts and answers were never
   * stored, so there is nothing of that kind to import or leak.
   */
  async function importAll(doc, mode) {
    if (!doc || doc.kind !== 'whilefree-export') {
      throw new Error('Not a WhileFree export file');
    }
    const replace = mode === 'replace';
    if (replace) {
      await B.storageClear();
    }
    if (doc.settings) await B.storageSet(KEYS.settings, doc.settings);
    if (doc.stats) {
      const existing = replace ? emptyStats() : await getStats();
      await setStats(WF.stats.mergeStats(existing, doc.stats));
    }
    if (Array.isArray(doc.events)) {
      const existing = replace ? [] : await getEvents();
      const merged = new Map();
      for (const e of [...existing, ...doc.events]) {
        if (e && e.id) merged.set(e.id, e);
      }
      await setEvents([...merged.values()].sort((a, b) => (a.sentAt || 0) - (b.sentAt || 0)));
    }
    if (Array.isArray(doc.answers)) {
      const existing = replace ? [] : await getAnswers();
      const merged = new Map();
      for (const a of [...existing, ...doc.answers]) {
        if (a && a.id) merged.set(a.id, a);
      }
      await setAnswers([...merged.values()]);
    }
    return { ok: true };
  }

  async function wipeAll() {
    await B.storageClear();
    return { ok: true };
  }

  WF.storage = {
    KEYS,
    SCHEMA_VERSION,
    emptySiteCounters,
    emptyStats,
    emptyDay,
    getSettings,
    setSettings,
    getStats,
    setStats,
    getEvents,
    setEvents,
    appendEvent,
    updateEvent,
    getAnswers,
    setAnswers,
    getQueue,
    setQueue,
    getSiteStatus,
    setSiteStatus,
    setSiteStatusFor,
    getMeta,
    setMeta,
    exportAll,
    importAll,
    wipeAll,
  };
})();
