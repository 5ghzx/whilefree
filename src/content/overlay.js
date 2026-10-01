/**
 * The in-page furniture: the "Ask all" launcher, the per-AI status list, the
 * answers-ready panel, warnings, and the chime.
 *
 * Everything lives in a closed-over shadow root so a site's CSS can never reach
 * it and ours can never leak into the page. It is also styled to stay out of the
 * way: two small controls in the bottom-right, nothing over the conversation.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});
  const content = (WF.content = WF.content || {});
  const U = WF.util;

  const Z = 2147483000;
  const LINGER_MS = 60000; // how long the status list stays after a job ends

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .root {
      position: fixed; right: 18px; bottom: 18px; z-index: ${Z};
      font: 13px/1.45 ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
      color: #e7e5e2; display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
      pointer-events: none;
    }
    .root > * { pointer-events: auto; }
    .card {
      background: rgba(17,17,19,.94); border: 1px solid rgba(255,255,255,.10);
      border-radius: 14px; box-shadow: 0 12px 34px rgba(0,0,0,.45); overflow: hidden;
      backdrop-filter: blur(10px); min-width: 268px; max-width: 340px;
    }
    .hd { display: flex; align-items: center; gap: 8px; padding: 10px 12px 8px; }
    .hd h3 { margin: 0; font-size: 13px; font-weight: 650; letter-spacing: .01em; }
    .hd .sub { color: #9b9793; font-size: 11.5px; }
    .spacer { flex: 1; }
    .clear { background: none; border: 0; color: #8d8985; font: inherit; font-size: 11.5px;
      cursor: pointer; text-decoration: underline; padding: 2px 4px; }
    .clear:hover { color: #d9d6d2; }
    .rows { padding: 0 6px 6px; }
    .row { display: flex; align-items: center; gap: 9px; padding: 7px 7px; border-radius: 9px; }
    .row:hover { background: rgba(255,255,255,.045); }
    .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
    .nm { font-weight: 600; font-size: 12.5px; white-space: nowrap; }
    .meta { color: #9b9793; font-size: 11.5px; margin-left: auto; white-space: nowrap; text-align: right; }
    .meta.good { color: #6fd18a; }
    .meta.bad { color: #f0a4a4; }
    .meta.warn { color: #ecc07a; }
    .open { display: flex; align-items: center; gap: 12px; }
    .rowbtn { background: none; border: 0; color: #7fd39a; font: inherit; font-size: 12px;
      font-weight: 600; cursor: pointer; padding: 2px 4px; }
    .rowbtn:hover { text-decoration: underline; }
    .rowbtn:disabled { color: #6b6763; cursor: default; text-decoration: none; }
    .launcher {
      display: flex; align-items: center; gap: 9px; background: rgba(17,17,19,.94);
      border: 1px solid rgba(255,255,255,.11); border-radius: 999px; padding: 7px 13px 7px 10px;
      cursor: pointer; box-shadow: 0 8px 22px rgba(0,0,0,.4); color: #f2efe9; font-weight: 620;
      font-size: 12.5px; backdrop-filter: blur(10px);
      /* The pill is a <button>, so the corner is reachable by keyboard; buttons do not
         inherit the font, and a pill in the system font next to our own text shows it. */
      font-family: inherit; text-align: left;
    }
    .launcher:hover { background: rgba(28,28,31,.97); border-color: rgba(255,255,255,.2); }
    .launcher[data-off="1"] { opacity: .55; }
    .dock { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
    /* On the hover, not in the flow: the corner stays one small pill until somebody asks
       what is behind it. The data-open exception is a press that was refused, which pins the
       card open for as long as the refusal is on screen, so the reason and the list land
       together the first time without anybody having to know to hover first. */
    .overview { display: none; }
    .dock:hover .overview, .dock:focus-within .overview, .dock[data-open="1"] .overview { display: block; }
    .ov { padding: 10px 12px 4px; }
    .ov-title { font-size: 12.5px; font-weight: 660; margin: 0 0 2px; }
    .ov-sub { color: #9b9793; font-size: 11.5px; }
    .ov-rows { padding: 2px 6px 8px; }
    .ov-row { display: flex; align-items: center; gap: 9px; padding: 4px 7px; border-radius: 8px; }
    .ov-row[data-on="0"] { opacity: .5; }
    .ov-row .nm { font-size: 12px; }
    .ov-row .meta { font-size: 11.5px; }
    .ov-here { color: #7c7873; font-size: 10px; font-weight: 700; letter-spacing: .04em;
      text-transform: uppercase; margin-left: 6px; }
    .ov-actions { padding: 0 12px 11px; }
    .ovbtn { background: #2f7d4f; border: 0; color: #fff; font: inherit; font-size: 11.5px;
      font-weight: 650; border-radius: 8px; padding: 5px 10px; cursor: pointer; }
    .ovbtn:hover { background: #369159; }
    .glyph { width: 16px; height: 16px; flex: none; color: #e8a33d; }
    .pillcount { background: #2f7d4f; color: #fff; border-radius: 999px; font-size: 10.5px;
      min-width: 17px; height: 17px; display: grid; place-items: center; padding: 0 4px; font-weight: 700; }
    .pillcount[data-zero="1"] { background: #3a3a3f; color: #b6b2ae; }
    .toast { background: rgba(17,17,19,.96); border: 1px solid rgba(255,255,255,.12);
      border-left: 2px solid #e8a33d; border-radius: 10px; padding: 9px 28px 9px 12px;
      max-width: 330px; font-size: 12.5px; box-shadow: 0 10px 26px rgba(0,0,0,.45);
      position: relative; }
    .toast.bad { border-left-color: #d2695f; }
    .toast.good { border-left-color: #4ab06e; }
    .tclose { position: absolute; top: 2px; right: 3px; background: none; border: 0;
      color: #8d8985; font: inherit; font-size: 14px; line-height: 1; cursor: pointer;
      padding: 3px 6px; }
    .tclose:hover { color: #d9d6d2; }
    .bar { height: 2px; background: rgba(255,255,255,.08); overflow: hidden; }
    .bar > i { display: block; height: 100%; background: linear-gradient(90deg,#e8a33d,#f0c37a);
      width: 30%; animation: wf-slide 1.35s ease-in-out infinite; }
    @keyframes wf-slide { 0% { margin-left: -30%; } 100% { margin-left: 100%; } }
    @media (prefers-reduced-motion: reduce) { .bar > i { animation: none; width: 100%; opacity: .5; } }
  `;

  const GLYPH = `<svg class="glyph" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9"
        stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`;

  const STATUS_META = {
    queued: { label: 'queued', cls: '' },
    sending: { label: 'sending', cls: '' },
    sent: { label: 'sent', cls: '' },
    streaming: { label: 'answering', cls: '' },
    done: { label: 'answered', cls: 'good' },
    error: { label: 'send failed', cls: 'bad' },
    timeout: { label: 'no answer seen', cls: 'warn' },
    attention: { label: 'needs you', cls: 'warn' },
    skipped: { label: 'skipped', cls: '' },
  };

  const state = {
    doc: null,
    site: null,
    settings: null,
    job: null, // { jobId, targets: [], startedAt, finishedAt }
    answers: [],
    toast: null,
    collapsed: false,
    // What the launcher says about the fan-out: the master switch, the size of the user's
    // list, and how much of that list is reachable right now. See `readOverview`.
    overview: { feature: true, on: 0, reach: 0, rows: [] },
    // The last site records we read, or null before the first read lands.
    statuses: null,
    // How many tabs each AI has open, as the background last said, or null before it answers.
    // This is the one term of the reach a page cannot see for itself — a content script has no
    // `tabs` API, and this page knows about its own tab and nothing else.
    openSites: null,
    // While this is in the future the overview card is held open — see the `.dock` rule.
    cardOpenUntil: 0,
    composerHasText: false,
    handlers: {},
    lingerTimer: null,
    toastTimer: null,
    pollTimer: null,
  };

  let host = null;
  let root = null;
  let sheet = null;
  let unwatchStatuses = null;

  /**
   * Prefer a constructable stylesheet: it is not subject to the page's style-src
   * CSP, which a <style> tag inside the shadow root is. Fall back when unsupported.
   */
  function installStyles() {
    try {
      if (typeof CSSStyleSheet === 'function' && 'replaceSync' in CSSStyleSheet.prototype) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
        root.adoptedStyleSheets = [sheet];
        return;
      }
    } catch (err) {
      /* fall through to a style tag */
    }
    sheet = null;
  }

  function mount(doc) {
    if (host && host.isConnected) return;
    host = doc.createElement('div');
    host.setAttribute('data-wf-overlay', '');
    host.style.cssText = `position:fixed;z-index:${Z};right:0;bottom:0;width:0;height:0;`;
    root = host.attachShadow({ mode: 'open' });
    // One listener per root, attached here rather than in `init`: a launcher that was switched
    // off and on again comes back with a new root, and the old one has to keep exactly one.
    root.addEventListener('click', onClick);
    installStyles();
    doc.documentElement.appendChild(host);
  }

  function siteName(id) {
    const site = WF.sites.byId(id);
    return site ? site.name : id;
  }

  function colorOf(id) {
    const site = WF.sites.byId(id);
    return site ? site.color : '#8d8985';
  }

  function monogram(id) {
    const site = WF.sites.byId(id);
    return site ? site.monogram : '?';
  }

  function targetRow(target, now) {
    const meta = STATUS_META[target.status] || STATUS_META.queued;
    const waited = target.sentAt ? (target.doneAt || now) - target.sentAt : null;
    let detail = meta.label;
    // "first, 6s" for the one that beat the others, "answered in 8s" for the rest.
    if (target.status === 'done' && waited !== null) {
      detail = target.first ? `first, ${U.humanShort(waited)}` : `answered in ${U.humanShort(waited)}`;
    }
    else if (target.attention) detail = WF.attentionLabel(target.attention);
    else if (target.error) detail = target.error;
    else if (target.status === 'streaming' && waited !== null) detail = `${U.humanShort(waited)} so far`;

    return `<div class="row" data-site="${U.escapeHtml(target.siteId)}">
        <span class="dot" style="background:${colorOf(target.siteId)}"></span>
        <span class="nm">${U.escapeHtml(siteName(target.siteId))}</span>
        <span class="meta ${meta.cls}">${U.escapeHtml(detail)}</span>
      </div>`;
  }

  function answerRow(answer, now) {
    return `<div class="row open">
        <span class="dot" style="background:${colorOf(answer.siteId)}"></span>
        <span>
          <span class="nm">${U.escapeHtml(siteName(answer.siteId))} has answered</span><br>
          <span class="sub">Ready after ${U.humanShort(answer.waitedMs)} · ${U.relativeTime(answer.readyAt, now)}</span>
        </span>
        <span class="spacer"></span>
        <button class="rowbtn" data-action="open" data-answer="${U.escapeHtml(answer.id)}">Open →</button>
      </div>`;
  }

  function render() {
    if (!root) return;
    const now = Date.now();
    // Past its deadline is past it, whatever the timer got up to while the tab was in the
    // background: a render never draws a message that has already expired.
    if (state.toast && now >= state.toast.expiresAt) state.toast = null;
    const job = state.job;
    const parts = [];

    if (state.answers.length) {
      parts.push(`<div class="card">
        <div class="hd">
          <h3>Answers ready <span class="pillcount">${state.answers.length}</span></h3>
          <span class="spacer"></span>
          <button class="clear" data-action="clear">Clear</button>
        </div>
        <div class="sub" style="padding:0 12px 6px;color:#9b9793;font-size:11.5px">Click one to go to that tab.</div>
        <div class="rows">${state.answers.map((a) => answerRow(a, now)).join('')}</div>
      </div>`);
    }

    if (job && (job.targets.length || job.running)) {
      const doneCount = job.targets.filter((t) => t.status === 'done').length;
      const title = job.running
        ? `Sent to ${job.targets.length} AI${job.targets.length === 1 ? '' : 's'}`
        : doneCount === job.targets.length
          ? 'All answers are in'
          : `${doneCount} of ${job.targets.length} answered`;
      parts.push(`<div class="card">
        <div class="hd">
          <h3>${U.escapeHtml(title)}</h3>
          <span class="spacer"></span>
          <button class="clear" data-action="dismiss-job">Hide</button>
        </div>
        <div class="rows">${job.targets.map((t) => targetRow(t, now)).join('')}</div>
        ${job.running ? '<div class="bar"><i></i></div>' : ''}
      </div>`);
    }

    if (state.toast) {
      parts.push(`<div class="toast ${state.toast.kind || ''}"><button class="tclose" type="button" data-action="dismiss-toast" aria-label="Dismiss">×</button>${U.escapeHtml(state.toast.message)}</div>`);
    }

    parts.push(launcher());

    root.innerHTML = `${sheet ? '' : `<style>${CSS}</style>`}<div class="root">${parts.join('')}</div>`;
  }

  /**
   * The corner: one pill saying what a press sends, and the card behind it.
   *
   * The label is the answer to the only question the pill is ever asked — how much of my list
   * will this reach — so it is the reach and not the size of the list, and the reasons a press
   * would be refused (nothing switched on, nothing sent yet) are said here rather than only
   * after the press.
   */
  function launcher() {
    const o = state.overview;
    const label = !o.feature
      ? 'WhileFree is off'
      : !state.composerHasText
        ? 'Type a prompt first'
        : o.on === 0
          ? 'No AI switched on'
          : o.reach === o.on
            ? `Ask all ${o.on}`
            : `Ask ${o.reach} of ${o.on}`;
    // The card's own sentence, folded into the tooltip's: one wording for one fact, rather than
    // a second guess at why the reach is short.
    const missing = WF.reach.fold(o.detail);
    const title = !o.feature
      ? 'WhileFree is switched off. Nothing is sent. Turn it on in the popup.'
      : !state.composerHasText
        ? 'Type your prompt in this page first, then press Ask all.'
        : o.on === 0
          ? 'No AI is switched on. Pick the ones you use in the popup.'
          : o.reach === 0
            ? `Nothing can be sent yet: ${missing}.`
            : o.reach === o.on
              ? `Send this prompt to all ${o.on} AIs you switched on.`
              : `Send this prompt to the ${o.reach} of ${o.on} AIs that can take it now. The rest are skipped.`;
    // Dimmed means this press sends nothing, so the pill and the refusal it would earn never
    // look like different opinions.
    const ready = o.feature && state.composerHasText && o.reach > 0;
    return `<div class="dock" data-open="${state.cardOpenUntil > Date.now() ? '1' : '0'}">
        ${overviewCard()}
        <button class="launcher" type="button" data-off="${ready ? '0' : '1'}" data-action="broadcast" title="${U.escapeHtml(title)}">
          ${GLYPH}<span>${U.escapeHtml(label)}</span>
          <span class="pillcount" data-zero="${state.answers.length ? '0' : '1'}">${state.answers.length}</span>
        </button>
      </div>`;
  }

  /**
   * The overview: who is in, who is skipped, and why.
   *
   * Written in the popup's own words on purpose. A user comparing the corner with the popup is
   * comparing two readings of one fact, and the moment the sentences differ the fact looks
   * doubtful — which is the opposite of what an overview is for.
   */
  function overviewCard() {
    const o = state.overview;
    if (!o.rows.length) return '';
    // The heading and the sub-line are the popup's summary split in two, from the same rule and
    // the same sentence (`lib/reach.js`): a user comparing the corner with the panel is comparing
    // two readings of one fact, and the moment the sentences differ the fact looks doubtful.
    const title = !o.feature ? 'WhileFree is off' : o.title || 'No AI switched on yet';
    const sub = !o.feature
      ? 'Nothing is sent anywhere while it is off.'
      : o.detail
        ? `${o.detail}.`
        : 'Pick the AIs you use in the popup.';
    const rows = o.rows
      .map((row) => {
        // The same questions in the same order as the popup's rows, with the same words: what the
        // page is asking for beats the switch, an AI that is off reads as off, then what its page
        // last said — and last the one thing that is about tabs rather than about the page, since
        // a signed-in AI with no tab open is a place this press does not land.
        let stateText;
        let cls;
        if (row.attention) {
          stateText = WF.attentionLabel(row.attention);
          cls = 'warn';
        } else if (!row.on) {
          stateText = 'off';
          cls = '';
        } else if (!row.verified) {
          stateText = 'not checked yet';
          cls = 'warn';
        } else if (row.open) {
          stateText = 'signed in';
          cls = 'good';
        } else {
          stateText = 'closed';
          cls = '';
        }
        const here = state.site && row.id === state.site.id ? '<span class="ov-here">this page</span>' : '';
        return `<div class="ov-row" data-on="${row.on ? '1' : '0'}">
            <span class="dot" style="background:${row.color}"></span>
            <span class="nm">${U.escapeHtml(row.name)}${here}</span>
            <span class="meta ${cls}">${U.escapeHtml(stateText)}</span>
          </div>`;
      })
      .join('');
    // The one state the card can fix without leaving the page: the master switch lives in the
    // popup, and it is offered here as turn-*on* only. A corner control that could stop every
    // send is a control nobody means to press, and stopping is a deliberate act that belongs
    // where the rest of the list is. An empty list is not fixable from here — the switches are
    // in the popup — so that state gets the sentence and no button.
    const actions = !o.feature
      ? '<div class="ov-actions"><button class="ovbtn" type="button" data-action="turn-on">Turn WhileFree on</button></div>'
      : '';
    return `<div class="card overview">
        <div class="ov">
          <div class="ov-title">${U.escapeHtml(title)}</div>
          <div class="ov-sub">${U.escapeHtml(sub)}</div>
        </div>
        <div class="ov-rows">${rows}</div>
        ${actions}
      </div>`;
  }

  /**
   * What a press of the pill would actually reach, worked out the way the popup works it out.
   *
   * The pill used to count the AIs the user had switched on, which is the *list* and not the
   * reach: ten switches on and none of them signed in is a real state on a fresh install, and a
   * corner promising "Ask all 10" over it is a promise the send will not keep. `on && verified`
   * was the next answer and it was still one term short: with tab-opening off — the default — a
   * signed-in AI with no tab open is skipped with `no tab open`, so the corner was promising one
   * AI more than the press would reach while the popup's own row for it said *closed*. The three
   * terms and the sentence are `lib/reach.js`, read by this card and by the popup's summary, and
   * they are the same conjunction `broadcast` gates on — so the corner, the panel and the send
   * cannot come to different conclusions about a number the user is being asked to trust.
   */
  function readOverview(settings, statuses, openSites) {
    const on = (settings && settings.enabledSites) || [];
    // Until the background answers, "closed" is not something this page knows: an unanswered
    // question is not evidence of a closed tab, so the rows are drawn as open and the count falls
    // back to the two terms both sides can see for themselves. The ask is awaited before the
    // first paint, so this is the repair path — a background that never answers — and never the
    // normal one.
    const counts = openSites && typeof openSites === 'object' ? openSites : null;
    const rows = WF.sites.list().map((site) => {
      const status = statuses ? statuses[site.id] : null;
      return {
        id: site.id,
        name: site.name,
        color: site.color,
        on: on.indexOf(site.id) !== -1,
        verified: WF.status.isVerified(status),
        open: counts ? (Number(counts[site.id]) || 0) > 0 : true,
        // A fresh "needs you" is the reason the AI is out, and in this direction there is no
        // second reading to soften it with, so it is shown instead of "not checked yet".
        attention: WF.status.attentionIsFresh(status) ? status.attention : null,
      };
    });
    const summary = WF.reach.summarize(rows, {
      autoOpenTabs: settings ? settings.autoOpenTabs : undefined,
    });
    return {
      feature: !settings || settings.broadcastEnabled !== false,
      on: summary.on,
      reach: summary.reach,
      title: summary.title,
      detail: summary.detail,
      rows,
    };
  }

  /** Redraw only if a reader would see a difference — this runs on every storage write. */
  function applyOverview() {
    const next = readOverview(state.settings, state.statuses, state.openSites);
    const was = state.overview;
    const same =
      next.feature === was.feature &&
      next.on === was.on &&
      next.reach === was.reach &&
      next.title === was.title &&
      next.detail === was.detail &&
      next.rows.length === was.rows.length &&
      next.rows.every((row, i) => {
        const before = was.rows[i];
        return (
          before &&
          before.id === row.id &&
          before.on === row.on &&
          before.verified === row.verified &&
          before.open === row.open &&
          before.attention === row.attention
        );
      });
    state.overview = next;
    if (!same) render();
  }

  /**
   * The tab half of the reach, from the background.
   *
   * One shape, two directions: the background pushes it when the set of open AIs changes, and it
   * answers the ask below with the same object. Both land here, so there is one place that decides
   * what the corner does with the answer.
   */
  function setOpenSites(open) {
    state.openSites = open && typeof open === 'object' ? open : null;
    applyOverview();
  }

  /** Ask which AIs have a tab open. Asked when it can have changed, never on a clock. */
  async function refreshOpenSites() {
    const res = await WF.browser.send({ type: WF.MSG.OPEN_SITES });
    if (res && res.open) setOpenSites(res.open);
  }

  /**
   * Follow the site records.
   *
   * `wf:site-status` is written by every AI page, this one included, and it is the only thing
   * behind the reach count. A page that has just announced it is signed in has to move the
   * number in the corner without a reload, or the corner is a claim about the last time anybody
   * looked. Deliberately not the settings key: the background pushes those to the open AI tabs
   * on every write, and one source per fact is what keeps the two from disagreeing.
   */
  function watchStatuses() {
    const api = WF.browser.api;
    if (!api || !api.storage || !api.storage.onChanged) return;
    const listener = (changes, area) => {
      if (area !== 'local') return;
      const change = changes[WF.storage.KEYS.siteStatus];
      if (!change) return;
      state.statuses = change.newValue && typeof change.newValue === 'object' ? change.newValue : {};
      applyOverview();
    };
    api.storage.onChanged.addListener(listener);
    unwatchStatuses = () => api.storage.onChanged.removeListener(listener);
  }

  function setSettings(settings) {
    state.settings = settings;
    state.overview = readOverview(settings, state.statuses, state.openSites);
    render();
  }

  function setComposerHasText(hasText, hasComposer) {
    const next = !!hasText && hasComposer !== false;
    if (next === state.composerHasText) return;
    state.composerHasText = next;
    render();
  }

  function jobStarted(job) {
    if (state.lingerTimer) clearTimeout(state.lingerTimer);
    state.job = {
      jobId: job.jobId,
      running: true,
      targets: (job.targets || []).map((siteId) => ({
        siteId,
        status: 'queued',
        sentAt: null,
        doneAt: null,
      })),
    };
    render();
  }

  function targetUpdate(siteId, patch) {
    if (!state.job) return;
    const row = state.job.targets.find((t) => t.siteId === siteId);
    if (!row) return;
    Object.assign(row, patch);
    if (patch.status === 'sent' && !row.sentAt) row.sentAt = Date.now();
    if ((patch.status === 'done' || patch.status === 'error' || patch.status === 'timeout') && !row.doneAt) {
      // Decide "first" before stamping doneAt, or this row wins its own race.
      if (patch.status === 'done') {
        row.first = !state.job.targets.some((other) => other !== row && other.doneAt);
      }
      row.doneAt = Date.now();
    }
    render();
  }

  function jobFinished() {
    if (!state.job) return;
    state.job.running = false;
    render();
    scheduleLinger();
  }

  function scheduleLinger() {
    if (state.lingerTimer) clearTimeout(state.lingerTimer);
    state.lingerTimer = setTimeout(() => {
      state.job = null;
      render();
    }, LINGER_MS);
  }

  function setAnswers(list) {
    state.answers = Array.isArray(list) ? list : [];
    render();
  }

  function toast(message, kind, ttl, options) {
    const ms = ttl || 6000;
    state.toast = { message, kind, expiresAt: Date.now() + ms };
    // `card`: hold the overview open for exactly as long as the message is up. A press that was
    // refused is the one moment the card is worth showing unprompted — the reason and the list
    // it is about land together, and nobody has to know to hover first.
    if (options && options.card) state.cardOpenUntil = state.toast.expiresAt;
    render();
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      state.toast = null;
      render();
    }, ms);
  }

  /**
   * Drop a toast that is past its deadline, and re-draw.
   *
   * The timer in `toast` is the fast path to the same thing, and it is the one thing a message
   * may not depend on: a background tab throttles timers towards "eventually", which is how a
   * "turn WhileFree on" nag is still on screen after WhileFree was turned on. The deadline is
   * the promise; every render enforces it too, so the sweep only has to run when the page is
   * worth looking at.
   */
  function sweepToast() {
    if (!state.toast || Date.now() < state.toast.expiresAt) return;
    state.toast = null;
    render();
  }

  /** Take it away now: the one control a toast may never leave the user without. */
  function dismissToast() {
    if (!state.toast) return;
    state.toast = null;
    state.cardOpenUntil = 0;
    if (state.toastTimer) clearTimeout(state.toastTimer);
    render();
  }

  /** A soft rising two-note chime, synthesised so no audio file has to ship. */
  function chime(volume) {
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!Ctx) return false;
    try {
      const ctx = (chime.ctx = chime.ctx || new Ctx());
      if (ctx.state === 'suspended') ctx.resume();
      const vol = U.clamp(volume === undefined ? 0.4 : volume, 0, 1) * 0.35;
      const now = ctx.currentTime + 0.01;
      const notes = [
        { freq: 880.0, at: 0 },
        { freq: 1174.66, at: 0.15 },
      ];
      for (const note of notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = note.freq;
        const start = now + note.at;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(vol, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.6);
      }
      return true;
    } catch (err) {
      return false;
    }
  }

  function onClick(event) {
    const el = event.target && event.target.closest ? event.target.closest('[data-action]') : null;
    if (!el) return;
    const action = el.getAttribute('data-action');
    if (action === 'broadcast') {
      if (!state.composerHasText) {
        toast('Type your prompt in this page first, then press Ask all.', '');
        return;
      }
      state.handlers.onBroadcast && state.handlers.onBroadcast();
    } else if (action === 'dismiss-toast') {
      dismissToast();
    } else if (action === 'turn-on') {
      state.handlers.onTurnOn && state.handlers.onTurnOn();
    } else if (action === 'open') {
      state.handlers.onOpenAnswer && state.handlers.onOpenAnswer(el.getAttribute('data-answer'));
    } else if (action === 'clear') {
      state.handlers.onClearAnswers && state.handlers.onClearAnswers();
    } else if (action === 'dismiss-job') {
      state.job = null;
      render();
    }
  }

  function onVisibility() {
    if (!state.doc || state.doc.hidden) return;
    sweepToast();
    // Coming back to a page is the moment its number is read, and tabs can have opened or closed
    // while it was hidden — a detour to another window is exactly when that happens.
    refreshOpenSites();
  }

  async function init({ doc, site, settings, handlers }) {
    state.doc = doc;
    state.site = site;
    state.handlers = handlers || {};
    mount(doc);
    // One storage read, awaited, so the corner's first paint is the real number instead of a
    // zero that corrects itself a frame later. A second init (the launcher switched off and on
    // again) replaces the subscription rather than adding a second one.
    if (unwatchStatuses) {
      unwatchStatuses();
      unwatchStatuses = null;
    }
    try {
      state.statuses = await WF.storage.getSiteStatus();
    } catch (err) {
      state.statuses = null;
    }
    // Awaited for the same reason the read above is: a pill that has to correct itself one frame
    // later is a pill that was wrong, and this one has a promise in it.
    await refreshOpenSites();
    watchStatuses();
    doc.addEventListener('visibilitychange', onVisibility);
    setSettings(settings);
    // The launcher doubles as a prompt-state indicator, so it watches the box — but on
    // a slower clock, and never out of sight. Once a second, on every AI page, means
    // reading the whole document and its computed styles every second to learn that a
    // light has not changed; twice a second slower is not something anyone can see, and
    // a hidden tab has nobody to show it to. The same tick is when an expired toast is
    // swept, which is why a message needs no clock of its own.
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(() => {
      if (!state.doc || state.doc.hidden) return;
      sweepToast();
      const composer = WF.dom.findComposer(state.doc, state.site);
      const text = composer ? WF.dom.normalize(WF.dom.composerText(composer)) : '';
      setComposerHasText(text.length > 0, !!composer);
    }, 2500);
    render();
  }

  /** Is the launcher in the page right now? Asked when a setting that removes it is put back. */
  function mounted() {
    return !!(host && host.isConnected && root);
  }

  function destroy() {
    if (unwatchStatuses) unwatchStatuses();
    unwatchStatuses = null;
    if (state.toastTimer) clearTimeout(state.toastTimer);
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = null;
    state.toast = null;
    state.cardOpenUntil = 0;
    if (state.doc) state.doc.removeEventListener('visibilitychange', onVisibility);
    state.doc = null;
    if (host && host.parentElement) host.parentElement.removeChild(host);
    host = null;
    root = null;
  }

  content.overlay = {
    init,
    destroy,
    mounted,
    render,
    setSettings,
    setComposerHasText,
    jobStarted,
    targetUpdate,
    jobFinished,
    setAnswers,
    setOpenSites,
    toast,
    chime,
    state,
  };
})();
