// What the page's own request timeline says, in the same terms netwatch.js reads it.
// Run: node scripts/cdp.mjs eval claude.ai @scripts/probes/streams.js
(() => {
  const now = Date.now();
  const origin = performance.timeOrigin;
  return performance
    .getEntriesByType('resource')
    .filter((e) => e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest')
    .filter((e) => e.duration > 800)
    .sort((a, b) => a.startTime - b.startTime)
    .slice(-12)
    .map((e) => ({
      name: String(e.name).replace(/^https:\/\/claude\.ai/, '').slice(0, 70),
      startedAt: Math.round(origin + e.startTime),
      agoMs: Math.round(now - (origin + e.startTime)),
      toHeadersMs: Math.round(e.responseStart - e.startTime),
      durationMs: Math.round(e.duration),
      transferSize: e.transferSize,
    }));
})();
