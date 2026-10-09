// The live watcher's own numbers, sampled while a DeepSeek answer arrives.
//
//   node scripts/rdp.mjs eval deepseek @scripts/probes/fx-ds-watch.js    # starts sampling
//   ... start a send ...
//   node scripts/rdp.mjs eval deepseek "JSON.stringify(globalThis.__wfWatch, null, 1)"
//
// `fx-ds-stream.js` reads the page; this reads the thing that decides. Every field that goes
// into the finished/not-finished test is here on one clock — how long the output has been quiet,
// when it last grew, whether the stop control is up, and what the network said — so a wait that
// ended early can be explained by the state that ended it instead of inferred from a timeline
// that has two clocks in it.
(() => {
  const site = WF.sites.byId('deepseek');
  const started = Date.now();
  globalThis.__wfWatch = [];
  globalThis.__wfWatchTimer = setInterval(() => {
    const w = WF.content.watcher;
    if (!w) {
      globalThis.__wfWatch.push({ at: Math.round((Date.now() - started) / 100) / 10, watcher: null });
      return;
    }
    globalThis.__wfWatch.push({
      at: Math.round((Date.now() - started) / 100) / 10,
      running: w.running,
      phase: w.phase,
      chars: w.highWater,
      quietMs: w.quietMs,
      lastGrowthAt: w.lastGrowthAt ? Math.round(w.lastGrowthAt - started) : null,
      sentAt: Math.round(w.sentAt - started),
      stopUp: !!WF.dom.findStopButton(document, site),
      netEndedAt: w.net && w.net.endedAt ? Math.round(w.net.endedAt - started) : null,
      doneAt: w.doneAt ? Math.round(w.doneAt - started) : null,
    });
    if (globalThis.__wfWatch.length > 200) clearInterval(globalThis.__wfWatchTimer);
  }, 400);
  return JSON.stringify({ sampling: true, url: location.href });
})()
