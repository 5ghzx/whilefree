/** Small shared helpers. No DOM, no chrome APIs. */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});

  const DAY_MS = 86400000;

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  /** Local calendar day key, e.g. "2026-09-23". */
  function dayKey(ts) {
    const d = new Date(ts === undefined ? Date.now() : ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function dayKeyToDate(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  /** Add (or subtract) whole days from a day key. */
  function shiftDay(key, delta) {
    const d = dayKeyToDate(key);
    d.setDate(d.getDate() + delta);
    return dayKey(d.getTime());
  }

  /** Inclusive list of day keys. */
  function dayRange(fromKey, toKey) {
    const out = [];
    let cur = fromKey;
    let guard = 0;
    while (cur <= toKey && guard++ < 5000) {
      out.push(cur);
      cur = shiftDay(cur, 1);
    }
    return out;
  }

  /** Monday-first weekday index (0 = Monday) so the heatmap reads like a calendar. */
  function weekdayIndex(ts) {
    return (new Date(ts).getDay() + 6) % 7;
  }

  function hourIndex(ts) {
    return new Date(ts).getHours();
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function sum(values) {
    return values.reduce((a, b) => a + b, 0);
  }

  function uid(prefix) {
    const rand =
      globalThis.crypto && globalThis.crypto.randomUUID
        ? globalThis.crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10);
    return `${prefix || 'id'}_${Date.now().toString(36)}_${rand}`;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function randInt(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  /** Human duration for dashboard totals: "5h 44m", "12m 6s", "44s". */
  function humanDuration(ms) {
    const total = Math.max(0, Math.round((ms || 0) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  /** Compact duration for per-answer timings: "1.6s", "11s", "1m 7s". */
  function humanShort(ms) {
    if (ms === null || ms === undefined || !isFinite(ms)) return '--';
    const total = Math.max(0, ms) / 1000;
    if (total < 10) return `${total.toFixed(1)}s`;
    if (total < 60) return `${Math.round(total)}s`;
    const m = Math.floor(total / 60);
    const s = Math.round(total % 60);
    return `${m}m ${s}s`;
  }

  /** Clock style duration used in the answers-ready list: "2m 12s". */
  function humanClock(ms) {
    return humanShort(ms);
  }

  /** Chart-axis duration: short enough to sit in a 44px gutter. */
  function humanTick(ms) {
    const total = Math.max(0, Math.round((ms || 0) / 1000));
    if (total === 0) return '0s';
    if (total < 60) return `${total}s`;
    const m = Math.floor(total / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? `${h}h ${rem}m` : `${h}h`;
  }

  function relativeTime(ts, now) {
    const delta = (now || Date.now()) - ts;
    if (delta < 45000) return 'just now';
    const mins = Math.round(delta / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(delta / 3600000);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(delta / DAY_MS)}d ago`;
  }

  function pct(part, whole) {
    if (!whole) return 0;
    return Math.round((part / whole) * 100);
  }

  /**
   * Costs get more precision the smaller they are, and never a pointless trailing
   * zero: $0.10, $3.13, $20, $10.50, $214.
   */
  function money(amount) {
    if (!isFinite(amount)) return '--';
    if (amount === 0) return '$0';
    if (amount < 10) return `$${amount.toFixed(2)}`;
    if (amount < 100) return Number.isInteger(Number(amount.toFixed(2)))
      ? `$${Math.round(amount)}`
      : `$${amount.toFixed(2)}`;
    return `$${Math.round(amount)}`;
  }

  /** "203" -> "203", 1234 -> "1,234" */
  function num(n) {
    return Math.round(n || 0).toLocaleString('en-US');
  }

  function escapeHtml(str) {
    return String(str === undefined || str === null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Clamp a string to n chars without splitting a surrogate pair. */
  function truncate(str, n) {
    const s = String(str || '');
    return s.length <= n ? s : `${s.slice(0, Math.max(0, n - 1))}\u2026`;
  }

  function deepMerge(base, override) {
    const out = Array.isArray(base) ? base.slice() : { ...base };
    if (!override || typeof override !== 'object') return out;
    for (const [key, value] of Object.entries(override)) {
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        base &&
        typeof base[key] === 'object' &&
        base[key] !== null &&
        !Array.isArray(base[key])
      ) {
        out[key] = deepMerge(base[key], value);
      } else if (value !== undefined) {
        out[key] = value;
      }
    }
    return out;
  }

  function debounce(fn, wait) {
    let timer = null;
    return (...args) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        fn(...args);
      }, wait);
    };
  }

  /** True when two numbers are within `tolerance` of each other. */
  function near(a, b, tolerance) {
    return Math.abs(a - b) <= tolerance;
  }

  WF.util = {
    DAY_MS,
    pad,
    dayKey,
    dayKeyToDate,
    shiftDay,
    dayRange,
    weekdayIndex,
    hourIndex,
    clamp,
    sum,
    uid,
    sleep,
    randInt,
    humanDuration,
    humanShort,
    humanClock,
    humanTick,
    relativeTime,
    pct,
    money,
    num,
    escapeHtml,
    truncate,
    deepMerge,
    debounce,
    near,
  };
})();
