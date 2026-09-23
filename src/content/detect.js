/**
 * Watching an answer land.
 *
 * A prompt is "answered" when new assistant output exists AND has stopped
 * changing AND the site's stop button is gone. We never read the answer — only
 * its length — so the extension can time it without storing what the AIs write.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});
  const content = (WF.content = WF.content || {});

  const TICK_MS = 400; // safety poll
  const MUTATION_THROTTLE_MS = 120; // mutate-driven probes, for accurate first-token timing
  const DONE_QUIET_MS = 1100; // output must hold still this long to count as finished
  const NOTHING_ARRIVED_MS = 35000; // no output and no stop button this long => report it

  class AnswerWatcher {
    constructor({ doc, site, jobId, onPhase }) {
      this.doc = doc;
      this.site = site;
      this.jobId = jobId;
      this.onPhase = onPhase;
      this.timer = null;
      this.observer = null;
      this.running = false;
      this.lastMutationAt = 0;
    }

    start() {
      if (this.running) return;
      this.running = true;
      const now = Date.now();
      this.sentAt = now;
      this.firstWordAt = null;
      this.doneAt = null;
      this.awayMs = 0;
      this.quietMs = 0;
      this.baselineChars = WF.dom.assistantChars(this.doc, this.site).chars;
      this.highWater = this.baselineChars;
      this.lastTick = now;
      this.sawStreaming = false;
      this.phase = WF.PHASE.SENT;

      this.timer = setInterval(() => this.tick(), TICK_MS);
      try {
        this.observer = new MutationObserver(() => {
          const t = Date.now();
          if (t - this.lastMutationAt < MUTATION_THROTTLE_MS) return;
          this.lastMutationAt = t;
          this.tick();
        });
        this.observer.observe(this.doc.body, { childList: true, subtree: true, characterData: true });
      } catch (err) {
        /* polling alone is enough */
      }
      return this.sentAt;
    }

    stop(reason) {
      if (!this.running) return;
      this.running = false;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      if (this.observer) {
        try {
          this.observer.disconnect();
        } catch (err) {
          /* ignore */
        }
        this.observer = null;
      }
      return reason;
    }

    /** Time the tab spent out of sight while we were waiting for this answer. */
    accumulateAway(now) {
      const delta = now - this.lastTick;
      if (delta <= 0 || delta > 5000) return;
      const doc = this.doc;
      const focused = typeof doc.hasFocus === 'function' ? doc.hasFocus() : true;
      if (doc.hidden || !focused) this.awayMs += delta;
    }

    tick() {
      if (!this.running) return;
      const now = Date.now();
      this.accumulateAway(now);
      this.lastTick = now;

      const { chars } = WF.dom.assistantChars(this.doc, this.site);

      // Only *increases* count as output. Long conversations are virtualised, so the
      // measured total can shrink when an old turn is unmounted, and treating that as
      // activity would both reset the quiet timer and mis-time the answer. A high-water
      // mark makes the measurement monotonic no matter what the page does.
      if (chars > this.highWater) {
        this.highWater = chars;
        this.quietMs = 0;
        if (this.firstWordAt === null) {
          this.firstWordAt = now;
          this.emit(WF.PHASE.STREAMING);
        } else if (this.phase !== WF.PHASE.STREAMING) {
          this.phase = WF.PHASE.STREAMING;
          this.emit(WF.PHASE.STREAMING);
        }
      } else {
        this.quietMs += TICK_MS;
      }

      const grew = this.highWater > this.baselineChars;
      const stopped = !WF.dom.findStopButton(this.doc, this.site);

      // A check or a quota banner that appears mid-answer is the one thing worth
      // interrupting for: the answer will never arrive.
      const attention = WF.dom.detectAttention(this.doc, this.site, this.doc.location.href, true);
      if (attention && attention.reason !== WF.ATTENTION.NO_COMPOSER) {
        this.doneAt = now;
        this.stop();
        this.emit(WF.PHASE.ATTENTION, { attention });
        return;
      }

      if (grew && stopped && this.quietMs >= DONE_QUIET_MS) {
        this.doneAt = now;
        this.sawStreaming = true;
        this.stop();
        this.emit(WF.PHASE.DONE, {
          chars: this.highWater,
          charsAdded: this.highWater - this.baselineChars,
        });
        return;
      }

      const timeout = (this.site.answerTimeoutMs || 300000) + (this.awayMs || 0);
      if (now - this.sentAt > timeout) {
        this.doneAt = now;
        this.stop();
        this.emit(WF.PHASE.TIMEOUT);
        return;
      }

      if (!grew && !this.sawStreaming && now - this.sentAt > NOTHING_ARRIVED_MS) {
        this.stop();
        this.emit(WF.PHASE.ERROR, { reason: 'no-answer-detected' });
      }
    }

    emit(phase, extra) {
      this.phase = phase;
      const payload = {
        jobId: this.jobId,
        siteId: this.site.id,
        phase,
        sentAt: this.sentAt,
        firstWordAt: this.firstWordAt,
        doneAt: this.doneAt,
        awayMs: Math.round(this.awayMs),
        ...(extra || {}),
      };
      if (this.onPhase) this.onPhase(payload);
    }
  }

  /** Manual completion, for the "mark this one done" escape hatch in the panel. */
  function forceDone() {
    if (content.watcher && content.watcher.running) {
      const now = Date.now();
      content.watcher.doneAt = now;
      content.watcher.firstWordAt = content.watcher.firstWordAt || now;
      content.watcher.stop();
      content.watcher.emit(WF.PHASE.DONE, { manual: true });
    }
  }

  content.detect = { AnswerWatcher, forceDone };
})();
