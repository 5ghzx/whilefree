/**
 * Settings access for the background.
 *
 * A service worker can be torn down at any moment, so nothing is cached for long.
 * Every write also tells the open AI tabs, which is how a toggle in the popup
 * takes effect on a page you already have open.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});
  const bg = (WF.bg = WF.bg || {});
  const B = WF.browser;

  const CACHE_MS = 3000;
  let cache = null;
  let cachedAt = 0;

  async function settings(force) {
    const now = Date.now();
    if (!force && cache && now - cachedAt < CACHE_MS) return cache;
    cache = await WF.storage.getSettings();
    cachedAt = now;
    return cache;
  }

  function invalidate() {
    cache = null;
    cachedAt = 0;
  }

  /** Apply a patch, then push the result to every open AI tab. */
  async function patchSettings(patch) {
    const next = await WF.storage.setSettings(patch);
    cache = next;
    cachedAt = Date.now();
    await broadcastToSites({ type: WF.MSG.SETTINGS_CHANGED, settings: next });
    return next;
  }

  async function broadcastToSites(message) {
    const patterns = WF.sites.matchPatterns();
    const tabs = await B.queryTabs({ url: patterns });
    await Promise.all(tabs.map((tab) => (tab.id === undefined ? null : B.sendToTab(tab.id, message))));
    return tabs.length;
  }

  bg.store = { settings, invalidate, patchSettings, broadcastToSites };
})();
