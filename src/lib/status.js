/**
 * Site status: has this AI's own page said, recently, that it is signed in and usable?
 *
 * The pages write the record (they are the only ones who can see their own session) and
 * everything else reads it. It lives in one place because the answer decides two things
 * that must never disagree: whether an AI may be switched on, and whether a prompt is
 * actually sent to it. Two copies of this rule is how a switch reads on while the fan-out
 * quietly leaves that AI out.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});

  // How long a sign-in check is trusted. A session that has since expired reports itself
  // as signed out the next time its page is looked at, and a failed send clears the flag
  // outright, so this is only the ceiling on a check nobody has contradicted.
  const TTL_MS = 7 * 24 * 60 * 60 * 1000;

  /**
   * How long "this page needs you" keeps meaning the present tense.
   *
   * Ten minutes, the same window `lib/badge.js` stops nagging the icon at and the same one
   * `blockedTargets` treats as still-blocked. A page that was signed out at ten past three is
   * not evidence that it is signed out now — the user signs in, and the tab is a background tab
   * nobody is looking at, so nothing tells us. The verdict that decides whether a prompt goes
   * out is not this record anyway: every send asks the page itself a moment before it types
   * (see the ping in `engine.js`), and that answer is about now. This timestamp only decides how
   * long a stale record is allowed to keep an AI out of a fan-out and to keep the popup saying
   * "Signed out" about a session that may well have been fine for hours.
   */
  const ATTENTION_TTL_MS = 10 * 60 * 1000;

  /** When this page was last seen asking for a human. Falls back to the record's own stamp. */
  function attentionAt(status) {
    if (!status) return 0;
    const at = Number(status.attentionAt);
    if (Number.isFinite(at) && at > 0) return at;
    // Records written before there was a separate stamp: `at` moved on every write, including
    // the ones that were not about attention at all, so it is a rough answer. Rough and older
    // than the truth is the safe direction, and it is what those records have.
    const fallback = Number(status.at);
    return Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
  }

  /** Is the page still asking? False for a record whose page needs you, recently, and null/no. */
  function attentionIsFresh(status, now) {
    if (!status || !status.attention) return false;
    const at = attentionAt(status);
    if (!at) return true; // no stamp at all: treat it as fresh rather than silently dropping a block
    return (now || Date.now()) - at < ATTENTION_TTL_MS;
  }

  /**
   * Is this status a "yes, send here"?
   *
   * `verifiedAt` is set by the turn-on check in the page itself. Anything the page has
   * since flagged — signed out, out of quota, showing a check — overrides it, because a
   * check that has been contradicted is worse than no check at all.
   *
   * A flag only overrides it while it is fresh. Older than that it is history, and history is
   * not a reason to withhold a prompt: the send asks the page itself first, so a page that
   * really is signed out is caught at the moment it matters instead of being assumed from a
   * reading taken before the user went and fixed it.
   */
  function isVerified(status, now) {
    if (!status || !status.verifiedAt) return false;
    if ((now || Date.now()) - status.verifiedAt > TTL_MS) return false;
    if (attentionIsFresh(status, now)) return false;
    return status.hasComposer !== false;
  }

  WF.status = { TTL_MS, ATTENTION_TTL_MS, attentionAt, attentionIsFresh, isVerified };
})();
