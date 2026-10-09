/**
 * The popup's "Check this tab's markup", run from the rig.
 *
 * This is the same call the button makes — `WF.dom.diagnose` in the page's own content-script
 * world — so what it prints is what the panel would show, not a second implementation of it
 * that could be right about a page the extension is wrong about. Per docs/SITE-BEHAVIOUR.md
 * this is the whole bug report for a site whose selectors have moved: `composer`, `send`,
 * `stopPresent` and `answers` are the four readings, and a null among them is the finding.
 *
 *   node scripts/rdp.mjs eval chatgpt.com @scripts/probes/fx-diagnose.js
 *
 * `<site>` matches on a substring of the tab's url, so the short host is enough.
 */
(() => {
  const site = WF.sites.fromUrl(location.href);
  if (!site) return JSON.stringify({ url: location.href, site: null }, null, 1);
  return JSON.stringify(WF.dom.diagnose(document, site, location.href), null, 1);
})()
