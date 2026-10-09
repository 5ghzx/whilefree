/**
 * Time the whole round on Perplexity: write, when the editor admits it, press, and what the
 * conversation says afterwards.
 *
 * The engine's send path gives up when the box does not read back the prompt, and on
 * Perplexity that read is the one thing that cannot be trusted yet — the editor renders from
 * its own model, and the tab is in an unfocused window, where Firefox throttles the frame the
 * render waits on. So this reads the same box at four ages (immediately, 0.5s, 2s, 6s) to find
 * out whether the text is *late* rather than absent, and then presses Submit if it ever showed
 * up, which is the only way to tell "the site never got it" from "we never saw it".
 *
 *   node scripts/rdp.mjs eval perplexity @scripts/probes/fx-perplexity-round.js
 *
 * It leaves the box empty. Set globalThis.__wfSkipPress = true first to stop before the press.
 */
(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const site = WF.sites.fromUrl(location.href);
  const prompt = 'Reply with exactly one word: pong';
  const lex = () =>
    Array.from(document.querySelectorAll('[data-lexical-text="true"]'))
      .map((node) => node.textContent || '')
      .join('');
  const composer = WF.dom.findComposer(document, site);
  if (!composer) return JSON.stringify({ composer: false }, null, 1);

  const report = { site: site.id, hasFocus: document.hasFocus(), hadFocus: null };
  // Start from an empty box: anything left from an earlier attempt would be sent as part of this
  // one, and it would also make the read-back look like success.
  composer.focus();
  report.hadFocus = document.activeElement === composer;
  WF.dom.selectAll(composer);
  const selection = document.getSelection();
  if (selection && selection.deleteFromDocument) selection.deleteFromDocument();
  await sleep(300);
  report.afterClear = { dom: WF.dom.composerText(composer).length, lexical: lex().length };

  const written = WF.dom.setComposerText(document, composer, prompt);
  const samples = [];
  for (const wait of [0, 500, 2000, 6000]) {
    if (wait) await sleep(wait - (samples.length ? samples[samples.length - 1].at : 0));
    samples.push({
      at: wait,
      dom: WF.dom.composerText(composer).length,
      lexical: lex().length,
      exact: WF.dom.readComposer(composer, WF.dom.normalize(prompt)).exact,
    });
  }
  report.written = { ok: written.ok, method: written.method, reason: written.reason || null };
  report.samples = samples;

  if (globalThis.__wfSkipPress) return JSON.stringify(report, null, 1);

  const button = WF.dom.findSendButton(document, site, composer);
  report.button = button ? WF.dom.labelOf(button) : null;
  if (button) {
    button.click();
    await sleep(2500);
    report.afterPress = {
      dom: WF.dom.composerText(composer).length,
      lexical: lex().length,
      lastUser: String(WF.dom.lastUserText(document, site) || '').slice(0, 50),
      answerChars: WF.dom.assistantChars(document, site).chars,
    };
  }
  // Leave it clean whatever happened.
  composer.focus();
  WF.dom.selectAll(composer);
  const sel2 = document.getSelection();
  if (sel2 && sel2.deleteFromDocument) sel2.deleteFromDocument();
  await sleep(300);
  report.finalDom = WF.dom.composerText(composer).length;
  return JSON.stringify(report, null, 1);
})()
