// Instrument the two clocks the answer watcher reads, so a live send can be checked
// against them afterwards.
//
//   WF_WORLD=ext node scripts/cdp.mjs eval claude.ai @scripts/probes/mark-growth.js
//   … send a prompt …
//   WF_WORLD=ext node scripts/cdp.mjs eval claude.ai @scripts/probes/dump-marks.js
(() => {
  const WF = globalThis.WF;
  if (globalThis.__marks) return { already: true };

  globalThis.__marks = { growth: [], streams: [], phases: [] };
  const site = WF.sites.fromUrl(location.href);

  const realChars = WF.dom.assistantChars;
  WF.dom.assistantChars = (doc, s) => {
    const out = realChars(doc, s);
    const last = globalThis.__marks.growth[globalThis.__marks.growth.length - 1];
    if (!last || last[1] !== out.chars) globalThis.__marks.growth.push([Date.now(), out.chars]);
    return out;
  };

  const realNote = WF.content.detect.noteStream;
  WF.content.detect.noteStream = (event) => {
    globalThis.__marks.streams.push({
      at: Date.now(),
      startedAt: event.startedAt,
      firstByteAt: event.firstByteAt,
      endedAt: event.endedAt,
      url: String(event.url).replace(/^https:\/\/claude\.ai/, '').slice(0, 50),
    });
    return realNote(event);
  };

  const realStart = WF.content.startWatcher;
  WF.content.startWatcher = (jobId) => {
    const sentAt = realStart(jobId);
    globalThis.__marks.phases.push({ at: Date.now(), sentAt, jobId, note: 'watcher started' });
    return sentAt;
  };

  void site;
  return { patched: true };
})();
