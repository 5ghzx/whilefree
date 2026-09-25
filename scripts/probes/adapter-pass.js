// The live adapter pass: open every provider, ask its page whether our probes still find
// what they are looking for, and close the tab again.
//
//   WF_EXT_ID=<id> WF_CDP_TIMEOUT=600000 node scripts/cdp.mjs sw @scripts/probes/adapter-pass.js
//
// Run in the extension's service worker. `testSite` is the same path the popup's
// *Diagnose* button uses, so a pass here is the button pressed ten times in a row.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = {};

  for (const siteId of WF.sites.ORDER) {
    const site = WF.sites.byId(siteId);
    const url = site.newChatUrl || `https://${site.hosts[0]}/`;
    let tab = null;
    try {
      tab = await chrome.tabs.create({ url, active: false });
      await sleep(11000);
      const res = await WF.bg.background.testSite(siteId);
      const diag = (res && res.diagnostic) || {};
      const status = ((await WF.storage.getSiteStatus()) || {})[siteId] || {};
      out[siteId] = {
        url: url.replace(/^https:\/\//, ''),
        composer: diag.composer ? { via: diag.composer.via, inDialog: diag.composer.inDialog } : null,
        send: diag.send ? { via: diag.send.via, label: diag.send.label } : null,
        stopPresent: diag.stopPresent,
        answerNodes: diag.answers ? diag.answers.nodes : null,
        answerSelectorHits: diag.answerMatches,
        attention: status.attention || null,
        attentionEvidence: status.attentionEvidence || null,
        warning: status.warning || null,
        error: res && res.ok === false ? res.reason : null,
      };
    } catch (err) {
      out[siteId] = { url, error: String((err && err.message) || err) };
    } finally {
      if (tab && tab.id !== undefined) {
        try {
          await chrome.tabs.remove(tab.id);
        } catch (err) {
          /* already gone */
        }
      }
    }
  }
  return out;
})();
