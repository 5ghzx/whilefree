/**
 * Canonical file lists.
 *
 * The build script (scripts/build.mjs) reads these to generate each browser's
 * manifest, and the background reads them to re-inject content scripts into tabs
 * that were already open when the extension was installed. One source of truth,
 * so a manifest and the runtime can never disagree about what to load.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});

  const SHARED = [
    'lib/browser.js',
    'lib/app.js',
    'lib/util.js',
    'lib/protocol.js',
    'lib/sites.js',
    'lib/storage.js',
    'lib/settings.js',
    'lib/stats.js',
    'lib/badge.js',
    'lib/status.js',
    // Last, because it describes the lists above it. The background reads it to
    // re-inject the content scripts into tabs that predate the extension load.
    'lib/files.js',
  ];

  const CONTENT_LIB = ['lib/dom.js'];

  const CONTENT = [
    'content/composer.js',
    // Before detect.js: the answer watcher asks it whether a stream is still open.
    'content/netwatch.js',
    'content/detect.js',
    'content/tracker.js',
    'content/overlay.js',
    'content/main.js',
  ];

  const BACKGROUND = [
    'background/store.js',
    'background/tracker.js',
    'background/answers.js',
    // Before the engine: the engine reads and writes the delivery ledger.
    'background/ledger.js',
    'background/engine.js',
    'background/background.js',
  ];

  const contentScripts = () => [...SHARED, ...CONTENT_LIB, ...CONTENT];
  const backgroundScripts = () => [...SHARED, ...BACKGROUND];

  WF.files = {
    SHARED,
    CONTENT_LIB,
    CONTENT,
    BACKGROUND,
    contentScripts,
    backgroundScripts,
    // There is deliberately no content CSS file: the in-page overlay lives in a
    // shadow root and carries its own styles, so nothing of ours can leak into a
    // page and no page stylesheet can reach it.
  };
})();
