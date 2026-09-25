// The half of the adapter that an empty page cannot show: the send button.
//
//   WF_EXT_ID=<id> WF_CDP_TIMEOUT=900000 node scripts/cdp.mjs sw @scripts/probes/adapter-typing-pass.js
//
// Every site disables its send button while the box is empty, so `testSite` on a fresh page
// reports `send: null` whether or not the selectors are right. This types a marker into the
// box with the extension's own insertion path, asks again, and clears the box. Nothing is
// sent: the marker never leaves the page.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MARKER = 'whilefree adapter check';
  const out = {};

  for (const siteId of WF.sites.ORDER) {
    const site = WF.sites.byId(siteId);
    const url = site.newChatUrl || `https://${site.hosts[0]}/`;
    let tab = null;
    try {
      tab = await chrome.tabs.create({ url, active: false });
      await sleep(11000);

      const [probe] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'ISOLATED',
        func: (marker) => {
          const api = typeof WF !== 'undefined' ? WF : null;
          if (!api) return { noContentScript: true };
          const site = api.sites.fromUrl(location.href);
          if (!site) return { noAdapter: location.href };
          const doc = document;
          const composer = api.dom.findComposer(doc, site);
          if (!composer) return { composer: null, attention: api.dom.detectAttention(doc, site, location.href, false) };
          const before = api.dom.findSendButton(doc, site, composer) ? api.dom.labelOf(api.dom.findSendButton(doc, site, composer)) : null;
          const written = api.dom.setComposerText(doc, composer, marker);
          const after = api.dom.findSendButton(doc, site, composer);
          const readBack = api.dom.normalize(api.dom.composerText(composer));
          const cleared = api.dom.setComposerText(doc, composer, '');
          return {
            composer: { tag: composer.tagName, kind: site.input.kind },
            written: { ok: written.ok, method: written.method },
            readBack: readBack.slice(0, 40),
            readBackOk: readBack === marker,
            sendBefore: before,
            sendAfter: after ? { label: api.dom.labelOf(after), disabled: !!after.disabled } : null,
            cleared: { ok: cleared.ok, empty: api.dom.composerText(composer).trim() === '' },
          };
        },
        args: [MARKER],
      });

      out[siteId] = probe.result;
    } catch (err) {
      out[siteId] = { error: String((err && err.message) || err) };
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
