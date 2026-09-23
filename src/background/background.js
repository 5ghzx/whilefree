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
      openTabs: openBySite.get(site.id) || 0,
      attention: (status[site.id] && status[site.id].attention) || null,
      attentionAt: (status[site.id] && status[site.id].at) || null,
      hasComposer: status[site.id] ? status[site.id].hasComposer : undefined,
    }));
  }

  async function getState() {
    const settings = await bg.store.settings(true);
    const [answers, stats, events, meta] = await Promise.all([
      bg.answers.list(),
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
        await WF.storage.setSiteStatusFor(msg.siteId, {
          attention: msg.attention ? msg.attention.reason : null,
          attentionEvidence: msg.attention ? msg.attention.evidence : null,
          warning: msg.warning || null,
          hasComposer: msg.hasComposer,
          url: msg.url,
        });
        return { ok: true };
      }

      case WF.MSG.ACTIVITY:
        return bg.tracker.recordActivity(msg);

      case WF.MSG.STATE:
        await bg.engine.handleState(msg, sender);
        return { ok: true };

      case WF.MSG.BROADCAST: {
        const result = await bg.engine.broadcast({
          prompt: msg.prompt,
          originSiteId: msg.originSiteId || null,
          originUrl: msg.originUrl || null,
          originTabId: sender && sender.tab ? sender.tab.id : null,
        });
        return result;
      }

      case WF.MSG.OPEN_ANSWER:
        return bg.answers.open(msg.answerId);

      case WF.MSG.CLEAR_ANSWERS: {
        const answers = await bg.answers.clear();
        return { ok: true, answers };
      }

      case WF.MSG.GET_STATE:
        return getState();

      case WF.MSG.SET_SETTINGS: {
        const settings = await bg.store.patchSettings(msg.patch || {});
        return { ok: true, settings };
      }

      case WF.MSG.TEST_SITE:
        return testSite(msg.siteId);

      case WF.MSG.CANCEL:
        return bg.engine.cancel(msg.jobId);

      case WF.MSG.OPEN_DASHBOARD: {
        await openDashboard();
        return { ok: true };
      }

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

  B.api.runtime.onInstalled.addListener(async (details) => {
    await WF.storage.setMeta({ installedAt: Date.now(), installReason: details && details.reason });
    const settings = await bg.store.settings(true);
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
    await bg.answers.updateBadge();
  });

  // A closed tab should not leave a dead "answers ready" entry behind.
  B.api.tabs.onRemoved.addListener(async (tabId) => {
    await bg.answers.removeForTab(tabId);
  });

  bg.engine.init();
  bg.tracker.start();
  bg.answers.updateBadge();

  bg.background = { getState, testSite, openDashboard };
})();
