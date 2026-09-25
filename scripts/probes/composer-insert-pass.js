// Can we actually put the prompt in the box — behind your back, and in front of you?
//
//   WF_EXT_ID=<id> WF_CDP_TIMEOUT=900000 node scripts/cdp.mjs sw @scripts/probes/composer-insert-pass.js
//
// Both states matter. A broadcast types into tabs the user is not looking at, which is what
// `focusOnRetry` exists for; the foreground result says whether the site is fine and only the
// background case is the problem. Nothing is sent — the box is read back and cleared.
(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const MARKER = 'whilefree insert check';
  const out = {};

  for (const siteId of WF.sites.ORDER) {
    const site = WF.sites.byId(siteId);
    const url = site.newChatUrl || `https://${site.hosts[0]}/`;
    let tab = null;
    const result = {};
    try {
      tab = await chrome.tabs.create({ url, active: false });
      await sleep(11000);

      const attempt = async () =>
        (
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'ISOLATED',
            func: (marker) => {
              const api = globalThis.WF;
              const site = api.sites.fromUrl(location.href);
              if (!site) return { noAdapter: location.href };
              const composer = api.dom.findComposer(document, site);
              if (!composer) {
                return { composer: null, attention: api.dom.detectAttention(document, site, location.href, false) };
              }
              const written = api.dom.setComposerText(document, composer, marker);
              const read = api.dom.normalize(api.dom.composerText(composer));
              const button = api.dom.findSendButton(document, site, composer);
              const focusNow = document.hasFocus();
              api.dom.clearComposer(document, composer);
              return {
                focused: focusNow,
                method: written.method,
                ok: written.ok,
                exact: read === marker,
                copies: marker ? read.split(marker).length - 1 : 0,
                sendButton: button ? { label: api.dom.labelOf(button), disabled: !!button.disabled } : null,
                cleared: api.dom.composerText(composer).trim() === '',
              };
            },
            args: [MARKER],
          })
        )[0].result;

      result.background = await attempt();

      // Now the same thing with the tab in front.
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      await sleep(2000);
      result.foreground = await attempt();

      out[siteId] = result;
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
