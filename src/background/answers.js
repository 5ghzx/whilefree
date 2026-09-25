/**
 * Answers landing: the toolbar count, the answers-ready list, the chime, and the
 * "go there" click.
 *
 * An answer that lands in the tab you are already looking at is not news: it never
 * reaches the list, and it does not chime or raise a notification either. The list
 * only ever holds things still worth your attention.
 *
 * The count on the icon has two sources, and lib/badge.js decides which wins: an AI
 * that needs you takes the icon in amber, answers that have landed show in green.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});
  const bg = (WF.bg = WF.bg || {});
  const B = WF.browser;

  const NOTIFY_PREFIX = 'wf-answer-';
  const PROBLEM_PREFIX = 'wf-problem-';

  async function activeTab() {
    const tabs = await B.queryTabs({ active: true, lastFocusedWindow: true });
    return tabs && tabs[0] ? tabs[0] : null;
  }

  async function list() {
    return WF.storage.getAnswers();
  }

  /**
   * The entries still worth showing, with the stale ones dropped from storage rather
   * than left to pile up. Called before anything reads the list.
   */
  async function live() {
    const stored = await list();
    const kept = WF.badge.live(stored, Date.now());
    if (kept.length !== stored.length) await WF.storage.setAnswers(kept);
    return kept;
  }

  /** Sites that are currently asking for the user: signed out, blocked, out of quota. */
  async function problems() {
    const settings = await bg.store.settings();
    const statuses = await WF.storage.getSiteStatus();
    return WF.badge.liveProblems(statuses, Date.now(), (siteId) =>
      WF.settings.siteEnabled(settings, siteId)
    );
  }

  /**
   * What the icon says. Attention is shown even when the answer count is switched
   * off: that switch is about answers, not about an AI that is stuck.
   */
  async function updateBadge() {
    const settings = await bg.store.settings();
    const items = await live();
    const stuck = await problems();
    const ready = settings.badgeEnabled === false ? 0 : items.length;
    const badge = WF.badge.badgeFor(stuck.length, ready, WF.app.name());
    await B.setBadge(badge.text, badge.text ? badge.color : null);
    await B.setTitle(badge.title);
    return badge;
  }

  async function push() {
    const items = await live();
    await bg.store.broadcastToSites({ type: WF.MSG.ANSWERS, answers: items });
    return items;
  }

  /**
   * Record a finished answer. Returns the entry, or null when it was not worth
   * showing (the user was already on that tab, or it is a duplicate).
   */
  async function add({ siteId, tabId, windowId, waitedMs, url, title, at }) {
    const items = await list();
    const readyAt = at || Date.now();

    const focused = await activeTab();
    const wasWatching = focused && focused.id === tabId;

    // Drop older entries for the same site: only the newest is actionable, and one
    // entry per site is what makes the count a count of AIs.
    const deduped = items.filter((item) => item.siteId !== siteId);
    let entry = null;

    if (!wasWatching) {
      entry = {
        id: WF.util.uid('ans'),
        siteId,
        tabId,
        windowId: windowId === undefined ? null : windowId,
        waitedMs: Math.max(0, Math.round(waitedMs || 0)),
        readyAt,
        url: url || null,
        title: title || null,
      };
      deduped.push(entry);
    }

    await WF.storage.setAnswers(WF.badge.live(deduped, Date.now()));
    await updateBadge();
    await push();
    return entry;
  }

  async function clear() {
    await WF.storage.setAnswers([]);
    await updateBadge();
    await push();
    return [];
  }

  async function removeForTab(tabId) {
    const items = await list();
    const next = items.filter((item) => item.tabId !== tabId);
    if (next.length === items.length) return items;
    await WF.storage.setAnswers(next);
    await updateBadge();
    await push();
    return next;
  }

  /**
   * The user went to that tab. Clicking "Open →" is not the only way to arrive: they
   * may switch to it themselves, or focus its window. Either way the entry has done
   * its job, so it clears and the count drops. Without this the badge would keep
   * claiming an answer is waiting long after they read it.
   */
  async function visited(tabId) {
    if (tabId === undefined || tabId === null) return 0;
    const before = (await list()).length;
    const after = await removeForTab(tabId);
    return Math.max(0, before - after.length);
  }

  /** Click an answer: bring that tab forward and let the entry clear itself. */
  async function open(answerId) {
    const items = await list();
    const entry = items.find((item) => item.id === answerId);
    if (!entry) return { ok: false, reason: 'gone' };
    try {
      if (entry.windowId !== null && entry.windowId !== undefined) {
        await B.call('windows', 'update', entry.windowId, { focused: true });
      }
      await B.updateTab(entry.tabId, { active: true });
    } catch (err) {
      // The tab is gone: drop the entry rather than leaving a dead link.
      await removeForTab(entry.tabId);
      return { ok: false, reason: 'tab-closed' };
    }
    await removeForTab(entry.tabId);
    return { ok: true };
  }

  function notificationId(siteId, prefix) {
    return `${prefix || NOTIFY_PREFIX}${siteId}-${Date.now()}`;
  }

  /** `wf-answer-<siteId>-<timestamp>` -> `<siteId>`. Site ids never contain a dash. */
  function siteIdFromNotification(id, prefix) {
    const head = prefix || NOTIFY_PREFIX;
    if (typeof id !== 'string' || !id.startsWith(head)) return null;
    const rest = id.slice(head.length);
    const cut = rest.lastIndexOf('-');
    return cut > 0 ? rest.slice(0, cut) : rest;
  }

  /**
   * The notification was clicked: open whichever answer it was about, so the alert is
   * actionable rather than something you dismiss and then go hunting for.
   */
  async function clickedNotification(id) {
    const problemSite = siteIdFromNotification(id, PROBLEM_PREFIX);
    if (problemSite) {
      // "Needs you" and "nothing was sent": open the tab that is stuck.
      const site = WF.sites.byId(problemSite);
      if (site) {
        const tabs = await B.queryTabs({ url: site.matchPatterns });
        const tab = tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0];
        if (tab && tab.id !== undefined) {
          try {
            await B.updateTab(tab.id, { active: true });
            return { ok: true, opened: 'tab' };
          } catch (err) {
            /* gone */
          }
        }
        return { ok: false, reason: 'no-tab' };
      }
      return { ok: false, reason: 'unknown-site' };
    }

    const siteId = siteIdFromNotification(id);
    if (!siteId) return { ok: false, reason: 'not-ours' };
    const items = await list();
    const entry = items.find((item) => item.siteId === siteId);
    if (!entry) return { ok: false, reason: 'gone' };
    return open(entry.id);
  }

  /**
   * A chime for each answer, if it is switched on. Chrome gets it from an offscreen
   * document so it sounds even while you are working in another app; elsewhere the
   * tone is synthesised in the AI tab, which only works while one is in front.
   */
  async function chime(siteId) {
    const settings = await bg.store.settings();
    if (!WF.settings.chimeFor(settings, siteId)) return false;
    if (WF.settings.inQuietHours(settings, Date.now())) return false;

    if (await B.playChime(settings.chimeVolume)) return true;

    const focused = await activeTab();
    if (focused && focused.id !== undefined) {
      const site = WF.sites.fromUrl(focused.url || '');
      if (site) {
        const res = await B.sendToTab(focused.id, {
          type: WF.MSG.CHIME,
          volume: settings.chimeVolume,
        });
        if (res && res.ok) return true;
      }
    }
    return false;
  }

  const PROBLEM_QUIET_MS = 5 * 60 * 1000;
  const problemSentAt = new Map();

  /**
   * Something needs you, or nothing was sent. This is the one alert worth interrupting
   * for, because it is the only one you can act on — and it is why the badge shows an
   * amber count at all.
   *
   * The same message is not repeated inside five minutes: a broadcast that hits the same
   * signed-out site four times should say so once.
   */
  async function notifyProblem({ siteId, title, message, key }) {
    const settings = await bg.store.settings();
    if (settings.notifyProblems === false) return false;
    if (WF.settings.inQuietHours(settings, Date.now())) return false;

    const dedupeKey = `${key || 'problem'}:${siteId || 'all'}`;
    const last = problemSentAt.get(dedupeKey) || 0;
    if (Date.now() - last < PROBLEM_QUIET_MS) return false;
    problemSentAt.set(dedupeKey, Date.now());

    const site = siteId ? WF.sites.byId(siteId) : null;
    const name = site ? site.name : siteId;
    return B.notify(notificationId(siteId, PROBLEM_PREFIX), {
      title: name && !String(title || '').includes(name) ? `${name}: ${title}` : title,
      message,
      silent: false,
    });
  }

  /** The OS-level notification, for when no AI tab is in front. Off by default. */
  async function notify({ siteId, waitedMs }) {
    const settings = await bg.store.settings();
    if (!settings.notifySystem) return false;
    if (waitedMs < (settings.notifyMinWaitMs || 0)) return false;
    if (WF.settings.inQuietHours(settings, Date.now())) return false;
    const site = WF.sites.byId(siteId);
    const name = site ? site.name : siteId;
    return B.notify(notificationId(siteId), {
      title: `${name} has answered`,
      message: `Ready after ${WF.util.humanShort(waitedMs)}. Click to open the conversation.`,
      silent: false,
    });
  }

  bg.answers = {
    list,
    live,
    problems,
    add,
    clear,
    removeForTab,
    visited,
    open,
    clickedNotification,
    chime,
    notify,
    notifyProblem,
    updateBadge,
    push,
    activeTab,
    notificationId,
    siteIdFromNotification,
    NOTIFY_PREFIX,
    PROBLEM_PREFIX,
  };
})();
