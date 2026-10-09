/**
 * Load every site tab in the rig, so the pages a test is about actually exist.
 *
 * A restarted rig comes back with a sessionstore of its own, and Firefox restores those tabs
 * as placeholders: the tab list shows the titles, but there is no document behind them until
 * something asks. A content script only starts when there is a document, so a broadcast fired
 * at a window full of restored tabs reaches nothing and reads as ten broken adapters — the
 * single most misleading state this rig can be in.
 *
 * `tabs.reload` on an unloaded tab is the ask. Loaded tabs are left alone, so this is cheap
 * to call on a rig that is already awake.
 *
 *   node scripts/rdp.mjs bg whilefree@whilefree.app @scripts/probes/fx-load.js
 */
(async () => {
  const tabs = await browser.tabs.query({});
  const asked = [];
  for (const tab of tabs) {
    const site = WF.sites.fromUrl(tab.url || '');
    if (!site) continue;
    const unloaded = Boolean(tab.discarded) || tab.status === 'unloaded';
    if (unloaded) {
      try {
        await browser.tabs.reload(tab.id);
      } catch (err) {
        // A tab that refuses is reported by the reading that follows, not here.
      }
    }
    asked.push({ id: tab.id, site: site.id, was: unloaded ? 'unloaded' : tab.status || 'unknown' });
  }
  return JSON.stringify(asked, null, 1);
})()
