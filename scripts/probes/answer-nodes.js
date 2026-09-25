// Which nodes do this site's answer selectors really match, and whose words are in them?
// Run: node scripts/cdp.mjs eval claude.ai @scripts/probes/answer-nodes.js
(() => {
  const WF = globalThis.WF;
  const site = WF.sites.fromUrl(location.href);
  const short = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 70);
  const out = { site: site.id, selectors: [], totals: WF.dom.assistantChars(document, site) };

  for (const selector of site.answer.selectors) {
    let nodes = [];
    try {
      nodes = [...document.querySelectorAll(selector)];
    } catch (err) {
      out.selectors.push({ selector, error: 'bad selector' });
      continue;
    }
    out.selectors.push({
      selector,
      count: nodes.length,
      nodes: nodes.slice(-4).map((n) => ({
        tag: n.tagName.toLowerCase(),
        // `data-*` hints are what a site uses to say whose turn it is.
        hints: [...n.attributes]
          .filter((a) => a.name.startsWith('data-') || a.name === 'class')
          .map((a) => `${a.name}=${short(a.value).slice(0, 40)}`)
          .slice(0, 4),
        chars: (n.innerText || '').length,
        text: short(n.innerText),
      })),
    });
  }

  // The turn markers these apps actually use, whether or not the adapter names them.
  out.turnHints = {
    userTestId: document.querySelectorAll('[data-testid="user-message"]').length,
    assistantTestId: document.querySelectorAll('[data-testid="assistant-message"]').length,
    streamingAttr: [...document.querySelectorAll('[data-is-streaming]')].map((n) => ({
      value: n.getAttribute('data-is-streaming'),
      chars: (n.innerText || '').length,
      text: short(n.innerText),
    })),
    fontClaude: document.querySelectorAll('div.font-claude-message').length,
    fontUser: document.querySelectorAll('div.font-user-message').length,
  };
  return out;
})();
