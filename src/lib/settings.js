/** Default settings, validation, and merge. Pure — no browser APIs. */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});

  const DEFAULTS = {
    version: 1,

    // Which AIs a broadcast fans out to. Everything is on by default: WhileFree
    // has no paid tier, so there is no cap on how many sites you can use.
    enabledSites: ['chatgpt', 'claude', 'gemini', 'perplexity', 'deepseek'],

    // Tabs
    autoOpenTabs: true, // open a background tab for an enabled AI that is not open
    keepTabsOpen: true, // leave those tabs alone once the answer lands
    reuseExistingTabs: true,

    // Pacing: sends are spaced out so the fan-out looks like a person working.
    paceMs: [900, 1700], // gap between two sites in the same broadcast
    settleMs: [220, 650], // pause between typing the prompt and pressing send

    // Alerts
    chimeEnabled: true,
    chimeVolume: 0.4,
    chimeSites: {}, // siteId -> false to mute that site's chime
    notifySystem: false, // also raise an OS notification
    notifyMinWaitMs: 0, // only alert when the answer took longer than this
    quietHours: null, // { from: 22, to: 7 }

    // Site behaviour
    disableSlowModes: { deepseek: true }, // switch off DeepThink/R1 before sending
    followUpWindowMs: 300000, // a new prompt within this window counts as a follow-up

    // Dashboard
    rangeDays: 7,
    prices: {}, // siteId -> $ per month the user says they pay
    onboardingDone: false,

    // Housekeeping
    overlayEnabled: true, // the small in-page launcher and status list
    confirmBeforeBroadcast: false,
    eventsRetention: 5000,
  };

  function normalize(raw) {
    const merged = WF.util.deepMerge(DEFAULTS, raw || {});
    const known = WF.sites ? WF.sites.ORDER : DEFAULTS.enabledSites;
    merged.enabledSites = (merged.enabledSites || []).filter((id) => known.includes(id));
    if (!merged.enabledSites.length) merged.enabledSites = [known[0]];
    // Keep site ids that disappeared from the registry, so a temporary removal
    // does not silently wipe the user's switch state.
    for (const id of Object.keys(raw && raw.chimeSites ? raw.chimeSites : {})) {
      if (!(id in merged.chimeSites)) merged.chimeSites[id] = raw.chimeSites[id];
    }
    merged.paceMs = coerceRange(merged.paceMs, DEFAULTS.paceMs, 150, 5000);
    merged.settleMs = coerceRange(merged.settleMs, DEFAULTS.settleMs, 0, 5000);
    merged.chimeVolume = WF.util.clamp(Number(merged.chimeVolume) || 0, 0, 1);
    merged.rangeDays = WF.util.clamp(Number(merged.rangeDays) || 7, 1, 3650);
    merged.notifyMinWaitMs = Math.max(0, Number(merged.notifyMinWaitMs) || 0);
    merged.eventsRetention = WF.util.clamp(Number(merged.eventsRetention) || 5000, 200, 50000);
    return merged;
  }

  /**
   * A [min, max] pair, clamped and ordered. Junk falls back to the default rather
   * than to the widest possible range, so a hand-edited settings object cannot turn
   * a 1-second gap into a 5-second one.
   */
  function coerceRange(value, fallback, min, max) {
    const arr = Array.isArray(value) && value.length === 2 ? value.map(Number) : null;
    if (!arr || !arr.every((n) => isFinite(n))) return fallback.slice();
    const lo = WF.util.clamp(arr[0], min, max);
    const hi = WF.util.clamp(arr[1], lo, max);
    return [lo, hi];
  }

  /** Random delay from a [min, max] pair. */
  function delayFrom(pair) {
    const [lo, hi] = coerceRange(pair, [0, 0], 0, 60000);
    return WF.util.randInt(lo, hi);
  }

  function targetsFor(settings, originSiteId) {
    const enabled = settings.enabledSites || [];
    return enabled.filter((id) => id !== originSiteId);
  }

  function siteEnabled(settings, siteId) {
    return (settings.enabledSites || []).includes(siteId);
  }

  function chimeFor(settings, siteId) {
    if (!settings.chimeEnabled) return false;
    const map = settings.chimeSites || {};
    return map[siteId] !== false;
  }

  function inQuietHours(settings, ts) {
    const q = settings.quietHours;
    if (!q) return false;
    const hour = new Date(ts).getHours();
    if (q.from === q.to) return false;
    return q.from < q.to ? hour >= q.from && hour < q.to : hour >= q.from || hour < q.to;
  }

  WF.settings = {
    DEFAULTS,
    normalize,
    coerceRange,
    delayFrom,
    targetsFor,
    siteEnabled,
    chimeFor,
    inQuietHours,
  };
})();
