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

  // While an answer is arriving the mutation observer is the real signal — it fires the
  // moment the page changes — so the timer is only a safety net for sites that stream
  // through a canvas or stop mutating. Three times a second of that safety net cost more
  // CPU than the answer did, and 900ms is invisible in a stopped-answer decision that
  // already waits 1100ms for the output to hold still.
  const TICK_MS = 900; // safety poll
  const MUTATION_THROTTLE_MS = 250; // mutate-driven probes, for accurate first-token timing
  // The attention scan is the most expensive probe in a tick and a check or quota banner
  // does not come and go inside a second, so it runs on every other tick.
  const ATTENTION_EVERY_TICKS = 2;
  const DONE_QUIET_MS = 1100; // output must hold still this long to count as finished
  const NET_SETTLE_MS = 250; // once the stream has closed, this is all the DOM gets
  const NOTHING_ARRIVED_MS = 35000; // no output and no stop button this long => report it
  const STREAM_MEMORY = 12;

  /**
   * Recent conversation streams, newest last. Reported by content/netwatch.js from the
   * page's own request timeline; the watcher below associates the one that belongs to
   * the send it is timing.
   */
  const streams = [];

  function noteStream(event) {
    if (!event || !event.startedAt) return;
    streams.push(event);
    while (streams.length > STREAM_MEMORY) streams.shift();
  }

  /** The most recent stream that began at or after `sinceMs`, ignoring ancient ones. */
  function streamSince(sinceMs, now) {
    const limit = now || Date.now();
    for (let i = streams.length - 1; i >= 0; i -= 1) {
      const stream = streams[i];
      if (stream.startedAt < sinceMs) continue;
      // A stream that started before we sent cannot be the answer to what we sent.
      if (stream.startedAt - sinceMs > 6 * 60 * 1000) continue;
      if (limit - stream.startedAt > 20 * 60 * 1000) continue;
      return stream;
    }
    return null;
  }

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
      this.ticks = 0;
    }

    /**
     * Begin watching. `submittedAt` is when the prompt was actually submitted — the press
     * that started it — which is earlier than this call, because confirming a send means
     * watching the page for up to a few seconds afterwards. A clock that starts after the
     * answer's own request has begun cannot use the network to time anything.
     */
    start(submittedAt) {
      if (this.running) return this.sentAt;
      this.running = true;
      // The escape hatch in the panel ("mark this one done") has no reference of its
      // own to the live watcher, so the watcher publishes itself here. Without this
      // `forceDone` silently did nothing, which is the worst way for a fallback to fail.
      content.watcher = this;
      const now = Date.now();
      const submitted = Number(submittedAt);
      // Never accept a start time in the future, and never one older than the request that
      // carried the prompt could be.
      this.sentAt = submitted > 0 && submitted <= now ? submitted : now;
      this.firstWordAt = null;
      this.doneAt = null;
      this.awayMs = 0;
      this.quietMs = 0;
      this.baselineChars = WF.dom.assistantChars(this.doc, this.site).chars;
      this.highWater = this.baselineChars;
      this.lastTick = now;
      this.sawStreaming = false;
      // "Output has been seen for this prompt", which survives a rebase and is therefore
      // not the same as "the text on screen is longer than it was when we started".
      this.seenOutput = false;
      this.phase = WF.PHASE.SENT;
      this.net = null;
      // Sites with an unknown endpoint still get the generic rule, so "no patterns"
      // means "no strong signal", not "no signal".
      this.netEnabled = !!(content.netwatch && content.netwatch.NetWatcher);
      // Which model is answering — read here, at send time, while the switcher is on
      // screen. A label, never the answer.
      const model = WF.dom.modelLabel(this.doc, this.site);
      this.model = model ? model.label : null;
      this.modelSource = model ? model.source : null;

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

    /** The stream carrying this answer, if the network has shown us one. */
    stream() {
      if (!this.netEnabled) return null;
      const found = streamSince(this.sentAt, Date.now());
      if (!found) return null;
      if (!this.net) {
        this.net = found;
        // Time to first byte is a better first-word time than watching paint dry:
        // the DOM can lag the network by a second on a long markdown render.
        if (found.firstByteAt && this.firstWordAt === null) {
          this.firstWordAt = found.firstByteAt;
          this.seenOutput = true;
          this.emit(WF.PHASE.STREAMING, { via: 'network' });
        }
      } else if (found.endedAt > this.net.endedAt) {
        this.net = found;
      }
      return this.net;
    }

    /**
     * The address moved under a running watch.
     *
     * Sending the first prompt of a conversation changes the URL — `/new` becomes
     * `/chat/<id>` — and the answer is still on its way to the same message box in the same
     * document. Treating that as the end of the watch is how a real answer was thrown away:
     * the site had answered while the extension sat waiting for a phase that never came, and
     * the popup said "no answer" about a conversation with the answer in it.
     *
     * So measure from what is on screen *now* and keep `sentAt`/`firstWordAt`, which are the
     * timings that mean something. A fresh baseline also keeps a false positive away: the new
     * page paints the prompt (and sometimes the whole earlier conversation) before the answer
     * starts, and against the old baseline that paint alone looks like output that has
     * already stopped.
     */
    rebase() {
      if (!this.running) return;
      const now = Date.now();
      this.baselineChars = WF.dom.assistantChars(this.doc, this.site).chars;
      this.highWater = this.baselineChars;
      this.quietMs = 0;
      this.lastTick = now;
      // The stream this watch was following is re-found by `stream()` on the next tick
      // against the same `sentAt`, so nothing about the answer is lost by forgetting it.
      this.net = null;
      // A page that rebuilt itself leaves the observer watching a detached node, which
      // would quietly downgrade us to the safety poll for the rest of the wait.
      if (this.observer) {
        try {
          this.observer.disconnect();
          this.observer.observe(this.doc.body, { childList: true, subtree: true, characterData: true });
        } catch (err) {
          /* polling alone is enough */
        }
      }
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
      this.ticks += 1;
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
        this.seenOutput = true;
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

      const stream = this.stream();
      const grew = this.highWater > this.baselineChars;
      // `grew` is measured from the baseline set when the watch began, which a page that
      // moved to its conversation's own address has since replaced. Output that arrived
      // before that move still counts as output.
      const output = grew || this.seenOutput;
      const stopped = !WF.dom.findStopButton(this.doc, this.site);
      // The stream has closed and the page has had a moment to paint what arrived.
      const streamClosed = !!(stream && stream.endedAt && now - stream.endedAt >= NET_SETTLE_MS);

      // A check or a quota banner that appears mid-answer is the one thing worth
      // interrupting for: the answer will never arrive.
      const attention =
        this.ticks % ATTENTION_EVERY_TICKS === 0
          ? WF.dom.detectAttention(this.doc, this.site, this.doc.location.href, true)
          : null;
      if (attention && attention.reason !== WF.ATTENTION.NO_COMPOSER) {
        this.doneAt = now;
        this.stop();
        this.emit(WF.PHASE.ATTENTION, { attention });
        return;
      }

      // Two ways to be finished, and the network is the better one: it ends when the
      // server stops sending, rather than when the page happens to hold still.
      if (output && stopped && (streamClosed || this.quietMs >= DONE_QUIET_MS)) {
        this.doneAt = streamClosed && stream.endedAt ? stream.endedAt : now;
        this.sawStreaming = true;
        this.stop();
        this.emit(WF.PHASE.DONE, {
          chars: this.highWater,
          charsAdded: this.highWater - this.baselineChars,
          via: streamClosed ? 'network' : 'dom',
          model: this.model,
        });
        return;
      }

      // A stream that finished, on a page where nothing appeared, is a failure rather
      // than a slow answer. Say so immediately instead of waiting out the timeout.
      if (streamClosed && !output && !this.sawStreaming) {
        this.stop();
        this.emit(WF.PHASE.ERROR, { reason: 'no-answer-detected', via: 'network' });
        return;
      }

      const timeout = (this.site.answerTimeoutMs || 300000) + (this.awayMs || 0);
      if (now - this.sentAt > timeout) {
        this.doneAt = now;
        this.stop();
        this.emit(WF.PHASE.TIMEOUT);
        return;
      }

      if (!output && !this.sawStreaming && now - this.sentAt > NOTHING_ARRIVED_MS) {
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

  content.detect = { AnswerWatcher, forceDone, noteStream, streamSince };
})();
