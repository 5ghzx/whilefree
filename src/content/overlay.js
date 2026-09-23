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
    }
    .launcher:hover { background: rgba(28,28,31,.97); border-color: rgba(255,255,255,.2); }
    .launcher[data-off="1"] { opacity: .55; }
    .glyph { width: 16px; height: 16px; flex: none; color: #e8a33d; }
    .pillcount { background: #2f7d4f; color: #fff; border-radius: 999px; font-size: 10.5px;
      min-width: 17px; height: 17px; display: grid; place-items: center; padding: 0 4px; font-weight: 700; }
    .pillcount[data-zero="1"] { background: #3a3a3f; color: #b6b2ae; }
    .toast { background: rgba(17,17,19,.96); border: 1px solid rgba(255,255,255,.12);
      border-left: 2px solid #e8a33d; border-radius: 10px; padding: 9px 12px; max-width: 330px;
      font-size: 12.5px; box-shadow: 0 10px 26px rgba(0,0,0,.45); }
    .toast.bad { border-left-color: #d2695f; }
    .toast.good { border-left-color: #4ab06e; }
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
    enabledCount: 0,
    composerHasText: false,
    handlers: {},
    lingerTimer: null,
    toastTimer: null,
  };

  let host = null;
  let root = null;
  let sheet = null;

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
    if (target.status === 'done' && waited !== null) detail = `answered in ${U.humanShort(waited)}`;
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
      parts.push(`<div class="toast ${state.toast.kind || ''}">${U.escapeHtml(state.toast.message)}</div>`);
    }

    const off = state.composerHasText ? '0' : '1';
    const label = state.composerHasText
      ? `Ask all ${state.enabledCount}`
      : 'Type a prompt first';
    parts.push(`<div class="launcher" data-off="${off}" data-action="broadcast" title="Send this prompt to every AI you switched on">
        ${GLYPH}<span>${U.escapeHtml(label)}</span>
        <span class="pillcount" data-zero="${state.answers.length ? '0' : '1'}">${state.answers.length}</span>
      </div>`);

    root.innerHTML = `${sheet ? '' : `<style>${CSS}</style>`}<div class="root">${parts.join('')}</div>`;
  }

  function setSettings(settings) {
    state.settings = settings;
    state.enabledCount = (settings.enabledSites || []).length;
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

  function toast(message, kind, ttl) {
    state.toast = { message, kind };
    render();
    if (state.toastTimer) clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => {
      state.toast = null;
      render();
    }, ttl || 6000);
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
    } else if (action === 'open') {
      state.handlers.onOpenAnswer && state.handlers.onOpenAnswer(el.getAttribute('data-answer'));
    } else if (action === 'clear') {
      state.handlers.onClearAnswers && state.handlers.onClearAnswers();
    } else if (action === 'dismiss-job') {
      state.job = null;
      render();
    }
  }

  function init({ doc, site, settings, handlers }) {
    state.doc = doc;
    state.site = site;
    state.handlers = handlers || {};
    mount(doc);
    root.addEventListener('click', onClick);
    setSettings(settings);
    // The launcher doubles as a prompt-state indicator, so poll the box.
    setInterval(() => {
      if (!state.doc) return;
      const composer = WF.dom.findComposer(state.doc, state.site);
      const text = composer ? WF.dom.normalize(WF.dom.composerText(composer)) : '';
      setComposerHasText(text.length > 0, !!composer);
    }, 1000);
    render();
  }

  function destroy() {
    if (host && host.parentElement) host.parentElement.removeChild(host);
    host = null;
    root = null;
  }

  content.overlay = {
    init,
    destroy,
    render,
    setSettings,
    setComposerHasText,
    jobStarted,
    targetUpdate,
    jobFinished,
    setAnswers,
    toast,
    chime,
    state,
  };
})();
