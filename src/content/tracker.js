/**
 * What a minute in an AI tab was spent on.
 *
 *   writing  — you are typing (measured from the fact that you are typing, never
 *              from what you type)
 *   waiting  — an answer is on its way and you are watching this tab
 *   reading  — an answer has landed and you are still on the tab
 *
 * Time spent waiting while the tab is in the background is counted by the
 * background worker instead, because a hidden tab's timers are throttled and this
 * script simply is not awake often enough to measure it.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});
  const content = (WF.content = WF.content || {});

  const TICK_MS = 1000;
  const FLUSH_MS = 10000;
  const TYPING_GRACE_MS = 5000; // a pause mid-sentence does not end "writing"
  const READING_CAP_MS = 10 * 60 * 1000;
  const PROGRAMMATIC_GUARD_MS = 2500;

  const state = {
    deltas: WF.stats.emptyCounters(),
    pendingCounts: { prompts: 0, answers: 0, followUps: 0 },
    lastTick: 0,
    typingUntil: 0,
    readingUntil: 0,
    inFlight: null,
    lastAnswerAt: 0,
    programmaticUntil: 0,
    timer: null,
    flushTimer: null,
    started: false,
  };

  let doc = null;
  let site = null;
  let settings = null;

  function focused() {
    if (!doc) return false;
    if (doc.hidden) return false;
    if (typeof doc.hasFocus === 'function') return doc.hasFocus();
    return true;
  }

  /** Tell the tracker to ignore input events caused by our own prompt insertion. */
  function markProgrammatic(ms) {
    state.programmaticUntil = Date.now() + (ms || PROGRAMMATIC_GUARD_MS);
  }

  function isProgrammatic() {
    return Date.now() < state.programmaticUntil;
  }

  function isEditable(target) {
    if (!target || !target.tagName) return false;
    if (target.tagName === 'TEXTAREA') return true;
    if (target.tagName === 'INPUT' && /^(text|search|email|url|)$/i.test(target.type || '')) return true;
    return target.isContentEditable === true;
  }

  function onTyping(event) {
    if (!event || !event.isTrusted) return; // synthetic input from our insertion
    if (isProgrammatic()) return;
    if (!isEditable(event.target)) return;
    state.typingUntil = Date.now() + TYPING_GRACE_MS;
    state.readingUntil = 0; // writing ends the reading window
  }

  function markInFlight(jobId, sentAt, origin) {
    state.inFlight = { jobId, sentAt: sentAt || Date.now(), origin: origin || 'user' };
    state.readingUntil = 0;
    state.typingUntil = 0;
  }

  function markAnswerDone(payload) {
    state.inFlight = null;
    state.lastAnswerAt = payload.doneAt || Date.now();
    state.readingUntil = state.lastAnswerAt + READING_CAP_MS;
    count('answers', 1);
  }

  function markPromptSent() {
    count('prompts', 1);
    const window = (settings && settings.followUpWindowMs) || 300000;
    if (state.lastAnswerAt && Date.now() - state.lastAnswerAt < window) {
      count('followUps', 1);
    }
    state.readingUntil = 0;
  }

  function count(key, n) {
    state.pendingCounts[key] = (state.pendingCounts[key] || 0) + n;
  }

  function tick() {
    const now = Date.now();
    const delta = now - state.lastTick;
    state.lastTick = now;
    if (delta <= 0 || delta > 15000) return;
    if (!focused()) return;

    if (now < state.typingUntil) {
      state.deltas.writing += delta;
    } else if (state.inFlight) {
      state.deltas.waiting += delta;
    } else if (now < state.readingUntil) {
      state.deltas.reading += delta;
    }
  }

  async function flush() {
    const hasDeltas = WF.stats.TIME_KEYS.some((key) => state.deltas[key] > 0);
    const hasCounts = Object.values(state.pendingCounts).some((n) => n > 0);
    if (!hasDeltas && !hasCounts) return;

    const payload = {
      type: WF.MSG.ACTIVITY,
      siteId: site.id,
      day: WF.util.dayKey(),
      hour: WF.util.hourIndex(Date.now()),
      weekday: WF.util.weekdayIndex(Date.now()),
      deltas: { writing: 0, waiting: 0, waitingAway: 0, reading: 0, ...state.deltas },
      counts: state.pendingCounts,
    };

    state.deltas = WF.stats.emptyCounters();
    state.pendingCounts = { prompts: 0, answers: 0, followUps: 0 };

    const ok = await WF.browser.send(payload);
    if (!ok || ok.ok === false) {
      // Nobody listened: fold the numbers back so the next flush carries them.
      for (const key of WF.stats.TIME_KEYS) state.deltas[key] += payload.deltas[key] || 0;
      for (const key of Object.keys(payload.counts)) {
        state.pendingCounts[key] = (state.pendingCounts[key] || 0) + payload.counts[key];
      }
    }
  }

  /** Steps one bucket at a time and returns the raw deltas so far. */
  function snapshot() {
    return { ...state.deltas, ...state.pendingCounts };
  }

  /**
   * Run the ticker only while this tab is the one being looked at.
   *
   * `tick()` has always returned early when the tab is hidden or unfocused — a minute in
   * an AI tab is only ever counted when you are in it — so running the interval on a
   * background tab was pure waste: a timer waking up once a second, on ten tabs, to
   * decide to do nothing. Stopping it costs nothing, because focus and visibility are
   * exactly the two events that make the answer change, and both are cheap to listen
   * for. A background AI tab now costs no CPU at all.
   */
  function startTicking() {
    if (state.timer || !state.started) return;
    state.lastTick = Date.now();
    state.timer = setInterval(tick, TICK_MS);
  }

  function stopTicking() {
    if (!state.timer) return;
    clearInterval(state.timer);
    state.timer = null;
  }

  function attach(document_, site_, settings_) {
    doc = document_;
    site = site_;
    settings = settings_;
    if (state.started) return;
    state.started = true;
    state.lastTick = Date.now();

    // Capture phase so a site's own stopPropagation cannot hide the truth. Three input
    // events would be one more listener than the truth needs: `keydown` catches the
    // first character, `input` catches everything after it.
    doc.addEventListener('keydown', onTyping, true);
    doc.addEventListener('input', onTyping, true);

    if (focused()) startTicking();
    state.flushTimer = setInterval(flush, FLUSH_MS);

    globalThis.addEventListener('focus', startTicking);
    globalThis.addEventListener('blur', () => {
      flush();
      stopTicking();
    });
    doc.addEventListener('visibilitychange', () => {
      if (doc.hidden) {
        flush();
        stopTicking();
      } else if (focused()) {
        startTicking();
      }
    });
    globalThis.addEventListener('pagehide', () => {
      flush();
      stopTicking();
    });
  }

  /**
   * A prompt the user sent by hand. It still gets timed, so the dashboard covers
   * every answer and not only the broadcast ones.
   *
   * Returns a jobId when a send really happened, otherwise null.
   */
  async function detectUserSend(trigger) {
    if (!doc || !site) return null;
    const input = WF.dom.findComposer(doc, site);
    if (!input) return null;
    // Read the box at trigger time: the site's own handler has not run yet because
    // we listen in the capture phase, so the prompt is still in there. This is also
    // the only moment the text exists — the site clears the box a tick later, and
    // what the user typed is never read again after this.
    const at = Date.now();
    const prompt = WF.dom.composerText(input);
    const before = content.composer.sendEvidence(doc, site, input);
    if (WF.dom.normalize(prompt) === '') return null;
    if (at < state.programmaticUntil) return null; // that was our own send
    if (state.inFlight) return null; // already timing something here

    const confirmed = await content.composer.confirmStarted(doc, site, input, before, 4000);
    if (!confirmed.started) return null;
    const jobId = WF.util.uid('user');
    return {
      jobId,
      sentAt: at,
      via: trigger,
      prompt,
      // An identity, not the text: this is what lets a fan-out recognise its own echo
      // and a retry recognise that it already landed.
      hash: WF.util.fingerprint(prompt),
    };
  }

  function detach() {
    stopTicking();
    if (state.flushTimer) clearInterval(state.flushTimer);
    state.flushTimer = null;
    state.started = false;
  }

  content.tracker = {
    attach,
    detach,
    tick,
    flush,
    snapshot,
    markProgrammatic,
    markInFlight,
    markAnswerDone,
    markPromptSent,
    detectUserSend,
    READING_CAP_MS,
    state,
  };
})();
