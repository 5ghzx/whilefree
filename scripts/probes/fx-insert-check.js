/**
 * Does the text actually land in this page's composer, and what does its send control look like
 * afterwards? The two halves of a `send-failed`, separated.
 *
 * `send-failed` is returned both when the box never accepted the prompt and when it accepted it
 * and the press produced no evidence, and the message that carries it back drops the field that
 * tells them apart. This does the insertion by hand — the same `setComposerText` the send path
 * uses, then the same settle-and-read-back — and reports what the box holds, what the send
 * control resolves to, and whether it is disabled. Nothing is pressed: the text is cleared
 * afterwards, so the page is left as it was found.
 *
 *   node scripts/rdp.mjs eval perplexity @scripts/probes/fx-insert-check.js
 */
(async () => {
  const site = WF.sites.fromUrl(location.href);
  if (!site) return JSON.stringify({ url: location.href, site: null });
  const marker = 'whilefree probe 12345';
  const input = WF.dom.findComposer(document, site);
  if (!input) return JSON.stringify({ site: site.id, composer: false }, null, 1);
  const written = WF.dom.setComposerText(document, input, marker);
  await new Promise((resolve) => setTimeout(resolve, 700));
  const boxText = WF.dom.composerText(input);
  const read = WF.dom.readComposer(input, WF.dom.normalize(marker));
  const send = WF.dom.findSendButton(document, site, input);
  const report = {
    site: site.id,
    url: location.href,
    mode: (site.send && site.send.mode) || null,
    written,
    boxChars: boxText.length,
    boxSample: boxText.slice(0, 60),
    readBackExact: read ? read.exact : null,
    send: send
      ? {
          label: WF.dom.labelOf(send),
          tag: send.tagName,
          disabled: send.disabled === true,
          ariaDisabled: send.getAttribute('aria-disabled'),
          visible: WF.dom.isVisible(send),
        }
      : null,
    diagnostic: WF.dom.diagnose(document, site, location.href),
  };
  // Leave the page as it was found: a probe that leaves text in a composer is a probe that puts
  // words in the user's next message.
  try {
    WF.dom.clearComposer(document, input);
  } catch (err) {
    report.clearError = String(err && err.message);
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
  report.boxAfterClear = WF.dom.composerText(input).length;
  return JSON.stringify(report, null, 1);
})()
