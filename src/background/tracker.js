/**
 * Timing: where the numbers come from.
 *
 * The background owns two things the content scripts cannot:
 *   1. Events — one per (prompt, AI), with send time, first token time, finish
 *      time, and whether the user had already left. Only durations are kept.
 *   2. Waiting-away time — a hidden tab's timers are throttled, so the only
 *      reliable place to notice "an answer is still coming and you are not
 *      looking" is here.
 *
 * All writes go through one serialized mutation chain, because several AIs
 * finishing at once would otherwise read-modify-write over each other.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});
  const bg = (WF.bg = WF.bg || {});
  const B = WF.browser;

  const AWAY_TICK_MS = 5000;
  const AWAY_GRACE_MS = 1500; // ignore the first moment after a send

  const inFlight = new Map(); // `${jobId}::${siteId}` -> {jobId, siteId, group, tabId, sentAt, origin}
  const awayPending = new Map(); // siteId -> ms not yet written
  let tickTimer = null;
  let mutating = Promise.resolve();

  /** Serialize every read-modify-write of the events list. */
  function mutate(fn) {
    mutating = mutating.then(fn, fn).catch(() => undefined);
    return mutating;
  }

  const eventId = (jobId, siteId) => `${jobId}::${siteId}`;

  function nowMs() {
    return Date.now();
  }

  // ---------------------------------------------------------------------------
  // Activity: the three-state time split
  // ---------------------------------------------------------------------------

  async function recordActivity(payload) {
    if (!payload || !payload.siteId || !payload.day) return { ok: false };
    const stats = await WF.storage.getStats();
    WF.stats.addUsage(stats, {
      siteId: payload.siteId,
      day: payload.day,
      hour: payload.hour,
      weekday: payload.weekday,
      deltas: payload.deltas,
      counts: payload.counts,
    });
    await WF.storage.setStats(stats);
    return { ok: true };
  }

  /** Waiting time on tabs you are not looking at, sampled while jobs are live. */
  async function sampleAway() {
    if (!inFlight.size) {
      // Nothing is being timed, so nothing needs sampling. Stopping the timer matters more
      // than it looks: in Chrome a live timer keeps the service worker from ever being
      // suspended, and this one woke up every five seconds for the life of the browser to
      // find an empty map. It is started again by the first turn that goes out.
      stop();
      return;
    }
    const active = await bg.answers.activeTab();
    const activeId = active ? active.id : null;
    let dirty = false;

    for (const entry of inFlight.values()) {
      if (nowMs() - entry.sentAt < AWAY_GRACE_MS) continue;
      if (entry.tabId !== undefined && entry.tabId === activeId) continue;
      awayPending.set(entry.siteId, (awayPending.get(entry.siteId) || 0) + AWAY_TICK_MS);
      dirty = true;
    }
    if (dirty) await flushAway();
  }

  async function flushAway() {
    if (!awayPending.size) return;
    const day = WF.util.dayKey();
    const hour = WF.util.hourIndex(nowMs());
    const weekday = WF.util.weekdayIndex(nowMs());
    const stats = await WF.storage.getStats();
    for (const [siteId, ms] of awayPending) {
      WF.stats.addUsage(stats, {
        siteId,
        day,
        hour,
        weekday,
        deltas: { waitingAway: ms },
        counts: {},
      });
    }
    awayPending.clear();
    await WF.storage.setStats(stats);
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  async function touchEvent(jobId, siteId, patch, create) {
    return mutate(async () => {
      const events = await WF.storage.getEvents();
      const id = eventId(jobId, siteId);
      const index = events.findIndex((e) => e.id === id);
      if (index === -1) {
        if (!create) return null;
        events.push({ id, jobId, siteId, ...create });
      } else {
        events[index] = { ...events[index], ...patch };
      }
      const settings = await bg.store.settings();
      const cap = settings.eventsRetention || 5000;
      const trimmed = events.length > cap ? events.slice(events.length - cap) : events;
      await WF.storage.setEvents(trimmed);
      return trimmed.find((e) => e.id === id) || null;
    });
  }

  /**
   * A broadcast went out. The prompt itself stays in memory and is gone the moment
   * the job ends; only its length is recorded.
   */
  async function jobSent({ jobId, group, origin, siteIds, promptChars }) {
    for (const siteId of siteIds || []) {
      await touchEvent(
        jobId,
        siteId,
        {},
        {
          group: group || jobId,
          origin: origin || 'broadcast',
          sentAt: null,
          firstWordAt: null,
          doneAt: null,
          awayMs: 0,
          promptChars: promptChars || 0,
          aborted: false,
          abandoned: false,
          attention: null,
        }
      );
    }
  }

  /** Register a live send so the away sampler knows to watch that tab. */
  function setInFlight(entries) {
    inFlight.clear();
    for (const entry of entries || []) {
      inFlight.set(eventId(entry.jobId, entry.siteId), entry);
    }
  }

  async function targetSent({ jobId, siteId, group, tabId, sentAt, origin, promptChars, model }) {
    const event = await touchEvent(
      jobId,
      siteId,
      { sentAt: sentAt || nowMs(), tabId, group, origin, model: model || null },
      {
        group: group || jobId,
        origin: origin || 'broadcast',
        sentAt: sentAt || nowMs(),
        firstWordAt: null,
        doneAt: null,
        awayMs: 0,
        promptChars: promptChars || 0,
        aborted: false,
        abandoned: false,
        attention: null,
        // Which model answered. Read off the page's own switcher at send time; null
        // rather than guessed when the site does not say.
        model: model || null,
        tabId,
      }
    );
    inFlight.set(eventId(jobId, siteId), {
      jobId,
      siteId,
      group: group || jobId,
      tabId,
      sentAt: sentAt || nowMs(),
      origin: origin || 'broadcast',
    });
    return event;
  }

  function clearInFlight(jobId, siteId) {
    inFlight.delete(eventId(jobId, siteId));
  }

  /**
   * A phase report from a content script. This is where the answers-ready list,
   * the chime and the per-answer numbers are produced.
   */
  async function targetPhase(payload) {
    const { jobId, siteId, phase } = payload;
    if (!jobId || !siteId) return null;

    const existing = await touchEvent(jobId, siteId, {}, null);
    const patch = {
      firstWordAt: payload.firstWordAt || (existing && existing.firstWordAt) || null,
      doneAt: payload.doneAt || null,
      awayMs: Math.max(payload.awayMs || 0, (existing && existing.awayMs) || 0),
      // How the finish was decided: the conversation stream closing, or the page
      // holding still. Kept so a wrong number can be explained later.
      via: payload.via || (existing && existing.via) || null,
      model: payload.model || (existing && existing.model) || null,
      charsAdded: payload.charsAdded || (existing && existing.charsAdded) || null,
    };

    if (phase === WF.PHASE.DONE) {
      const settings = await bg.store.settings();
      const focused = await bg.answers.activeTab();
      const tabId = payload.tabId !== undefined ? payload.tabId : existing && existing.tabId;
      patch.abandoned = !(focused && focused.id === tabId);

      const event = await touchEvent(jobId, siteId, patch, {
        group: jobId,
        origin: payload.origin || 'broadcast',
        sentAt: payload.sentAt || nowMs(),
        promptChars: 0,
        aborted: false,
        attention: null,
        tabId,
      });

      const waitedMs = (patch.doneAt || nowMs()) - ((event && event.sentAt) || payload.sentAt || nowMs());
      // One condition decides whether the answer is news: was the user watching that
      // tab when it landed? If they were, it is silently counted in their stats and
      // the badge, list, chime and notification all leave them alone.
      const entry = await bg.answers.add({
        siteId,
        tabId,
        windowId: focused && focused.id === tabId ? focused.windowId : null,
        waitedMs,
        url: payload.url,
        title: payload.title,
        at: patch.doneAt || nowMs(),
      });
      if (entry) {
        await bg.answers.chime(siteId);
        await bg.answers.notify({ siteId, waitedMs });
      }
      clearInFlight(jobId, siteId);
      return event;
    }

    if (phase === WF.PHASE.ATTENTION || phase === WF.PHASE.ERROR || phase === WF.PHASE.TIMEOUT) {
      patch.aborted = true;
      patch.attention = payload.attention ? payload.attention.reason : phase;
      clearInFlight(jobId, siteId);
      if (payload.attention) {
        await WF.storage.setSiteStatusFor(siteId, {
          attention: payload.attention.reason,
          attentionAt: Date.now(),
          hasComposer: false,
        });
        // An AI that needs you takes the toolbar icon, so refresh it now.
        await bg.answers.updateBadge();
      }
    }

    if (phase === WF.PHASE.SENT || phase === WF.PHASE.STREAMING) {
      inFlight.set(eventId(jobId, siteId), {
        jobId,
        siteId,
        group: payload.group || jobId,
        tabId: existing && existing.tabId,
        sentAt: payload.sentAt || nowMs(),
        origin: payload.origin || 'broadcast',
      });
    }

    return touchEvent(jobId, siteId, patch, {
      group: jobId,
      origin: payload.origin || 'broadcast',
      sentAt: payload.sentAt || nowMs(),
      promptChars: 0,
      aborted: false,
      abandoned: false,
      attention: null,
    });
  }

  // ---------------------------------------------------------------------------

  function start() {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      sampleAway().catch(() => undefined);
    }, AWAY_TICK_MS);
  }

  function stop() {
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
  }

  async function prune() {
    const settings = await bg.store.settings();
    const events = await WF.storage.getEvents();
    const cap = settings.eventsRetention || 5000;
    if (events.length > cap) await WF.storage.setEvents(events.slice(events.length - cap));
  }

  /**
   * File what the record is missing.
   *
   * A turn whose tab was closed, or whose worker was torn down mid-answer, has no
   * finish and no failure: it is an orphan. A "answer" that took five milliseconds is
   * noise. Left alone, the first silently disappears from the totals and the second
   * drags the averages down, so both are marked and then excluded from the tables by
   * lib/stats.js. Runs on an alarm and on every startup, so a browser that was closed
   * mid-answer settles the next time it opens.
   */
  async function sweep() {
    return mutate(async () => {
      const events = await WF.storage.getEvents();
      const { events: next, changed } = WF.stats.reclassify(events, nowMs());
      if (!changed.length) return { changed: 0 };
      await WF.storage.setEvents(next);
      return { changed: changed.length, statuses: changed };
    });
  }

  bg.tracker = {
    start,
    stop,
    recordActivity,
    jobSent,
    targetSent,
    targetPhase,
    setInFlight,
    clearInFlight,
    sampleAway,
    flushAway,
    prune,
    sweep,
    inFlight: () => [...inFlight.values()],
  };
})();
