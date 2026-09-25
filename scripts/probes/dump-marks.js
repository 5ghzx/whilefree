// Read back what scripts/probes/mark-growth.js recorded, relative to the send.
// Run: WF_WORLD=ext node scripts/cdp.mjs eval claude.ai @scripts/probes/dump-marks.js
(() => {
  const marks = globalThis.__marks || null;
  if (!marks) return { none: true };
  const w = (globalThis.WF.content || {}).watcher;
  const sentAt = (w && w.sentAt) || (marks.phases[0] && marks.phases[0].sentAt) || null;
  const rel = (t) => (sentAt && t ? t - sentAt : null);
  return {
    watcherNow: w ? { running: w.running, phase: w.phase, sentAt: w.sentAt, firstWordAt: w.firstWordAt, doneAt: w.doneAt, ticks: w.ticks, netEnabled: w.netEnabled } : null,
    phases: marks.phases.map((p) => ({ ...p, rel: rel(p.at) })),
    streams: marks.streams.map((s) => ({ ...s, startedRel: rel(s.startedAt), firstByteRel: rel(s.firstByteAt), endedRel: rel(s.endedAt) })),
    growth: marks.growth.map(([t, chars]) => ({ rel: rel(t), chars })),
  };
})();
