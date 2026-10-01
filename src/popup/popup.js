import '../lib/browser.js';
import '../lib/app.js';
import '../lib/util.js';
import '../lib/protocol.js';
import '../lib/sites.js';
import '../lib/storage.js';
import '../lib/settings.js';
import '../lib/reach.js';
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
  // `refresh` is what makes the site list a statement about now: the background asks every AI
  // that has a tab open what its page is showing, and the answers come back as storage writes
  // that redraw this popup. Without it the list was whatever the pages had happened to say
  // since they loaded, which for a tab nobody looks at could be days.
  const next = await WF.browser.send({ type: MSG.GET_STATE, refresh: true });
  if (!next || next.error) return;
  state = next;
  render();
}

/**
 * Two questions that were one, and had to be pulled apart.
 *
 * The switch is the user's ask: this AI is one of mine. Whether a prompt can reach it *right now*
 * is the page's answer, and it changes on its own — a tab that closed, a session that expired.
 * Drawing the switch from both at once made every provider look switched off on a fresh install,
 * which was not what was stored and not anything the user had chosen. So the switch shows the ask,
 * the text on the row shows the answer, and a fan-out only goes where the two agree (engine).
 */
const isOn = (site) => !!site.enabled;

/**
 * Re-read whenever the background writes anything we display. That covers answers
 * landing and time being recorded, without polling for either.
 */
function watchStorage() {
  try {
    WF.browser.api.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (
        changes[WF.storage.KEYS.answers] ||
        changes[WF.storage.KEYS.stats] ||
        // Settings too, because this popup is not the only thing that writes them: the
        // dashboard does, and so does a second popup. Without this, the switches here went on
        // showing the last settings this page happened to have read.
        changes[WF.storage.KEYS.settings] ||
        // The site list is written by the pages as well as by this popup, and by the status
        // sweep when it opens. Listening for it is what turns a corrected reading into a
        // redrawn switch instead of a stale one.
        changes[WF.storage.KEYS.siteStatus]
      ) {
        load();
      }
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
  renderInFlight();
  renderToday();

  el('chime-switch').setAttribute('aria-checked', String(!!settings.chimeEnabled));
  el('tabs-switch').setAttribute('aria-checked', String(!!settings.autoOpenTabs));
  // The switch says what the default does, because the default is the surprising half: a
  // send that reaches seven AIs and not the other three should be readable off this line
  // rather than discovered in the job card.
  el('tabs-hint').textContent = settings.autoOpenTabs
    ? 'On: an AI with no tab open gets one, in the background.'
    : 'Off: a send only reaches the AIs you already have open.';
  el('newchat-switch').setAttribute('aria-checked', String(settings.sendMode === 'new_chat'));
  el('lockstep-switch').setAttribute('aria-checked', String(!!settings.lockstep));

  // The master switch reads the feature, not the rows underneath it.
  //
  // It used to be derived from them — on when every AI was on — which meant one press turned ten
  // switches on and the next one emptied the list. That is a switch you cannot afford to touch:
  // the picks are the user's, and "off" that throws them away makes turning it back on a job of
  // re-selection every time. One stored flag now says whether WhileFree sends at all, and the
  // list below it is left exactly as the user left it.
  const featureOn = state.settings.broadcastEnabled !== false;
  el('all-switch').setAttribute('aria-checked', String(featureOn));
  el('all-hint').textContent = featureOn
    ? 'On: one Send asks the AIs below at once.'
    : 'Off: nothing is sent. The AIs you picked are kept.';

  // The number above the button keeps the fan-out's own promise, and the reach is what the
  // promise is about — so it counts the AIs a prompt can actually be delivered to. Ten switched
  // on and none signed in is a real state on a fresh install, and it should read as a fraction
  // rather than as the silence it used to be. The conjunction behind the fraction is
  // `lib/reach.js`, because the launcher in the page quotes this same sentence and the two used to
  // disagree in exactly the case the switch below is about: a signed-in AI with no tab open reads
  // *closed* on its row and is skipped by the send, so it cannot be part of what this line promises.
  const summary = WF.reach.summarize(
    state.sites.map((site) => ({ on: isOn(site), verified: !!site.verified, open: !!site.openTabs })),
    { autoOpenTabs: settings.autoOpenTabs }
  );
  el('target-summary').textContent = !featureOn
    ? 'WhileFree is off. Nothing will be sent.'
    : !summary.on
      ? 'No AI switched on yet.'
      : summary.detail && summary.reach < summary.on
        ? `${summary.title} — ${WF.reach.fold(summary.detail)}.`
        : // Everything the list asks for can be reached, where the plain count is already the whole
          // answer and a second sentence only repeats it.
          `${summary.title}.`;
  // The button follows the master switch, so "off" is visible before a prompt is typed into a box
  // nothing would carry.
  el('send').disabled = !featureOn || !el('prompt').value.trim() || busy;
}

function renderSites(settings) {
  const host = el('sites');
  host.innerHTML = '';

  for (const site of state.sites) {
    const row = document.createElement('div');
    row.className = 'site';

    // The switch is the user's list and nothing else: on means this AI is one of theirs. Whether
    // it can be reached right now is the text beside it — the page's answer, which changes without
    // anyone pressing anything, and which is why the two cannot be the same value.
    const on = isOn(site);
    const switchBtn = document.createElement('button');
    switchBtn.className = 'switch';
    switchBtn.setAttribute('role', 'switch');
    switchBtn.setAttribute('aria-checked', String(on));
    switchBtn.setAttribute('aria-label', `${site.name} on`);
    switchBtn.addEventListener('click', () => toggleSite(site.id, !on));

    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = site.color;

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = site.name;

    const stateEl = document.createElement('span');
    stateEl.className = 'state';
    // A reading from a page that was looked at hours ago is not a reading. Seen recently, it is
    // what this site is showing and it belongs on the row; older than that it is history, and the
    // row says what is actually known instead — nothing is open, nobody has looked since. This is
    // the difference between "Copilot is signed out" and "Copilot was signed out the last time
    // anybody saw it", and only the second one is something we can know. The old reading is kept
    // in the tooltip, where it is still useful without being asserted in the present tense.
    const seen = site.attention && site.attentionFresh ? site.attention : null;
    if (site.attention && !site.attentionFresh) {
      row.title = `Last seen showing: ${WF.attentionLabel(site.attention)}${site.attentionAt ? ` (${U.relativeTime(site.attentionAt)})` : ''}.`;
    }
    if (seen) {
      stateEl.classList.add('warn');
      // A page that needs you is the reason its AI is left out, and in this direction there is
      // no second reading to soften it with: a fresh "signed out" is a site no prompt can reach.
      stateEl.textContent = WF.attentionLabel(seen);
    } else if (!site.enabled) {
      stateEl.textContent = 'off';
    } else if (!site.verified) {
      // Switched on, nothing contradicts it, and no page has confirmed a session either. It is
      // flagged rather than quietly shown as on, because in this state a send skips it — and that
      // is the one thing this text is here to say.
      stateEl.classList.add('warn');
      stateEl.textContent = 'not checked yet';
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

/**
 * A target state, in the user's words. Anything not listed is still "working".
 */
const TARGET_LABEL = {
  queued: ['waiting', ''],
  sending: ['sending', ''],
  retrying: ['retrying', ''],
  sent: ['sent', 'good'],
  answering: ['answering', 'good'],
  done: ['answered', 'good'],
  attention: ['needs you', 'bad'],
  timeout: ['no answer', 'bad'],
  error: ['failed', 'bad'],
  cancelled: ['stopped', ''],
  skipped: ['skipped', ''],
};

const DONE_STATES = ['done', 'error', 'timeout', 'attention', 'skipped', 'cancelled'];

function targetRow(jobId, target) {
  const [label, tone] = TARGET_LABEL[target.state] || ['working', ''];
  const site = WF.sites.byId(target.siteId);
  const row = document.createElement('div');
  row.className = 'target';

  const dot = document.createElement('span');
  dot.className = 'dot';
  dot.style.background = (site && site.color) || '#78736e';

  const name = document.createElement('span');
  name.textContent = target.name || target.siteId;

  const status = document.createElement('span');
  status.className = `st ${tone}`.trim();
  status.textContent = target.attempts > 1 ? `${label} · try ${target.attempts}` : label;
  status.title = target.error || '';

  row.append(dot, name, status);

  // A single AI that is finished or stuck can be dealt with on its own: one slow site
  // should never mean resending to the four that already answered.
  if (DONE_STATES.includes(target.state) && target.state !== 'done') {
    const retry = document.createElement('button');
    retry.className = 'btn-quiet tiny';
    retry.textContent = 'Retry';
    retry.addEventListener('click', () => targetAction(MSG.RETRY_TARGET, jobId, target.siteId));
    row.append(retry);
  }
  if (!DONE_STATES.includes(target.state)) {
    const stop = document.createElement('button');
    stop.className = 'btn-quiet tiny';
    stop.textContent = 'Stop';
    stop.addEventListener('click', () => targetAction(MSG.CANCEL_TARGET, jobId, target.siteId));
    row.append(stop);
  }
  return row;
}

function renderJob() {
  const job = state && state.job ? state.job.activeJob : null;
  const card = el('job-card');

  if (!job) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  const targets = job.targets || [];
  // A finished broadcast stays on the card rather than disappearing with its outcome, so
  // the last ask reads as an answer instead of as nothing having happened.
  const running = job.running !== false;
  if (running) {
    el('job-title').textContent = `Asking ${targets.length} AI${targets.length === 1 ? '' : 's'}`;
  } else {
    const answered = targets.filter((target) => target.state === 'done').length;
    el('job-title').textContent = `Last ask · ${answered} of ${targets.length} answered`;
  }
  el('cancel-job').hidden = !running;

  const host = el('job-targets');
  host.innerHTML = '';
  for (const target of targets) host.append(targetRow(job.jobId, target));

  // Comparing needs two tabs that actually opened.
  const open = targets.filter((t) => t.tabId !== null && t.tabId !== undefined).length;
  el('compare').hidden = open < 2;
}

/**
 * Everything else that is going out right now.
 *
 * There is no queue: a second prompt starts the moment you send it, in parallel with
 * the first, so this card lists jobs that are *already running* rather than waiting.
 * The only control that makes sense for one of those is stopping it.
 */
function renderInFlight() {
  const all = (state && state.job && state.job.jobs) || [];
  const activeJob = (state && state.job && state.job.activeJob) || null;
  const others = all.filter((job) => !activeJob || job.jobId !== activeJob.jobId);

  const card = el('queue-card');
  card.hidden = others.length === 0;
  if (!others.length) return;

  const host = el('queued');
  host.innerHTML = '';
  for (const job of others) {
    const row = document.createElement('div');
    row.className = 'queued';

    const text = document.createElement('div');
    text.className = 'what';
    text.textContent = job.prompt.length > 72 ? `${job.prompt.slice(0, 71)}…` : job.prompt;
    text.title = job.prompt;

    const meta = document.createElement('div');
    meta.className = 'meta';
    const done = job.targets.filter((t) => t.state === 'done').length;
    meta.textContent = `${job.targets.length} AI${
      job.targets.length === 1 ? '' : 's'
    } · ${done} answered · ${U.humanDuration(Date.now() - job.createdAt)}`;

    const body = document.createElement('div');
    body.append(text, meta);

    const stop = iconButton('✕', 'Stop this prompt', () => dropJob(job.jobId));
    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    buttons.append(stop);

    row.append(body, buttons);
    host.append(row);
  }
}

function iconButton(label, title, onClick) {
  const button = document.createElement('button');
  button.className = 'btn-quiet tiny';
  button.textContent = label;
  button.title = title;
  button.addEventListener('click', onClick);
  return button;
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

const nextSendMode = () => (state.settings.sendMode === 'new_chat' ? 'continue' : 'new_chat');

/** Change one setting and redraw from what the background actually stored. */
async function patch(values) {
  const res = await WF.browser.send({ type: MSG.SET_SETTINGS, patch: values });
  if (res && res.settings) {
    state.settings = res.settings;
    render();
  }
  // A patch that changes which AIs are on cannot be drawn from the site list we already hold: the
  // render above is fresh settings over stale rows, so the switches and the settings disagree for
  // as long as it takes for something else to write storage. The background is the only side that
  // knows both halves, so ask it — which is also what makes the master switch's own state honest,
  // since it is derived from the rows rather than stored.
  if (values && 'enabledSites' in values) await load();
}

/**
 * The AIs among these the browser has not let this extension into yet.
 *
 * Firefox hands out the host permissions a manifest declares at install time, and an origin
 * added to the manifest later is not among them until the user says yes. An origin without a
 * grant gets no content script at all, so the page cannot answer, and the AI simply does
 * nothing — no failure, no reason, the same silence as an AI that is switched off. This is the
 * question that turns that silence into a named row.
 */
async function missingAccess(siteIds) {
  const missing = [];
  for (const id of siteIds) {
    const site = WF.sites.byId(id);
    const patterns = (site && site.matchPatterns) || [];
    if (!patterns.length) continue;
    if ((await WF.browser.permissionsContains(patterns)) === false) missing.push(id);
  }
  return missing;
}

/**
 * Ask for the sites the browser is holding shut, from inside the user's own click.
 *
 * Firefox only accepts a permission request with a user gesture behind it, and the two
 * switches are the only places in this panel where the user's hand is on the thing — so this is
 * where the question is asked, once, for however many AIs that one press switched on. Returns
 * whatever is still missing afterwards, so the caller can say so instead of leaving a switch on
 * that has nothing behind it.
 */
async function askForAccess(siteIds) {
  const missing = await missingAccess(siteIds);
  if (!missing.length) return [];
  const origins = [];
  for (const id of missing) {
    for (const pattern of (WF.sites.byId(id) || {}).matchPatterns || []) {
      if (!origins.includes(pattern)) origins.push(pattern);
    }
  }
  try {
    await WF.browser.permissionsRequest(origins);
  } catch (err) {
    // A refused prompt is not an error to report: the row below says what is still shut.
  }
  return missingAccess(siteIds);
}

/**
 * Turn an AI on or off.
 *
 * Both directions are the user's list and nothing else: no tab is opened, no page is asked. That is
 * the point of the change — when switching one on meant "and its page has now confirmed a session",
 * a fresh install drew every switch off, and turning the ten providers on meant ten tabs, ten
 * sign-in checks and ten presses. The list is the ask; the pages answer for themselves when they are
 * open, and a send is where the answer is enforced.
 */
async function toggleSite(siteId, on) {
  const enabled = new Set(state.settings.enabledSites || []);
  const site = state.sites.find((entry) => entry.id === siteId) || { id: siteId, name: siteId };

  if (on) {
    // A page the browser has never let us into cannot answer for itself, so the grant is asked for
    // here, where the click still counts as consent: Firefox takes the request only from a gesture.
    const stillShut = await askForAccess([siteId]);
    if (stillShut.length) {
      note(`Firefox has not given this extension access to ${nameOf(siteId)} yet.`);
      await load();
      return;
    }
    enabled.add(siteId);
  } else {
    enabled.delete(siteId);
  }

  await patch({ enabledSites: WF.sites.ORDER.filter((id) => enabled.has(id)) });
  if (on && !site.verified) {
    note(`${site.name} is on, and is asked once its page says you are signed in.`);
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
  el('send').disabled = !el('prompt').value.trim() || state.settings.broadcastEnabled === false;

  if (!res || res.error || !res.ok) {
    const reason = (res && (res.error || res.reason)) || 'unknown';
    el('send-result').textContent =
      reason === 'off'
        ? 'WhileFree is switched off. Turn it on at the top.'
        : reason === 'no-open-tabs'
          ? 'Nothing was sent: none of your AIs has a tab open. Open one, or turn on “Open a tab for AIs you have not opened”.'
          : reason === 'no-targets'
            ? 'Switch on at least one AI above.'
            : reason === 'no-verified-targets'
              ? 'Nothing was sent: none of your AIs has said it is signed in yet. Open one, sign in there, and send again.'
              : `Could not send: ${U.escapeHtml(String(reason))}`;
    return;
  }

  el('prompt').value = '';
  el('send-result').textContent = `Sent to ${res.targets.length} AI${
    res.targets.length === 1 ? '' : 's'
  } — all at once. You can close this popup.`;
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

async function targetAction(type, jobId, siteId) {
  const res = await WF.browser.send({ type, jobId, siteId });
  if (!res || !res.ok) note(retryNote(res));
  await load();
}

function retryNote(res) {
  const reason = res && res.reason;
  if (reason === 'still-running') return 'That one is still going — stop it first.';
  if (reason === 'not-found') return 'That send is no longer running.';
  return reason ? `Could not do that: ${reason}` : 'Could not do that.';
}

async function dropJob(jobId) {
  await WF.browser.send({ type: MSG.CANCEL, jobId });
  await load();
}

async function compare() {
  const res = await WF.browser.send({ type: MSG.OPEN_COMPARE });
  if (!res || !res.ok) {
    const reason = res && res.reason;
    note(
      reason === 'need-two'
        ? 'Two tabs have to be open to put them side by side.'
        : reason === 'unsupported'
          ? 'This browser will not let an extension arrange windows.'
          : 'Could not open the comparison window.'
    );
    return;
  }
  window.close();
}

/** One line at the bottom of the actions card, for anything that did not work. */
function note(message) {
  const host = el('action-note');
  host.hidden = !message;
  host.textContent = message || '';
}

async function checkTab() {
  const host = el('diagnostic');
  host.hidden = false;
  host.innerHTML = '<p class="empty">Looking at this tab…</p>';
  const res = await WF.browser.send({ type: MSG.TEST_SITE });
  if (!res || !res.ok) {
    host.innerHTML = `<p class="empty">${
      res && res.reason === 'no-tab'
        ? 'Open that AI in a tab first, then run the check.'
        : 'That tab did not answer. Reload the page and try again.'
    }</p>`;
    return;
  }
  const d = res.diagnostic;
  const lines = [
    `AI            ${d.siteId}`,
    `message box   ${
      d.composer ? `found (${d.composer.tag}, ${d.composer.chars} characters)` : 'not found'
    }`,
    `send button   ${d.send ? `found (${d.send.label})` : 'not found'}`,
    `stop button   ${d.stopPresent ? 'on screen — an answer is arriving now' : 'not on screen'}`,
    `answer text   ${d.answers.chars} characters in ${d.answers.nodes} block(s)`,
    `needs you     ${d.attention ? WF.attentionLabel(d.attention.reason) : 'nothing'}`,
  ];
  host.innerHTML = `<details class="diag" open><summary>What this page looks like</summary><pre>${U.escapeHtml(
    lines.join('\n')
  )}</pre><p class="dim" style="font-size:11.5px">If a line says <em>not found</em>, that AI changed
    its page and WhileFree has to be told where things moved. Please open an issue with this text — it
    is usually a one-line fix.</p></details>`;
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
  // The master switch, which is the feature and nothing else.
  //
  // Off stops every send — the engine, the capture path and the context menu all read this one
  // flag before they do anything — and leaves the per-AI switches alone, so turning it back on
  // asks exactly the AIs it asked before. It deliberately does *not* write `enabledSites`:
  // rewriting the list is what made an off switch cost a re-selection, and the sign-in check a
  // site has passed is not something a stop button should be allowed to spend.
  el('all-switch').addEventListener('click', async () => {
    const on = state.settings.broadcastEnabled !== false;
    // Turning it *on* is when the browser is asked about the sites the user has picked and it has
    // not let this extension into yet: on Firefox a host permission added to the manifest later
    // is not granted until a press asks for it, and an origin without a grant gets no content
    // script at all — that AI is silent rather than broken. The ask comes first, while the click
    // that started it is still the gesture the permission prompt needs.
    const picked = state.sites.filter((site) => site.enabled).map((site) => site.id);
    const stillShut = on ? [] : await askForAccess(picked);
    await patch({ broadcastEnabled: !on });
    if (on) {
      note('WhileFree is off. Nothing is sent, and your AI picks are kept.');
      return;
    }
    note(
      stillShut.length
        ? `WhileFree is on, except ${stillShut.map(nameOf).join(', ')}: the browser has not allowed this extension into ${stillShut.length === 1 ? 'that site' : 'those sites'} yet.`
        : 'WhileFree is on.'
    );
  });
  el('clear-answers').addEventListener('click', clearAnswers);
  el('cancel-job').addEventListener('click', cancelJob);
  el('compare').addEventListener('click', compare);
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
  el('newchat-switch').addEventListener('click', () => patch({ sendMode: nextSendMode() }));
  el('lockstep-switch').addEventListener('click', () => patch({ lockstep: !state.settings.lockstep }));
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
    // Elapsed waits and relative times stay honest while the popup is open. The
    // in-flight card is redrawn too, because its elapsed line is a claim about time.
    renderAnswers();
    renderJob();
    renderInFlight();
  }, 1000);
  window.addEventListener('unload', () => ticker && clearInterval(ticker));
});
