/**
 * Cross-browser WebExtension API access.
 *
 * Loaded as a classic script (content scripts, Firefox background event page)
 * and as a side-effect module (Chrome MV3 module service worker, popup, dashboard).
 * Everything it exposes hangs off the single `WF` global.
 *
 * Rule for every file in src/lib: no `import` / `export`, attach to `WF`.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});

  const isFirefox =
    typeof globalThis.browser !== 'undefined' &&
    !!globalThis.browser.runtime &&
    !!globalThis.browser.runtime.getBrowserInfo;

  const api =
    typeof globalThis.browser !== 'undefined' && globalThis.browser.runtime
      ? globalThis.browser
      : globalThis.chrome;

  const inServiceWorker =
    typeof ServiceWorkerGlobalScope !== 'undefined' &&
    globalThis instanceof ServiceWorkerGlobalScope;

  /**
   * Resolve a dotted path against the browser API and return the function at its end.
   *
   * Both halves can be dotted, because both are real: `storage.local.get` and
   * `storage.session.set` are how the storage area is named. Treating `local.get` as a
   * single property name finds nothing, and a storage call that quietly returns
   * undefined is the worst possible failure — everything appears to work and nothing is
   * ever saved. Hence one walk over the whole path.
   */
  function resolvePath(path) {
    const parts = String(path || '').split('.');
    const name = parts.pop();
    let ns = api;
    for (const part of parts) {
      if (!ns) return null;
      ns = ns[part];
    }
    if (!ns || typeof ns[name] !== 'function') return null;
    return { ns, name };
  }

  /** Resolve a callback- or promise-style API call into a promise. */
  function call(namespace, method, ...args) {
    const target = resolvePath(`${namespace}.${method}`);
    if (!target) return Promise.resolve(undefined);
    try {
      const result = target.ns[target.name](...args);
      if (result && typeof result.then === 'function') return result;
      return Promise.resolve(result);
    } catch (err) {
      return Promise.reject(err);
    }
  }

  /** sendMessage that never throws: there is often nobody listening. */
  async function send(message) {
    try {
      const res = await api.runtime.sendMessage(message);
      return res === undefined ? undefined : res;
    } catch (err) {
      return undefined;
    }
  }

  async function sendToTab(tabId, message) {
    try {
      return await api.tabs.sendMessage(tabId, message);
    } catch (err) {
      return undefined;
    }
  }

  /**
   * onMessage handler that supports async handlers in both browsers.
   * The handler may return a value or a promise.
   */
  function onMessage(handler) {
    api.runtime.onMessage.addListener((message, sender, sendResponse) => {
      let result;
      try {
        result = handler(message, sender);
      } catch (err) {
        sendResponse({ error: String((err && err.message) || err) });
        return false;
      }
      if (result && typeof result.then === 'function') {
        result.then(
          (value) => sendResponse(value === undefined ? { ok: true } : value),
          (err) => sendResponse({ error: String((err && err.message) || err) })
        );
        return true; // keep the channel open for the promise
      }
      if (result !== undefined) {
        sendResponse(result);
        return false;
      }
      return false;
    });
  }

  /**
   * Has this browser handed the extension this site at all?
   *
   * The question exists because on Firefox the answer can be no while everything else looks
   * fine. Firefox grants MV3 host permissions one origin at a time and keeps the set it
   * granted: an origin a later version added to the manifest is *not* silently included, so
   * an AI whose site moved (Kimi, from kimi.com to kimi.ai) can be listed, switched on,
   * opened, and still have no content script in it — not broken code, no permission. Nothing
   * else distinguishes those two states, and the difference decides what the user has to do:
   * repair the site's selectors, or hand the extension the site.
   *
   * Three-valued on purpose. `true`, `false`, or null for "this browser will not say" — an
   * API that is absent (an older Chrome, a content script) knows nothing, and knowing nothing
   * must never be reported as "not allowed", which would turn a missing question into an
   * accusation.
   */
  function permissionsContains(origins) {
    return call('permissions', 'contains', { origins }).then((value) => (value === undefined ? null : value === true), () => null);
  }

  /**
   * Ask for the site, from a click. Firefox requires a user input handler for this, which is
   * why the only caller is the panel's own switch: it is the only place in the extension where
   * the user's hand is on the thing.
   */
  function permissionsRequest(origins) {
    return call('permissions', 'request', { origins }).then((value) => value === true, () => false);
  }

  WF.browser = {
    api,
    isFirefox,
    inServiceWorker,
    call,
    send,
    sendToTab,
    onMessage,
    permissionsContains,
    permissionsRequest,

    storageGet: (key) => call('storage', 'local.get', key).then((o) => (o ? o[key] : undefined)),
    storageSet: (key, value) => call('storage', 'local.set', { [key]: value }),
    storageRemove: (key) => call('storage', 'local.remove', key),
    storageClear: () => call('storage', 'local.clear'),

    /** Session storage survives service-worker restarts; falls back to memory. */
    sessionGet: async (key) => {
      try {
        const o = await call('storage', 'session.get', key);
        return o ? o[key] : undefined;
      } catch (err) {
        return memorySession.get(key);
      }
    },
    sessionSet: async (key, value) => {
      memorySession.set(key, value);
      try {
        await call('storage', 'session.set', { [key]: value });
      } catch (err) {
        /* Firefox < 115 or session storage unavailable: memory only */
      }
    },

    queryTabs: (query) => call('tabs', 'query', query).then((tabs) => tabs || []),
    getTab: (tabId) => call('tabs', 'get', tabId),
    createTab: (props) => call('tabs', 'create', props),
    updateTab: (tabId, props) => call('tabs', 'update', tabId, props),
    removeTab: (tabId) => call('tabs', 'remove', tabId),
    reloadTab: (tabId) => call('tabs', 'reload', tabId),

    /** The tab the user is looking at, so a focus detour can hand it back afterwards. */
    activeTab: async () => {
      const focused = await call('tabs', 'query', { active: true, lastFocusedWindow: true });
      const found = (focused || []).find((tab) => tab && tab.id !== undefined);
      if (found) return found;
      const current = await call('tabs', 'query', { active: true, currentWindow: true });
      return (current || []).find((tab) => tab && tab.id !== undefined) || null;
    },

    /**
     * Bring a tab to the front, and its window with it.
     *
     * Used for one thing: a site that will not accept a prompt while it is in the
     * background gets a single attempt with its tab shown, and then the user is put back.
     */
    focusTab: async (tabId) => {
      const tab = await call('tabs', 'get', tabId);
      if (!tab || tab.id === undefined) return false;
      await call('tabs', 'update', tabId, { active: true });
      if (tab.windowId !== undefined) {
        await call('windows', 'update', tab.windowId, { focused: true });
      }
      return true;
    },

    // Windows, for a broadcast's own tabs: one opened around its first tab, plus the moves
    // that put any straggler in with the rest.
    createWindow: (props) => call('windows', 'create', props),
    getWindow: (windowId) => call('windows', 'get', windowId),
    updateWindow: (windowId, props) => call('windows', 'update', windowId, props),
    moveTabs: (tabIds, props) => call('tabs', 'move', tabIds, props),

    setBadge: async (text, color) => {
      try {
        await call('action', 'setBadgeText', { text: text || '' });
        if (color) await call('action', 'setBadgeBackgroundColor', { color });
      } catch (err) {
        /* action may not exist in a rare context */
      }
    },

    /** The tooltip on the icon. Hovering it is a way to read the count too. */
    setTitle: async (title) => {
      try {
        await call('action', 'setTitle', { title });
      } catch (err) {
        /* cosmetic */
      }
    },

    /**
     * Play the answer chime.
     *
     * A service worker has no audio output, and synthesising the tone inside a page
     * only works when an AI tab happens to be in front — which is exactly the moment
     * you are not waiting for. Chrome's supported answer is an offscreen document
     * that exists for a few seconds and is then closed, so it costs nothing idle.
     *
     * Returns false on Firefox, which has no offscreen API; callers fall back to
     * sounding the tone inside an AI tab.
     */
    playChime: async (volume) => {
      const offscreen = api && api.offscreen;
      if (!offscreen || typeof offscreen.createDocument !== 'function') return false;
      try {
        let open = false;
        try {
          open = (await call('offscreen', 'hasDocument')) === true;
        } catch (err) {
          open = false;
        }
        if (!open) {
          await offscreen.createDocument({
            url: 'offscreen/offscreen.html',
            reasons: ['AUDIO_PLAYBACK'],
            justification: 'Play a short chime when an AI answer is ready.',
          });
        }
        const res = await call('runtime', 'sendMessage', {
          // Deliberately not WF.MSG.CHIME: that one is a tab-addressed message with a
          // `type`, and reusing the string would invite a content script to answer it.
          kind: 'wf:offscreen-chime',
          volume: typeof volume === 'number' ? volume : 0.4,
        });
        if (!res || res.ok !== true) return false;
        // Close after the sound has had time to play. A worker that is suspended
        // before this fires leaves the document alive; the next chime reuses it,
        // so the cost of that is a few hundred kilobytes, not a leak that grows.
        setTimeout(() => {
          call('offscreen', 'closeDocument').catch(() => {});
        }, 4000);
        return true;
      } catch (err) {
        return false;
      }
    },

    notify: async (id, options) => {
      try {
        await call('notifications', 'create', id, {
          type: 'basic',
          iconUrl: api.runtime.getURL('assets/icon-128.png'),
          ...options,
        });
        return true;
      } catch (err) {
        return false;
      }
    },

    /** Inject the content scripts into a tab that predates the extension load. */
    injectContentScripts: async (tabId, files) => {
      try {
        await call('scripting', 'executeScript', { target: { tabId }, files });
        return true;
      } catch (err) {
        return false;
      }
    },
  };
})();
