// One prompt to one AI through the engine's own wire message, watching the verdict settle.
//
//   node scripts/rdp.mjs bg whilefree@whilefree.app @scripts/probes/fx-ds-send.js
//
// `fx-send-one.js` sends the same message but returns the promise straight into the console
// actor, which cannot await one — so the verdict is printed as `undefined`. This is that probe
// written the way the rig can actually read it: the first half starts the send and says so, the
// second half prints whatever the content script answered. The target is DeepSeek, because the
// question here is whether the site's own composer and send path work today; set
// `__wfSendSite` first for another one.
(async () => {
  const siteId = globalThis.__wfSendSite || 'deepseek';
  const prompt = globalThis.__wfSendPrompt || 'Reply with exactly one word: pong';
  const site = WF.sites.byId(siteId);
  if (!site) return `unknown site: ${siteId}`;
  globalThis.__wfSendResult = 'pending';
  globalThis.__wfSendStarted = Date.now();
  const tabs = await browser.tabs.query({ url: site.matchPatterns });
  if (!tabs.length) return `no tab open for ${siteId}`;
  const tab = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  const jobId = `job_probe_${Date.now()}`;
  browser.tabs
    .sendMessage(tab.id, { type: 'wf:send', jobId, siteId, prompt })
    .then((reply) => {
      globalThis.__wfSendResult = JSON.stringify(
        { siteId, tabId: tab.id, url: tab.url, ms: Date.now() - globalThis.__wfSendStarted, reply },
        null,
        1
      );
    })
    .catch((err) => {
      globalThis.__wfSendResult = `threw: ${String((err && err.message) || err)}`;
    });
  return JSON.stringify({ started: siteId, tabId: tab.id, url: tab.url });
})()
// ::after 20000
(() => JSON.stringify({ result: globalThis.__wfSendResult }, null, 1))()
