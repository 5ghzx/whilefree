/**
 * Message contract between the four contexts.
 * Every message is `{ type, ...payload }`; the sender fills `type` from here so a
 * typo becomes an undefined instead of a silently ignored string.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});

  WF.MSG = Object.freeze({
    // content -> background
    HELLO: 'wf:hello', // page booted / navigated: { siteId, url, hasComposer, dormant? }
    BROADCAST: 'wf:broadcast', // { prompt, originSiteId } -> { jobId }
    CAPTURE: 'wf:capture', // { prompt, hash, siteId } — a prompt sent in the AI's own box
    STATE: 'wf:state', // per-target answer lifecycle
    ACTIVITY: 'wf:activity', // timed deltas for writing / waiting / reading
    SITE_STATUS: 'wf:site-status', // attention needed (login, quota, check)
    OPEN_ANSWER: 'wf:open-answer', // { answerId }

    // background -> content
    SEND: 'wf:send', // { jobId, siteId, prompt, options }
    PROBE: 'wf:probe', // { hash } -> did this prompt already land in this tab?
    NEW_CHAT: 'wf:new-chat', // start a fresh conversation in this tab
    READY: 'wf:ready', // { timeoutMs } -> wait until this page's message box exists
    PING: 'wf:ping', // -> this page's own live verdict: { hasComposer, signedIn, attention }
    CHIME: 'wf:chime',
    SETTINGS_CHANGED: 'wf:settings-changed',
    CANCEL_JOB: 'wf:cancel-job',
    ANSWERS: 'wf:answers', // the answers-ready list changed
    JOB: 'wf:job', // a broadcast started or ended, for the in-page status list
    JOB_TARGET: 'wf:job-target', // one target changed state

    // content or popup -> background
    CLEAR_ANSWERS: 'wf:clear-answers',
    OPEN_DASHBOARD: 'wf:open-dashboard',
    CANCEL: 'wf:cancel',
    CANCEL_TARGET: 'wf:cancel-target', // { jobId, siteId } — one AI, not the whole job
    RETRY_TARGET: 'wf:retry-target', // { jobId, siteId } — send this one again
    OPEN_COMPARE: 'wf:open-compare', // put the answering tabs side by side in one window
    WEEKLY_REPORT: 'wf:weekly-report', // build the weekly digest now, for the button
    GET_STATE: 'wf:get-state', // everything the popup renders
    SET_SETTINGS: 'wf:set-settings', // { patch }
    TEST_SITE: 'wf:test-site', // { siteId } -> selector diagnostic
    VERIFY_SITE: 'wf:verify-site', // { timeoutMs } -> is this page signed in and ready?
  });

  /**
   * Why one target of a broadcast ended the way it did. A closed set, because the
   * engine decides whether a failure is worth retrying from this — and because only
   * some of these mean "the prompt may already be in the box", which is the one case
   * where retrying carelessly sends a prompt twice.
   */
  WF.CODE = Object.freeze({
    NO_COMPOSER: 'no-composer',
    INSERT_FAILED: 'insert-failed',
    SUBMIT_FAILED: 'submit-failed',
    TAB_GONE: 'tab-gone',
    NEEDS_HUMAN: 'needs-human',
    // Another prompt is already going into this same site. Not queued behind it: the
    // user is told, because a prompt that silently waits looks like one that vanished.
    BUSY: 'busy',
    HELD_BACK: 'held-back',
    TIMEOUT: 'timeout',
    UNKNOWN: 'unknown',
  });

  /**
   * Failures where the text may already be sitting in the message box: the retry
   * must ask the page before it sends again, or it double-posts. Their
   * counterpart is called `mayHaveLanded`, which is a good name for it.
   */
  WF.MAY_HAVE_LANDED = Object.freeze([
    WF.CODE.INSERT_FAILED,
    WF.CODE.SUBMIT_FAILED,
    WF.CODE.UNKNOWN,
  ]);

  /** Answer lifecycle phases reported by content scripts. */
  WF.PHASE = Object.freeze({
    READY: 'ready',
    SENDING: 'sending',
    SENT: 'sent',
    STREAMING: 'streaming',
    DONE: 'done',
    ERROR: 'error',
    ATTENTION: 'attention',
    TIMEOUT: 'timeout',
  });

  /** Reasons a site might need the human. Shown in the popup, never auto-solved. */
  WF.ATTENTION = Object.freeze({
    SIGNED_OUT: 'signed-out',
    QUOTA: 'quota',
    CHECK: 'check',
    NO_COMPOSER: 'no-composer',
    SEND_FAILED: 'send-failed',
    // The one reason that is not about the page: the browser has never handed this extension
    // the site, so no content script is running there to have a page to be wrong about. It
    // reads like the others in the panel because the user's move is the same one — act on
    // that site — but the actor is the browser, not the session.
    NO_ACCESS: 'no-access',
  });

  const ATTENTION_LABEL = {
    'signed-out': 'Signed out',
    quota: 'Out of quota',
    check: 'Showing a check',
    'no-composer': 'Message box not found',
    'send-failed': 'Send did not go through',
    'no-access': 'This browser has not allowed it here',
  };

  WF.attentionLabel = (reason) => ATTENTION_LABEL[reason] || 'Needs you';

  /** The three things a minute in an AI tab can be. */
  WF.STATES = Object.freeze(['writing', 'waiting', 'waitingAway', 'reading']);
  WF.STATE_LABEL = Object.freeze({
    writing: 'writing',
    waiting: 'waiting',
    waitingAway: 'waiting elsewhere',
    reading: 'reading',
  });
})();
