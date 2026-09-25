/**
 * The toolbar badge: the one number you can read without opening anything.
 *
 * Two independent counts feed it, and they are not equally important. An AI that
 * needs you — signed out, out of quota, sitting behind a check — is costing you
 * time right now; an answer that has landed is merely waiting for you. So attention
 * takes the icon and the colours differ: amber for "needs you", green for "answered".
 *
 * An answer that is twelve hours old is not news either, so the ready list expires.
 * Without that, the count only ever climbs and stops meaning anything.
 *
 * Pure: no browser APIs, so tests/badge.test.mjs can pin the rules down.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});

  // An unread answer stops being a nudge after half a day.
  const READY_TTL_MS = 12 * 60 * 60 * 1000;
  // A site that needed you is stale by the evening; the site itself will say so again
  // the next time it actually blocks something.
  const PROBLEM_TTL_MS = 6 * 60 * 60 * 1000;
  // The list is a nudge, not an inbox. Past this, the number stops being a count and
  // starts being a wall.
  const MAX_READY = 20;
  // A clock that is slightly ahead should not delete a just-recorded answer.
  const MAX_FUTURE_SKEW_MS = 60 * 1000;

  const COLORS = { attention: '#b45309', ready: '#15803d' };

  /** Nine is the last number a badge can show at a glance. */
  function cap(count) {
    return count > 9 ? '9+' : String(count);
  }

  /** When did this entry land? Our entries use readyAt; accept at as well. */
  function atOf(item) {
    if (!item || typeof item !== 'object') return NaN;
    return Number(item.readyAt !== undefined ? item.readyAt : item.at);
  }

  /**
   * The entries still worth showing: recent enough, not from the future, newest
   * first, capped. Storage keeps whatever it was given, so this runs on every read.
   */
  function live(items, now) {
    const stamp = typeof now === 'number' ? now : Date.now();
    const list = Array.isArray(items) ? items : [];
    return list
      .filter((item) => {
        const at = atOf(item);
        return (
          Number.isFinite(at) &&
          stamp - at < READY_TTL_MS &&
          at - stamp < MAX_FUTURE_SKEW_MS &&
          item &&
          typeof item.siteId === 'string'
        );
      })
      .sort((a, b) => atOf(b) - atOf(a))
      .slice(0, MAX_READY);
  }

  /** The site status entries that should still be nagging you, newest first. */
  function liveProblems(statuses, now, isEnabled) {
    const stamp = typeof now === 'number' ? now : Date.now();
    const map = statuses && typeof statuses === 'object' ? statuses : {};
    const out = [];
    for (const [siteId, status] of Object.entries(map)) {
      if (!status || typeof status !== 'object') continue;
      if (!status.attention) continue;
      if (isEnabled && !isEnabled(siteId)) continue;
      const at = Number(status.at);
      if (Number.isFinite(at) && stamp - at >= PROBLEM_TTL_MS) continue;
      out.push({ siteId, reason: status.attention, at: Number.isFinite(at) ? at : stamp });
    }
    return out.sort((a, b) => b.at - a.at);
  }

  function label(count, name) {
    const app = name || 'WhileFree';
    return {
      attention:
        count === 1
          ? `${app}: 1 AI needs your attention`
          : `${app}: ${count} AIs need your attention`,
      // "have answered" rather than "answers are ready": the list holds one entry per
      // AI, so this is literally a count of AIs that have finished.
      ready: count === 1 ? `${app}: 1 AI has answered` : `${app}: ${count} AIs have answered`,
      idle: `${app}: ask every AI at once`,
    };
  }

  /**
   * What the icon should say. Attention wins over answers because it is the one you
   * can act on; ready answers are only counted when the user wants them counted.
   */
  function badgeFor(problems, ready, name) {
    const texts = label(0, name);
    if (problems > 0) {
      return { text: cap(problems), color: COLORS.attention, title: label(problems, name).attention };
    }
    if (ready > 0) {
      return { text: cap(ready), color: COLORS.ready, title: label(ready, name).ready };
    }
    return { text: '', color: COLORS.ready, title: texts.idle };
  }

  WF.badge = {
    READY_TTL_MS,
    PROBLEM_TTL_MS,
    MAX_READY,
    MAX_FUTURE_SKEW_MS,
    COLORS,
    cap,
    atOf,
    live,
    liveProblems,
    label,
    badgeFor,
  };
})();
