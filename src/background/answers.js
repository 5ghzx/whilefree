/**
 * Answers landing: the toolbar count, the answers-ready list, the chime, and the
 * "go there" click.
 *
 * An answer that lands in the tab you are already looking at is not news: it never
 * reaches the list, so the list only ever holds things still worth your attention.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});
  const bg = (WF.bg = WF.bg || {});
  const B = WF.browser;

  const MAX = 40;
  const BADGE_COLOR = '#2f7d4f';

  async function activeTab() {
    const tabs = await B.queryTabs({ active: true, lastFocusedWindow: true });
    return tabs && tabs[0] ? tabs[0] : null;
  }

  async function list() {
    return WF.storage.getAnswers();
  }

  async function updateBadge() {
    const items = await list();
    const count = items.length;
    await B.setBadge(count ? String(count) : '', BADGE_COLOR);
    // The toolbar tooltip is part of the product, so hovering the icon says the same
    // thing the badge says. It is also the only place a count is visible without
    // opening the popup.
    try {
      await B.call('action', 'setTitle', {
        title: count
          ? `${WF.app.name()}: ${count} answer${count === 1 ? '' : 's'} ready`
          : `${WF.app.name()}: ask every AI at once`,
      });
    } catch (err) {
      /* setTitle is cosmetic */
    }
    return count;
  }

  async function push() {
    const items = await list();
    await bg.store.broadcastToSites({ type: WF.MSG.ANSWERS, answers: items });
    return items;
  }

  /**
   * Record a finished answer. Returns the entry, or null when it was not worth
   * showing (the user was already on that tab, or it is a duplicate).
   */
  async function add({ siteId, tabId, windowId, waitedMs, url, title, at }) {
    const settings = await bg.store.settings();
    const items = await list();
    const readyAt = at || Date.now();

    const focused = await activeTab();
    const wasWatching = focused && focused.id === tabId;

    // Drop older entries for the same site: only the newest is actionable.
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

    const trimmed = deduped.slice(-MAX);
    await WF.storage.setAnswers(trimmed);
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

  /**
   * A chime for each answer, if it is switched on. The sound is synthesised in the
   * tab you are actually looking at, so no audio file ships and nothing plays in a
   * background tab where you would not hear it anyway.
   */
  async function chime(siteId) {
    const settings = await bg.store.settings();
    if (!WF.settings.chimeFor(settings, siteId)) return false;
    if (WF.settings.inQuietHours(settings, Date.now())) return false;

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

  /** The OS-level notification, for when no AI tab is in front. */
  async function notify({ siteId, waitedMs }) {
    const settings = await bg.store.settings();
    if (!settings.notifySystem) return false;
    if (waitedMs < (settings.notifyMinWaitMs || 0)) return false;
    if (WF.settings.inQuietHours(settings, Date.now())) return false;
    const site = WF.sites.byId(siteId);
    const name = site ? site.name : siteId;
    return B.notify(`wf-answer-${siteId}-${Date.now()}`, {
      title: `${name} has answered`,
      message: `Ready after ${WF.util.humanShort(waitedMs)}. Click to open the tab.`,
      silent: false,
    });
  }

  bg.answers = {
    list,
    add,
    clear,
    removeForTab,
    open,
    chime,
    notify,
    updateBadge,
    push,
    activeTab,
  };
})();
