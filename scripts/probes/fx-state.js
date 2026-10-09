/**
 * What the installed Firefox build believes, read from inside its own background page.
 *
 * The first thing to run after `sh scripts/install-firefox.sh` and a restart: it answers
 * "is this the build I think it is" and "what does the extension think about ten sites"
 * in one reading, before any page is opened. Run through the RDP rig, which is where an
 * extension's own worlds live on Firefox:
 *
 *   node scripts/rdp.mjs bg whilefree@whilefree.app @scripts/probes/fx-state.js
 *
 * The API readings are the interesting half on Firefox: `offscreen`, `tabGroups` and
 * `scripting` are the three Chrome features the code has a fallback for, and which of
 * them exist here is what decides which branch of it this build runs.
 */
(async () => {
  const manifest = browser.runtime.getManifest();
  const gecko = (manifest.browser_specific_settings || {}).gecko || {};
  const settings = await WF.bg.store.settings(true);
  const status = await WF.storage.getSiteStatus();
  const open = await WF.bg.engine.openCounts();
  return JSON.stringify(
    {
      version: manifest.version,
      name: `${manifest.name} (${manifest.name.length} chars)`,
      geckoId: gecko.id,
      minVersion: gecko.strict_min_version,
      dataCollection: gecko.data_collection_permissions,
      apis: {
        offscreen: typeof browser.offscreen,
        tabGroups: typeof browser.tabGroups,
        scripting: typeof browser.scripting,
      },
      master: settings.broadcastEnabled,
      autoOpenTabs: settings.autoOpenTabs,
      sendMode: settings.sendMode,
      autoCapture: settings.autoCapture,
      overlayEnabled: settings.overlayEnabled,
      sites: WF.sites.list().map((site) => {
        const record = status[site.id] || {};
        return {
          id: site.id,
          on: (settings.enabledSites || []).includes(site.id),
          verified: WF.bg.engine.isVerified(record),
          open: open[site.id] || 0,
          attention: record.attention || null,
          hasComposer: record.hasComposer,
          verifiedAt: record.verifiedAt ? new Date(record.verifiedAt).toISOString() : null,
        };
      }),
    },
    null,
    1
  );
})()
