/**
 * Is this Gemini tab signed in, and what did the page draw for it?
 *
 *   node scripts/rdp.mjs eval gemini @scripts/probes/fx-gem-state.js
 *
 * `attention: null` from the truth probe is not enough: Gemini gives a stranger a working
 * composer too, so the difference between the two states is the account control (signed in) and
 * the sign-in door (signed out). This lists both, plus how many turns the conversation is
 * showing, which is the cheapest way to tell a fresh anonymous page from the user's own history.
 * No account name or address is returned — only whether the control exists.
 */
(() => {
  const site = WF.sites.fromUrl(location.href);
  if (!site) return JSON.stringify({ url: location.href, site: null });
  const visible = (node) => {
    try {
      return WF.dom.isVisible(node);
    } catch (err) {
      return false;
    }
  };
  const texts = (selector, cap = 6) =>
    Array.from(document.querySelectorAll(selector))
      .filter(visible)
      .map((node) => (node.getAttribute('aria-label') || node.textContent || '').trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .slice(0, cap);

  const composer = WF.dom.findComposer(document, site);
  const accountControls = texts('button[aria-label*="Google Account" i], button[aria-label*="account" i]');
  const doors = Array.from(document.querySelectorAll('a, button, [role="button"]'))
    .filter(visible)
    .map((node) => (node.getAttribute('aria-label') || node.textContent || '').trim().replace(/\s+/g, ' '))
    .filter((label) => /^(sign|log) ?in( to .+)?$/i.test(label))
    .slice(0, 6);

  return JSON.stringify(
    {
      url: location.href,
      composer: Boolean(composer),
      // Present + labelled as an account control means a session; empty means no session was found.
      accountControl: accountControls[0] || null,
      accountControlCount: accountControls.length,
      visibleSignInDoors: doors,
      attention: WF.dom.detectAttention(document, site, location.href, Boolean(composer)),
      turns: {
        userQueries: document.querySelectorAll('user-query').length,
        modelResponses: document.querySelectorAll('model-response').length,
        queryLines: document.querySelectorAll('.query-text-line').length,
      },
    },
    null,
    1
  );
})()
