/**
 * Open the extension's own popup page as a tab, so the panel can be driven without a mouse.
 *
 * A browser-action popup cannot be opened by code — that is the point of it — but it is only an
 * extension page, and nothing stops an extension page being opened as a tab where the rig can
 * read it. Everything the panel does then works the same way: same document, same script, same
 * messages to the background. It also gives the rig a second wake source, since an extension
 * page's request is enough to start the event page on Firefox.
 *
 * Idempotent: the existing tab is reused when there is one, so consecutive probes do not pile up
 * copies of the panel.
 *
 *   node scripts/rdp.mjs bg whilefree@whilefree.app @scripts/probes/fx-popup-tab.js
 */
(async () => {
  const url = browser.runtime.getURL('popup/popup.html');
  const open = (await browser.tabs.query({ url }))[0];
  const tab = open || (await browser.tabs.create({ url, active: false }));
  return JSON.stringify({ tabId: tab.id, url, reused: Boolean(open) });
})()
