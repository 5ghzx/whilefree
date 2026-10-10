/**
 * The live watcher's own numbers, mid-answer.
 *
 *   node scripts/rdp.mjs eval deepseek @scripts/probes/fx-watch-state.js
 *
 * `content.watcher` is the watcher running in this tab (published so the panel's "mark this one
 * done" can reach it). Reading it while a send is in flight is how the accounting is checked
 * directly instead of inferred from the finished event: `baselineChars` is what the answer is
 * measured against, `highWater` the most the page has shown, and `charsAdded` at the end is the
 * difference — so a baseline that a page move has raised is visible here as the answer arrives.
 */
(() => {
  const w = globalThis.WF && WF.content && WF.content.watcher;
  if (!w) return JSON.stringify({ watcher: null });
  const chars = WF.dom.assistantChars(document, w.site);
  return JSON.stringify(
    {
      url: location.href,
      running: w.running,
      phase: w.phase,
      sentAt: w.sentAt,
      baseline: w.baselineChars,
      highWater: w.highWater,
      seenOutput: w.seenOutput,
      firstWordAt: w.firstWordAt,
      doneAt: w.doneAt,
      pageChars: chars.chars,
      pageNodes: chars.nodes,
    },
    null,
    1
  );
})()
