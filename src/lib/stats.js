/**
 * The stats engine. Pure functions over plain objects, so it runs identically in
 * the background, the dashboard, and node --test.
 *
 * Nothing here ever sees prompt or answer text: only durations, counts and ids.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});
  const U = WF.util;

  const COUNT_KEYS = ['writing', 'waiting', 'waitingAway', 'reading', 'prompts', 'answers', 'followUps'];
  const TIME_KEYS = ['writing', 'waiting', 'waitingAway', 'reading'];

  const emptyCounters = () => ({
    writing: 0,
    waiting: 0,
    waitingAway: 0,
    reading: 0,
    prompts: 0,
    answers: 0,
    followUps: 0,
  });

  /**
   * The shape of everything the dashboard reads. It lives here, with the maths that
   * consumes it, so that storage is only ever responsible for persistence.
   */
  function emptyStats(now) {
    return {
      version: 1,
      startedAt: now || Date.now(),
      days: {},
      heat: {},
      siteTotals: {},
    };
  }

  function emptyDay() {
    return { sites: {}, totals: emptyCounters() };
  }

  function addCounters(target, delta) {
    for (const key of COUNT_KEYS) {
      if (delta[key]) target[key] = (target[key] || 0) + delta[key];
    }
    return target;
  }

  function sumCounters(list) {
    const out = emptyCounters();
    for (const item of list) if (item) addCounters(out, item);
    return out;
  }

  function totalTime(counters) {
    return TIME_KEYS.reduce((acc, key) => acc + (counters[key] || 0), 0);
  }

  /**
   * Fold one usage report into the stats tree.
   * `heat` keys are "weekday:hour" (Monday = 0) so the dashboard can draw a
   * mon..sun calendar without keeping per-timestamp rows.
   */
  function addUsage(stats, report) {
    const { siteId, day, hour, weekday, deltas, counts } = report;
    if (!siteId || !day) return stats;

    stats.days = stats.days || {};
    stats.days[day] = stats.days[day] || { sites: {}, totals: emptyCounters() };
    const dayObj = stats.days[day];
    dayObj.sites[siteId] = dayObj.sites[siteId] || emptyCounters();

    const merged = { ...(deltas || {}), ...(counts || {}) };
    addCounters(dayObj.sites[siteId], merged);
    addCounters(dayObj.totals, merged);

    stats.siteTotals = stats.siteTotals || {};
    stats.siteTotals[siteId] = stats.siteTotals[siteId] || emptyCounters();
    addCounters(stats.siteTotals[siteId], merged);

    if (deltas && deltas.waitingAway) {
      stats.heat = stats.heat || {};
      const key = `${weekday === undefined ? U.weekdayIndex(Date.now()) : weekday}:${
        hour === undefined ? U.hourIndex(Date.now()) : hour
      }`;
      stats.heat[key] = (stats.heat[key] || 0) + deltas.waitingAway;
    }
    return stats;
  }

  /** Additive merge, used by import. */
  function mergeStats(a, b) {
    const out = a || emptyStats();
    if (!b) return out;
    out.startedAt = Math.min(out.startedAt || Date.now(), b.startedAt || Date.now());
    out.days = out.days || {};
    for (const [day, dayObj] of Object.entries(b.days || {})) {
      const target = (out.days[day] = out.days[day] || { sites: {}, totals: emptyCounters() });
      for (const [siteId, counters] of Object.entries(dayObj.sites || {})) {
        target.sites[siteId] = target.sites[siteId] || emptyCounters();
        addCounters(target.sites[siteId], counters);
      }
      addCounters(target.totals, dayObj.totals || {});
    }
    out.heat = out.heat || {};
    for (const [key, ms] of Object.entries(b.heat || {})) {
      out.heat[key] = (out.heat[key] || 0) + ms;
    }
    out.siteTotals = out.siteTotals || {};
    for (const [siteId, counters] of Object.entries(b.siteTotals || {})) {
      out.siteTotals[siteId] = out.siteTotals[siteId] || emptyCounters();
      addCounters(out.siteTotals[siteId], counters);
    }
    return out;
  }

  /** The `count` day keys ending today (or ending at `endKey`). */
  function rangeKeys(count, endKey) {
    const end = endKey || U.dayKey();
    const start = U.shiftDay(end, -(count - 1));
    return U.dayRange(start, end);
  }

  /** The calendar week containing `endKey`, Monday first. */
  function weekKeys(endKey) {
    const end = endKey || U.dayKey();
    const start = U.shiftDay(end, -U.weekdayIndex(U.dayKeyToDate(end).getTime()));
    return U.dayRange(start, end);
  }

  /** The calendar month containing `endKey`, up to and including it. */
  function monthKeys(endKey) {
    const end = endKey || U.dayKey();
    const d = U.dayKeyToDate(end);
    return U.dayRange(`${d.getFullYear()}-${U.pad(d.getMonth() + 1)}-01`, end);
  }

  function allKeys(stats, endKey) {
    const end = endKey || U.dayKey();
    const keys = Object.keys((stats && stats.days) || {}).sort();
    if (!keys.length) return rangeKeys(7, end);
    const start = keys[0];
    return U.dayRange(start, end > keys[keys.length - 1] ? end : keys[keys.length - 1]);
  }

  /** Everything the dashboard needs for a date range. */
  function summarize(stats, keys) {
    const days = keys.map((key) => {
      const dayObj = (stats.days && stats.days[key]) || { sites: {}, totals: emptyCounters() };
      return {
        key,
        weekday: U.weekdayIndex(U.dayKeyToDate(key).getTime()),
        sites: dayObj.sites,
        totals: { ...emptyCounters(), ...dayObj.totals },
      };
    });
    const totals = sumCounters(days.map((d) => d.totals));
    const perSite = {};
    for (const day of days) {
      for (const [siteId, counters] of Object.entries(day.sites)) {
        perSite[siteId] = perSite[siteId] || emptyCounters();
        addCounters(perSite[siteId], counters);
      }
    }
    return {
      keys,
      days,
      totals,
      perSite,
      hasData: totalTime(totals) > 0 || totals.prompts > 0,
      activeDays: days.filter((d) => totalTime(d.totals) > 0 || d.totals.prompts > 0).length,
    };
  }

  /** Share of the three states, as used by the split bar. */
  function split(totals) {
    const writing = totals.writing || 0;
    const waiting = totals.waiting || 0;
    const reading = totals.reading || 0;
    const total = writing + waiting + reading;
    const away = totals.waitingAway || 0;
    return {
      writing,
      waiting,
      reading,
      away,
      total,
      writingPct: U.pct(writing, total),
      waitingPct: U.pct(waiting, total),
      readingPct: U.pct(reading, total),
      readingIsBiggest: reading >= writing && reading >= waiting,
    };
  }

  // ---------------------------------------------------------------------------
  // Is this event still a fact?
  // ---------------------------------------------------------------------------

  /**
   * A turn with no finish, and nothing to say it failed, was abandoned: the tab was
   * closed, or the worker was torn down mid-answer. Their counterpart files these as
   * `orphaned` after 90 idle seconds; we have no heartbeat, so it is an age check with
   * room for the slowest answer any site is allowed to take.
   */
  const ORPHAN_AFTER_MS = 15 * 60 * 1000;

  /** Below this, an "answer" is a rounding error, not an answer. */
  const NOISE_UNDER_MS = 5;

  /**
   * One of: ok, noise, orphaned, failed, open.
   *
   * Only `ok` counts towards timings. Everything else is kept in the record — so the
   * prompt and answer totals stay honest — but excluded from the tables, because a
   * five-millisecond "answer" and an abandoned tab would both flatter the numbers.
   */
  function classifyEvent(event, now) {
    if (!event || !event.sentAt) return 'invalid';
    if (event.doneAt && event.doneAt > event.sentAt) {
      const duration = event.doneAt - event.sentAt;
      if (duration <= NOISE_UNDER_MS && !event.firstWordAt) {
        const signals = event.signals || [];
        if (!signals.length || signals.every((s) => s === 'network')) return 'noise';
      }
      return 'ok';
    }
    if (event.aborted || event.attention) return 'failed';
    const age = (now === undefined ? Date.now() : now) - event.sentAt;
    return age > ORPHAN_AFTER_MS ? 'orphaned' : 'open';
  }

  /** Every event whose status has changed since it was written. */
  function reclassify(events, now) {
    const stamp = now === undefined ? Date.now() : now;
    const changed = [];
    const next = (events || []).map((event) => {
      const status = classifyEvent(event, stamp);
      // `open` and `invalid` are not worth writing: one is still running, the other is
      // junk we will drop on retention anyway.
      if (status === 'open' || status === 'invalid') return event;
      if (event.status === status) return event;
      changed.push({ id: event.id, status });
      return { ...event, status, classifiedAt: stamp };
    });
    return { events: next, changed };
  }

  /** Is this event one the timing tables should use? */
  function usable(event) {
    if (!event || !event.sentAt || !event.doneAt) return false;
    if (event.doneAt <= event.sentAt) return false;
    if (event.aborted) return false;
    return event.status !== 'noise' && event.status !== 'orphaned';
  }

  function percentile(sortedAsc, p) {
    if (!sortedAsc.length) return null;
    const idx = U.clamp(Math.ceil((p / 100) * sortedAsc.length) - 1, 0, sortedAsc.length - 1);
    return sortedAsc[idx];
  }

  function median(numbers) {
    if (!numbers.length) return null;
    const sorted = [...numbers].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function mean(numbers) {
    if (!numbers.length) return null;
    return numbers.reduce((a, b) => a + b, 0) / numbers.length;
  }

  /**
   * Head to head across the prompts that actually went to several AIs at once.
   * Only cleanly measured answers count: a send we confirmed, a first token, and
   * a finish we saw land.
   */
  function headToHead(events) {
    // `usable` is the whole honesty story here: orphans and noise are in the record but
    // not in the table.
    const measured = (events || []).filter((e) => e && e.siteId && usable(e));
    const bySite = {};
    const groups = new Map();

    for (const event of measured) {
      const site = (bySite[event.siteId] = bySite[event.siteId] || {
        siteId: event.siteId,
        sent: 0,
        measured: 0,
        firstWords: [],
        answers: [],
        abandoned: 0,
        sharedWins: 0,
        sharedEligible: 0,
        fastestMs: null,
      });
      site.sent += 1;
      site.measured += 1;
      site.answers.push(event.doneAt - event.sentAt);
      if (event.firstWordAt && event.firstWordAt > event.sentAt) {
        site.firstWords.push(event.firstWordAt - event.sentAt);
      }
      if (event.abandoned) site.abandoned += 1;

      if (!groups.has(event.group)) groups.set(event.group, []);
      groups.get(event.group).push(event);
    }

    // Count sends that never produced a measured answer, so "switched away" has
    // a denominator that includes the times it simply failed.
    for (const event of events || []) {
      if (!event || !event.siteId || usable(event)) continue;
      if (event.sentAt === null || event.sentAt === undefined) continue;
      const site = (bySite[event.siteId] = bySite[event.siteId] || {
        siteId: event.siteId,
        sent: 0,
        measured: 0,
        firstWords: [],
        answers: [],
        abandoned: 0,
        sharedWins: 0,
        sharedEligible: 0,
        fastestMs: null,
      });
      site.sent += 1;
    }

    let sharedGroups = 0;
    for (const [, groupEvents] of groups) {
      if (groupEvents.length < 2) continue;
      sharedGroups += 1;
      const best = groupEvents.reduce((a, b) => (a.doneAt - a.sentAt <= b.doneAt - b.sentAt ? a : b));
      for (const event of groupEvents) {
        const site = bySite[event.siteId];
        site.sharedEligible += 1;
        if (event.id === best.id) {
          site.sharedWins += 1;
          const ms = best.doneAt - best.sentAt;
          site.fastestMs = site.fastestMs === null ? ms : Math.min(site.fastestMs, ms);
        }
      }
    }

    const rows = Object.values(bySite).map((site) => {
      const answers = [...site.answers].sort((a, b) => a - b);
      return {
        siteId: site.siteId,
        sent: site.sent,
        measured: site.measured,
        firstWordAvg: mean(site.firstWords),
        firstWordMedian: median(site.firstWords),
        answerMedian: median(answers),
        answerP90: percentile(answers, 90),
        fastestMs: site.fastestMs,
        sharedWins: site.sharedWins,
        sharedEligible: site.sharedEligible,
        abandoned: site.abandoned,
        abandonedPct: site.sent ? U.pct(site.abandoned, site.sent) : 0,
      };
    });
    rows.sort((a, b) => (a.answerMedian === null ? 1e9 : a.answerMedian) - (b.answerMedian === null ? 1e9 : b.answerMedian));
    return { rows, sharedGroups };
  }

  /**
   * The same timings, split by the model that answered rather than by site.
   *
   * "Is Pro worth it over Flash?" is the question a site-level table cannot answer, and
   * the model name is a label on the page — never the answer text. Events with no model
   * read fall into `unknown`, which is honest rather than hidden.
   */
  function modelRows(events) {
    const groups = new Map();
    for (const event of events || []) {
      if (!event || !event.siteId) continue;
      const model = event.model || 'unknown';
      const key = `${event.siteId}::${model}`;
      const row = groups.get(key) || {
        siteId: event.siteId,
        model,
        sent: 0,
        measured: 0,
        answers: [],
        firstWords: [],
      };
      row.sent += 1;
      if (usable(event)) {
        row.measured += 1;
        row.answers.push(event.doneAt - event.sentAt);
        if (event.firstWordAt && event.firstWordAt > event.sentAt) {
          row.firstWords.push(event.firstWordAt - event.sentAt);
        }
      }
      groups.set(key, row);
    }

    const rows = [...groups.values()].map((row) => {
      const answers = [...row.answers].sort((a, b) => a - b);
      return {
        siteId: row.siteId,
        model: row.model,
        sent: row.sent,
        measured: row.measured,
        answerMedian: median(answers),
        answerP90: percentile(answers, 90),
        firstWordMedian: median(row.firstWords),
        // A model seen once is a curiosity, not a finding. The dashboard hides these
        // behind the "measured" count it already shows.
        measuredPct: row.sent ? U.pct(row.measured, row.sent) : 0,
      };
    });
    rows.sort((a, b) => {
      if (a.answerMedian === null) return 1;
      if (b.answerMedian === null) return -1;
      return a.answerMedian - b.answerMedian;
    });
    return rows;
  }

  /**
   * Is each subscription earning its keep? Cost per prompt and per hour of real
   * use, over the selected range, from the prices the user typed in.
   */
  function costRows(perSite, prices, keys) {
    const pricesMap = prices || {};
    const rows = [];
    for (const [siteId, counters] of Object.entries(perSite || {})) {
      const monthly = Number(pricesMap[siteId]) || 0;
      const usageMs = totalTime(counters);
      const hours = usageMs / 3600000;
      const prompts = counters.prompts || 0;
      const costPerPrompt = monthly > 0 && prompts > 0 ? monthly / prompts : null;
      const costPerHour = monthly > 0 && hours > 0.01 ? monthly / hours : null;

      let verdict = 'no-price';
      if (monthly > 0) {
        if (prompts < 6 || hours < 0.25) verdict = 'barely-used';
        else if (prompts < 25 || (costPerPrompt !== null && costPerPrompt > 1) || (costPerHour !== null && costPerHour > 40))
          verdict = 'light';
        else verdict = 'earning';
      }
      rows.push({
        siteId,
        monthly,
        yearly: monthly * 12,
        prompts,
        usageMs,
        hours,
        costPerPrompt,
        costPerHour,
        verdict,
        rangeDays: keys ? keys.length : null,
      });
    }
    rows.sort((a, b) => b.monthly - a.monthly);
    return rows;
  }

  const VERDICT_LABEL = {
    earning: 'earning its keep',
    light: 'light use',
    'barely-used': 'barely used',
    'no-price': 'no price set',
  };

  /** The plain sentence the dashboard shows above the table. */
  function costNote(rows) {
    if (!rows.length) return null;
    const priced = rows.filter((r) => r.monthly > 0);
    if (!priced.length) return null;
    const worst = [...priced].sort((a, b) => {
      const av = a.prompts ? a.monthly / a.prompts : Infinity;
      const bv = b.prompts ? b.monthly / b.prompts : Infinity;
      return bv - av;
    })[0];
    if (!worst || worst.prompts > 12) return null;
    const site = WF.sites ? WF.sites.byId(worst.siteId) : null;
    const name = site ? site.name : worst.siteId;
    const prompts = worst.prompts;
    return `${name} costs you ${U.money(worst.monthly)} a month and you sent it ${prompts} prompt${
      prompts === 1 ? '' : 's'
    }. That is ${U.money(worst.yearly)} a year.`;
  }

  /** Weekday x hour matrix for the waiting heatmap. */
  function heatMatrix(cells) {
    const matrix = Array.from({ length: 7 }, () => new Array(24).fill(0));
    let max = 0;
    for (const [key, ms] of Object.entries(cells || {})) {
      const [wd, hr] = key.split(':').map(Number);
      if (!isFinite(wd) || !isFinite(hr)) continue;
      if (wd < 0 || wd > 6 || hr < 0 || hr > 23) continue;
      matrix[wd][hr] += ms;
      if (matrix[wd][hr] > max) max = matrix[wd][hr];
    }
    return { matrix, max };
  }

  /** Everything in the "attention detail" panel. All free, no tier gate. */
  function attentionDetail(events, opts) {
    const list = (events || []).filter((e) => e && e.sentAt && e.doneAt && e.doneAt > e.sentAt);
    let watchedArriveMs = 0;
    let waitingElsewhereMs = 0;
    for (const event of list) {
      if (event.firstWordAt) watchedArriveMs += Math.max(0, event.doneAt - event.firstWordAt);
      waitingElsewhereMs += Math.max(0, event.awayMs || 0);
    }
    const ranked = [...list].sort((a, b) => b.doneAt - b.sentAt - (a.doneAt - a.sentAt));
    const limit = (opts && opts.limit) || 5;
    return {
      count: list.length,
      watchedArriveMs,
      waitingElsewhereMs,
      longest: ranked.slice(0, limit).map((e) => ({
        siteId: e.siteId,
        ms: e.doneAt - e.sentAt,
        at: e.doneAt,
      })),
      slowestMs: ranked.length ? ranked[0].doneAt - ranked[0].sentAt : null,
    };
  }

  /** Hour-of-day histogram over a range, for the "when you use AI" strip. */
  function byHour(events, keys) {
    const set = new Set(keys || []);
    const hours = new Array(24).fill(0);
    for (const event of events || []) {
      if (!event || !event.sentAt) continue;
      if (set.size && !set.has(U.dayKey(event.sentAt))) continue;
      hours[U.hourIndex(event.sentAt)] += 1;
    }
    return hours;
  }

  /**
   * The once-a-week digest, as one line you can read on a lock screen.
   *
   * Numbers only: how many answers landed, how long you spent, which AI you leaned on,
   * and how much of the waiting happened while you were somewhere else. No prompt text
   * and no answer text, because neither ever reaches this side of the extension.
   */
  function weeklyDigest(sum, opts) {
    const options = opts || {};
    const s = split(sum.totals);
    const answers = sum.totals.answers || 0;
    const prompts = sum.totals.prompts || 0;
    const parts = [
      `${U.num(answers)} answer${answers === 1 ? '' : 's'}`,
      `${U.humanShort(s.total)} in AI tabs`,
    ];
    const ranked = Object.entries(sum.perSite || {})
      .map(([siteId, counters]) => ({ siteId, answers: counters.answers || 0, prompts: counters.prompts || 0 }))
      .sort((a, b) => b.answers - a.answers || b.prompts - a.prompts);
    if (ranked.length > 1 && ranked[0].answers > 0) {
      const top = WF.sites ? WF.sites.byId(ranked[0].siteId) : null;
      if (top) parts.push(`most used: ${top.name}`);
    }
    if (s.away > 0 && s.total > 0) {
      parts.push(`${U.pct(s.away, s.total)}% of the waiting spent elsewhere`);
    }
    if (!prompts && !answers) return null;
    return {
      title: options.title || `Your AI week: ${U.humanDuration(s.total)}`,
      message: `${parts.join(' \u00b7 ')}. Click for the full report.`,
    };
  }

  /** The shareable weekly/monthly card content. Plain text on purpose. */
  function summaryCard(sum, opts) {
    const options = opts || {};
    const s = split(sum.totals);
    const title = options.title || 'My AI week';
    const range = options.rangeLabel || `${sum.keys[0]} to ${sum.keys[sum.keys.length - 1]}`;
    const lines = [
      `${title}  ${range}`,
      '',
      `${U.humanDuration(s.total)} in AI tabs`,
      `   writing ${s.writingPct}%  (${U.humanDuration(s.writing)})`,
      `   waiting ${s.waitingPct}%  (${U.humanDuration(s.waiting)})`,
      `   reading ${s.readingPct}%  (${U.humanDuration(s.reading)})`,
      '',
      `${U.num(sum.totals.prompts)} prompts sent, ${U.num(sum.totals.answers)} answers landed`,
    ];
    if (options.headRows && options.headRows.length) {
      const fastest = options.headRows.filter((r) => r.answerMedian !== null).slice(0, 3);
      if (fastest.length) {
        lines.push('', 'Typical answer time');
        for (const row of fastest) {
          const site = WF.sites ? WF.sites.byId(row.siteId) : null;
          lines.push(`   ${site ? site.name : row.siteId} ${U.humanShort(row.answerMedian)}`);
        }
      }
    }
    if (options.costNote) lines.push('', options.costNote);
    lines.push('', 'no prompt or answer text was ever stored — whilefree');
    return lines.join('\n');
  }

  WF.stats = {
    COUNT_KEYS,
    TIME_KEYS,
    emptyCounters,
    emptyStats,
    emptyDay,
    addCounters,
    sumCounters,
    totalTime,
    addUsage,
    mergeStats,
    rangeKeys,
    weekKeys,
    monthKeys,
    allKeys,
    summarize,
    split,
    percentile,
    median,
    mean,
    headToHead,
    modelRows,
    classifyEvent,
    reclassify,
    usable,
    ORPHAN_AFTER_MS,
    costRows,
    costNote,
    VERDICT_LABEL,
    heatMatrix,
    attentionDetail,
    byHour,
    summaryCard,
    weeklyDigest,
  };
})();
