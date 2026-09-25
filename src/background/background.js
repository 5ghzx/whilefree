/**
 * The background worker: one message router, one lifecycle.
 *
 * In Chrome this runs as a module service worker; in Firefox it runs as an event
 * page. Both load the same modules, so nothing below knows or cares which it is.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});
  const bg = (WF.bg = WF.bg || {});
  const B = WF.browser;
  const U = WF.util;

  // ---------------------------------------------------------------------------
  // State for the popup
  // ---------------------------------------------------------------------------

  async function siteOverview(settings) {
    const tabs = await B.queryTabs({ url: WF.sites.matchPatterns() });
    const status = await WF.storage.getSiteStatus();
    const openBySite = new Map();
    for (const tab of tabs) {
      const site = WF.sites.fromUrl(tab.url || '');
      if (!site) continue;
      openBySite.set(site.id, (openBySite.get(site.id) || 0) + 1);
    }
    return WF.sites.list().map((site) => ({
      id: site.id,
      name: site.name,
      color: site.color,
      monogram: site.monogram,
      enabled: (settings.enabledSites || []).includes(site.id),
      // `enabled` is the switch; `verified` is whether a page of that site has said,
      // recently, that it is signed in. A switch that is on but unverified shows as
      // "not checked", because an AI that is switched on and cannot be sent to is worse
      // information than one that is plainly off.
      verified: bg.engine.isVerified(status[site.id]),
      openTabs: openBySite.get(site.id) || 0,
      attention: (status[site.id] && status[site.id].attention) || null,
      attentionAt: WF.status.attentionAt(status[site.id]) || null,
      // Whether that attention is still about now. A site with no tab open cannot be asked, so
      // its record is history, and the popup says so rather than asserting it in the present
      // tense — which is what "Signed out" next to an AI the user is signed in to always was.
      attentionFresh: WF.status.attentionIsFresh(status[site.id]),
      hasComposer: status[site.id] ? status[site.id].hasComposer : undefined,
    }));
  }

  async function getState(options) {
    // The site list is a claim about right now, so the AI tabs that are open are asked right
    // now. Not awaited: the popup is a click that should draw immediately, and the answers
    // arrive as storage writes, which the popup is already listening for.
    if (options && options.refresh) bg.engine.refreshStatuses().catch(() => undefined);
    const settings = await bg.store.settings(true);
    const [answers, stats, events, meta] = await Promise.all([
      // live() drops expired entries: the popup should never show a stale one either.
      bg.answers.live(),
      WF.storage.getStats(),
      WF.storage.getEvents(),
      WF.storage.getMeta(),
    ]);
    const todayKey = U.dayKey();
    const today = WF.stats.summarize(stats, [todayKey]);
    const week = WF.stats.summarize(stats, WF.stats.rangeKeys(7));
    return {
      ok: true,
      version: WF.app.version(),
      app: { name: WF.app.name, tagline: WF.app.tagline, repo: WF.app.repo, license: WF.app.license },
      settings,
      answers,
      sites: await siteOverview(settings),
      job: bg.engine.state(),
      today: { key: todayKey, totals: today.totals, perSite: today.perSite },
      week: { totals: week.totals, perSite: week.perSite, split: WF.stats.split(week.totals) },
      eventCount: events.length,
      meta,
    };
  }

  // ---------------------------------------------------------------------------
  // "Check this tab": is the site's markup still the shape we expect?
  // ---------------------------------------------------------------------------

  async function testSite(siteId) {
    let tab = null;
    if (siteId) {
      const site = WF.sites.byId(siteId);
      if (!site) return { ok: false, reason: 'unknown-site' };
      const tabs = await B.queryTabs({ url: site.matchPatterns });
      tab = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || null;
    } else {
      const active = await bg.answers.activeTab();
      if (active && WF.sites.fromUrl(active.url || '')) tab = active;
    }
    if (!tab || tab.id === undefined) {
      return { ok: false, reason: 'no-tab', message: 'Open that AI in a tab first, then run the check.' };
    }
    const diagnostic = await B.sendToTab(tab.id, { type: WF.MSG.TEST_SITE });
    if (!diagnostic || !diagnostic.diagnostic) {
      return { ok: false, reason: 'no-content', tabId: tab.id, message: 'That tab is not running WhileFree yet. Reload it.' };
    }
    return { ok: true, tabId: tab.id, diagnostic: diagnostic.diagnostic };
  }

  // ---------------------------------------------------------------------------
  // Alarms: the two things that happen when nobody is doing anything
  // ---------------------------------------------------------------------------

  const SWEEP_ALARM = 'wf:sweep';
  const WEEKLY_ALARM = 'wf:weekly';
  const WEEK_MS = 7 * 86400000;

  /**
   * Two alarms, both cheap. One settles the record — abandoned turns get filed as
   * orphans instead of vanishing — and one checks whether a week has passed since the
   * last report. Alarms rather than timers because a service worker is not alive often
   * enough to keep a clock, and a weekly digest that only fires if the browser happens
   * to stay open is not a weekly digest.
   */
  async function ensureAlarms() {
    try {
      await B.call('alarms', 'create', SWEEP_ALARM, { periodInMinutes: 5 });
      await B.call('alarms', 'create', WEEKLY_ALARM, { periodInMinutes: 60 });
    } catch (err) {
      /* Firefox without the permission, or a browser that has no alarms at all */
    }
  }

  async function sweep() {
    const result = await bg.tracker.sweep();
    await bg.answers.updateBadge();
    return result;
  }

  // ---------------------------------------------------------------------------
  // The right-click menu: asking without leaving the page you are on
  // ---------------------------------------------------------------------------

  const MENU_SELECTION = 'wf-ask-selection';
  const MENU_PAGE = 'wf-ask-page';

  /**
   * Two items, both "ask every AI about the thing under the cursor". Off the page the
   * whole broadcast works on a prompt: a selection is one, and a page is its title and
   * address, which is what you would have pasted anyway.
   *
   * Context menus are created on install and on startup rather than unconditionally,
   * because Chrome throws on a duplicate id and a service worker starts more than once.
   */
  async function installMenus() {
    const menus = B.api && B.api.contextMenus;
    if (!menus || typeof menus.create !== 'function') return;
    try {
      // Chrome's removeAll is callback-style and returns nothing; Firefox's returns a
      // promise. Racing a short timeout covers both without guessing which browser this
      // is, and stops a fast create from losing to a slow removal.
      await Promise.race([
        B.call('contextMenus', 'removeAll').catch(() => undefined),
        new Promise((resolve) => setTimeout(resolve, 200)),
      ]);
    } catch (err) {
      /* a browser without context menus still has everything else */
    }
    createMenus(menus);
  }

  function createMenus(menus) {
    try {
      menus.create({
        id: MENU_SELECTION,
        title: 'Ask every AI about “%s”',
        contexts: ['selection'],
      });
      menus.create({
        id: MENU_PAGE,
        title: 'Ask every AI about this page',
        contexts: ['page'],
      });
    } catch (err) {
      /* already there, or menus are unavailable */
    }
  }

  /** Never a silent click: a right-click that does nothing tells you why. */
  async function explainMenuFailure(reason) {
    const message =
      reason === 'no-targets'
        ? 'Switch on at least one AI in the popup first.'
        : reason === 'off'
          ? 'Sending is switched off. Turn it back on in the popup.'
          : reason === 'empty'
            ? 'There was nothing selected to ask about.'
            : 'That prompt could not be sent. Open the popup to see why.';
    return B.notify(`wf-menu-${Date.now()}`, {
      title: 'Nothing was sent',
      message,
      silent: true,
    });
  }

  async function askFromMenu(info, tab) {
    const settings = await bg.store.settings(true);
    const menuItemId = info && info.menuItemId;
    const selection =
      info && typeof info.selectionText === 'string' ? info.selectionText.trim() : '';
    // A selection is a prompt; a whole page is its title and address, which is what you
    // would have pasted into the box anyway.
    const prompt =
      menuItemId === MENU_PAGE && !selection
        ? [tab && tab.title, tab && tab.url].filter(Boolean).join('\n')
        : selection;

    let result = null;
    if (!prompt) result = { ok: false, reason: 'empty' };
    else if (settings.broadcastEnabled === false) result = { ok: false, reason: 'off' };
    else {
      result = await bg.engine.broadcast({
        prompt,
        originSiteId: null,
        originUrl: (tab && tab.url) || null,
        originTabId: tab && tab.id !== undefined ? tab.id : null,
        via: 'menu',
      });
    }

    if (!result || !result.ok) await explainMenuFailure(result && result.reason);
    return result;
  }

  /**
   * The Monday-ish digest. Free, and on by default: it is the one piece of the old
   * Pro list that is worth pushing rather than waiting to be asked for.
   */
  async function maybeWeeklyReport(force) {
    const settings = await bg.store.settings(true);
    if (settings.weeklyReportEnabled === false) return { ok: false, reason: 'off' };

    const meta = await WF.storage.getMeta();
    const now = Date.now();
    const last = Number(meta.weeklyReportAt) || 0;
    if (!last) {
      // First run: start the clock rather than reporting on nothing.
      await WF.storage.setMeta({ weeklyReportAt: now });
      return { ok: false, reason: 'started' };
    }
    if (!force && now - last < WEEK_MS) return { ok: false, reason: 'wait', nextAt: last + WEEK_MS };

    const stats = await WF.storage.getStats();
    const week = WF.stats.summarize(stats, WF.stats.rangeKeys(7));
    const digest = WF.stats.weeklyDigest(week);
    await WF.storage.setMeta({ weeklyReportAt: now });
    if (!digest) return { ok: false, reason: 'nothing-to-report' };

    await B.notify(`wf-weekly-${now}`, {
      title: digest.title,
      message: digest.message,
      silent: true,
    });
    return { ok: true, title: digest.title, message: digest.message };
  }

  // ---------------------------------------------------------------------------
  // Message routing
  // ---------------------------------------------------------------------------

  B.onMessage(async (msg, sender) => {
    if (!msg || !msg.type) return undefined;

    switch (msg.type) {
      case WF.MSG.HELLO: {
        bg.engine.onHello({ siteId: msg.siteId, tab: sender && sender.tab });
        if (sender && sender.tab) {
          await WF.storage.setSiteStatusFor(msg.siteId, {
            hasComposer: !!msg.hasComposer,
            url: msg.url,
          });
        }
        return { ok: true };
      }

      case WF.MSG.SITE_STATUS: {
        // The content script sends `{ reason, evidence }`; accept a bare reason string
        // too, because a wrong shape here fails silently — the icon just stays quiet.
        const attention =
          msg.attention && typeof msg.attention === 'object' ? msg.attention.reason : msg.attention || null;
        const evidence =
          msg.attention && typeof msg.attention === 'object' ? msg.attention.evidence : null;
        await WF.storage.setSiteStatusFor(msg.siteId, {
          attention,
          attentionEvidence: evidence,
          warning: msg.warning || null,
          hasComposer: msg.hasComposer,
          url: msg.url,
          // When the page said it, as opposed to when this record was last touched. The record's
          // own `at` moves on every write — a hello from a page that navigated, a settings
          // change — and an attention that looked eternally new because of an unrelated write is
          // how a signed-out reading from hours ago kept an AI out of every fan-out.
          ...(attention ? { attentionAt: Date.now() } : {}),
          // A page that says it is signed out has just contradicted the turn-on check, and a
          // contradiction should not sit in storage for the week the check is trusted. The
          // switch goes back to off until it is pressed again on a signed-in page.
          ...(attention === WF.ATTENTION.SIGNED_OUT ? { verifiedAt: 0 } : {}),
          // And the other direction, which used to be missing: a page that says it is fine is
          // the same evidence the turn-on check collects, so it restores the flag the bad
          // reading cleared. This is what makes the switch self-correcting instead of sticky —
          // one misread used to take an AI off the list permanently, because the only thing
          // that could clear it was the switch that the misread had just turned off.
          ...(attention === null && msg.hasComposer === true && sender && sender.tab
            ? { verifiedAt: Date.now() }
            : {}),
        });
        // A site that has just started (or stopped) asking for you owns the icon, so
        // the badge is recomputed here rather than waiting for the next answer.
        await bg.answers.updateBadge();
        return { ok: true };
      }

      case WF.MSG.ACTIVITY:
        return bg.tracker.recordActivity(msg);

      case WF.MSG.STATE:
        await bg.engine.handleState(msg, sender);
        return { ok: true };

      case WF.MSG.BROADCAST: {
        // An explicit "ask every AI" includes the one you pressed it in: you asked for all
        // of them, and excluding the page you happen to be looking at is not what "all"
        // means to anyone. Which AI that is comes from the tab it was sent from, so the
        // engine can reuse that exact tab and that open conversation — a prompt sent from
        // the launcher on ChatGPT is asked *in* the ChatGPT you are looking at.
        const senderUrl = (sender && sender.tab && sender.tab.url) || null;
        const from = senderUrl ? WF.sites.fromUrl(senderUrl) : null;
        const result = await bg.engine.broadcast({
          prompt: msg.prompt,
          originSiteId: msg.originSiteId || (from ? from.id : null),
          originUrl: msg.originUrl || senderUrl,
          originTabId: sender && sender.tab ? sender.tab.id : null,
          via: 'manual',
        });
        return result;
      }

      // A prompt sent in an AI's own message box. The engine decides whether it is you
      // asking something or the site echoing back what we delivered.
      case WF.MSG.CAPTURE:
        return bg.engine.capture({
          prompt: msg.prompt,
          hash: msg.hash,
          siteId: msg.siteId,
          tabId: sender && sender.tab ? sender.tab.id : undefined,
          url: msg.url || (sender && sender.tab ? sender.tab.url : null),
        });

      case WF.MSG.CANCEL_TARGET:
        return bg.engine.cancelTarget(msg.jobId, msg.siteId);

      case WF.MSG.RETRY_TARGET:
        return bg.engine.retryTarget(msg.jobId, msg.siteId);

      case WF.MSG.OPEN_COMPARE:
        return bg.engine.openCompare();

      case WF.MSG.OPEN_ANSWER:
        return bg.answers.open(msg.answerId);

      case WF.MSG.CLEAR_ANSWERS: {
        const answers = await bg.answers.clear();
        return { ok: true, answers };
      }

      case WF.MSG.GET_STATE:
        // `refresh` is set by the popup and the dashboard — the two places the site list is
        // read by a person — and deliberately not by anything that only wants to know whether
        // a send may go out, which asks the page itself a moment later anyway.
        return getState({ refresh: msg.refresh === true });

      case WF.MSG.SET_SETTINGS: {
        const settings = await bg.store.patchSettings(msg.patch || {});
        return { ok: true, settings };
      }

      case WF.MSG.TEST_SITE:
        return testSite(msg.siteId);

      // Turning an AI on: open its tab, ask whether it is signed in, and only then let
      // it be a target. The switch in the popup and the dashboard both come here.
      case WF.MSG.VERIFY_SITE:
        return bg.engine.verifySite(msg.siteId, { timeoutMs: msg.timeoutMs });

      case WF.MSG.CANCEL:
        return bg.engine.cancel(msg.jobId);

      case WF.MSG.OPEN_DASHBOARD: {
        await openDashboard(msg.hash);
        return { ok: true };
      }

      // Useful from the dashboard, and the only way to see the digest without waiting
      // a week for it.
      case WF.MSG.WEEKLY_REPORT:
        return maybeWeeklyReport(true);

      default:
        return undefined;
    }
  });

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async function openDashboard(hash) {
    const url = B.api.runtime.getURL(`dashboard/dashboard.html${hash ? `#${hash}` : ''}`);
    const existing = await B.queryTabs({ url: `${url.split('#')[0]}*` });
    if (existing.length && existing[0].id !== undefined) {
      await B.updateTab(existing[0].id, { active: true });
      return existing[0].id;
    }
    const created = await B.createTab({ url });
    return created && created.id;
  }

  try {
    B.api.contextMenus.onClicked.addListener((info, tab) => {
      askFromMenu(info || {}, tab || null).catch(() => undefined);
    });
  } catch (err) {
    /* no context menus */
  }

  B.api.runtime.onInstalled.addListener(async (details) => {
    await WF.storage.setMeta({ installedAt: Date.now(), installReason: details && details.reason });
    const settings = await bg.store.settings(true);
    installMenus();
    await ensureAlarms();
    await sweep();
    await bg.answers.updateBadge();
    if (details && details.reason === 'install' && !settings.onboardingDone) {
      await openDashboard('welcome');
    }
  });

  B.api.runtime.onStartup.addListener(async () => {
    await bg.store.invalidate();
    bg.store.settings(true).then((settings) => {
      // A restart is a good moment to re-check slow modes and replay nothing else.
      return settings;
    });
    bg.tracker.start();
    installMenus();
    await ensureAlarms();
    // A browser that was closed mid-answer settles its record the next time it opens.
    await sweep();
    await maybeWeeklyReport(false);
    await bg.answers.updateBadge();
  });

  try {
    B.api.alarms.onAlarm.addListener(async (alarm) => {
      if (!alarm) return;
      if (alarm.name === SWEEP_ALARM) await sweep();
      if (alarm.name === WEEKLY_ALARM) await maybeWeeklyReport(false);
    });
  } catch (err) {
    /* no alarms API: everything else still works */
  }

  // A closed tab should not leave a dead "answers ready" entry behind.
  B.api.tabs.onRemoved.addListener(async (tabId) => {
    await bg.answers.removeForTab(tabId);
  });

  // Going to the tab yourself is the same thing as clicking "Open →": the entry has
  // served its purpose, so the count drops without the user having to tidy up.
  B.api.tabs.onActivated.addListener((info) => {
    if (info && info.tabId !== undefined) bg.answers.visited(info.tabId);
  });
  B.api.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === undefined || windowId < 0) return;
    const tabs = await B.queryTabs({ active: true, windowId });
    if (tabs[0] && tabs[0].id !== undefined) bg.answers.visited(tabs[0].id);
  });

  // A notification should take you to the thing it is about.
  B.api.notifications.onClicked.addListener(async (id) => {
    if (typeof id === 'string' && id.startsWith('wf-weekly-')) {
      await openDashboard('week');
    } else {
      await bg.answers.clickedNotification(id);
    }
    try {
      await B.call('notifications', 'clear', id);
    } catch (err) {
      /* the notification may already be gone */
    }
  });

  bg.engine.init();
  bg.tracker.start();
  installMenus();
  bg.answers.updateBadge();
  ensureAlarms();

  bg.background = {
    getState,
    testSite,
    openDashboard,
    sweep,
    maybeWeeklyReport,
    ensureAlarms,
    askFromMenu,
  };
})();
