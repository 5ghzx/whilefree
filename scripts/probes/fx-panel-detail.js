/**
 * The panel's job rows as markup, plus the badge's colour, for when the row's text is a riddle.
 *
 * A row like "Perplexity · failed · try 2" is a verdict with the reason stripped out: the
 * reason is on the row as a `title`, and the row's classes carry the state the stylesheet
 * colours. Reading text alone loses exactly the part worth having when something failed.
 *
 * The badge's *colour* is the other half of a number: `lib/badge.js` uses the same slot for two
 * different counts — amber for AIs that need you, green for answers waiting — so a badge of 3
 * is three answers or three problems, and only the colour says which.
 *
 *   node scripts/rdp.mjs bg whilefree@whilefree.app @scripts/probes/fx-panel-detail.js
 */
(async () => {
  const job = document.getElementById('job-targets');
  if (!job) return 'not the popup page';
  let badge = null;
  let badgeColor = null;
  try {
    badge = await browser.action.getBadgeText({});
    const color = await browser.action.getBadgeBackgroundColor({});
    badgeColor = Array.isArray(color) ? `rgb(${color.join(',')})` : String(color);
  } catch (err) {
    badge = `error: ${err.message}`;
  }
  return JSON.stringify(
    {
      badge,
      badgeColor,
      jobTitle: (document.getElementById('job-title') || {}).textContent,
      rows: Array.from(job.children).map((row) => ({
        text: (row.innerText || '').replace(/\n+/g, ' · ').trim(),
        title: row.getAttribute('title'),
        classes: row.className,
        state: row.getAttribute('data-state') || row.getAttribute('data-status') || null,
      })),
    },
    null,
    1
  );
})()
