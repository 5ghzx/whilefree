/**
 * Open the ten AI sites in the running rig, one tab each, from inside the extension.
 *
 * The BiDi-driven way to do this (`scripts/bidi.mjs open`) is the nicer one, because it also
 * reports the browsing context — but the Remote Agent admits exactly one session at a time and
 * does not release it when a client dies, so a single interrupted command closes that door until
 * the browser restarts. This is the way in that does not care: the background page is reachable
 * over RDP whatever BiDi is doing, and `tabs.create` is an API the extension really has.
 *
 * Tabs are created inactive, so nothing is brought to the front and the rig stays out of the
 * way while the ten SPAs boot. `autoOpenTabs` stays off: this is the harness opening pages to
 * be observed, not the engine opening them as part of a send, and the two must not be confused
 * — the second is a thing under test.
 */
(async () => {
  const urls = [
    'https://chatgpt.com/',
    'https://claude.ai/new',
    'https://gemini.google.com/app',
    'https://www.perplexity.ai/',
    'https://chat.deepseek.com/',
    'https://grok.com/',
    'https://copilot.microsoft.com/',
    'https://chat.mistral.ai/chat',
    'https://chat.qwen.ai/',
    'https://www.kimi.ai/',
  ];
  const opened = [];
  for (const url of urls) {
    const tab = await browser.tabs.create({ url, active: false });
    opened.push({ id: tab.id, url });
  }
  return JSON.stringify(opened);
})()
