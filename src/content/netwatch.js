/**
 * When an answer actually finishes, according to the network.
 *
 * A DOM that has stopped changing might mean the answer is finished, or it might mean
 * the model paused for a second. A conversation request that has *ended* has ended.
 * So this watches the page's own request timeline and reports the streams that look
 * like answers, which gives the detector two real numbers it cannot get from markup:
 * when the first byte arrived (a true time-to-first-token) and when the stream closed.
 *
 * How it watches is worth stating, because it is deliberately unglamorous: it reads
 * `PerformanceObserver` resource entries from the content script's own isolated world.
 * The alternative — hooking `fetch` inside the page — needs a script in the page's
 * world, which a strict Content-Security-Policy on these sites can block, and which
 * would put our code inside the page's own JavaScript context for no extra accuracy.
 * Resource timing is the same information, one layer down, and it cannot be blocked.
 *
 * Costs about nothing: no timers, no polling, and nothing is stored beyond the last
 * few streams.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});
  const content = (WF.content = WF.content || {});

  // Under this, it is not an answer: it is a settings fetch or a telemetry ping.
  const MIN_STREAM_MS = 1500;
  const MAX_STREAM_MS = 20 * 60 * 1000;

  class NetWatcher {
    constructor({ site, onStream } = {}) {
      this.site = site || null;
      this.onStream = onStream || null;
      this.observer = null;
      this.running = false;
      this.timeOrigin = globalThis.performance && performance.timeOrigin ? performance.timeOrigin : Date.now();
    }

    get supported() {
      return typeof globalThis.PerformanceObserver !== 'undefined';
    }

    start() {
      if (this.running || !this.supported) return false;
      try {
        this.observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) this.consider(entry);
        });
        // `buffered` picks up requests that were already in flight when we attached,
        // which is the common case: the page boots before the content script does.
        this.observer.observe({ type: 'resource', buffered: true });
        this.running = true;
        return true;
      } catch (err) {
        return false;
      }
    }

    stop() {
      if (this.observer) {
        try {
          this.observer.disconnect();
        } catch (err) {
          /* already gone */
        }
      }
      this.observer = null;
      this.running = false;
    }

    sameOrigin(url) {
      try {
        return new URL(url, globalThis.location.href).origin === globalThis.location.origin;
      } catch (err) {
        return false;
      }
    }

    /** Does this request look like the one carrying an answer? */
    matches(entry) {
      const duration = entry.duration || 0;
      if (duration <= 0 || duration > MAX_STREAM_MS) return null;

      if (WF.sites.isEndpoint(this.site, entry.name)) return 'endpoint';

      // A site whose endpoint we do not know still gets a signal, but only on a
      // stricter rule: a long same-origin fetch. Uploads and asset loads are excluded
      // by the initiator type and the duration floor.
      const known = (this.site && this.site.endpointPatterns) || [];
      if (known.length) return null;
      const initiator = entry.initiatorType;
      if (initiator !== 'fetch' && initiator !== 'xmlhttprequest') return null;
      if (duration < MIN_STREAM_MS) return null;
      if (!this.sameOrigin(entry.name)) return null;
      return 'generic';
    }

    consider(entry) {
      const kind = this.matches(entry);
      if (!kind) return;
      const epoch = (t) => (t ? Math.round(this.timeOrigin + t) : null);
      const event = {
        siteId: this.site ? this.site.id : null,
        url: String(entry.name || '').slice(0, 300),
        kind,
        startedAt: epoch(entry.startTime),
        // Zero means the browser withheld it (cross-origin without Timing-Allow-Origin).
        firstByteAt: entry.responseStart > 0 ? epoch(entry.responseStart) : null,
        endedAt: epoch(entry.responseEnd),
        durationMs: Math.round(entry.duration || 0),
      };
      if (this.onStream) {
        try {
          this.onStream(event);
        } catch (err) {
          /* a reporting failure must never break the page */
        }
      }
    }
  }

  content.netwatch = { NetWatcher, MIN_STREAM_MS, MAX_STREAM_MS };
})();
