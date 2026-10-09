/**
 * Close the duplicate tab per site, keeping the oldest one.
 *
 * The rig's tab opens come from two directions — the BiDi agent and the extension's own
 * `tabs.create` (scripts/probes/fx-open.js) — and when the first path dies half way through,
 * running the second leaves two tabs for every site it got to. Two tabs of one AI is a state
 * the extension handles deliberately (row 17 in docs/SITE-BEHAVIOUR.md: the newest answer
 * wins, the tab is picked by lastAccessed), so leaving them would quietly turn every reading
 * afterwards into a test of that rule instead of the one being asked about.
 *
 * The oldest tab is the one kept, because it is the one that has had the most time to get
 * past a bot check or an app's first paint.
 *
 *   node scripts/rdp.mjs bg whilefree@whilefree.app @scripts/probes/fx-dedupe.js
 */
(async () => {
  const tabs = (await browser.tabs.query({})).sort((a, b) => a.id - b.id);
  const kept = {};
  const closed = [];
  for (const tab of tabs) {
    const site = WF.sites.fromUrl(tab.url || '');
    if (!site) continue;
    if (site.id in kept) {
      closed.push({ id: tab.id, site: site.id, url: tab.url });
      await browser.tabs.remove(tab.id);
    } else {
      kept[site.id] = tab.id;
    }
  }
  return JSON.stringify({ kept, closed }, null, 1);
})()
