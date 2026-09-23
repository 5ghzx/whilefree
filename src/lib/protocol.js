/**
 * Message contract between the four contexts.
 * Every message is `{ type, ...payload }`; the sender fills `type` from here so a
 * typo becomes an undefined instead of a silently ignored string.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});

  WF.MSG = Object.freeze({
    // content -> background
    HELLO: 'wf:hello', // page booted / navigated: { siteId, url, signedIn, blocked }
    BROADCAST: 'wf:broadcast', // { prompt, originSiteId } -> { jobId }
    STATE: 'wf:state', // per-target answer lifecycle
    ACTIVITY: 'wf:activity', // timed deltas for writing / waiting / reading
    SITE_STATUS: 'wf:site-status', // attention needed (login, quota, check)
    OPEN_ANSWER: 'wf:open-answer', // { answerId }
    TEST_TARGET: 'wf:test-target', // { siteId } -> dry run, no send

    // background -> content
    SEND: 'wf:send', // { jobId, siteId, prompt, options }
    PING: 'wf:ping',
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
    GET_STATE: 'wf:get-state', // everything the popup renders
    SET_SETTINGS: 'wf:set-settings', // { patch }
    TEST_SITE: 'wf:test-site', // { siteId } -> selector diagnostic
  });

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
  });

  const ATTENTION_LABEL = {
    'signed-out': 'Signed out',
    quota: 'Out of quota',
    check: 'Showing a check',
    'no-composer': 'Message box not found',
    'send-failed': 'Send did not go through',
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
