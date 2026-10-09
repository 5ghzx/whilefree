/**
 * What the panel is showing about a broadcast right now: the job card, the answers, the badge.
 *
 * This is the fan-out's user-visible surface, and the three parts have to agree with each other
 * — the job card counts what was sent and to whom, the answers card lists what came back, and
 * the badge is the number on the toolbar icon for someone who is not looking at either. A run
 * that ends with "5 targets done" and a badge of 4, or an answer row for an AI the job card
 * says timed out, is the kind of disagreement this reads for.
 *
 * The badge is read through the real API rather than a stored setting, because a badge is what
 * the user sees and it is set by one code path with no state of its own to inspect.
 *
 *   node scripts/rdp.mjs bg whilefree@whilefree.app @scripts/probes/fx-panel-job.js
 */
(async () => {
  const text = (el) => (el ? (el.innerText || '').replace(/\n+/g, ' · ').trim() : null);
  const list = (id) => {
    const parent = document.getElementById(id);
    return parent ? Array.from(parent.children).map(text) : [];
  };
  let badge = null;
  try {
    badge = await browser.action.getBadgeText({});
  } catch (err) {
    badge = `error: ${err.message}`;
  }
  return JSON.stringify(
    {
      summary: text(document.getElementById('target-summary')),
      badge,
      jobVisible: document.getElementById('job-card') ? !document.getElementById('job-card').hidden : null,
      jobTitle: text(document.getElementById('job-title')),
      targets: list('job-targets'),
      queuedVisible: document.getElementById('queue-card') ? !document.getElementById('queue-card').hidden : null,
      queued: list('queued'),
      answersVisible: document.getElementById('answers-card') ? !document.getElementById('answers-card').hidden : null,
      answersCount: text(document.getElementById('answers-count')),
      answers: list('answers'),
    },
    null,
    1
  );
})()
