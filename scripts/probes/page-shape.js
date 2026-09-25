// What is actually on this page?
// Run: node scripts/cdp.mjs eval copilot.microsoft.com @scripts/probes/page-shape.js
//
// Used for the sites where the adapter finds no composer and no attention reason either: the
// answer is usually "the chat is in an iframe", "it is a marketing page", or "there is a
// sign-in wall we do not name".
(() => {
  const short = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 90);
  const editable = [...document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"], input[type="search"]')];
  return {
    url: location.href.slice(0, 70),
    title: short(document.title),
    frames: [...document.querySelectorAll('iframe')].map((f) => ({
      src: short(f.getAttribute('src') || f.src),
      size: `${Math.round(f.getBoundingClientRect().width)}x${Math.round(f.getBoundingClientRect().height)}`,
    })),
    editables: editable.map((n) => ({
      tag: n.tagName.toLowerCase(),
      id: n.id || null,
      visible: n.getClientRects().length > 0,
      size: `${Math.round(n.getBoundingClientRect().width)}x${Math.round(n.getBoundingClientRect().height)}`,
      aria: short(n.getAttribute('aria-label') || n.getAttribute('placeholder')),
    })),
    doors: [...document.querySelectorAll('a, button, [role="button"]')]
      .filter((n) => n.getClientRects().length > 0)
      .map((n) => short(n.textContent || n.getAttribute('aria-label')))
      .filter((t) => /log ?in|sign ?in|sign ?up|create|continue with|get started/i.test(t))
      .slice(0, 8),
    firstWords: short(document.body.innerText).slice(0, 200),
  };
})();
