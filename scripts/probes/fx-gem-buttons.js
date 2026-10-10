/**
 * What the Gemini app shell is drawing right now — labels only, with addresses redacted.
 *
 *   node scripts/rdp.mjs eval gemini @scripts/probes/fx-gem-buttons.js
 *
 * Used when the signed-in probes disagree: it prints the visible controls, any account links and
 * the header text so the state can be read from the page itself rather than from a guess about
 * which selector a signed-in page uses.
 */
(() => {
  const visible = (node) => {
    try {
      return WF.dom.isVisible(node);
    } catch (err) {
      return false;
    }
  };
  const clean = (text) => String(text || '').replace(/\s+/g, ' ').trim().replace(/[\w.+-]+@[\w.-]+/g, '<email>');
  const labels = (selector, cap) =>
    Array.from(document.querySelectorAll(selector))
      .filter(visible)
      .map((node) => clean(node.getAttribute('aria-label') || node.textContent))
      .filter(Boolean)
      .slice(0, cap);

  return JSON.stringify(
    {
      readyState: document.readyState,
      title: document.title,
      buttons: labels('button', 30),
      accountLinks: Array.from(document.querySelectorAll('a[href*="accounts.google.com"], a[href*="SignOutOptions"]'))
        .map((node) => ({ label: clean(node.getAttribute('aria-label') || node.textContent), visible: visible(node) }))
        .slice(0, 8),
      avatars: Array.from(document.querySelectorAll('img'))
        .filter((img) => visible(img) && /googleusercontent|profile|avatar/i.test(String(img.src) + img.alt + img.className))
        .map((img) => ({ alt: clean(img.alt), host: (img.src || '').split('/')[2] || '' }))
        .slice(0, 6),
      header: clean(
        (document.querySelector('header, top-bar, .header, mat-toolbar') || {}).innerText || ''
      ).slice(0, 220),
      sidePanel: labels('side-navigation-v2 a, .sidenav a', 12),
    },
    null,
    1
  );
})()
