/**
 * The state object behind the panel, with the parts the panel whispers: per-target reasons.
 *
 * A row reading "failed" is the end of a chain that has an `error` and an `errorCode` on it, and
 * neither is drawn — the panel has no room for them. This asks the background the same question
 * the panel asks (GET_STATE) and prints the job's targets as the engine recorded them, which is
 * the difference between "Perplexity failed" and "Perplexity failed because the send could not
 * be started".
 *
 * Run it in the popup page, which is an extension page and can talk to the background directly:
 *
 *   node scripts/rdp.mjs bg whilefree@whilefree.app @scripts/probes/fx-bg-state.js
 */
(async () => {
  const state = await browser.runtime.sendMessage({ type: 'wf:get-state' });
  if (!state) return 'no state — was the background asleep?';
  const job = state.job && state.job.activeJob;
  const clip = (text) => String(text || '').slice(0, 70);
  return JSON.stringify(
    {
      version: state.version,
      counts: state.job ? state.job.counts : null,
      activeJob: job
        ? {
            jobId: job.jobId,
            running: job.running,
            origin: job.originSiteId,
            targets: (job.targets || []).map((t) => ({
              siteId: t.siteId,
              state: t.state,
              attempts: t.attempts,
              error: t.error,
              errorCode: t.errorCode,
            })),
          }
        : null,
      answers: (state.answers || []).map((a) => ({
        siteId: a.siteId,
        state: a.state,
        readyAt: a.readyAt,
        keys: Object.keys(a).join(','),
        text: clip(a.text || a.summary || a.excerpt),
      })),
      sites: (state.sites || []).map(
        (s) =>
          `${s.id} ${s.enabled ? 'on' : 'off'} ${s.verified ? 'verified' : 'unverified'} open=${s.openTabs}${s.attention ? ' attention=' + s.attention : ''}${s.hasComposer === false ? ' no-composer' : ''}`
      ),
      today: state.today ? state.today.totals : null,
    },
    null,
    1
  );
})()
