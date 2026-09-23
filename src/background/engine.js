/**
 * The broadcast engine.
 *
 * One prompt goes out to several AIs, one at a time, spaced out at roughly the pace
 * a person would work. Serial by design: parallel sends are what makes several sites
 * throw up a rate-limit check at once, and they make the timings meaningless.
 *
 * The prompt text lives in this module's memory for the length of the job and is
 * never written to storage. If the worker is torn down mid-job, the fan-out stops;
 * that is the price of not persisting what you typed, and it is the right trade.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});
  const bg = (WF.bg = WF.bg || {});
  const B = WF.browser;
  const U = WF.util;

  const READY_TIMEOUT_MS = 25000;
  const JOB_INDEX_LIMIT = 20;
  const WATCHDOG_EXTRA_MS = 90000;

  /** Live state. Deliberately not persisted (it contains prompt text). */
  const live = {
    activeJob: null,
    queue: [],
    counts: { queued: 0, sentToday: 0 },
  };

  /** jobId -> { originTabId, targets: [siteId], status: {siteId: phase}, at } */
  const jobIndex = new Map();
  /** siteId -> Set<tabId> of tabs we know have a content script */
  const knownTabs = new Map();
  /** tabId -> resolve(), for tabs we are waiting on */
  const readyWaiters = new Map();
  const watchdogs = new Map();
  /** The last broadcast, so the user's own send on the origin site joins its group. */
  let recentJob = null;

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
   * Get a usable tab for a site: prefer one already open and already talking to us,
   * then any open tab for that site (injecting the scripts if needed), and only then
   * open a new one.
   */
  async function ensureTab(site, settings) {
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
        if (alive) return tabs[0];
      }
    }

    // 2. Any open tab on that site, from before the extension was loaded.
    const open = await B.queryTabs({ url: site.matchPatterns });
    const candidate = open
      .filter((tab) => tab.id !== undefined)
      .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
    if (candidate) {
      if (await ping(candidate.id)) {
        rememberTab(site.id, candidate.id);
        return candidate;
      }
      await B.injectContentScripts(candidate.id, WF.files.contentScripts());
      if (await waitForReady(candidate.id, 3000)) {
        rememberTab(site.id, candidate.id);
        return candidate;
      }
    }

    // 3. Open one, in the background, at its new-chat URL.
    if (!settings.autoOpenTabs) return null;
    const created = await B.createTab({ url: site.newChatUrl, active: false }).catch(() => null);
    if (!created || created.id === undefined) return null;

    let ready = await waitForReady(created.id, READY_TIMEOUT_MS);
    if (!ready) {
      // A slow or redirected page: inject directly and give it one more moment.
      await B.injectContentScripts(created.id, WF.files.contentScripts());
      ready = (await ping(created.id)) ? created.id : null;
    }
    if (!ready) return null;
    rememberTab(site.id, created.id);
    return created;
  }

  // ---------------------------------------------------------------------------
  // Job notifications, for the in-page status list
  // ---------------------------------------------------------------------------

  async function notifyJob(jobId, message) {
    const entry = jobIndex.get(jobId);
    if (entry && entry.originTabId !== undefined && entry.originTabId !== null) {
      await B.sendToTab(entry.originTabId, message);
      return;
    }
    // No origin tab (a broadcast from the popup): tell every AI tab instead.
    await bg.store.broadcastToSites(message);
  }

  function rememberJob(job) {
    jobIndex.set(job.id, {
      originTabId: job.originTabId === undefined ? null : job.originTabId,
      targets: [...job.targets],
      status: {},
      at: Date.now(),
    });
    while (jobIndex.size > JOB_INDEX_LIMIT) {
      const oldest = [...jobIndex.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!oldest) break;
      jobIndex.delete(oldest[0]);
    }
  }

  async function pushTarget(jobId, siteId, patch) {
    const entry = jobIndex.get(jobId);
    if (entry) {
      entry.status[siteId] = patch.status || entry.status[siteId] || 'queued';
      const terminal = ['done', 'error', 'timeout', 'attention', 'skipped'];
      const allDone = entry.targets.every((id) => terminal.includes(entry.status[id]));
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
      const entry = jobIndex.get(job.id);
      const status = entry && entry.status[site.id];
      if (status === 'done' || status === 'timeout' || status === 'attention' || status === 'error') return;
      await pushTarget(job.id, site.id, { status: 'timeout', error: 'no answer seen in time' });
      await bg.tracker.targetPhase({
        jobId: job.id,
        siteId: site.id,
        phase: WF.PHASE.TIMEOUT,
        sentAt: Date.now(),
      });
      bg.tracker.clearInFlight(job.id, site.id);
    }, (site.answerTimeoutMs || 300000) + WATCHDOG_EXTRA_MS);
    watchdogs.set(key, timer);
  }

  // ---------------------------------------------------------------------------
  // Broadcast
  // ---------------------------------------------------------------------------

  async function broadcast({ prompt, originSiteId, originUrl, originTabId, targets: explicitTargets }) {
    const settings = await bg.store.settings();
    const targets = explicitTargets && explicitTargets.length
      ? explicitTargets.filter((id) => WF.sites.byId(id))
      : WF.settings.targetsFor(settings, originSiteId);
    if (!targets.length) return { ok: false, reason: 'no-targets' };

    const job = {
      id: U.uid('job'),
      group: null,
      prompt,
      promptChars: typeof prompt === 'string' ? prompt.length : 0,
      originSiteId: originSiteId || null,
      originUrl: originUrl || null,
      originTabId: originTabId === undefined ? null : originTabId,
      targets,
      createdAt: Date.now(),
      cancelled: false,
    };
    job.group = job.id;

    recentJob = {
      jobId: job.id,
      originSiteId: originSiteId || null,
      at: Date.now(),
    };

    if (live.activeJob) {
      live.queue.push(job);
      live.counts.queued = live.queue.length;
      return {
        ok: true,
        queued: true,
        jobId: job.id,
        targets,
        queueLength: live.queue.length,
      };
    }

    run(job).catch(() => undefined);
    return { ok: true, jobId: job.id, targets, queueLength: 0 };
  }

  async function run(job) {
    live.activeJob = job;
    live.counts.queued = live.queue.length;
    const settings = await bg.store.settings();

    rememberJob(job);
    await bg.tracker.jobSent({
      jobId: job.id,
      group: job.group,
      origin: 'broadcast',
      siteIds: job.targets,
      promptChars: job.promptChars,
    });
    await notifyJob(job.id, {
      type: WF.MSG.JOB,
      job: { jobId: job.id, targets: job.targets, running: true },
    });

    for (const siteId of job.targets) {
      if (job.cancelled) break;
      const site = WF.sites.byId(siteId);
      if (!site) continue;

      await pushTarget(job.id, siteId, { status: 'sending' });

      let tab = null;
      try {
        tab = await ensureTab(site, settings);
      } catch (err) {
        tab = null;
      }

      if (!tab || tab.id === undefined) {
        await pushTarget(job.id, siteId, {
          status: 'error',
          error: settings.autoOpenTabs ? 'could not reach the tab' : 'no open tab',
        });
        await bg.storage.setSiteStatusFor(siteId, { attention: 'no-tab', hasComposer: false });
        continue;
      }

      let response = await B.sendToTab(tab.id, {
        type: WF.MSG.SEND,
        jobId: job.id,
        siteId,
        prompt: job.prompt,
      });

      if (!response || (response.error && !response.ok)) {
        // The content script may have been unloaded by a page navigation.
        await B.injectContentScripts(tab.id, WF.files.contentScripts());
        await U.sleep(400);
        response = await B.sendToTab(tab.id, {
          type: WF.MSG.SEND,
          jobId: job.id,
          siteId,
          prompt: job.prompt,
        });
      }

      if (!response || response.ok !== true) {
        const reason = (response && response.reason) || 'send-failed';
        await pushTarget(job.id, siteId, { status: 'error', error: WF.attentionLabel(reason) });
        await bg.storage.setSiteStatusFor(siteId, { attention: reason, hasComposer: false });
        await bg.tracker.targetPhase({
          jobId: job.id,
          siteId,
          phase: WF.PHASE.ERROR,
          reason,
          sentAt: Date.now(),
        });
        continue;
      }

      await bg.tracker.targetSent({
        jobId: job.id,
        siteId,
        group: job.group,
        tabId: tab.id,
        sentAt: response.sentAt || Date.now(),
        origin: 'broadcast',
        promptChars: job.promptChars,
      });
      await pushTarget(job.id, siteId, {
        status: 'sent',
        sentAt: response.sentAt || Date.now(),
      });
      armWatchdog(job, site);

      // The gap that makes this look like a person rather than a script.
      await U.sleep(WF.settings.delayFrom(settings.paceMs));
    }

    job.prompt = null; // the text is gone as soon as the fan-out is done
    live.activeJob = null;
    live.counts.queued = live.queue.length;
    await notifyJob(job.id, { type: WF.MSG.JOB, job: { jobId: job.id, running: false } });

    if (live.queue.length) {
      const next = live.queue.shift();
      live.counts.queued = live.queue.length;
      run(next).catch(() => undefined);
    }
  }

  // ---------------------------------------------------------------------------
  // Inbound reports
  // ---------------------------------------------------------------------------

  /**
   * A phase report from a tab. For a send the user made by hand, this is also where
   * the event is created: if it happened right after a broadcast from the same site,
   * it joins that job's group so head-to-head includes the AI you actually typed in.
   */
  async function handleState(msg, sender) {
    if (!msg || !msg.siteId || !msg.phase) return;
    const tabId = sender && sender.tab ? sender.tab.id : undefined;
    const isUserSend = typeof msg.jobId === 'string' && msg.jobId.startsWith('user_');

    let group = msg.jobId;
    if (isUserSend && recentJob && recentJob.originSiteId === msg.siteId) {
      if (Date.now() - recentJob.at < 90000) group = recentJob.jobId;
    }

    await bg.tracker.targetPhase(
      {
        ...msg,
        group,
        tabId: tabId === undefined ? msg.tabId : tabId,
        origin: isUserSend ? 'user' : msg.origin || 'broadcast',
      },
      sender
    );

    if (msg.phase === WF.PHASE.DONE || msg.phase === WF.PHASE.TIMEOUT ||
        msg.phase === WF.PHASE.ERROR || msg.phase === WF.PHASE.ATTENTION) {
      const status =
        msg.phase === WF.PHASE.DONE ? 'done'
          : msg.phase === WF.PHASE.TIMEOUT ? 'timeout'
          : msg.phase === WF.PHASE.ATTENTION ? 'attention'
          : 'error';
      clearWatchdog(msg.jobId, msg.siteId);
      await pushTarget(msg.jobId, msg.siteId, {
        status,
        attention: msg.attention ? msg.attention.reason : null,
        error: msg.reason || null,
        sentAt: msg.sentAt,
        doneAt: msg.doneAt,
      });
    }
  }

  async function cancel(jobId) {
    if (live.activeJob && (!jobId || live.activeJob.id === jobId)) {
      live.activeJob.cancelled = true;
      live.queue = live.queue.filter((job) => job.id !== jobId);
      for (const siteId of live.activeJob.targets) clearWatchdog(live.activeJob.id, siteId);
      await notifyJob(live.activeJob.id, {
        type: WF.MSG.JOB,
        job: { jobId: live.activeJob.id, running: false },
      });
      live.activeJob = null;
      live.counts.queued = live.queue.length;
      return { ok: true };
    }
    live.queue = live.queue.filter((job) => job.id !== jobId);
    live.counts.queued = live.queue.length;
    return { ok: false, reason: 'not-running' };
  }

  function state() {
    return {
      activeJob: live.activeJob
        ? {
            id: live.activeJob.id,
            targets: live.activeJob.targets,
            originSiteId: live.activeJob.originSiteId,
            createdAt: live.activeJob.createdAt,
          }
        : null,
      queued: live.queue.map((job) => ({ id: job.id, targets: job.targets, createdAt: job.createdAt })),
      targetId: null,
    };
  }

  /** Send a prompt from the popup, where there is no origin page. */
  async function broadcastFromPopup({ prompt, targetSites }) {
    const settings = await bg.store.settings();
    const targets = (targetSites && targetSites.length ? targetSites : settings.enabledSites) || [];
    if (!targets.length) return { ok: false, reason: 'no-targets' };
    return broadcast({ prompt, originSiteId: null, originTabId: null, targets });
  }

  function init() {
    B.api.tabs.onRemoved.addListener((tabId) => forgetTab(tabId));
  }

  bg.engine = {
    init,
    broadcast,
    broadcastFromPopup,
    handleState,
    cancel,
    ensureTab,
    onHello,
    state,
    live,
    jobIndex,
  };
})();
