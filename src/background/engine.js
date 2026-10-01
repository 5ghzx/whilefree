/**
 * The broadcast engine.
 *
 * One prompt goes out to every switched-on AI **at once**. No queue, no waiting for one
 * site before starting the next: pressing *Ask all* means ask all now.
 *
 * Parallel is only safe because of the warm-up in front of it. A cold single-page app
 * takes seconds to draw its message box, and typing into a page that is not there yet is
 * how a fan-out ends up half-sent — so every page is asked to wait for its own message
 * box first (`WF.MSG.READY`), all of them in parallel, and only then does anything type.
 * The one thing that made serialising attractive — six sites seeing a burst in the same
 * second — is a rate-limit risk we accept, because a prompt that arrives late or not at
 * all is worse.
 *
 * The prompt text lives in this module's memory for the length of the job and is never
 * written to storage. If the worker is torn down mid-job, the fan-out stops; that is the
 * price of not persisting what you typed, and it is the right trade.
 *
 * Three ideas from the published WhileAI bundle shape what follows, because they are
 * good ideas:
 *
 *   - **Capture from any tab.** A prompt you send in an AI's own message box fans out by
 *     itself. The guard is a fingerprint of what we delivered, so an echo of our own
 *     fan-out is never fanned out again.
 *   - **A retry must not double-send.** When a failure happens after the text reached
 *     the box, the retry asks the page what is there before it sends anything. Their
 *     name for the state is `mayHaveLanded` and it is exactly the right thing to model.
 *   - **Per-target control.** One AI failing is not a reason to lose the other four, so
 *     a target can be cancelled, retried or given a second attempt without touching the
 *     rest of the job.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});
  const bg = (WF.bg = WF.bg || {});
  const B = WF.browser;
  const U = WF.util;

  const READY_TIMEOUT_MS = 25000;
  const JOB_INDEX_LIMIT = 20;
  const WATCHDOG_EXTRA_MS = 90000;
  const NEW_CHAT_TIMEOUT_MS = 7000;

  // Attempt two waits longer than attempt one: a failure that fast is usually the page
  // still drawing itself.
  const RETRY_DELAY_MS = [1200, 3000, 6000];
  // How long to let a tab settle after being brought to the front for one more try.
  const FOCUS_SETTLE_MS = 700;
  // The failures a visible tab can fix.
  //
  // A page that never drew its message box and a press that did not take are both "not
  // while I am in the background" problems on a site like Gemini, and bringing the tab
  // forward is the fix. A site that is signed out, out of quota or behind a check is not
  // — nothing about being visible changes that, and switching the user's screen to a
  // captcha they did not ask for would be worse than the failure.
  const FOCUS_FIXABLE = [WF.CODE.NO_COMPOSER, WF.CODE.INSERT_FAILED, WF.CODE.SUBMIT_FAILED];
  // The same prompt twice inside this window is a double-send, not a decision.
  const DUPLICATE_WINDOW_MS = 10000;
  // A capture this soon after we delivered that same prompt to that site is the site
  // echoing our delivery back, not you asking again.
  const ECHO_WINDOW_MS = 90000;
  // A prompt sent in this window after a broadcast belongs to the same conversation.
  const RECENT_JOB_MS = 90000;
  // How recently a site has to have asked for you for it to still count as blocked now lives in
  // lib/status.js, with the rest of the rule: the badge, the popup and this all read the same
  // answer, because three copies of "recently" is how the icon and the panel disagree.

  /** Live state. Deliberately not persisted (it contains prompt text). */
  const live = {
    /** Every broadcast in flight. There is no queue: a new prompt starts now. */
    jobs: [],
    counts: { sentToday: 0 },
    /** fingerprint -> last time we saw it, to swallow accidental double sends. */
    seen: new Map(),
    /**
     * The broadcast that finished most recently.
     *
     * A job used to disappear from the popup the moment it ended, taking its per-AI
     * outcome with it: three sites fail, and the card that was showing you which three
     * is simply gone. Keeping the last one means the result of what you just asked stays
     * on screen, and the Retry button next to a failed AI still has something to retry.
     */
    lastFinished: null,
  };

  /**
   * siteId -> jobId, for a site something is already being typed into.
   *
   * Two prompts going into one message box at the same time would interleave text. Rather
   * than queue the second one behind the first — which looks like nothing happening, the
   * exact complaint that made this queue disappear — the second target is told the site is
   * busy and says so.
   */
  const busySites = new Map();

  /** jobId -> { originTabId, targets, status, at } for the in-page status list. */
  const jobIndex = new Map();
  /** siteId -> Set<tabId> of tabs we know have a content script. */
  const knownTabs = new Map();
  /** tabId -> resolve(), for tabs we are waiting on. */
  const readyWaiters = new Map();
  const watchdogs = new Map();
  /** The last broadcast, so the user's own send on the origin site joins its group. */
  let recentJob = null;

  // ---------------------------------------------------------------------------
  // Browser API odds and ends
  // ---------------------------------------------------------------------------

  /**
   * Call a browser API that may be promise-style (Chrome MV3) or callback-style
   * (Firefox), without the caller having to care. `undefined` on any failure: these are
   * all cosmetic extras, and none of them is worth breaking a broadcast over.
   */
  function callApi(fn, ...args) {
    if (typeof fn !== 'function') return Promise.resolve(undefined);
    return new Promise((resolve) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      try {
        const maybe = fn(...args);
        if (maybe && typeof maybe.then === 'function') {
          maybe.then(done, () => done(undefined));
          return;
        }
        if (typeof fn.length === 'number' && fn.length > args.length) {
          fn(...args, (result) => done(result));
          return;
        }
        done(maybe);
      } catch (err) {
        done(undefined);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Tab handling
  // ---------------------------------------------------------------------------

  function rememberTab(siteId, tabId) {
    if (!knownTabs.has(siteId)) knownTabs.set(siteId, new Set());
    knownTabs.get(siteId).add(tabId);
  }

  function forgetTab(tabId) {
    for (const set of knownTabs.values()) set.delete(tabId);
    if (readyWaiters.has(tabId)) {
      const resolve = readyWaiters.get(tabId);
      readyWaiters.delete(tabId);
      resolve(null);
    }
  }

  /** Called by the background router when a content script says hello. */
  function onHello(sender) {
    if (!sender || !sender.tab || sender.tab.id === undefined) return;
    rememberTab(sender.siteId, sender.tab.id);
    const resolve = readyWaiters.get(sender.tab.id);
    if (resolve) {
      readyWaiters.delete(sender.tab.id);
      resolve(sender.tab.id);
    }
  }

  function waitForReady(tabId, timeoutMs) {
    if ([...knownTabs.values()].some((set) => set.has(tabId))) return Promise.resolve(tabId);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        readyWaiters.delete(tabId);
        resolve(null);
      }, timeoutMs || READY_TIMEOUT_MS);
      readyWaiters.set(tabId, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }

  async function ping(tabId) {
    const res = await B.sendToTab(tabId, { type: WF.MSG.PING });
    return res && res.ok ? res : null;
  }

  /**
   * Is this site one the browser has never given us?
   *
   * A page that does not answer is usually a page that has not drawn yet — a tab a second old,
   * a site rebuilding itself. Firefox has one other way to produce that silence, and it never
   * ends on its own: an origin the extension was not granted, where no content script is
   * injected at all (and the manual injection below it fails for the same reason). The two
   * look identical from here, which is why the answer comes from the permission itself rather
   * than from a guess about how long the page has had.
   */
  async function accessMissing(site) {
    const patterns = site && site.matchPatterns;
    if (!patterns || !patterns.length) return false;
    return (await B.permissionsContains(patterns)) === false;
  }

  /** What to tell the user about a site the browser is holding shut. */
  function accessMessage(site) {
    return `${site.name} is switched on, but ${
      WF.browser.isFirefox ? 'Firefox has' : 'the browser has'
    } not given this extension access to its site yet, so nothing can reach it.`;
  }

  /**
   * A tab's answer about itself: is its session still there, and what is its page showing?
   *
   * Read out of the ping reply the warm-up already sends. The distinction that matters is
   * between `attention` — the page is showing something only a person can deal with — and
   * `confirmed`, which is the page saying it is signed in right now. A page whose content
   * script predates this field answers with neither, and that is the honest reading of it:
   * a page that has not told us anything is not a page that has told us no.
   */
  function liveVerdict(reply) {
    if (!reply) return null;
    return {
      attention: reply.attention || null,
      confirmed: reply.signedIn === true,
      url: reply.url || null,
    };
  }

  /**
   * The tab opener for one broadcast: every tab the fan-out has to open goes into a window
   * of its own.
   *
   * This is the answer to the only real complaint about a fan-out — several tabs appearing
   * in the middle of what you were doing. The tabs are still the sites, in the user's own
   * account (none of these sites can be embedded, and an embedded copy would be signed out
   * anyway); they just live in one window behind the one you are in, which is also a window
   * you can close as a unit once the answers are in.
   *
   * The window is made *around* the first tab rather than empty and then filled, so the
   * user's own window never flickers with a tab on its way out of it. Only tabs we open go
   * in: a tab that was already open is never moved.
   *
   * Returns null when `singleWindow` is switched off, in which case an opened tab lands in
   * the window the user is using, as it did before this existed.
   */
  function ownWindowOpener(job, settings) {
    if (settings.singleWindow === false) return null;
    // One window attempt for the whole broadcast, however many targets ask at once.
    let creation = null;
    // The tab the window was made around belongs to exactly one target — the one that got
    // there first. Handing it to two of them is how two AIs end up asked in one tab.
    let claimed = false;

    /** Make the window around the first tab it needs. */
    async function openFirst(site) {
      const windows = B.api && B.api.windows;
      if (!windows || typeof windows.create !== 'function') return null;
      const created = await callApi(windows.create, {
        url: site.newChatUrl,
        focused: false,
        populate: true,
      });
      if (!created || created.id === undefined) return null;
      job.windowId = created.id;
      // `populate` is what hands back the tab the window was made around. A browser that
      // ignores it still opened the URL in there, so ask the window what it holds.
      const listed = Array.isArray(created.tabs)
        ? created.tabs
        : await B.queryTabs({ windowId: created.id }).catch(() => []);
      const tab = (listed || []).find((candidate) => candidate && candidate.id !== undefined);
      return { id: created.id, tab: tab || null };
    }

    async function openIn(windowId, site) {
      if (windowId === undefined || windowId === null) return null;
      return B.createTab({ url: site.newChatUrl, windowId, active: false }).catch(() => null);
    }

    return async function openTab(site) {
      // Two tries: the window is made on the first, and a window the user has closed by the
      // time we get to the second target is started over rather than failing that send.
      for (let attempt = 0; attempt < 2; attempt++) {
        if (job.windowId === undefined) {
          if (!creation) creation = openFirst(site);
          const made = await creation;
          // There is no window of ours to be had at all: the tab goes where it would have
          // gone anyway, in the window the user is using.
          if (!made) break;
          if (made.tab && !claimed) {
            claimed = true;
            return made.tab;
          }
          const placed = await openIn(made.id, site);
          if (placed) return placed;
        } else {
          const placed = await openIn(job.windowId, site);
          if (placed) return placed;
        }
        // The window is gone. Forget it, and let the next pass start a fresh one.
        job.windowId = undefined;
        creation = null;
      }
      return B.createTab({ url: site.newChatUrl, active: false }).catch(() => null);
    };
  }

  /**
   * Get a usable tab for a site: prefer one already open and already talking to us, then
   * any open tab for that site (injecting the scripts if needed), and only then open a
   * new one.
   *
   * `fresh` asks for a new conversation, which only matters when the user asked to send
   * in a new chat each time — a tab we just opened at the site's new-chat URL already is
   * one, so clicking "new chat" there would be pointless.
   *
   * `openTab` is where a tab we have to open goes. A broadcast passes the opener above, so
   * its own tabs land in a window of their own; nothing else passes one, which is what
   * keeps the sign-in check (`verifySite`) opening its tab in front of the user, in the
   * window they are already using.
   *
   * A tab that was already open also brings back its page's own verdict on its session (see
   * `liveVerdict`), because the ping below is the message the fan-out sends before it types
   * anywhere. That verdict is what stops a prompt going into a tab whose session has ended
   * since it was last checked — a signature that cannot be read off the page's markup, and
   * the one the user is looking at when they say we thought they were signed in.
   */
  async function ensureTab(site, settings, fresh, preferTabId, openTab) {
    // 0. The tab the user pressed "ask all" in, when this target is that site. Using it
    //    is the difference between asking Gemini in *your* Gemini conversation and
    //    asking it in whichever Gemini tab happened to be touched last.
    if (preferTabId !== undefined && preferTabId !== null) {
      const preferred = await B.getTab(preferTabId).catch(() => null);
      const preferredAlive = preferred ? await ping(preferred.id) : null;
      if (preferred && preferredAlive) {
        rememberTab(site.id, preferred.id);
        return { tab: preferred, fresh: false, opened: false, verdict: liveVerdict(preferredAlive) };
      }
    }

    // 1. A tab we already know, preferring the most recently active.
    const known = [...(knownTabs.get(site.id) || [])];
    if (known.length) {
      const tabs = [];
      for (const id of known) {
        const tab = await B.getTab(id).catch(() => null);
        if (tab) tabs.push(tab);
        else forgetTab(id);
      }
      if (tabs.length) {
        tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
        const alive = await ping(tabs[0].id);
        if (alive) return { tab: tabs[0], fresh: !fresh, opened: false, verdict: liveVerdict(alive) };
      }
    }

    // 2. Any open tab on that site, from before the extension was loaded.
    const open = await B.queryTabs({ url: site.matchPatterns });
    const candidate = open
      .filter((tab) => tab.id !== undefined)
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    if (candidate) {
      const candidateAlive = await ping(candidate.id);
      if (candidateAlive) {
        rememberTab(site.id, candidate.id);
        return { tab: candidate, fresh: !fresh, opened: false, verdict: liveVerdict(candidateAlive) };
      }
      await B.injectContentScripts(candidate.id, WF.files.contentScripts());
      if (await waitForReady(candidate.id, 3000)) {
        rememberTab(site.id, candidate.id);
        return { tab: candidate, fresh: !fresh, opened: false };
      }
    }

    // 3. Open one, in the background, at its new-chat URL.
    if (!settings.autoOpenTabs) return { tab: null, fresh: false, opened: false };
    const created = openTab
      ? await openTab(site).catch(() => null)
      : await B.createTab({ url: site.newChatUrl, active: false }).catch(() => null);
    if (!created || created.id === undefined) return { tab: null, fresh: false, opened: false };

    let ready = await waitForReady(created.id, READY_TIMEOUT_MS);
    if (!ready) {
      // A slow or redirected page: inject directly and give it one more moment.
      await B.injectContentScripts(created.id, WF.files.contentScripts());
      ready = (await ping(created.id)) ? created.id : null;
    }
    if (!ready) return { tab: null, fresh: false, opened: false };
    rememberTab(site.id, created.id);
    // Opened at the new-chat URL, so it is already fresh. A tab that just loaded has
    // nothing to tell us that its own load has not already told us.
    return { tab: created, fresh: true, opened: true };
  }

  /** Ask the tab to start a new conversation. Falls back to navigating there. */
  async function startFreshChat(site, tab) {
    const res = await B.sendToTab(tab.id, { type: WF.MSG.NEW_CHAT });
    if (res && res.ok) return true;
    // No control we can find: navigating is heavier but honest, and the tab keeps its
    // session either way.
    try {
      await B.updateTab(tab.id, { url: site.newChatUrl });
    } catch (err) {
      return false;
    }
    if (await waitForReady(tab.id, NEW_CHAT_TIMEOUT_MS)) return true;
    const alive = await ping(tab.id);
    return !!alive;
  }

  /**
   * Put the job's tabs in one tab group, so a broadcast is visible as one thing.
   *
   * All of a job's tabs are grouped in a single call at the end of warm-up: grouping them
   * one at a time, from ten parallel tasks, is how two tab groups get created.
   */
  async function groupTabs(job, tabIds) {
    const ids = (tabIds || []).filter((id) => id !== undefined && id !== null);
    if (!ids.length) return;
    const settings = await bg.store.settings();
    if (!settings.groupTabs) return;
    const tabsApi = B.api && B.api.tabs;
    if (!tabsApi || typeof tabsApi.group !== 'function') return; // Firefox has no groups
    try {
      if (job.groupId === undefined) {
        job.groupId = await callApi(tabsApi.group, { tabIds: ids });
      } else {
        await callApi(tabsApi.group, { groupId: job.groupId, tabIds: ids });
      }
      if (job.groupId !== undefined && B.api.tabGroups) {
        const label = `${WF.app.name()}: ${job.targetOrder.length}`;
        await callApi(B.api.tabGroups.update, job.groupId, { title: label, color: 'blue' });
      }
    } catch (err) {
      /* a tab group is a nicety */
    }
  }

  // ---------------------------------------------------------------------------
  // Job notifications, for the in-page status list
  // ---------------------------------------------------------------------------

  function visibleTabs(siteId) {
    return [...(knownTabs.get(siteId) || [])];
  }

  async function notifyJob(jobId, message) {
    const entry = jobIndex.get(jobId);
    if (entry && entry.originTabId !== undefined && entry.originTabId !== null) {
      await B.sendToTab(entry.originTabId, message);
      return;
    }
    // No origin tab (a broadcast from the popup or from a capture): tell every AI tab.
    await bg.store.broadcastToSites(message);
  }

  function rememberJob(job) {
    jobIndex.set(job.id, {
      originTabId: job.originTabId === undefined ? null : job.originTabId,
      targets: [...job.targetOrder],
      status: {},
      at: Date.now(),
    });
    while (jobIndex.size > JOB_INDEX_LIMIT) {
      const oldest = [...jobIndex.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!oldest) break;
      jobIndex.delete(oldest[0]);
    }
  }

  const TERMINAL = ['done', 'error', 'timeout', 'attention', 'skipped', 'cancelled'];

  async function pushTarget(jobId, siteId, patch) {
    // Found through `jobFor`, not through `live.jobs`: a target retried after its
    // broadcast ended has to update the job the popup is still showing.
    const job = jobFor(jobId);
    if (job && job.runs[siteId]) {
      // `status` is what the in-page list calls it; `state` is what the job holds. One
      // mapping, here, so the two can never disagree.
      const { status, ...rest } = patch;
      job.runs[siteId] = { ...job.runs[siteId], ...rest, ...(status ? { state: status } : {}) };
    }
    const entry = jobIndex.get(jobId);
    if (entry) {
      entry.status[siteId] = patch.status || entry.status[siteId] || 'queued';
      const allDone = entry.targets.every((id) => TERMINAL.includes(entry.status[id]));
      await notifyJob(jobId, { type: WF.MSG.JOB_TARGET, siteId, patch });
      if (allDone) await notifyJob(jobId, { type: WF.MSG.JOB, job: { jobId, running: false } });
      return allDone;
    }
    await notifyJob(jobId, { type: WF.MSG.JOB_TARGET, siteId, patch });
    return false;
  }

  function clearWatchdog(jobId, siteId) {
    const key = `${jobId}::${siteId}`;
    const timer = watchdogs.get(key);
    if (timer) {
      clearTimeout(timer);
      watchdogs.delete(key);
    }
  }

  function armWatchdog(job, site) {
    const key = `${job.id}::${site.id}`;
    clearWatchdog(job.id, site.id);
    const timer = setTimeout(async () => {
      watchdogs.delete(key);
      const run = job.runs[site.id];
      if (run && TERMINAL.includes(run.state)) return;
      await pushTarget(job.id, site.id, {
        status: 'timeout',
        errorCode: WF.CODE.TIMEOUT,
        error: 'no answer seen in time',
      });
      await bg.tracker.targetPhase({
        jobId: job.id,
        siteId: site.id,
        phase: WF.PHASE.TIMEOUT,
        sentAt: Date.now(),
      });
      bg.tracker.clearInFlight(job.id, site.id);
      const name = site.name;
      await bg.answers.notifyProblem({
        siteId: site.id,
        title: 'took too long',
        message: `${name} took too long, so it was given up on. Open the ${name} tab.`,
        key: 'timeout',
      });
    }, (site.answerTimeoutMs || 300000) + WATCHDOG_EXTRA_MS);
    watchdogs.set(key, timer);
  }

  // ---------------------------------------------------------------------------
  // Blocked targets
  // ---------------------------------------------------------------------------

  /**
   * Which of these AIs cannot take a prompt right now.
   *
   * Reads what the content scripts have already reported — signed out, out of quota,
   * showing a check — and only for sites that have a tab open, because a site with no
   * tab is a site we will open fresh. Cheap on purpose: this runs in front of every
   * fan-out when lockstep is on.
   */
  async function blockedTargets(targets) {
    const statuses = await WF.storage.getSiteStatus();
    const now = Date.now();
    const blocked = [];
    for (const siteId of targets) {
      const status = statuses[siteId];
      // Fresh, and not merely present: a flag from this morning is not a page that needs you
      // now, and holding a fan-out back for it is the same mistake as sending to a page that is
      // signed out — just in the other direction.
      if (!WF.status.attentionIsFresh(status, now)) continue;
      const site = WF.sites.byId(siteId);
      if (!site) continue;
      const tabs = await B.queryTabs({ url: site.matchPatterns });
      if (!tabs.length) continue;
      blocked.push({ id: siteId, reason: status.attention });
    }
    return blocked;
  }

  /** Tell the user nothing went out, and why, once. */
  async function announceBlocked(blocked) {
    const names = blocked.map((entry) => {
      const site = WF.sites.byId(entry.id);
      return site ? site.name : entry.id;
    });
    const label = names.join(' and ');
    const reason = blocked[0].reason;
    const detail =
      reason === WF.ATTENTION.QUOTA
        ? `${label} has hit a usage limit.`
        : reason === WF.ATTENTION.CHECK
          ? `${label} is showing a verification check.`
          : reason === WF.ATTENTION.SIGNED_OUT
            ? `${label} is signed out.`
            : `${label} is not ready.`;
    const message = `Nothing was sent: ${detail}`;
    await bg.answers.notifyProblem({
      siteId: blocked[0].id,
      title: 'nothing was sent',
      message,
      key: 'blocked',
    });
    return { names, message };
  }

  // ---------------------------------------------------------------------------
  // Broadcast
  // ---------------------------------------------------------------------------

  function pruneSeen(now) {
    for (const [hash, at] of live.seen) {
      if (now - at > 2 * 60 * 1000) live.seen.delete(hash);
    }
  }

  function newRun() {
    return { state: 'waiting', attempts: 0, error: null, errorCode: null, tabId: undefined };
  }

  function makeJob({ prompt, originSiteId, originUrl, originTabId, targets, via, hash }) {
    const runs = {};
    for (const siteId of targets) runs[siteId] = newRun();
    const job = {
      id: U.uid('job'),
      group: null,
      prompt,
      hash: hash || U.fingerprint(prompt),
      promptChars: typeof prompt === 'string' ? prompt.length : 0,
      originSiteId: originSiteId || null,
      originUrl: originUrl || null,
      originTabId: originTabId === undefined ? null : originTabId,
      via: via || 'manual',
      targetOrder: [...targets],
      runs,
      createdAt: Date.now(),
      cancelled: false,
      groupId: undefined,
      // The window this job's own tabs go into, once it has one — see `ownWindowOpener`,
      // which the sender hangs on the job here.
      windowId: undefined,
      openTab: null,
    };
    job.group = job.id;
    return job;
  }

  /**
   * Where a broadcast goes: every switched-on AI, the one you asked from included.
   *
   * "Ask all" means all of them. If you pressed it on an AI's own page, that AI is the
   * one you most obviously meant, so it is not excluded — its tab and its open conversation
   * are reused instead (`originTabId`), which is the difference between asking *your*
   * ChatGPT something and asking whichever ChatGPT tab was touched last.
   *
   * The one exception is a prompt you sent in an AI's own message box: that site already
   * has it, so `capture` hands this function an explicit list without it.
   */
  async function broadcast({
    prompt,
    originSiteId,
    originUrl,
    originTabId,
    targets: explicitTargets,
    via,
    hash,
  }) {
    const settings = await bg.store.settings();
    if (settings.broadcastEnabled === false) return { ok: false, reason: 'off' };

    const text = typeof prompt === 'string' ? prompt : '';
    if (!U.normalizeText(text)) return { ok: false, reason: 'empty' };

    let targets;
    if (explicitTargets && explicitTargets.length) {
      targets = explicitTargets.filter((id) => WF.sites.byId(id));
    } else {
      targets = WF.settings.allTargets(settings);
    }
    if (!targets.length) return { ok: false, reason: 'no-targets' };

    // An AI is only a target once its own page has said it is signed in. Not a setting: a
    // fan-out into a page that never said so happily reports "no answer" for a site that was
    // never able to answer, which reads as our bug and cannot be fixed from the popup — and
    // the switch that used to turn this off was only ever asked for by people who then had
    // that exact experience. What was left out is reported rather than silently dropped.
    const statuses = await WF.storage.getSiteStatus();
    const now = Date.now();
    const sendable = targets.filter((id) => isVerified(statuses[id], now));
    const skipped = targets.filter((id) => !sendable.includes(id));
    if (!sendable.length) return { ok: false, reason: 'no-verified-targets', skipped };
    targets = sendable;

    // With the tab-opening switch off — the default — the fan-out can only reach what is
    // already open. Every target being closed is worth catching here rather than after the
    // fact: a job that starts and skips all ten is a card of silence, and the caller is the
    // one place that can say which switch to press instead.
    if (settings.autoOpenTabs === false && !(await anyTabOpen(targets))) {
      return { ok: false, reason: 'no-open-tabs', skipped, targets };
    }

    const job = makeJob({
      prompt: text,
      originSiteId,
      originUrl,
      originTabId,
      targets,
      via,
      hash: hash || U.fingerprint(text),
    });
    // The broadcast, not the engine, owns the window its own tabs go into: a job lives
    // exactly as long as the tabs it opened, and a retry of one AI can still find it.
    job.openTab = ownWindowOpener(job, settings);

    recentJob = { jobId: job.id, originSiteId: originSiteId || null, at: Date.now() };

    // Straight out, with no queue to wait in. A second prompt while the first is still
    // going starts immediately too; the only thing that cannot happen is two prompts
    // typed into the same message box at once, which is what busySites prevents.
    run(job).catch(() => undefined);
    // `started`, not `queued`: by the time this reply is sent the fan-out is already
    // running, and saying so is what lets a caller report what actually happened.
    return { ok: true, started: true, jobId: job.id, targets, skipped };
  }

  /**
   * A prompt the user sent in an AI's own message box.
   *
   * The whole feature hangs on one question: is this you, or is this us? A delivery of
   * ours that the site renders back as a user message must not be broadcast again, and
   * the answer is a fingerprint of what we delivered — never the text, which is gone from
   * this process the moment the job ends.
   */
  async function capture({ prompt, hash, siteId, tabId, url }) {
    const settings = await bg.store.settings();
    if (settings.broadcastEnabled === false) return { ok: true, reason: 'off' };
    if (settings.autoCapture === false) return { ok: true, reason: 'auto-off' };

    const site = WF.sites.byId(siteId);
    if (!site) return { ok: true, reason: 'unknown-site' };
    if (!WF.settings.siteEnabled(settings, siteId)) return { ok: true, reason: 'site-off' };

    const text = typeof prompt === 'string' ? prompt : '';
    if (!U.normalizeText(text)) return { ok: true, reason: 'empty' };
    const fp = hash || U.fingerprint(text);

    // Did we deliver this exact prompt to this exact site moments ago? Then that is what
    // this is, and it has already been acted on.
    const entry = await bg.ledger.entry(fp);
    if (entry && entry.siteId === siteId && Date.now() - entry.at < ECHO_WINDOW_MS) {
      return { ok: true, echo: true };
    }

    const now = Date.now();
    pruneSeen(now);
    const previous = live.seen.get(fp);
    live.seen.set(fp, now);
    if (previous && now - previous < DUPLICATE_WINDOW_MS) return { ok: true, duplicate: true };

    const targets = WF.settings.targetsFor(settings, siteId);
    if (!targets.length) return { ok: true, noTargets: true };

    if (settings.lockstep) {
      const blocked = await blockedTargets(targets);
      if (blocked.length) {
        const announced = await announceBlocked(blocked);
        return { ok: true, blocked: blocked.map((b) => b.id), message: announced.message };
      }
    }

    const job = await broadcast({
      prompt: text,
      originSiteId: siteId,
      originUrl: url,
      originTabId: tabId,
      targets,
      via: 'capture',
      hash: fp,
    });
    if (!job.ok) return job;
    // `started`, not `queued`: by the time this returns, the fan-out is already running.
    return { ok: true, started: true, jobId: job.jobId, targets: job.targets };
  }

  // ---------------------------------------------------------------------------
  // Sending, one target at a time
  // ---------------------------------------------------------------------------

  /**
   * Put any tab this broadcast opened that is not already in the broadcast's window in with
   * the rest.
   *
   * Opening a tab there is what normally happens — see `ownWindowOpener` — so this is the
   * repair for the one case that misses it: a window that could not be made around the first
   * tab, which would otherwise leave that tab sitting in the window the user is using. Only
   * tabs we opened are moved; a tab that was already yours is never rearranged.
   */
  async function gatherOpened(entries, windowId) {
    const loose = entries
      .filter((entry) => entry.tab && entry.tab.id !== undefined && entry.tab.id !== null)
      .filter((entry) => entry.tab.windowId !== windowId)
      .map((entry) => entry.tab.id);
    if (!loose.length) return windowId === undefined ? null : windowId;

    if (windowId !== undefined && windowId !== null) {
      await B.moveTabs(loose, { windowId, index: -1 }).catch(() => undefined);
      return windowId;
    }
    // No window of ours: two or more strays are still worth one, made around the first.
    if (loose.length < 2) return null;
    const created = await B.createWindow({ tabId: loose[0], focused: false }).catch(() => null);
    if (!created || created.id === undefined) return null;
    await B.moveTabs(loose.slice(1), { windowId: created.id, index: -1 }).catch(() => undefined);
    return created.id;
  }

  /**
   * How many tabs each AI has open right now, by site id.
   *
   * One query for all ten patterns rather than one per site, because three readers want this
   * and they must all read the same answer: the send path ("is any of these open at all?",
   * below), the popup's own row text, and the launcher's reach — which is the same number shown
   * in two places, so it is asked for once here.
   *
   * The tabs are asked directly rather than read off `knownTabs`, because a browser that has
   * just started has a record of nobody having said hello yet, and "nothing is open" is too
   * strong a claim to make from a hello that has not arrived.
   */
  async function openCounts() {
    const counts = {};
    const tabs = await B.queryTabs({ url: WF.sites.matchPatterns() }).catch(() => []);
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      const site = WF.sites.fromUrl(tab.url || '');
      if (!site) continue;
      counts[site.id] = (counts[site.id] || 0) + 1;
    }
    return counts;
  }

  /**
   * Is any of these AIs open in a tab right now?
   *
   * With `autoOpenTabs` off — the default — a fan-out can only reach AIs that are already
   * open, so "none of them is" is the one case worth catching before a job starts. The
   * alternative is a card of ten rows saying "no tab open" and no explanation, and the fix
   * is either opening a tab or turning that switch on: both are things the message can say.
   */
  async function anyTabOpen(siteIds) {
    const open = await openCounts();
    return siteIds.some((siteId) => (open[siteId] || 0) > 0);
  }

  /**
   * Has this site's own page said, recently, that it is signed in and ready?
   *
   * The rule itself lives in lib/status.js, because the popup, the dashboard and the send
   * path all have to answer it the same way.
   */
  const isVerified = (status, now) => WF.status.isVerified(status, now);

  /**
   * Ask one AI's page whether it is signed in, and write down what it answers.
   *
   * This is a *check*, not a switch. It used to be both — turning an AI on came through here,
   * and a page that answered "no" took that AI off the list — which is a rule that reads well
   * until you live with it: a switch the user deliberately turned on went dark after an
   * unrelated look at the page, a fresh install started with every switch off, and the one
   * thing a switch is supposed to mean (this AI is mine) was decided by a page that had never
   * heard of the user's list. The list is the user's and the reading is the page's; a send is
   * where the two are made to agree (`broadcast` refuses anything unverified), so the only
   * thing written here is the record: `verifiedAt`, `attention`, the composer, the URL.
   *
   * Opening the tab is still part of it, because a site with no tab cannot be asked. Nothing
   * calls this on the way to turning a switch on any more — a switch writes the list and opens
   * nothing — so this runs only when something explicitly wants a reading from the page.
   */
  async function verifySite(siteId, options) {
    const site = WF.sites.byId(siteId);
    if (!site) return { ok: false, reason: 'unknown-site' };
    const settings = await bg.store.settings();
    const timeoutMs = Math.min(Math.max(Number(options && options.timeoutMs) || 25000, 3000), 60000);

    const ensured = await ensureTab(site, { ...settings, autoOpenTabs: true }, false, null);
    const tab = ensured.tab;
    if (!tab || tab.id === undefined) {
      // No tab could be made to answer, and the reason is not always the page: a site the
      // browser has never handed us gets no content script even in a tab we open ourselves, so
      // the switch would be told "signed out" about a session that is perfectly fine — the
      // exact lie this check exists to prevent. The browser's own answer comes first, and only
      // when it is not the one holding the door is the page blamed.
      const noAccess = await accessMissing(site);
      await WF.storage.setSiteStatusFor(siteId, {
        verifiedAt: 0,
        hasComposer: false,
        attention: noAccess ? WF.ATTENTION.NO_ACCESS : WF.ATTENTION.SIGNED_OUT,
        attentionAt: Date.now(),
        ...(noAccess ? { attentionEvidence: 'permission' } : {}),
        url: site.newChatUrl,
      });
      await bg.answers.updateBadge();
      if (noAccess) await bg.answers.notifyProblem({ siteId, title: 'needs you', message: accessMessage(site), key: `access:${siteId}` });
      return { ok: true, siteId, verified: false, reason: noAccess ? 'no-access' : 'no-tab' };
    }

    // Ask first, show later.
    //
    // A page answers for itself whether it is in front of you or behind a window, so a
    // session that is already fine is confirmed without anything moving: no tab raised, no
    // window switched, nothing to dismiss. The tab is only brought forward when the answer is
    // no — signed out, out of quota, showing a check — because that is the one outcome the
    // user has to act on, in that page.
    let res = await B.sendToTab(tab.id, { type: WF.MSG.VERIFY_SITE, timeoutMs });
    if (!res || res.ok !== true || res.signedIn !== true) {
      await B.focusTab(tab.id);
      if (!res || res.ok !== true) {
        // A tab opened a moment ago may not have its content script yet, and "no answer" is
        // not the same as "signed out". One more try after giving the page a moment.
        await U.sleep(1200);
        await B.injectContentScripts(tab.id, WF.files.contentScripts());
      }
      res = await B.sendToTab(tab.id, { type: WF.MSG.VERIFY_SITE, timeoutMs });
    }
    if (!res || res.ok !== true) {
      // Two different silences: a page that has not drawn yet, and a site the browser will not
      // let the extension into at all. Only one of them is the page's fault, and only one of
      // them has an answer the user can act on — so ask which one it is before writing a
      // verdict about the page.
      const noAccess = await accessMissing(site);
      await WF.storage.setSiteStatusFor(siteId, {
        verifiedAt: 0,
        hasComposer: false,
        attention: noAccess ? WF.ATTENTION.NO_ACCESS : WF.ATTENTION.NO_COMPOSER,
        attentionAt: Date.now(),
        ...(noAccess ? { attentionEvidence: 'permission' } : {}),
        url: tab.url,
      });
      await bg.answers.updateBadge();
      if (noAccess) await bg.answers.notifyProblem({ siteId, title: 'needs you', message: accessMessage(site), key: `access:${siteId}` });
      return { ok: true, siteId, verified: false, reason: noAccess ? 'no-access' : 'no-answer', tabId: tab.id };
    }

    const verified = res.signedIn === true;
    // `verifiedAt` is the whole of the sign-in record: it is set by the check above and
    // cleared the moment anything contradicts it. A second boolean field here used to be
    // written by this path but not by the page's own reports, which is how a record ended up
    // saying "signed in: true" next to "attention: signed-out".
    await WF.storage.setSiteStatusFor(siteId, {
      verifiedAt: verified ? Date.now() : 0,
      hasComposer: !!res.hasComposer,
      attention: res.attention || null,
      ...(res.attention ? { attentionAt: Date.now() } : {}),
      url: res.url || tab.url,
    });
    await bg.answers.updateBadge();

    return {
      ok: true,
      siteId,
      name: site.name,
      verified,
      attention: verified ? null : res.attention || WF.ATTENTION.SIGNED_OUT,
      tabId: tab.id,
    };
  }

  // How often the open AI tabs are asked what they are showing, and how stale a `verifiedAt`
  // stamp is allowed to get before a clean reading refreshes it.
  const STATUS_SWEEP_MS = 20000;
  const STAMP_REFRESH_MS = 60 * 60 * 1000;
  let sweptAt = 0;

  /**
   * Ask every AI with a tab open what its page is showing *now*, and believe the answer.
   *
   * This exists because the record was write-only in the direction that matters. A page only
   * spoke when it was loading, or on a two-minute timer, or when a send went wrong — so a
   * verdict that was wrong once stayed wrong until something else happened to that site, and
   * nothing did: nobody presses anything on a page that looks asleep. The popup went on reading
   * "Signed out" about a session that had been fine for a week, and since a send refuses an
   * unverified site, the user's only way out was to open the tab and stir it by hand.
   *
   * So the list the user is about to read is built by asking, not by quoting. The page is the
   * only thing that knows, the ping is one message per open tab, and a clean answer here is the
   * same evidence an explicit check collects — which is why it also re-stamps `verifiedAt`.
   * Without that, a site whose stamp was cleared by a misread would stay unverified until
   * somebody happened to type in it, and a reading that cannot correct itself is not a reading.
   *
   * Only sites with a tab open are asked: a site with no tab has no session to be wrong about,
   * and nothing to correct. Throttled, because the popup can be opened twice in a row and the
   * question costs a scan of each page.
   */
  async function refreshStatuses(options) {
    const now = Date.now();
    const force = !!(options && options.force);
    if (!force && now - sweptAt < STATUS_SWEEP_MS) return { ran: false };
    sweptAt = now;

    const tabs = await B.queryTabs({ url: WF.sites.matchPatterns() }).catch(() => []);
    const newest = new Map();
    for (const tab of tabs) {
      if (!tab || tab.id === undefined) continue;
      const site = WF.sites.fromUrl(tab.url || '');
      if (!site) continue;
      const seen = newest.get(site.id);
      if (!seen || (tab.lastAccessed || 0) > (seen.lastAccessed || 0)) newest.set(site.id, tab);
    }

    let asked = 0;
    let changed = 0;
    await Promise.all(
      [...newest].map(async ([siteId, tab]) => {
        const reply = await ping(tab.id);
        if (!reply) {
          // A page that did not answer has told us nothing, not "no" — unless the reason it is
          // silent is that the extension was never let into the site, which is the one silence
          // that will not pass on its own. Recording that here is what turns "Kimi does
          // nothing" into a row that says why, in the place the user is already looking.
          const site = WF.sites.byId(siteId);
          if (site && (await accessMissing(site))) {
            const statuses = await WF.storage.getSiteStatus();
            const before = statuses[siteId] || {};
            if (before.attention !== WF.ATTENTION.NO_ACCESS) {
              await WF.storage.setSiteStatusFor(siteId, {
                attention: WF.ATTENTION.NO_ACCESS,
                attentionAt: now,
                attentionEvidence: 'permission',
                hasComposer: false,
                verifiedAt: 0,
                url: tab.url,
              });
              changed += 1;
            }
          }
          return;
        }
        asked += 1;
        const statuses = await WF.storage.getSiteStatus();
        const before = statuses[siteId] || {};
        const attention = reply.attention || null;
        const patch = {
          attention,
          ...(attention ? { attentionAt: now } : {}),
          attentionEvidence: attention ? before.attentionEvidence || 'page' : null,
          hasComposer: !!reply.hasComposer,
          url: reply.url || tab.url,
        };
        if (attention === WF.ATTENTION.SIGNED_OUT) patch.verifiedAt = 0;
        else if (reply.hasComposer && reply.signedIn === true && now - (Number(before.verifiedAt) || 0) > STAMP_REFRESH_MS) {
          patch.verifiedAt = now;
        }
        const same =
          before.attention === attention &&
          before.hasComposer === patch.hasComposer &&
          patch.verifiedAt === undefined;
        if (same) return; // nothing new to say, and saying it again would only move a timestamp
        await WF.storage.setSiteStatusFor(siteId, patch);
        changed += 1;
      })
    );
    if (changed) await bg.answers.updateBadge();
    return { ran: true, asked, changed };
  }

  /** Map a content-script failure onto the closed set in WF.CODE. */
  function codeFor(result) {
    const reason = result && result.reason;
    if (reason === WF.ATTENTION.NO_COMPOSER) return WF.CODE.NO_COMPOSER;
    if (reason === WF.ATTENTION.SIGNED_OUT || reason === WF.ATTENTION.QUOTA || reason === WF.ATTENTION.CHECK) {
      return WF.CODE.NEEDS_HUMAN;
    }
    if (reason === WF.ATTENTION.SEND_FAILED) {
      // The text reached the box but the send did not confirm: it may have gone.
      return result && result.inserted === false ? WF.CODE.INSERT_FAILED : WF.CODE.SUBMIT_FAILED;
    }
    return WF.CODE.UNKNOWN;
  }

  function retryable(code) {
    return code !== WF.CODE.NEEDS_HUMAN;
  }

  /**
   * One attempt at one target. Returns `{ ok, code, result, tabId, skippedInsert }`.
   *
   * The tab arrives already open and already warm, so this is only the typing and the
   * pressing of send.
   */
  async function attemptSend(job, site, settings, attempt, options) {
    const tab = options.tab;
    // `keepConversation` means "do not start a new one": either the tab was opened at the
    // site's new-chat address during warm-up, or this is a retry that must not walk away
    // from the conversation the prompt was already sent into.
    const wantsNewChat =
      settings.sendMode === 'new_chat' && attempt === 1 && !options.keepConversation;

    if (!tab || tab.id === undefined) {
      return {
        ok: false,
        code: WF.CODE.TAB_GONE,
        error: settings.autoOpenTabs ? 'could not reach the tab' : 'no open tab',
      };
    }

    if (wantsNewChat) {
      // A tab that existed before is still sitting in whatever conversation it was left
      // in; one opened during warm-up is already new.
      await startFreshChat(site, tab);
    }

    const res = await B.sendToTab(tab.id, {
      type: WF.MSG.SEND,
      jobId: job.id,
      siteId: site.id,
      prompt: job.prompt,
      options: { skipInsert: !!options.skipInsert },
    });

    if (!res) {
      return { ok: false, code: WF.CODE.TAB_GONE, error: 'the tab did not respond', tabId: tab.id };
    }
    if (res.ok) {
      // The delivery is a fact worth remembering: it is how a capture of our own prompt
      // is recognised as an echo rather than as a new request.
      await bg.ledger.remember(job.hash, site.id, 'delivery');
      return { ok: true, tabId: tab.id, result: res };
    }

    const code = codeFor(res);
    if (code === WF.CODE.NEEDS_HUMAN) {
      // Signed out or out of quota un-verifies the site outright: it was checked once, and
      // the check has just been contradicted. Turning it on again re-runs the check.
      await WF.storage.setSiteStatusFor(site.id, {
        attention: res.reason,
        attentionAt: Date.now(),
        hasComposer: false,
        verifiedAt: 0,
        url: tab.url,
      });
      await bg.answers.updateBadge();
    }
    return { ok: false, code, error: res.reason, result: res, tabId: tab.id };
  }

  /**
   * All the attempts for one target, including the question a retry has to ask.
   *
   * The tab is already warm: `prepareTarget` found or opened it and waited for its
   * message box. The lock below is the only serialisation left in the fan-out — one site
   * at a time, all sites at once.
   */
  async function sendToTarget(job, siteId, tab, readySettings, options) {
    const settings = readySettings || (await bg.store.settings());
    const site = WF.sites.byId(siteId);
    if (!site) return;

    const holder = busySites.get(siteId);
    if (holder && holder !== job.id) {
      await pushTarget(job.id, siteId, {
        status: 'error',
        errorCode: WF.CODE.BUSY,
        error: 'another prompt is already going into this AI',
      });
      return;
    }
    busySites.set(siteId, job.id);
    try {
      await sendToTargetLocked(job, site, settings, tab, options);
    } finally {
      if (busySites.get(siteId) === job.id) busySites.delete(siteId);
    }
  }

  /** Mark a target as delivered, in one place, so every path says the same thing. */
  async function markSent(job, site, result, attempt, extra) {
    await pushTarget(job.id, site.id, {
      status: 'sent',
      error: null,
      errorCode: null,
      tabId: result.tabId,
      attempts: attempt,
      ...(extra || {}),
    });
  }

  /**
   * The question a retry has to ask first: did it land anyway?
   *
   * A send can fail loudly and still have gone — the press registers, the page navigates,
   * and the reply never arrives. Sending again on that news is how one prompt becomes two
   * answers. So before any second attempt, the page is asked what it is showing: either
   * the prompt is already in the conversation (`landed`), or it is sitting in the message
   * box (`in-composer`, so press send but do not type it again), or it is nowhere and the
   * retry is safe.
   */
  async function mayHaveLanded(job, site, result, attempt) {
    if (!WF.MAY_HAVE_LANDED.includes(result.code)) return null;
    if (result.tabId === undefined) return null;
    const probe = await B.sendToTab(result.tabId, { type: WF.MSG.PROBE, hash: job.hash });
    if (!probe || !probe.ok) return null;
    if (probe.lastUserMatches) {
      await markSent(job, site, result, attempt, { via: 'probe' });
      await bg.ledger.remember(job.hash, site.id, 'probe');
      bg.answers.updateBadge();
      return 'landed';
    }
    return probe.inComposer ? 'in-composer' : null;
  }

  /**
   * Focus detours are serialised.
   *
   * Ten targets deciding in the same second to borrow the screen would flicker through
   * every tab in the job and hand the user back the wrong one. One at a time, each one
   * putting back what it found.
   */
  let focusQueue = Promise.resolve();
  function withFocus(fn) {
    const next = focusQueue.then(fn, fn);
    focusQueue = next.catch(() => undefined);
    return next;
  }

  async function sendToTargetLocked(job, site, settings, tab, options) {
    const { id: siteId } = site;
    const opts = options || {};
    await pushTarget(job.id, siteId, { status: 'sending' });

    const maxAttempts = Math.max(1, Math.min(4, settings.retryAttempts || 1));
    let skipInsert = false;
    let last = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (job.cancelled || job.runs[siteId].cancelled) break;

      await pushTarget(job.id, siteId, { status: 'sending', attempts: attempt });

      const result = await attemptSend(job, site, settings, attempt, {
        skipInsert,
        tab,
        keepConversation: opts.keepConversation,
      });
      last = result;

      if (result.ok) {
        await markSent(job, site, result, attempt);
        return;
      }

      if (result.code === WF.CODE.NEEDS_HUMAN) break;

      if (attempt < maxAttempts && retryable(result.code)) {
        const recovered = await mayHaveLanded(job, site, result, attempt);
        if (recovered === 'landed') return;
        // Still in the box: the next attempt presses send instead of retyping.
        if (recovered === 'in-composer') skipInsert = true;
        await pushTarget(job.id, siteId, {
          status: 'retrying',
          errorCode: result.code,
          error: result.error || 'retrying',
        });
        await U.sleep(RETRY_DELAY_MS[Math.min(attempt - 1, RETRY_DELAY_MS.length - 1)]);
        continue;
      }
      break;
    }

    // Nothing went out, and the reason may simply be that the page was never shown. Some
    // sites do not finish drawing their message box, and some do not accept a press, until
    // the tab is in front of a person — this is the failure that reads as "nothing sends
    // unless I am on the page". So it gets one attempt with the tab brought forward, and
    // then the user is put back exactly where they were: a short flicker instead of a
    // silent no-op, and only for the one target that needs it.
    const failureCode = last && last.code;
    if (
      last &&
      !last.ok &&
      failureCode &&
      FOCUS_FIXABLE.includes(failureCode) &&
      settings.focusOnRetry !== false &&
      tab &&
      tab.id !== undefined
    ) {
      const brought = await withFocus(async () => {
        const here = await B.activeTab();
        if (here && here.id === tab.id) return { focused: true, back: null };
        const front = await B.focusTab(tab.id);
        if (!front) return { focused: false, back: null };
        await U.sleep(FOCUS_SETTLE_MS);
        return { focused: true, back: here };
      });
      if (brought.focused) {
        await pushTarget(job.id, siteId, {
          status: 'retrying',
          errorCode: failureCode,
          error: 'brought its tab forward and tried once more',
        });
        const again = await attemptSend(job, site, settings, maxAttempts + 1, {
          skipInsert,
          tab,
          keepConversation: true,
        });
        last = again;
        if (brought.back && brought.back.id !== undefined) await B.focusTab(brought.back.id);
        if (again.ok) {
          await markSent(job, site, again, maxAttempts + 1);
          return;
        }
      }
    }

    // Out of attempts, or not worth retrying.
    if (job.runs[siteId].cancelled || job.cancelled) {
      await pushTarget(job.id, siteId, { status: 'cancelled' });
      return;
    }

    const code = (last && last.code) || WF.CODE.UNKNOWN;
    const status = code === WF.CODE.TIMEOUT ? 'timeout' : code === WF.CODE.NEEDS_HUMAN ? 'attention' : 'error';
    await pushTarget(job.id, siteId, {
      status,
      errorCode: code,
      error: (last && last.error) || 'send failed',
      tabId: last ? last.tabId : undefined,
    });

    const name = site.name;
    await bg.answers.notifyProblem({
      siteId,
      title: 'needs you',
      message:
        code === WF.CODE.NEEDS_HUMAN
          ? `${name} needs you: ${WF.attentionLabel(last && last.error)}. The prompt was not sent.`
          : `Nothing was sent to ${name}. Open the ${name} tab to see what it is showing.`,
      key: `failed:${code}`,
    });
  }

  // ---------------------------------------------------------------------------
  // Running a job
  // ---------------------------------------------------------------------------

  /**
   * A broadcast by id — or, with no id, the one the user is looking at.
   *
   * A job that has finished is still found, because the card in the popup outlives the
   * fan-out: pressing *Retry* next to an AI that failed has to reach the job that holds
   * the prompt. "What the user is looking at" is a broadcast still going out if there is
   * one, and otherwise the last one's outcome.
   */
  function jobFor(jobId) {
    if (jobId) {
      const running = live.jobs.find((entry) => entry.id === jobId);
      if (running) return running;
      return live.lastFinished && live.lastFinished.id === jobId ? live.lastFinished : null;
    }
    return live.jobs[live.jobs.length - 1] || live.lastFinished || null;
  }

  /**
   * Get this target's page ready to receive a prompt, and say so if it cannot be.
   *
   * This is the step that makes a fan-out work from a page you are not looking at: the
   * requested tab is opened (in the background, without stealing focus) and then asked to
   * wait for its own message box, in the page, where the app is actually drawing. Every
   * target does this at the same time, so the slowest site sets how long the warm-up
   * takes rather than the sum of all of them.
   */
  async function prepareTarget(job, siteId, settings) {
    const site = WF.sites.byId(siteId);
    if (!site) {
      await pushTarget(job.id, siteId, {
        status: 'error',
        errorCode: WF.CODE.UNKNOWN,
        error: 'unknown site',
      });
      return { siteId, tab: null, alreadyFresh: false, opened: false };
    }

    await pushTarget(job.id, siteId, { status: 'waiting' });

    const fresh = settings.sendMode === 'new_chat';
    // The origin site keeps the tab you were looking at, so "ask all 10" includes the
    // one you are on, in the conversation you are already in.
    const preferTabId = siteId === job.originSiteId ? job.originTabId : null;
    let tab = null;
    let alreadyFresh = false;
    let opened = false;
    let verdict = null;
    try {
      const ensured = await ensureTab(site, settings, fresh, preferTabId, job.openTab);
      tab = ensured.tab;
      // A tab opened at the site's new-chat address *is* the new chat; asking the page
      // to start one in it would only cost time.
      alreadyFresh = !!ensured.fresh;
      opened = !!ensured.opened;
      verdict = ensured.verdict || null;
    } catch (err) {
      tab = null;
    }

    if (!tab || tab.id === undefined) {
      // Two different things, and only one of them is a failure.
      //
      // With `autoOpenTabs` off — the default — this AI was simply not asked. Nothing went
      // wrong, nothing is stuck, and there is nothing for the user to do; putting it in the
      // "needs you" list would be an amber badge asking them to open a tab they chose not to
      // open. A tab we *tried* to open and could not reach is the case that earns the alert.
      if (!settings.autoOpenTabs) {
        await pushTarget(job.id, siteId, {
          status: 'skipped',
          errorCode: WF.CODE.NO_TAB,
          error: 'no tab open',
        });
        return { siteId, tab: null, alreadyFresh: false, opened: false };
      }
      await pushTarget(job.id, siteId, {
        status: 'error',
        errorCode: WF.CODE.TAB_GONE,
        error: 'the tab could not be opened',
      });
      await reportTargetFailure(site, WF.CODE.TAB_GONE);
      return { siteId, tab: null, alreadyFresh: false, opened: false };
    }

    // The page's own answer, read a moment ago in the ping that opened this tab's slot in
    // the fan-out. A page showing a sign-in door, a quota banner or a check is not a page to
    // spend a send on: the prompt would not be answered, and the failure would be reported
    // as ours ("its message box never appeared") when it is the site's. Saying so here is
    // also what keeps a check made last week from standing in for a session that has ended
    // since — the page is asked again, every time, because it is the only thing that knows.
    //
    // A missing message box is deliberately not in this list: that is what the warm-up below
    // is for, and it waits, which is the right answer for a page still drawing itself.
    if (verdict && verdict.attention && verdict.attention !== WF.ATTENTION.NO_COMPOSER) {
      const reason = verdict.attention;
      await recordBlocked(site, reason, verdict.url || tab.url);
      await pushTarget(job.id, siteId, {
        status: 'attention',
        errorCode: WF.CODE.NEEDS_HUMAN,
        error: reason,
        tabId: tab.id,
      });
      await reportTargetFailure(site, WF.CODE.NEEDS_HUMAN, reason);
      return { siteId, tab: null, alreadyFresh: false, opened: false };
    }

    if (verdict && verdict.confirmed) {
      // The page has just said, in its own words, that it is signed in — the same evidence
      // the turn-on check collects, collected again for free because the tab was already
      // open and already being asked. Stamping it here is what keeps the record a statement
      // about a session rather than a memory of one.
      await WF.storage.setSiteStatusFor(siteId, {
        verifiedAt: Date.now(),
        hasComposer: true,
        attention: null,
        url: verdict.url || tab.url,
      });
    }

    const readyMs = settings.readyTimeoutMs || 30000;
    const ready = await B.sendToTab(tab.id, { type: WF.MSG.READY, timeoutMs: readyMs });
    if (!ready || ready.ok !== true) {
      // Reported by the page itself, which is the only place that knows what it drew.
      await pushTarget(job.id, siteId, {
        status: 'error',
        errorCode: WF.CODE.NO_COMPOSER,
        error: 'its message box never appeared',
        tabId: tab.id,
      });
      await reportTargetFailure(site, WF.CODE.NO_COMPOSER);
      return { siteId, tab: null, alreadyFresh: false, opened: false };
    }

    return { siteId, tab, alreadyFresh, opened };
  }

  async function reportTargetFailure(site, code, reason) {
    await bg.answers.notifyProblem({
      siteId: site.id,
      title: 'needs you',
      message:
        reason === WF.ATTENTION.NO_ACCESS
          ? `${accessMessage(site)} Press its switch in the panel to allow it.`
          : code === WF.CODE.NO_COMPOSER
            ? `${site.name} never showed a message box, so nothing was sent. Open its tab.`
            : code === WF.CODE.NEEDS_HUMAN
              ? `${site.name} is ${WF.attentionLabel(reason).toLowerCase()}, so nothing was sent. Open its tab.`
              : `Nothing was sent to ${site.name}: its tab could not be reached.`,
      key: `failed:${code}`,
    });
  }

  /**
   * Write down what a page has just said about itself, in the one place everything reads.
   *
   * The status record is the site's answer to "may a prompt go here", and the page has just
   * changed its answer. Signed out also clears `verifiedAt` outright, the same way the
   * turn-on check and a failed send do: a check that the page has contradicted must not stay
   * in storage where the popup would go on showing a switch as on. Quota and a check leave
   * the check standing, because the session behind them is still there — the flag that stops
   * the send is `attention`, and the same rule that reads it at turn-on reads it here.
   */
  async function recordBlocked(site, reason, url) {
    await WF.storage.setSiteStatusFor(site.id, {
      attention: reason,
      attentionAt: Date.now(),
      attentionEvidence: 'page',
      ...(reason === WF.ATTENTION.SIGNED_OUT ? { verifiedAt: 0 } : {}),
      ...(url ? { url } : {}),
    });
    await bg.answers.updateBadge();
  }

  async function run(job) {
    live.jobs.push(job);
    const settings = await bg.store.settings();

    rememberJob(job);
    await bg.tracker.jobSent({
      jobId: job.id,
      group: job.group,
      origin: job.via === 'capture' ? 'capture' : 'broadcast',
      siteIds: job.targetOrder,
      promptChars: job.promptChars,
    });
    // Something is in flight now, so the away-time sampler is worth its timer; it stops
    // itself again when the last turn finishes.
    bg.tracker.start();
    await notifyJob(job.id, {
      type: WF.MSG.JOB,
      job: { jobId: job.id, targets: job.targetOrder, running: true, origin: job.via },
    });

    // Phase one: every page in parallel, each waiting for its own message box. Nothing is
    // typed yet, so a site that is slow, signed out or still painting cannot make the
    // others miss their turn.
    let prepared = [];
    try {
      prepared = await Promise.all(
        job.targetOrder.map((siteId) =>
          Promise.resolve(prepareTarget(job, siteId, settings)).catch((err) => {
            pushTarget(job.id, siteId, {
              status: 'error',
              errorCode: WF.CODE.UNKNOWN,
              error: 'the send could not be started',
            });
            return { siteId, tab: null };
          })
        )
      );
    } catch (err) {
      prepared = [];
    }

    // One group for the whole broadcast, now that the tabs exist.
    if (job.via !== 'capture') {
      await groupTabs(
        job,
        prepared.filter((entry) => entry.tab).map((entry) => entry.tab.id)
      );
    }
    // Whatever this broadcast had to open belongs in its own window, not in the middle of
    // what the user was doing — the opener put it there, and this catches a tab that
    // missed. A capture gets this too: it is the path that most often opens tabs, because
    // it is what a prompt typed in an AI's own box turns into.
    if (settings.singleWindow !== false) {
      await gatherOpened(
        prepared.filter((entry) => entry.opened),
        job.windowId
      );
    }

    // Phase two: all of them at once.
    const sendable = prepared.filter(
      (entry) => entry.tab && !job.cancelled && !job.runs[entry.siteId].cancelled
    );
    await Promise.all(
      sendable.map((entry) =>
        sendToTarget(job, entry.siteId, entry.tab, settings, {
          // A tab opened during warm-up is already in a new conversation, so there is
          // nothing to start.
          keepConversation: entry.alreadyFresh,
        }).catch(async () => {
          await pushTarget(job.id, entry.siteId, {
            status: 'error',
            errorCode: WF.CODE.UNKNOWN,
            error: 'the send could not be started',
          });
        })
      )
    );

    for (const entry of prepared) {
      const site = WF.sites.byId(entry.siteId);
      if (site && job.runs[entry.siteId].state === 'sent') armWatchdog(job, site);
    }

    await notifyJob(job.id, {
      type: WF.MSG.JOB,
      job: { jobId: job.id, running: false, cancelled: job.cancelled },
    });

    const index = live.jobs.indexOf(job);
    if (index >= 0) live.jobs.splice(index, 1);
    // Kept for the popup's sake: the outcome of what you just asked stays readable, and
    // a failed AI can still be retried from the card that reported it.
    live.lastFinished = job;
  }

  // ---------------------------------------------------------------------------
  // Job control: stop one, stop one AI, or send one AI again
  // ---------------------------------------------------------------------------

  async function cancel(jobId) {
    const targets = jobId ? [jobFor(jobId)].filter(Boolean) : live.jobs.slice();
    if (!targets.length) return { ok: false, reason: 'not-found' };
    for (const job of targets) {
      job.cancelled = true;
      for (const siteId of Object.keys(job.runs)) {
        if (!TERMINAL.includes(job.runs[siteId].state)) job.runs[siteId].cancelled = true;
      }
    }
    return { ok: true, cancelled: targets.map((job) => job.id) };
  }

  /** Give up on one AI without losing the rest of the job. */
  async function cancelTarget(jobId, siteId) {
    const job = jobFor(jobId);
    if (!job || !job.runs[siteId]) {
      return { ok: false, reason: 'not-found' };
    }
    job.runs[siteId].cancelled = true;
    clearWatchdog(job.id, siteId);
    const tabId = job.runs[siteId].tabId;
    if (tabId !== undefined) await B.sendToTab(tabId, { type: WF.MSG.CANCEL_JOB });
    bg.tracker.clearInFlight(job.id, siteId);
    await pushTarget(job.id, siteId, { status: 'cancelled' });
    return { ok: true };
  }

  /**
   * Send one target again, on its own.
   *
   * It goes through the same two steps as a broadcast — warm the page, then type — because
   * the reason a target failed is usually the page, not the prompt. A retry after a failure
   * keeps the conversation it was in: the user asked for this one AI again, not a new chat.
   */
  async function retryTarget(jobId, siteId) {
    const job = jobFor(jobId);
    if (!job || !job.runs[siteId]) return { ok: false, reason: 'not-found' };
    const run = job.runs[siteId];
    if (!TERMINAL.includes(run.state) && run.state !== 'waiting') {
      return { ok: false, reason: 'still-running' };
    }
    job.runs[siteId] = { ...newRun(), attempts: run.attempts };
    const settings = await bg.store.settings();
    const prepared = await prepareTarget(job, siteId, settings);
    // A retry keeps the conversation this job was already in.
    if (prepared.tab) await sendToTarget(job, siteId, prepared.tab, settings, { keepConversation: true });
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // The comparison window
  // ---------------------------------------------------------------------------

  /**
   * Put the tabs that are answering side by side in one window. Chrome only, in the
   * sense that it needs `tabs.move`; the tabs themselves are the real sites, so nothing
   * about an answer passes through us to display it.
   */
  async function openCompare() {
    const job = jobFor(null);
    const ids = [];
    if (job) {
      for (const siteId of job.targetOrder) {
        const run = job.runs[siteId];
        if (run && run.tabId !== undefined) ids.push(run.tabId);
      }
    }
    if (ids.length < 2) {
      // Fall back to the tabs behind the answers-ready list.
      const items = await bg.answers.list();
      for (const item of items) {
        if (item.tabId !== undefined && !ids.includes(item.tabId)) ids.push(item.tabId);
      }
    }
    if (ids.length < 2) return { ok: false, reason: 'need-two' };

    const windows = B.api && B.api.windows;
    const tabsApi = B.api && B.api.tabs;
    if (!windows || !tabsApi || typeof windows.create !== 'function') {
      return { ok: false, reason: 'unsupported' };
    }

    const created = await callApi(windows.create, { tabId: ids[0], focused: true });
    const windowId = created && created.id;
    if (windowId === undefined) return { ok: false, reason: 'blocked' };
    if (typeof tabsApi.move === 'function') {
      await callApi(tabsApi.move, ids.slice(1), { windowId, index: -1 });
    }
    return { ok: true, windowId, tabs: ids.length };
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  function summarise(job) {
    return {
      jobId: job.id,
      prompt: job.prompt,
      chars: job.promptChars,
      origin: job.via,
      originSiteId: job.originSiteId,
      createdAt: job.createdAt,
      running: live.jobs.includes(job),
      targets: job.targetOrder.map((siteId) => {
        const run = job.runs[siteId];
        return {
          siteId,
          name: (WF.sites.byId(siteId) || { name: siteId }).name,
          state: run.state,
          attempts: run.attempts,
          error: run.error,
          errorCode: run.errorCode,
          tabId: run.tabId === undefined ? null : run.tabId,
        };
      }),
    };
  }

  function state() {
    const running = live.jobs.map(summarise);
    return {
      // `jobs` is what is in flight right now, and nothing else: there is no queue, so a
      // second prompt is going out at the same time as the first.
      jobs: running,
      // `activeJob` is the card the popup shows. While anything is going out that is the
      // newest of them; once they have all finished it is the last one's *outcome*, so the
      // per-AI tally does not vanish the instant the last answer lands. `running` on the
      // summary is what tells the two apart.
      activeJob: running.length
        ? running[running.length - 1]
        : live.lastFinished
          ? summarise(live.lastFinished)
          : null,
      counts: {
        running: running.length,
        sentToday: live.counts.sentToday,
      },
      recent: recentJob
        ? { jobId: recentJob.jobId, originSiteId: recentJob.originSiteId, at: recentJob.at }
        : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Phases reported by the content scripts
  // ---------------------------------------------------------------------------

  async function handleState(msg, sender) {
    const { jobId, siteId, phase } = msg;
    if (!jobId || !siteId) return;

    let group = null;
    const origin = msg.origin || 'broadcast';
    const isUserSend = origin === 'user';

    // A prompt the user sent by hand in the origin tab belongs to the broadcast that is
    // already running: it is the same conversation, and it should be timed with it.
    if (isUserSend && recentJob && recentJob.originSiteId === msg.siteId) {
      if (Date.now() - recentJob.at < RECENT_JOB_MS) group = recentJob.jobId;
    }

    const tabId = sender && sender.tab ? sender.tab.id : undefined;

    if (phase === WF.PHASE.SENT && !isUserSend) {
      await bg.tracker.targetSent({
        jobId,
        siteId,
        group: msg.group || group || jobId,
        tabId,
        sentAt: msg.sentAt,
        origin,
      });
      bg.tracker.start();
      await pushTarget(jobId, siteId, { status: 'sent', tabId });
    }

    // Mirror the lifecycle into the job, so the popup can show which AI is still
    // working, which is finished and which needs you.
    if (phase === WF.PHASE.STREAMING) await pushTarget(jobId, siteId, { status: 'answering' });
    if (phase === WF.PHASE.DONE) await pushTarget(jobId, siteId, { status: 'done' });
    if (phase === WF.PHASE.ERROR) {
      await pushTarget(jobId, siteId, { status: 'error', errorCode: WF.CODE.UNKNOWN, error: 'no answer appeared' });
    }
    if (phase === WF.PHASE.ATTENTION) {
      await pushTarget(jobId, siteId, { status: 'attention', errorCode: WF.CODE.NEEDS_HUMAN });
    }
    if (phase === WF.PHASE.TIMEOUT) await pushTarget(jobId, siteId, { status: 'timeout', errorCode: WF.CODE.TIMEOUT });

    // Pass the sender's tab id through explicitly: the content script does not know its
    // own id, and without it an answer whose "sent" record was lost (a worker restart
    // between the two reports) could never be cleared by visiting the tab.
    await bg.tracker.targetPhase({
      ...msg,
      tabId: msg.tabId !== undefined ? msg.tabId : tabId,
      group: group || undefined,
    });
  }

  // ---------------------------------------------------------------------------

  function init() {
    // Nothing to schedule: the alarms that sweep orphans live in background.js, because
    // they are about the record rather than about sending.
  }

  bg.engine = {
    init,
    broadcast,
    capture,
    cancel,
    cancelTarget,
    retryTarget,
    openCompare,
    handleState,
    onHello,
    state,
    blockedTargets,
    announceBlocked,
    ensureTab,
    verifySite,
    refreshStatuses,
    isVerified,
    visibleTabs,
    openCounts,
  };
})();
