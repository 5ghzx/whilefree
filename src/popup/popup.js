import '../lib/browser.js';
import '../lib/app.js';
import '../lib/util.js';
import '../lib/protocol.js';
import '../lib/sites.js';
import '../lib/storage.js';
import '../lib/settings.js';
import '../lib/stats.js';

const U = WF.util;
const MSG = WF.MSG;

const el = (id) => document.getElementById(id);

let state = null;
let busy = false;
let ticker = null;

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

async function load() {
  const next = await WF.browser.send({ type: MSG.GET_STATE });
  if (!next || next.error) return;
  state = next;
  render();
}

/**
 * Re-read whenever the background writes anything we display. That covers answers
 * landing and time being recorded, without polling for either.
 */
function watchStorage() {
  try {
    WF.browser.api.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[WF.storage.KEYS.answers] || changes[WF.storage.KEYS.stats]) load();
    });
  } catch (err) {
    /* fall back to the ticker */
  }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render() {
  if (!state) return;
  const settings = state.settings;

  el('app-name').textContent = WF.app.name();
  el('app-version').textContent = `v${WF.app.version()}`;
  el('repo-link').href = WF.app.repo;

  renderSites(settings);
  renderAnswers();
  renderJob();
  renderToday();

  el('chime-switch').setAttribute('aria-checked', String(!!settings.chimeEnabled));
  el('tabs-switch').setAttribute('aria-checked', String(!!settings.autoOpenTabs));

  const enabled = state.sites.filter((site) => site.enabled);
  el('target-summary').textContent = enabled.length
    ? `Goes to ${enabled.length} AI${enabled.length === 1 ? '' : 's'}.`
    : 'No AI switched on yet.';
}

function renderSites(settings) {
  const host = el('sites');
  host.innerHTML = '';

  for (const site of state.sites) {
    const row = document.createElement('div');
    row.className = 'site';

    const switchBtn = document.createElement('button');
    switchBtn.className = 'switch';
    switchBtn.setAttribute('role', 'switch');
    switchBtn.setAttribute('aria-checked', String(!!site.enabled));
    switchBtn.setAttribute('aria-label', `${site.name} on`);
    switchBtn.addEventListener('click', () => toggleSite(site.id, !site.enabled));

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = site.color;

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = site.name;

    const stateEl = document.createElement('span');
    stateEl.className = 'state';
    if (site.attention) {
      stateEl.classList.add('warn');
      stateEl.textContent = WF.attentionLabel(site.attention);
    } else if (site.openTabs) {
      stateEl.textContent = `${site.openTabs} tab${site.openTabs === 1 ? '' : 's'} open`;
    } else {
      stateEl.textContent = 'closed';
    }

    row.append(switchBtn, dot, name, stateEl);
    host.append(row);
  }
}

function renderAnswers() {
  const answers = (state && state.answers) || [];
  const card = el('answers-card');
  card.hidden = answers.length === 0;
  el('answers-count').textContent = String(answers.length);
  el('answers-count').className = answers.length ? 'badge' : 'badge zero';

  const host = el('answers');
  host.innerHTML = '';
  for (const answer of answers) {
    const site = WF.sites.byId(answer.siteId);
    const row = document.createElement('div');
    row.className = 'answer';

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = site ? site.color : '#78736e';

    const text = document.createElement('span');
    text.innerHTML =
      `<span class="who">${U.escapeHtml(site ? site.name : answer.siteId)} has answered</span><br>` +
      `<span class="meta">Ready after ${U.humanShort(answer.waitedMs)} · ${U.relativeTime(answer.readyAt)}</span>`;

    const open = document.createElement('button');
    open.textContent = 'Open →';
    open.addEventListener('click', () => openAnswer(answer.id));

    const wrap = document.createElement('span');
    wrap.append(text);
    row.append(dot, wrap, Object.assign(document.createElement('span'), { className: 'spacer' }), open);
    host.append(row);
  }
}

function renderJob() {
  const job = state && state.job ? state.job.activeJob : null;
  const queued = state && state.job ? state.job.queued || [] : [];
  const card = el('job-card');

  if (!job && !queued.length) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  if (job) {
    el('job-title').textContent = `Sending to ${job.targets.length}`;
    el('job-targets').innerHTML = job.targets
      .map(
        (siteId) => `<div class="target">
            <span class="dot" style="background:${colorOf(siteId)}"></span>
            <span>${U.escapeHtml(nameOf(siteId))}</span>
            <span class="st">sending…</span>
          </div>`
      )
      .join('');
  } else {
    el('job-title').textContent = 'Queued';
    el('job-targets').innerHTML = `<div class="target"><span>${queued.length} prompt${
      queued.length === 1 ? '' : 's'
    } waiting its turn.</span></div>`;
  }
}

function renderToday() {
  const totals = (state && state.today && state.today.totals) || WF.stats.emptyCounters();
  const split = WF.stats.split(totals);
  const host = el('today-split');

  if (!split.total) {
    host.innerHTML = '';
    el('today-total').textContent = 'Nothing recorded yet today.';
    return;
  }

  host.innerHTML = `<div class="split">
      ${segment('writing', split.writingPct, split.writing)}
      ${segment('waiting', split.waitingPct, split.waiting)}
      ${segment('reading', split.readingPct, split.reading)}
    </div>`;
  el('today-total').textContent = `${U.humanDuration(split.total)} in AI tabs · ${U.num(
    totals.prompts
  )} prompts · ${U.num(totals.answers)} answers`;
}

function segment(kind, percent, ms) {
  if (!percent) return '';
  return `<span class="${kind}" style="width:${percent}%" title="${kind} ${U.humanDuration(ms)}">${
    percent > 12 ? `${kind} ${percent}%` : ''
  }</span>`;
}

const nameOf = (id) => (WF.sites.byId(id) || {}).name || id;
const colorOf = (id) => (WF.sites.byId(id) || {}).color || '#78736e';

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

async function toggleSite(siteId, on) {
  const enabled = new Set(state.settings.enabledSites || []);
  if (on) enabled.add(siteId);
  else enabled.delete(siteId);
  const next = [...enabled];
  if (!next.length) return; // never leave the user with nothing switched on
  const res = await WF.browser.send({ type: MSG.SET_SETTINGS, patch: { enabledSites: next } });
  if (res && res.settings) {
    state.settings = res.settings;
    state.sites = state.sites.map((site) => (site.id === siteId ? { ...site, enabled: on } : site));
    render();
  }
}

async function send() {
  const prompt = el('prompt').value.trim();
  if (!prompt || busy) return;
  busy = true;
  el('send').disabled = true;
  el('send-result').hidden = false;
  el('send-result').textContent = 'Sending…';

  const res = await WF.browser.send({ type: MSG.BROADCAST, prompt, originSiteId: null });
  busy = false;
  el('send').disabled = false;

  if (!res || res.error || !res.ok) {
    const reason = (res && (res.error || res.reason)) || 'unknown';
    el('send-result').textContent =
      reason === 'no-targets'
        ? 'Switch on at least one AI above.'
        : `Could not send: ${U.escapeHtml(String(reason))}`;
    return;
  }

  el('prompt').value = '';
  el('send-result').textContent = res.queued
    ? 'Queued behind the prompt that is still going out.'
    : `Sent to ${res.targets.length} AI${res.targets.length === 1 ? '' : 's'}. You can close this popup.`;
  await load();
}

async function openAnswer(answerId) {
  await WF.browser.send({ type: MSG.OPEN_ANSWER, answerId });
  await load();
  window.close();
}

async function clearAnswers() {
  const res = await WF.browser.send({ type: MSG.CLEAR_ANSWERS });
  if (res && res.answers) {
    state.answers = res.answers;
    render();
  }
}

async function cancelJob() {
  await WF.browser.send({ type: MSG.CANCEL });
  await load();
}

async function checkTab() {
  const host = el('diagnostic');
  host.hidden = false;
  host.innerHTML = '<p class="empty">Looking at this tab…</p>';
  const res = await WF.browser.send({ type: MSG.TEST_SITE });
  if (!res || !res.ok) {
    host.innerHTML = `<p class="empty">${
      res && res.reason === 'no-tab'
        ? 'Open one of the five AI sites in a tab first, then run the check.'
        : 'No answer from that tab. Reload the page and try again.'
    }</p>`;
    return;
  }
  const d = res.diagnostic;
  const lines = [
    `site        ${d.siteId}`,
    `composer    ${d.composer ? `${d.composer.via} (${d.composer.tag}, ${d.composer.chars} chars)` : 'NOT FOUND'}`,
    `send        ${d.send ? `${d.send.via} [${d.send.label}]` : 'NOT FOUND'}`,
    `stop button ${d.stopPresent ? 'visible (an answer is streaming)' : 'not visible'}`,
    `answers     ${d.answers.nodes} node(s), ${d.answers.chars} chars`,
    `attention   ${d.attention ? `${d.attention.reason} (${d.attention.evidence})` : 'none'}`,
    '',
    'answer selector matches:',
    ...Object.entries(d.answerMatches || {}).map(([selector, count]) => `  ${count}  ${selector}`),
  ];
  host.innerHTML = `<details class="diag" open><summary>Markup check</summary><pre>${U.escapeHtml(
    lines.join('\n')
  )}</pre><p class="dim" style="font-size:11.5px">If something says NOT FOUND, that site changed its
    page. Please open an issue with this text — a selector fix is usually one line.</p></details>`;
}

// ---------------------------------------------------------------------------

function wire() {
  el('send').addEventListener('click', send);
  el('prompt').addEventListener('input', () => {
    const has = el('prompt').value.trim().length > 0;
    el('send').disabled = !has || busy;
  });
  el('prompt').addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') send();
  });
  el('clear-answers').addEventListener('click', clearAnswers);
  el('cancel-job').addEventListener('click', cancelJob);
  el('check-tab').addEventListener('click', checkTab);
  el('chime-switch').addEventListener('click', async () => {
    const next = !state.settings.chimeEnabled;
    const res = await WF.browser.send({ type: MSG.SET_SETTINGS, patch: { chimeEnabled: next } });
    if (res && res.settings) {
      state.settings = res.settings;
      render();
    }
  });
  el('tabs-switch').addEventListener('click', async () => {
    const next = !state.settings.autoOpenTabs;
    const res = await WF.browser.send({ type: MSG.SET_SETTINGS, patch: { autoOpenTabs: next } });
    if (res && res.settings) {
      state.settings = res.settings;
      render();
    }
  });
  el('open-dashboard').addEventListener('click', () => {
    WF.browser.send({ type: MSG.OPEN_DASHBOARD });
  });
}

wire();
watchStorage();
load().then(() => {
  // Relative times and elapsed waits stay honest while the popup is open.
  ticker = setInterval(() => {
    if (!state) return;
    if ((state.answers && state.answers.length) || (state.job && state.job.activeJob)) {
      renderAnswers();
      renderJob();
    }
  }, 1000);
  window.addEventListener('unload', () => ticker && clearInterval(ticker));
});
