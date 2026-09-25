// What does the content script think is happening on this very page?
// Run: node scripts/cdp.mjs eval claude.ai @scripts/probes/content-view.js
(() => {
  const w = (globalThis.WF && WF.content && WF.content.watcher) || null;
  const dom = globalThis.WF && WF.dom;
  const site = globalThis.WF && WF.sites.byId('claude');
  const chars = dom && site ? dom.assistantChars(document, site) : { chars: null, nodes: null };
  const stop = dom && site ? !!dom.findStopButton(document, site) : null;
  return {
    url: location.href.slice(0, 50),
    loadedAt: globalThis.__wfLoadedAt || null,
    now: Date.now(),
    hasContentScript: !!globalThis.WF,
    watcher: w
      ? {
          running: w.running,
          phase: w.phase,
          jobId: w.jobId,
          sentAt: w.sentAt,
          firstWordAt: w.firstWordAt,
          doneAt: w.doneAt,
          baselineChars: w.baselineChars,
          highWater: w.highWater,
          quietMs: w.quietMs,
          ticks: w.ticks,
          netEnabled: w.netEnabled,
          sawStreaming: w.sawStreaming,
        }
      : null,
    pageNow: { assistantChars: chars.chars, assistantNodes: chars.nodes, stopButtonUp: stop },
  };
})();
