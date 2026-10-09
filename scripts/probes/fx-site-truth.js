/**
 * What this page actually looks like after a broadcast: the four facts a fan-out is judged on.
 *
 * The panel's job card is a claim made one level away from the page, and every disagreement
 * found so far has been a claim that was wrong in one direction or the other. This reads the
 * page: is there a composer, does it still hold text (a prompt that never left), how many
 * characters of answer are on screen (from the same high-water measurement the engine uses),
 * and whether the stop control is up (a send still running).
 *
 *   node scripts/rdp.mjs eval gemini @scripts/probes/fx-site-truth.js
 *
 * `lastUserText` is the conversation's own echo of what was asked, which is the only place that
 * says whether the prompt *arrived* rather than whether it was typed into the right element.
 */
(() => {
  const site = WF.sites.fromUrl(location.href);
  if (!site) return JSON.stringify({ url: location.href, site: null });
  const composer = WF.dom.findComposer(document, site);
  const diag = WF.dom.diagnose(document, site, location.href);
  let lastUser = null;
  try {
    lastUser = WF.dom.lastUserText(document, site);
  } catch (err) {
    lastUser = `error: ${err.message}`;
  }
  const boxText = composer ? WF.dom.composerText(composer) : null;
  // The tail of what the assistant has written, which is the difference between "a node exists"
  // and "an answer is on screen": several of these pages keep model switchers and chips in
  // markup that matches their own answer selector, so a node count alone is not evidence.
  let answerTail = null;
  try {
    const nodes = WF.dom.assistantNodes(document, site) || [];
    const text = nodes.map((node) => node.innerText || '').join('\n').trim();
    answerTail = text.slice(-160);
  } catch (err) {
    answerTail = `error: ${err.message}`;
  }
  return JSON.stringify(
    {
      site: site.id,
      url: location.href,
      composer: Boolean(composer),
      answerTail,
      boxChars: boxText === null ? null : boxText.length,
      boxSample: boxText === null ? null : boxText.slice(0, 60),
      answerNodes: diag.answers ? diag.answers.nodes : null,
      answerChars: diag.answers ? diag.answers.chars : null,
      stop: diag.stopPresent,
      attention: diag.attention,
      lastUser: lastUser === null ? null : String(lastUser).slice(0, 60),
    },
    null,
    1
  );
})()
