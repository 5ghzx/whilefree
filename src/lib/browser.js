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

  /** Resolve a callback- or promise-style API call into a promise. */
  function call(namespace, method, ...args) {
    const ns = api && api[namespace];
    if (!ns || typeof ns[method] !== 'function') return Promise.resolve(undefined);
    try {
      const result = ns[method](...args);
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

  WF.browser = {
    api,
    isFirefox,
    inServiceWorker,
    call,
    send,
    sendToTab,
    onMessage,

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

    setBadge: async (text, color) => {
      try {
        await call('action', 'setBadgeText', { text: text || '' });
        if (color) await call('action', 'setBadgeBackgroundColor', { color });
      } catch (err) {
        /* action may not exist in a rare context */
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
