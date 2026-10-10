/**
 * Which nodes Gemini's answer selectors actually match, in the order they are joined.
 *
 *   node scripts/rdp.mjs eval gemini @scripts/probes/fx-gem-nodes.js
 *
 * The truth probe showed the joined answer text ending in the label `Gemini said`, which means
 * at least one matched node holds the label rather than (or as well as) the response. This prints
 * each node's tag, class, length and a preview so the selector that is wrong is visible, plus
 * the total the engine records.
 */
(() => {
  const site = WF.sites.fromUrl(location.href);
  if (!site) return JSON.stringify({ url: location.href, site: null });
  const text = (node) => String((node.innerText !== undefined ? node.innerText : node.textContent) || '')
    .replace(/\s+/g, ' ')
    .trim();
  const nodes = WF.dom.assistantNodes(document, site) || [];
  const chars = WF.dom.assistantChars(document, site);
  return JSON.stringify(
    {
      url: location.href,
      count: nodes.length,
      totalChars: chars.chars,
      stop: Boolean(WF.dom.findStopButton(document, site)),
      nodes: nodes.map((node) => {
        const body = text(node);
        return {
          tag: node.tagName.toLowerCase(),
          cls: String(node.className || '').slice(0, 80),
          len: body.length,
          head: body.slice(0, 70),
          tail: body.slice(-70),
        };
      }),
      selectors: site.answer.selectors.map((selector) => {
        try {
          return `${selector} -> ${document.querySelectorAll(selector).length}`;
        } catch (err) {
          return `${selector} -> bad selector`;
        }
      }),
    },
    null,
    1
  );
})()
