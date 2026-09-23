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

  /** Daily rows, one line per day per AI: the dataset a spreadsheet wants. */
  async function exportDailyCsv() {
    const stats = await getStats();
    const columns = [
      { key: 'day', label: 'day' },
      { key: 'site', label: 'ai' },
      { key: 'writing_ms', label: 'writing_ms' },
      { key: 'waiting_ms', label: 'waiting_ms' },
      { key: 'waiting_elsewhere_ms', label: 'waiting_elsewhere_ms' },
      { key: 'reading_ms', label: 'reading_ms' },
      { key: 'prompts', label: 'prompts' },
      { key: 'answers', label: 'answers' },
      { key: 'follow_ups', label: 'follow_ups' },
    ];
    const rows = [];
    for (const day of Object.keys(stats.days || {}).sort()) {
      for (const [siteId, counters] of Object.entries(stats.days[day].sites || {})) {
        rows.push({
          day,
          site: siteId,
          writing_ms: counters.writing || 0,
          waiting_ms: counters.waiting || 0,
          waiting_elsewhere_ms: counters.waitingAway || 0,
          reading_ms: counters.reading || 0,
          prompts: counters.prompts || 0,
          answers: counters.answers || 0,
          follow_ups: counters.followUps || 0,
        });
      }
    }
    return WF.util.toCsv(columns, rows);
  }

  /** One line per measured answer. Durations and counts only, never any text. */
  async function exportAnswersCsv() {
    const events = await getEvents();
    const columns = [
      { key: 'sent_at', label: 'sent_at' },
      { key: 'day', label: 'day' },
      { key: 'ai', label: 'ai' },
      { key: 'origin', label: 'origin' },
      { key: 'prompt_chars', label: 'prompt_chars' },
      { key: 'first_words_ms', label: 'first_words_ms' },
      { key: 'answer_ms', label: 'answer_ms' },
      { key: 'away_ms', label: 'away_ms' },
      { key: 'left_before_it_landed', label: 'left_before_it_landed' },
      { key: 'attention', label: 'attention' },
    ];
    const rows = [...events]
      .sort((a, b) => (a.sentAt || 0) - (b.sentAt || 0))
      .map((event) => ({
        sent_at: event.sentAt ? new Date(event.sentAt).toISOString() : '',
        day: event.sentAt ? WF.util.dayKey(event.sentAt) : '',
        ai: event.siteId,
        origin: event.origin || 'broadcast',
        prompt_chars: event.promptChars || 0,
        first_words_ms: event.firstWordAt && event.sentAt ? event.firstWordAt - event.sentAt : '',
        answer_ms: event.doneAt && event.sentAt ? event.doneAt - event.sentAt : '',
        away_ms: event.awayMs || 0,
        left_before_it_landed: event.abandoned ? 'yes' : 'no',
        attention: event.attention || '',
      }));
    return WF.util.toCsv(columns, rows);
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
    exportDailyCsv,
    exportAnswersCsv,
    importAll,
    wipeAll,
  };
})();
