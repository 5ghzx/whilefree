// What does this page's own markup say about the person looking at it?
// Run: node scripts/cdp.mjs eval chatgpt.com @scripts/probes/page-identity.js
(() => {
  const short = (s) => String(s || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const visible = (el) => el.getClientRects().length > 0;
  const doorRe = /^(log|sign) ?in$|^sign ?up( for free)?$/i;

  const doors = [...document.querySelectorAll('a, button, [role="button"]')]
    .filter((el) => visible(el) && doorRe.test(short(el.textContent)))
    .map((el) => `${el.tagName.toLowerCase()}:"${short(el.textContent)}"`);

  const account = document.querySelector(
    '[data-testid="user-menu-button"], [aria-label*="account" i], button[aria-label*="Account" i], [data-testid*="profile" i]'
  );

  const composer =
    document.querySelector('div[contenteditable="true"], textarea') ||
    document.querySelector('[role="textbox"]');

  return {
    url: location.href.slice(0, 60),
    title: short(document.title),
    doors: doors.slice(0, 5),
    accountButton: account ? short(account.textContent) || short(account.getAttribute('aria-label')) : null,
    composer: composer ? composer.tagName.toLowerCase() : null,
    bodyStart: short(document.body.innerText).slice(0, 120),
  };
})();
