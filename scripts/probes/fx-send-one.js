/**
 * Send one prompt to one AI, through the exact message the engine sends it.
 *
 * `wf:send` is what the engine's fan-out puts on the wire for a single target, and the content
 * script answers it with the verdict the engine would have recorded: `ok` with the method that
 * worked, or `reason` — `send-failed`, `submit-failed`, `no-composer` — with the diagnostic
 * taken at the moment it gave up. That makes this the smallest possible reproduction of one
 * target's failure, without a broadcast, without the other nine tabs, and without waiting for
 * the timeout that hides the reason.
 *
 * The site's tabs are found the way the engine finds them, through the site's own match
 * patterns, so a probe that cannot find a tab is a finding in itself.
 *
 *   node scripts/rdp.mjs bg whilefree@whilefree.app @scripts/probes/fx-send-one.js
 *
 * The target defaults to Perplexity — the site this was written for. The popup frame keeps its
 * globals between evaluations, so a different one is two commands in the same frame:
 *
 *   node scripts/rdp.mjs bg whilefree@whilefree.app "globalThis.__wfSendSite = 'grok'"
 *   node scripts/rdp.mjs bg whilefree@whilefree.app @scripts/probes/fx-send-one.js
 *
 * The message is sent from the popup page because it is an extension page: content scripts
 * cannot address another tab, and the popup can.
 */
(async () => {
  const siteId = globalThis.__wfSendSite || 'perplexity';
  const prompt = globalThis.__wfSendPrompt || 'Reply with exactly one word: pong';
  const site = WF.sites.byId(siteId);
  if (!site) return `unknown site: ${siteId}`;
  const tabs = await browser.tabs.query({ url: site.matchPatterns });
  if (!tabs.length) return `no tab open for ${siteId}`;
  const tab = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
  const jobId = `job_probe_${Date.now()}`;
  const started = Date.now();
  let reply = null;
  try {
    reply = await browser.tabs.sendMessage(tab.id, { type: 'wf:send', jobId, siteId, prompt });
  } catch (err) {
    reply = { threw: String(err && err.message) };
  }
  return JSON.stringify({ siteId, tabId: tab.id, url: tab.url, ms: Date.now() - started, reply }, null, 1);
})()
