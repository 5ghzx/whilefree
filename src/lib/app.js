/**
 * Product identity.
 *
 * The name, description and version come from the manifest, which is generated from
 * src/manifest.base.json. That file is the single source of truth: renaming the
 * product is one edit there, and every surface follows.
 *
 * The name here is deliberately our own and not a play on another product's name.
 * Similar functionality is fine; a confusingly similar name is the thing that gets
 * listings pulled.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});

  function manifest() {
    try {
      return WF.browser.api.runtime.getManifest() || {};
    } catch (err) {
      return {};
    }
  }

  WF.app = {
    id: 'whilefree',
    tagline: 'Ask every AI at once.',

    name() {
      return manifest().name || 'WhileFree';
    },

    description() {
      return manifest().description || '';
    },

    version() {
      return manifest().version || '0.0.0';
    },

    homepage: 'https://github.com/5ghzx/whilefree',
    repo: 'https://github.com/5ghzx/whilefree',
    issues: 'https://github.com/5ghzx/whilefree/issues',
    license: 'MIT',

    /** The one line the popup and dashboard show under the title. */
    footer() {
      return `Free and open source (${WF.app.license}). No account, no analytics, no server.`;
    },
  };
})();
