import '../lib/browser.js';
import '../lib/app.js';
import '../lib/util.js';
import '../lib/protocol.js';
import '../lib/sites.js';
import '../lib/storage.js';
import '../lib/settings.js';
import '../lib/stats.js';
import '../lib/status.js';
import './charts.js';

const U = WF.util;
const MSG = WF.MSG;
const el = (id) => document.getElementById(id);

let settings = null;
let stats = null;
let events = [];
let siteStatus = {};
let rangeDays = 7;
let metric = 'waiting';
let cardRange = 'week';
const diagnostics = {};

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function load() {
  const [nextSettings, nextStats, nextEvents, nextStatus] = await Promise.all([
    WF.storage.getSettings(),
    WF.storage.getStats(),
    WF.storage.getEvents(),
    WF.storage.getSiteStatus(),
  ]);
  settings = nextSettings;
  stats = nextStats;
  events = nextEvents;
  siteStatus = nextStatus;
  render();
}

/** Reload when the background records anything, so the page is never stale. */
function watch() {
  try {
    WF.browser.api.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      const keys = Object.keys(changes);
      if (
        keys.includes(WF.storage.KEYS.stats) ||
        keys.includes(WF.storage.KEYS.events) ||
        keys.includes(WF.storage.KEYS.answers)
      ) {
        load();
      }
    });
  } catch (err) {
    /* the page still works, it just will not auto-refresh */
  }
}

const currentKeys = () => (rangeDays === 'all' ? WF.stats.allKeys(stats) : WF.stats.rangeKeys(rangeDays));

function eventsInRange(keys) {
  const set = new Set(keys);
  return events.filter((event) => {
    const at = event.sentAt || event.doneAt;
    return at && set.has(U.dayKey(at));
  });
}

const timeInUse = (counters) =>
  counters ? (counters.writing || 0) + (counters.waiting || 0) + (counters.reading || 0) : 0;

const siteName = (id) => (WF.sites.byId(id) || {}).name || id;
const siteColor = (id) => (WF.sites.byId(id) || {}).color || '#78736e';

async function save(patch) {
  const res = await WF.browser.send({ type: MSG.SET_SETTINGS, patch });
  if (res && res.settings) settings = res.settings;
  render();
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render() {
  if (!settings || !stats) return;
  const keys = currentKeys();
  const sum = WF.stats.summarize(stats, keys);
  const scoped = eventsInRange(keys);
  const head = WF.stats.headToHead(scoped);

  renderSplit(sum);
  renderBars(sum);
  renderPerSite(sum, head);
  renderHeadToHead(head, scoped);
  renderModels(scoped);
  renderPrices();
  renderCosts(sum, keys);
  renderAttention(scoped);
  renderHeat();
  renderSummaryButton(keys, sum, head);
  renderSites();
  renderSettings();
  renderData();

  el('app-name').textContent = WF.app.name();
  el('repo-link').href = WF.app.repo;
  el('foot').textContent = `${WF.app.name()} v${WF.app.version()} · MIT licensed · ${WF.app.footer()}`;
  el('welcome').hidden = !(location.hash === '#welcome' && !settings.onboardingDone);
}

// 1. Split -------------------------------------------------------------------

function renderSplit(sum) {
  const split = WF.stats.split(sum.totals);
  const host = el('split');
  const triple = el('split-triple');

  if (!split.total) {
    host.innerHTML = '<div class="empty">Nothing recorded yet. Open one of the AIs and start typing.</div>';
    triple.innerHTML = '';
    el('split-note').innerHTML = '';
    return;
  }

  const seg = (kind, percent, ms) =>
    percent
      ? `<span class="${kind}" style="width:${percent}%" title="${kind}: ${U.humanDuration(ms)}">${
          percent > 12 ? `${kind} ${percent}%` : ''
        }</span>`
      : '';

  host.innerHTML = `<div class="split">
      ${seg('writing', split.writingPct, split.writing)}
      ${seg('waiting', split.waitingPct, split.waiting)}
      ${seg('reading', split.readingPct, split.reading)}
    </div>`;

  triple.innerHTML = [
    ['writing', split.writing, split.writingPct],
    ['waiting', split.waiting, split.waitingPct],
    ['reading', split.reading, split.readingPct],
  ]
    .map(
      ([kind, ms, percent]) => `<div>
          <div class="n">${U.humanDuration(ms)}</div>
          <div class="k">${kind} · ${percent}%</div>
        </div>`
    )
    .join('');

  const parts = [
    `Waiting was ${split.waitingPct}% of your time with AI.`,
    split.readingIsBiggest
      ? 'Reading is the largest slice: being told when an answer lands is worth more than a slightly faster model.'
      : 'The rest is you, writing and reading.',
  ];
  if (split.away) {
    parts.push(`${U.humanDuration(split.away)} of the waiting happened while you were elsewhere.`);
  }
  el('split-note').innerHTML = `<div class="note">${U.escapeHtml(parts.join(' '))}</div>`;
}

// 2. Bars --------------------------------------------------------------------

function renderBars(sum) {
  const valueFor = (counters) => {
    if (metric === 'prompts') return counters.prompts || 0;
    if (metric === 'use') return timeInUse(counters);
    return counters.waiting || 0;
  };

  const days = sum.days.map((day) => ({
    key: day.key,
    label: day.key.slice(5),
    segments: WF.sites
      .list()
      .map((site) => ({ key: site.id, value: valueFor(day.sites[site.id] || WF.stats.emptyCounters()) }))
      .filter((seg) => seg.value > 0),
  }));

  const canvas = el('bars');
  WF.charts.stackedBars(canvas, { days, height: 220, colorOf: siteColor });

  const used = new Set();
  for (const day of days) for (const seg of day.segments) used.add(seg.key);
  el('bars-legend').innerHTML = WF.sites
    .list()
    .filter((site) => used.has(site.id) || sum.perSite[site.id])
    .map(
      (site) =>
        `<span><i class="dot" style="background:${site.color}"></i>${U.escapeHtml(site.name)}</span>`
    )
    .join('');
}

// 3. Per AI ------------------------------------------------------------------

function renderPerSite(sum, head) {
  const body = el('per-site').querySelector('tbody');
  const rows = WF.sites
    .list()
    .map((site) => ({ site, counters: sum.perSite[site.id] }))
    .filter((row) => row.counters && (timeInUse(row.counters) > 0 || row.counters.prompts > 0));

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty">No data in this range yet.</td></tr>';
    return;
  }

  const bySite = new Map(head.rows.map((row) => [row.siteId, row]));
  body.innerHTML = rows
    .map(({ site, counters }) => {
      const median = bySite.get(site.id) ? bySite.get(site.id).answerMedian : null;
      return `<tr>
        <td><span class="dot" style="background:${site.color}"></span> ${U.escapeHtml(site.name)}</td>
        <td class="num">${U.humanDuration(timeInUse(counters))}</td>
        <td class="num">${U.num(counters.prompts)}</td>
        <td class="num">${U.num(counters.answers)}</td>
        <td class="num">${U.humanDuration(counters.waiting || 0)}</td>
        <td class="num">${U.humanShort(median)}</td>
      </tr>`;
    })
    .join('');
}

// 4. Head to head ------------------------------------------------------------

function renderHeadToHead(head, scoped) {
  const body = el('head-to-head').querySelector('tbody');
  const rows = head.rows.filter((row) => row.measured > 0 || row.sent > 0);

  if (!rows.length) {
    body.innerHTML =
      '<tr><td colspan="7" class="empty">Nothing measured yet. Send a prompt to several AIs at once.</td></tr>';
    el('head-note').innerHTML = '';
    return;
  }

  const maxWins = Math.max(1, ...rows.map((row) => row.sharedWins));
  const fastestSite = [...rows]
    .filter((row) => row.sharedWins > 0)
    .sort((a, b) => b.sharedWins - a.sharedWins)[0];

  const followUps = (siteId) => {
    const counters = WF.stats.summarize(stats, currentKeys()).perSite[siteId];
    return counters ? counters.followUps || 0 : 0;
  };

  body.innerHTML = rows
    .map((row) => {
      const wins = row.sharedEligible
        ? `${row.sharedWins} of ${row.sharedEligible}`
        : '<span class="dim">not measured</span>';
      const isFastest = fastestSite && fastestSite.siteId === row.siteId;
      return `<tr>
        <td><span class="dot" style="background:${siteColor(row.siteId)}"></span> ${U.escapeHtml(
        siteName(row.siteId)
      )}</td>
        <td class="num">${U.humanShort(row.firstWordMedian)}</td>
        <td class="num">${U.humanShort(row.answerMedian)}</td>
        <td class="num">${U.humanShort(row.answerP90)}</td>
        <td class="num">
          <span class="bar-cell"><canvas class="inline-bar" data-value="${row.sharedWins}" data-max="${maxWins}" data-color="${
            isFastest ? '#4ab06e' : '#5a5a62'
          }"></canvas>${wins}${isFastest ? ' <span class="verdict-earning">FASTEST</span>' : ''}</span>
        </td>
        <td class="num">${row.sent ? `${row.abandonedPct}%` : '--'}</td>
        <td class="num">${U.num(followUps(row.siteId))}</td>
      </tr>`;
    })
    .join('');

  for (const canvas of body.querySelectorAll('canvas.inline-bar')) {
    WF.charts.inlineBar(canvas, {
      value: Number(canvas.dataset.value),
      max: Number(canvas.dataset.max),
      color: canvas.dataset.color,
    });
  }

  el('head-note').innerHTML = head.sharedGroups
    ? `<div class="note good">Measured on ${U.num(head.sharedGroups)} prompt${
        head.sharedGroups === 1 ? '' : 's'
      } sent to several AIs at once. This is your own benchmark, not a lab test.</div>`
    : `<div class="note">No prompt has been sent to more than one AI in this range yet, so "fastest on shared prompts" is empty.</div>`;
}

// 5. Cost --------------------------------------------------------------------

/**
 * Model by model, which a site-level table cannot answer: "is Pro worth it over Flash?"
 * One row per model actually seen on a page, with the same measures as head to head.
 */
function renderModels(scoped) {
  const body = el('models').querySelector('tbody');
  const table = el('models').closest('.table-scroll');
  const rows = WF.stats
    .modelRows(scoped)
    .filter((row) => row.measured > 0)
    .slice(0, 12);

  if (!rows.length) {
    table.hidden = true;
    el('models-note').innerHTML =
      '<div class="note">No model has been named on a page yet. Send a prompt and it starts ' +
      'filling in: the label is read from the site\u2019s own switcher.</div>';
    return;
  }
  table.hidden = false;

  body.innerHTML = rows
    .map(
      (row) => `<tr>
        <td><i class="dot" style="background:${siteColor(row.siteId)}"></i>${U.escapeHtml(
          siteName(row.siteId)
        )}</td>
        <td>${U.escapeHtml(row.model)}</td>
        <td>${U.num(row.sent)}</td>
        <td>${row.measured}${row.measured < row.sent ? ` <span class="dim">of ${row.sent}</span>` : ''}</td>
        <td>${row.firstWordMedian === null ? '—' : U.humanShort(row.firstWordMedian)}</td>
        <td>${row.answerMedian === null ? '—' : U.humanShort(row.answerMedian)}</td>
        <td>${row.answerP90 === null ? '—' : U.humanShort(row.answerP90)}</td>
      </tr>`
    )
    .join('');

  const named = rows.filter((row) => row.model !== 'unknown').length;
  el('models-note').innerHTML = `<div class="note">${U.escapeHtml(
    named
      ? `${named} model${named === 1 ? '' : 's'} seen. Answers with no label are counted as unknown rather than guessed at.`
      : 'Every answer so far came from a page that showed no model name, so they are all counted as unknown.'
  )}</div>`;
}

function renderPrices() {
  el('prices').innerHTML = WF.sites
    .list()
    .map(
      (site) => `<label>
        ${U.escapeHtml(site.name)}
        <input class="price-input" type="number" min="0" step="1" inputmode="decimal"
          id="price-${site.id}" value="${Number(settings.prices[site.id]) || ''}" placeholder="0" />
        <span class="dim">$/mo</span>
      </label>`
    )
    .join('');

  for (const site of WF.sites.list()) {
    const input = el(`price-${site.id}`);
    input.addEventListener('change', () => {
      const prices = { ...settings.prices, [site.id]: Math.max(0, Number(input.value) || 0) };
      save({ prices });
    });
  }
}

function renderCosts(sum, keys) {
  const rows = WF.stats.costRows(sum.perSite, settings.prices, keys);
  const body = el('costs').querySelector('tbody');

  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty">No usage in this range.</td></tr>';
    el('cost-note').innerHTML = '';
    return;
  }

  body.innerHTML = rows
    .map((row) => {
      const label = WF.stats.VERDICT_LABEL[row.verdict];
      return `<tr>
        <td><span class="dot" style="background:${siteColor(row.siteId)}"></span> ${U.escapeHtml(
        siteName(row.siteId)
      )}</td>
        <td class="num">${row.monthly ? U.money(row.monthly) : '<span class="dim">not set</span>'}</td>
        <td class="num">${U.num(row.prompts)}</td>
        <td class="num">${U.humanDuration(timeInUse(sum.perSite[row.siteId]))}</td>
        <td class="num">${row.costPerPrompt === null ? '--' : U.money(row.costPerPrompt)}</td>
        <td class="num">${row.costPerHour === null ? '--' : U.money(row.costPerHour)}</td>
        <td class="verdict-${row.verdict}"><span class="verdict-dot">●</span>${U.escapeHtml(label)}</td>
      </tr>`;
    })
    .join('');

  const note = WF.stats.costNote(rows);
  el('cost-note').innerHTML = note ? `<div class="note bad">${U.escapeHtml(note)}</div>` : '';
}

// 6. Attention ---------------------------------------------------------------

function renderAttention(scoped) {
  const detail = WF.stats.attentionDetail(scoped, { limit: 5 });
  el('attention').innerHTML = [
    [U.humanDuration(detail.watchedArriveMs), 'watching answers arrive'],
    [U.humanDuration(detail.waitingElsewhereMs), 'waiting elsewhere'],
    [U.num(detail.count), 'answers measured'],
  ]
    .map(([value, key]) => `<div><div class="n">${value}</div><div class="k">${key}</div></div>`)
    .join('');

  el('longest').innerHTML = detail.longest.length
    ? `<div class="sep"></div><div class="card-note" style="margin: 0 0 6px">Longest waits</div>` +
      detail.longest
        .map(
          (item) => `<div class="row" style="font-size: 12.5px; padding: 4px 0">
            <span class="dot" style="background:${siteColor(item.siteId)}"></span>
            <span>${U.escapeHtml(siteName(item.siteId))}</span>
            <span class="spacer"></span>
            <span class="num">${U.humanShort(item.ms)}</span>
            <span class="dim" style="width: 78px; text-align: right">${U.relativeTime(item.at)}</span>
          </div>`
        )
        .join('')
    : '';
}

// 7. Heatmap -----------------------------------------------------------------

function renderHeat() {
  const { matrix, max } = WF.stats.heatMatrix(stats.heat);
  WF.charts.heatmap(el('heat'), { matrix, max, height: 200 });
}

// 8. Summary card ------------------------------------------------------------

/** Calendar week, calendar month, a rolling window, or everything. */
function cardKeys() {
  if (cardRange === 'all') return WF.stats.allKeys(stats);
  if (cardRange === 'week') return WF.stats.weekKeys();
  if (cardRange === 'month') return WF.stats.monthKeys();
  return WF.stats.rangeKeys(Number(cardRange));
}

function summaryText() {
  const keys = cardKeys();
  const sum = WF.stats.summarize(stats, keys);
  const head = WF.stats.headToHead(eventsInRange(keys));
  const costs = WF.stats.costRows(sum.perSite, settings.prices, keys);
  return WF.stats.summaryCard(sum, {
    title: `${WF.app.name()} summary`,
    rangeLabel: `${keys[0]} to ${keys[keys.length - 1]}`,
    headRows: head.rows,
    costNote: WF.stats.costNote(costs),
  });
}

function renderSummaryButton() {
  el('summary').textContent = summaryText();
}

async function copySummary() {
  const text = summaryText();
  try {
    await navigator.clipboard.writeText(text);
    flashNote('Summary copied to the clipboard.', 'good');
    return;
  } catch (err) {
    /* fall through to the textarea trick */
  }
  const area = document.createElement('textarea');
  area.value = text;
  document.body.append(area);
  area.select();
  try {
    document.execCommand('copy');
    flashNote('Summary copied to the clipboard.', 'good');
  } catch (err) {
    flashNote('Could not copy automatically. Select the text and copy it.', 'bad');
  }
  area.remove();
}

function downloadSummary() {
  download('whilefree-summary.txt', summaryText(), 'text/plain');
}

// 9. Sites -------------------------------------------------------------------

function renderSites() {
  const host = el('sites');
  host.innerHTML = '';

  for (const site of WF.sites.list()) {
    const enabled = (settings.enabledSites || []).includes(site.id);
    // The same rule as the popup: on means switched on *and* checked. An AI whose page has
    // never said it is signed in cannot be sent to, so a switch that claimed otherwise
    // would be wrong about the only thing it is there to tell you.
    const verified = WF.status.isVerified(siteStatus[site.id]);
    const on = enabled && verified;
    const row = document.createElement('div');
    row.className = 'site-row';

    const button = document.createElement('button');
    button.className = 'switch';
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-checked', String(on));
    button.setAttribute('aria-label', `${site.name} on`);
    button.addEventListener('click', async () => {
      if (on) {
        save({
          enabledSites: (settings.enabledSites || []).filter((id) => id !== site.id),
        });
        return;
      }
      // Switching one on opens its tab and checks it there; see the popup for the rule.
      flashNote(`Opening ${site.name}…`);
      const res = await WF.browser.send({
        type: MSG.VERIFY_SITE,
        siteId: site.id,
        timeoutMs: 30000,
      });
      if (res && res.verified) {
        flashNote(`${site.name} is on.`, 'good');
      } else {
        flashNote(
          `Sign in to ${site.name} in the tab that opened, then press the switch again.`,
          'bad'
        );
      }
      await load();
    });

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = site.color;

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = site.name;

    const statusCell = document.createElement('span');
    statusCell.className = 'dim';
    const stored = siteStatus[site.id];
    const attention = stored && stored.attention;
    // The same rule as the popup, for the same reason: a reading is shown in the present tense
    // while it is fresh and as history once it is not. A site nobody has looked at since yesterday
    // cannot be *signed out* — it can only have been, the last time anybody looked — and saying
    // otherwise on this page is how an AI the user was signed in to was reported as signed out for
    // a day and quietly left out of every fan-out.
    const fresh = !!(attention && WF.status.attentionIsFresh(stored));
    statusCell.textContent = fresh
      ? WF.attentionLabel(attention)
      : enabled && !verified
        ? 'not checked'
        : verified
          ? 'signed in'
          : 'closed';
    if (attention && !fresh) {
      const at = WF.status.attentionAt(stored);
      statusCell.title = `Last time its page was looked at it was showing: ${WF.attentionLabel(
        attention
      )}${at ? ` (${WF.util.relativeTime(at)})` : ''}.`;
    }

    const check = document.createElement('button');
    check.className = 'btn-quiet';
    check.textContent = 'Diagnose';
    check.title = `Check whether ${site.name} has changed its page`;
    check.addEventListener('click', () => checkSite(site.id));

    row.append(
      button,
      dot,
      name,
      statusCell,
      Object.assign(document.createElement('span'), { className: 'spacer' }),
      check
    );
    host.append(row);
  }
}

async function checkSite(siteId) {
  const host = el('diagnostics');
  host.innerHTML = `<p class="empty">Looking at ${U.escapeHtml(siteName(siteId))}…</p>`;
  const res = await WF.browser.send({ type: MSG.TEST_SITE, siteId });
  if (!res || !res.ok) {
    host.innerHTML = `<p class="empty">${U.escapeHtml(
      (res && res.message) || 'Open that AI in a tab first, then run the check.'
    )}</p>`;
    return;
  }
  diagnostics[siteId] = res.diagnostic;
  host.innerHTML = `<details class="diag" open>
      <summary>What ${U.escapeHtml(siteName(siteId))} looks like</summary>
      <pre>${U.escapeHtml(JSON.stringify(res.diagnostic, null, 2))}</pre>
      <p class="dim" style="font-size: 12px">
        A field that is null is something WhileFree could not find on the page. Please open an
        issue with this text and it can be pointed at the right place.
      </p>
    </details>`;
}

// 10. Settings ---------------------------------------------------------------

function renderSettings() {
  el('settle-min').value = settings.settleMs[0];
  el('settle-max').value = settings.settleMs[1];
  el('notify-wait').value = String(settings.notifyMinWaitMs || 0);

  el('send-mode').value = settings.sendMode === 'new_chat' ? 'new_chat' : 'continue';
  el('weekly-switch').setAttribute('aria-checked', String(settings.weeklyReportEnabled !== false));

  const toggles = [
    ['autoOpenTabs', 'Open a background tab for an AI that is closed'],
    ['keepTabsOpen', 'Leave those tabs open afterwards'],
    ['singleWindow', 'Open the tabs a broadcast has to open in a window of their own'],
    ['autoCapture', 'Send along a prompt typed in an AI\u2019s own box'],
    ['lockstep', 'Hold a prompt back unless every AI is ready'],
    ['groupTabs', 'Put the broadcast\u2019s tabs in one group (Chrome only)'],
    [
      'requireSignIn',
      'Only send to an AI that is signed in',
    ],
    ['focusOnRetry', 'Bring a tab forward if a site will not accept a prompt in the background'],
    ['badgeEnabled', 'Show the answered count on the toolbar icon'],
    ['chimeEnabled', 'Chime when an answer lands'],
    ['notifySystem', 'Also raise a system notification'],
    ['overlayEnabled', 'Show the launcher inside the AI pages'],
  ];

  el('behavior-toggles').innerHTML = toggles
    .map(
      ([key, label]) => `<div class="row">
        <span>${U.escapeHtml(label)}</span>
        <span class="spacer"></span>
        <button class="switch" role="switch" data-toggle="${key}"
          aria-checked="${String(toggleValue(key))}" aria-label="${U.escapeHtml(label)}"></button>
      </div>`
    )
    .join('');

  for (const button of el('behavior-toggles').querySelectorAll('[data-toggle]')) {
    button.addEventListener('click', () => {
      const key = button.dataset.toggle;
      const next = !toggleValue(key);
      button.setAttribute('aria-checked', String(next));
      save(patchForToggle(key, next));
    });
  }

  el('chime-sites').innerHTML = WF.sites
    .list()
    .map(
      (site) =>
        `<span class="chip" data-site="${site.id}" data-off="${
          settings.chimeSites[site.id] === false ? 1 : 0
        }"><i class="monogram" style="background:${site.color}">${U.escapeHtml(
          site.monogram
        )}</i>${U.escapeHtml(site.name)}</span>`
    )
    .join('');

  for (const chip of el('chime-sites').querySelectorAll('.chip')) {
    chip.addEventListener('click', () => {
      const siteId = chip.dataset.site;
      const off = chip.dataset.off === '1';
      const chimeSites = { ...settings.chimeSites, [siteId]: off };
      save({ chimeSites });
    });
  }

  renderSlowModes();
}

/**
 * One switch per AI that has a slow mode we know how to turn off. Only AIs that
 * actually have one are listed, so the panel never implies a toggle exists where it
 * does not.
 */
function renderSlowModes() {
  const host = el('slowmode-sites');
  const candidates = WF.sites.list().filter((site) => site.togglesOff && site.togglesOff.length);
  if (!candidates.length) {
    host.innerHTML = '<span class="dim">None of the supported AIs expose a slow mode.</span>';
    return;
  }
  host.innerHTML = candidates
    .map(
      (site) =>
        `<span class="chip" data-slow="${site.id}" data-off="${
          settings.disableSlowModes[site.id] === true ? 0 : 1
        }"><i class="monogram" style="background:${site.color}">${U.escapeHtml(
          site.monogram
        )}</i>${U.escapeHtml(site.name)}</span>`
    )
    .join('');

  for (const chip of host.querySelectorAll('.chip')) {
    chip.addEventListener('click', () => {
      const siteId = chip.dataset.slow;
      const on = chip.dataset.off === '1';
      save({ disableSlowModes: { ...settings.disableSlowModes, [siteId]: on } });
    });
  }
}

function toggleValue(key) {
  return settings[key] !== false;
}

function patchForToggle(key, value) {
  return { [key]: value };
}

// 11. Data -------------------------------------------------------------------

function renderData() {
  const days = Object.keys(stats.days || {}).length;
  el('data-stats').textContent = `${days} day${days === 1 ? '' : 's'} recorded · ${U.num(
    events.length
  )} timed answers · since ${stats.startedAt ? U.dayKey(stats.startedAt) : 'today'}`;
}

function download(filename, text, type) {
  const blob = new Blob([text], { type: type || 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function doExportCsv(kind) {
  const isDaily = kind === 'daily';
  const text = isDaily ? await WF.storage.exportDailyCsv() : await WF.storage.exportAnswersCsv();
  download(`whilefree-${isDaily ? 'daily' : 'answers'}-${U.dayKey()}.csv`, text, 'text/csv');
  flashNote(
    isDaily
      ? 'Exported one row per day per AI: writing, waiting, reading, prompts, answers.'
      : 'Exported one row per timed answer: first words, total time, and whether you had already left.',
    'good'
  );
}

/** Look at every AI that is currently open, for when one of them stops answering. */
async function checkAllOpen() {
  const host = el('diagnostics');
  const open = [];
  for (const site of WF.sites.list()) {
    const res = await WF.browser.send({ type: MSG.TEST_SITE, siteId: site.id });
    if (res && res.ok) open.push(res.diagnostic);
  }
  if (!open.length) {
    host.innerHTML =
      '<p class="empty">None of the supported AIs is open right now. Open the ones you use, then run the check again.</p>';
    return;
  }
  host.innerHTML = `<details class="diag" open>
      <summary>What ${open.length} open AI${open.length === 1 ? '' : 's'} look like</summary>
      <pre>${U.escapeHtml(JSON.stringify(open, null, 2))}</pre>
      <p class="dim" style="font-size: 12px">
        Anything showing as null is something WhileFree could not find on the page. Paste this
        into an issue and it can be pointed at the right place.
      </p>
    </details>`;
}

async function doExport() {
  const doc = await WF.storage.exportAll();
  download(`whilefree-${U.dayKey()}.json`, JSON.stringify(doc, null, 2));
  flashNote('Exported. The file contains timings and counts only — never prompt or answer text.', 'good');
}

async function doImport(file) {
  try {
    const text = await file.text();
    const doc = JSON.parse(text);
    await WF.storage.importAll(doc, 'merge');
    await load();
    flashNote('Imported and merged with what you already had.', 'good');
  } catch (err) {
    flashNote(`Could not import that file: ${err.message}`, 'bad');
  }
}

async function doWipe() {
  const sure = window.confirm(
    'Delete every timing, count and price stored by this extension? This cannot be undone.'
  );
  if (!sure) return;
  await WF.storage.wipeAll();
  await load();
  flashNote('Everything deleted.', 'good');
}

function flashNote(message, kind) {
  const host = el('data-note');
  host.innerHTML = `<div class="note ${kind || ''}">${U.escapeHtml(message)}</div>`;
  setTimeout(() => {
    if (host.innerHTML.includes(message.slice(0, 24))) host.innerHTML = '';
  }, 9000);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

function wire() {
  for (const button of document.querySelectorAll('.range')) {
    button.addEventListener('click', () => {
      for (const other of document.querySelectorAll('.range')) other.classList.remove('is-on');
      button.classList.add('is-on');
      const value = button.dataset.range;
      rangeDays = value === 'all' ? 'all' : Number(value);
      render();
    });
  }

  el('metric').addEventListener('change', (event) => {
    metric = event.target.value;
    render();
  });

  el('card-range').addEventListener('change', (event) => {
    cardRange = event.target.value;
    renderSummaryButton();
  });

  el('copy-card').addEventListener('click', copySummary);
  el('download-card').addEventListener('click', downloadSummary);

  // The one pause that is left now that a broadcast goes out all at once: inside a single
  // site, between typing the prompt and pressing send. Some pages need a moment to notice
  // what was typed; the two numbers are the range a random delay is drawn from.
  const saveSettle = () => {
    const min = Math.max(0, Number(el('settle-min').value) || 0);
    const max = Math.max(min, Number(el('settle-max').value) || min);
    save({ settleMs: [min, max] });
  };
  el('settle-min').addEventListener('change', saveSettle);
  el('settle-max').addEventListener('change', saveSettle);

  el('notify-wait').addEventListener('change', (event) => {
    save({ notifyMinWaitMs: Number(event.target.value) || 0 });
  });

  el('send-mode').addEventListener('change', (event) => {
    save({ sendMode: event.target.value });
  });

  el('weekly-switch').addEventListener('click', () => {
    const next = !(settings.weeklyReportEnabled !== false);
    el('weekly-switch').setAttribute('aria-checked', String(next));
    save({ weeklyReportEnabled: next });
  });

  // The same digest the alarm sends, on demand — otherwise it is a week before you can
  // tell whether it says anything worth reading.
  el('weekly-now').addEventListener('click', async () => {
    const res = await WF.browser.send({ type: MSG.WEEKLY_REPORT });
    const host = el('weekly-note');
    const message = res && res.ok
      ? 'Sent — check your notifications.'
      : res && res.reason === 'off'
        ? 'Turn the weekly report on first.'
        : res && res.reason === 'nothing-to-report'
          ? 'Nothing recorded in the last 7 days.'
          : 'Nothing to report yet: the clock starts on the first day of use.';
    host.textContent = message;
    host.hidden = false;
  });

  el('export').addEventListener('click', doExport);
  el('export-daily').addEventListener('click', () => doExportCsv('daily'));
  el('export-answers').addEventListener('click', () => doExportCsv('answers'));
  el('check-all').addEventListener('click', checkAllOpen);
  el('import').addEventListener('click', () => el('import-file').click());
  el('import-file').addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (file) doImport(file);
    event.target.value = '';
  });
  el('wipe').addEventListener('click', doWipe);

  el('welcome-done').addEventListener('click', () => {
    el('welcome').hidden = true;
    save({ onboardingDone: true });
  });

  for (const input of [el('settle-min'), el('settle-max')]) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') input.blur();
    });
  }
}

wire();
watch();
load();
globalThis.addEventListener('resize', U.debounce(() => render(), 200));
