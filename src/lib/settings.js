/** Default settings, validation, and merge. Pure — no browser APIs. */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});

  const DEFAULTS = {
    // 2 is the release whose default stopped opening a tab for an AI that is closed. The
    // number is only ever compared, never displayed; see `normalize` for what it does.
    version: 2,

    // Which AIs a broadcast fans out to. `null` means every AI the registry knows
    // about, which is the intended default: WhileFree has no paid tier, so there is no
    // cap on how many sites you can use. Keeping the list implicit here means adding a
    // provider in lib/sites.js is genuinely a one-file change.
    enabledSites: null,

    // Sending
    broadcastEnabled: true, // master switch: while this is off, nothing is ever sent
    // 'continue' appends to the conversation already open; 'new_chat' starts a fresh
    // one each time, which is what you want when comparing answers to the same prompt.
    sendMode: 'continue',
    // Asking in an AI's own message box fans the prompt out to the others, with no
    // extra press. Off means the launcher and the popup are the only ways to send.
    autoCapture: true,
    // Hold a prompt back unless every enabled AI is ready, so chat histories stay in
    // step instead of one site getting the prompt and another missing it.
    lockstep: false,
    retryAttempts: 2, // attempts per AI before the failure is reported
    // How long to wait for a page's message box to appear before giving up on it. Cold
    // single-page apps on a busy machine can take a while, and giving up early is what
    // makes a send look like it silently vanished.
    readyTimeoutMs: 30000,

    // Tabs
    // A broadcast reaches the AIs that are already open, and no further. Off by default,
    // because a fan-out is something you do *from* a conversation you are in and the tabs it
    // used to open arrived behind your back: ask once in an existing chat and ten tabs were
    // born for it. Opening a tab is a heavier thing to do to someone than skipping one — it
    // is memory, it is a loading page, it is a window that was not there before — so it is
    // the thing the user asks for, and the switch below the list is where they ask.
    autoOpenTabs: false,
    keepTabsOpen: true, // leave those tabs alone once the answer lands
    reuseExistingTabs: true,
    groupTabs: true, // put the broadcast's tabs in one tab group (Chrome only)
    // Bring a tab to the front for one last attempt when a site will not take a prompt
    // from a background tab, then put the user back where they were. Gemini is the site
    // that made this necessary; on the others it never fires.
    focusOnRetry: true,
    // A broadcast's own tabs go into one window of their own, opened around the first tab
    // it needs, so ten answers are one window you can flip through — and close as a unit —
    // instead of ten tabs appearing in the middle of the ones you already had open. Only
    // tabs we open go in: the tab you asked from, and any tab that was already yours, stay
    // exactly where they are. Off means an opened tab lands in the window you are using.
    singleWindow: true,

    // A broadcast goes to every site at once — no queue, no waiting for one site before
    // the next. The only pause is inside a single site, between typing the prompt and
    // pressing send, which the site needs to register what was typed.
    settleMs: [60, 160],

    // Alerts
    badgeEnabled: true, // the green count on the toolbar icon for answers that landed
    chimeEnabled: true,
    chimeVolume: 0.4,
    chimeSites: {}, // siteId -> false to mute that site's chime
    notifySystem: false, // also raise an OS notification
    notifyMinWaitMs: 0, // only alert when the answer took longer than this
    notifyProblems: true, // an AI needs you, or nothing was sent — worth interrupting for
    weeklyReportEnabled: true, // the Monday summary, on by default because it is free
    quietHours: null, // { from: 22, to: 7 }

    // Site behaviour
    disableSlowModes: { deepseek: true }, // switch off DeepThink/R1 before sending
    followUpWindowMs: 300000, // a new prompt within this window counts as a follow-up

    // Dashboard
    rangeDays: 7,
    prices: {}, // siteId -> $ per month the user says they pay
    onboardingDone: false,

    // Housekeeping
    overlayEnabled: true, // the small in-page launcher and status list
    confirmBeforeBroadcast: false,
    eventsRetention: 5000,
  };

  function normalize(raw) {
    const merged = WF.util.deepMerge(DEFAULTS, raw || {});
    const known = WF.sites ? WF.sites.ORDER : [];
    // An explicit list is honoured, minus anything the registry no longer knows;
    // null (the default) means everything, which is how a newly added provider
    // becomes available without the user having to go and switch it on.
    //
    // An explicitly *empty* list stays empty. That is a real state — someone who has taken
    // every AI out — and quietly substituting all ten for "nothing" would put back exactly
    // the switches that were turned off.
    merged.enabledSites = Array.isArray(merged.enabledSites)
      ? merged.enabledSites.filter((id) => known.includes(id))
      : known.slice();
    // Keep site ids that disappeared from the registry, so a temporary removal
    // does not silently wipe the user's switch state.
    for (const id of Object.keys(raw && raw.chimeSites ? raw.chimeSites : {})) {
      if (!(id in merged.chimeSites)) merged.chimeSites[id] = raw.chimeSites[id];
    }
    merged.settleMs = coerceRange(merged.settleMs, DEFAULTS.settleMs, 0, 5000);
    merged.readyTimeoutMs = WF.util.clamp(
      Number(merged.readyTimeoutMs) || DEFAULTS.readyTimeoutMs,
      2000,
      120000
    );
    merged.chimeVolume = WF.util.clamp(Number(merged.chimeVolume) || 0, 0, 1);
    merged.rangeDays = WF.util.clamp(Number(merged.rangeDays) || 7, 1, 3650);
    merged.notifyMinWaitMs = WF.util.nearestWaitStep(merged.notifyMinWaitMs);
    merged.sendMode = merged.sendMode === 'new_chat' ? 'new_chat' : 'continue';
    // Whether an AI may be sent to is not a setting. It used to be one — `requireSignIn`, a
    // switch in the popup and the dashboard — and switching it off was the only way to reach
    // the behaviour it named: a fan-out into pages that had never said they were signed in,
    // which comes back as "no answer" from seven tabs and reads as our bug. An AI is a target
    // when its own page has said it is signed in, and there is nothing to turn that off with;
    // a stored `false` from the old switch is dropped here so it cannot come back through a
    // merge or a hand-edited record.
    delete merged.requireSignIn;
    merged.retryAttempts = WF.util.clamp(Math.round(Number(merged.retryAttempts) || 2), 1, 4);
    for (const key of [
      'broadcastEnabled',
      'autoCapture',
      'lockstep',
      'groupTabs',
      'focusOnRetry',
      'singleWindow',
      'notifyProblems',
      'weeklyReportEnabled',
    ]) {
      merged[key] = merged[key] !== false;
    }
    merged.eventsRetention = WF.util.clamp(Number(merged.eventsRetention) || 5000, 200, 50000);

    // The one-time move to version 2, and the reason it has to exist.
    //
    // Version 1 stored `autoOpenTabs: true`, because that was the default then. It is the
    // default no longer, and a stored `true` cannot be told apart from a deliberate yes — so
    // without this, the change would reach only new installs, and the people who complained
    // about ten tabs appearing behind their prompt would be the exact people who kept getting
    // them. The switch is therefore reset once on the way up, and the record is stamped with
    // the new version as part of the same write: after that, only the user's own setting
    // decides, which is what "once" means. It is placed last so nothing below can put it back.
    const storedVersion = Number(raw && raw.version) || 0;
    merged.version = DEFAULTS.version;
    if (storedVersion < DEFAULTS.version) merged.autoOpenTabs = false;
    return merged;
  }

  /**
   * A [min, max] pair, clamped and ordered. Junk falls back to the default rather
   * than to the widest possible range, so a hand-edited settings object cannot turn
   * a 1-second gap into a 5-second one.
   */
  function coerceRange(value, fallback, min, max) {
    const arr = Array.isArray(value) && value.length === 2 ? value.map(Number) : null;
    if (!arr || !arr.every((n) => isFinite(n))) return fallback.slice();
    const lo = WF.util.clamp(arr[0], min, max);
    const hi = WF.util.clamp(arr[1], lo, max);
    return [lo, hi];
  }

  /** Random delay from a [min, max] pair. */
  function delayFrom(pair) {
    const [lo, hi] = coerceRange(pair, [0, 0], 0, 60000);
    return WF.util.randInt(lo, hi);
  }

  /** Every AI switched on. Used by an explicit "ask every AI", including this one. */
  function allTargets(settings) {
    return (settings.enabledSites || []).slice();
  }

  /**
   * Where a fan-out goes: every enabled AI except the one it came from.
   *
   * A prompt you typed into ChatGPT's own box has already been sent there, so sending it
   * to ChatGPT again would post it twice — hence the exclusion. That is the only case it
   * applies to: pressing *Ask all* asks every switched-on AI, the one you are looking at
   * included.
   */
  function targetsFor(settings, originSiteId) {
    const enabled = settings.enabledSites || [];
    return enabled.filter((id) => id !== originSiteId);
  }

  function siteEnabled(settings, siteId) {
    return (settings.enabledSites || []).includes(siteId);
  }

  function chimeFor(settings, siteId) {
    if (!settings.chimeEnabled) return false;
    const map = settings.chimeSites || {};
    return map[siteId] !== false;
  }

  function inQuietHours(settings, ts) {
    const q = settings.quietHours;
    if (!q) return false;
    const hour = new Date(ts).getHours();
    if (q.from === q.to) return false;
    return q.from < q.to ? hour >= q.from && hour < q.to : hour >= q.from || hour < q.to;
  }

  WF.settings = {
    DEFAULTS,
    normalize,
    coerceRange,
    delayFrom,
    allTargets,
    targetsFor,
    siteEnabled,
    chimeFor,
    inQuietHours,
  };
})();
