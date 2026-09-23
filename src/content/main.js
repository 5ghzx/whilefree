/**
 * Content-script bootstrap: run on the five AI sites, wire the pieces together,
 * and be the page's side of the message contract.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});
  const content = (WF.content = WF.content || {});

  if (content.booted) return; // survives double injection
  content.booted = true;

  const site = WF.sites.fromUrl(globalThis.location && globalThis.location.href);
  if (!site) return;

  let settings = WF.settings.normalize({});
  let watcher = null;
  let lastHref = globalThis.location.href;
  let ready = false;
  let statusSentAt = 0;

  const now = () => Date.now();

  // ---------------------------------------------------------------------------
  // Reporting
  // ---------------------------------------------------------------------------

  function reportWarning(message, siteArg) {
    const target = siteArg || site;
    WF.browser.send({
      type: WF.MSG.SITE_STATUS,
      siteId: target.id,
      attention: null,
      warning: String(message).slice(0, 200),
    });
  }

  function reportStatus(attention) {
    statusSentAt = now();
    const composer = WF.dom.findComposer(document, site);
    WF.browser.send({
      type: WF.MSG.SITE_STATUS,
      siteId: site.id,
      attention: attention || null,
      hasComposer: !!composer,
      url: globalThis.location.href,
    });
  }

  function evaluateStatus() {
    const composer = WF.dom.findComposer(document, site);
    const attention = WF.dom.detectAttention(document, site, globalThis.location.href, !!composer);
    if (attention && attention.reason !== WF.ATTENTION.NO_COMPOSER) {
      reportStatus(attention);
      content.overlay.toast(`${site.name} needs you: ${WF.attentionLabel(attention.reason)}.`, 'bad', 9000);
      return attention;
    }
    reportStatus(null);
    return null;
  }

  async function onPhase(payload) {
    if (payload.phase === WF.PHASE.DONE) {
      content.tracker.markAnswerDone(payload);
    }
    if (payload.phase === WF.PHASE.ATTENTION && payload.attention) {
      content.overlay.toast(`${site.name} needs you: ${WF.attentionLabel(payload.attention.reason)}.`, 'bad', 9000);
    }
    if (payload.phase === WF.PHASE.ERROR) {
      content.overlay.toast(`${site.name}: no answer appeared. The site may have changed.`, 'bad', 9000);
    }
    await WF.browser.send({ type: WF.MSG.STATE, ...payload });
  }

  function startWatcher(jobId) {
    if (watcher) watcher.stop('superseded');
    watcher = new WF.content.detect.AnswerWatcher({
      doc: document,
      site,
      jobId,
      onPhase,
    });
    const sentAt = watcher.start();
    WF.browser.send({
      type: WF.MSG.STATE,
      jobId,
      siteId: site.id,
      phase: WF.PHASE.SENT,
      sentAt,
      firstWordAt: null,
      doneAt: null,
      awayMs: 0,
    });
    return sentAt;
  }

  // ---------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------

  async function handleSend(msg) {
    const prompt = msg.prompt;
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return { ok: false, reason: 'empty' };
    }

    content.tracker.markProgrammatic(8000);
    const result = await content.composer.sendPrompt({ doc: document, site, prompt, settings });

    if (!result.ok) {
      const reason = result.reason || WF.ATTENTION.SEND_FAILED;
      reportStatus(reason === WF.ATTENTION.NO_COMPOSER ? { reason } : null);
      content.overlay.toast(`${site.name}: ${WF.attentionLabel(reason)}.`, 'bad', 9000);
      content.tracker.markProgrammatic(0);
      return { ok: false, reason, diagnostic: result.diagnostic };
    }

    const sentAt = startWatcher(msg.jobId);
    content.tracker.markPromptSent();
    content.tracker.markInFlight(msg.jobId, sentAt, 'broadcast');
    return { ok: true, method: result.method, via: result.via, sentAt };
  }

  /** "Ask all N" from the launcher: read this page's box, hand it to the background. */
  async function broadcastHere() {
    const composer = WF.dom.findComposer(document, site);
    const prompt = composer ? WF.dom.composerText(composer) : '';
    if (!prompt.trim()) {
      content.overlay.toast('Type your prompt in this page first, then press Ask all.', '', 6000);
      return;
    }
    const response = await WF.browser.send({
      type: WF.MSG.BROADCAST,
      prompt,
      originSiteId: site.id,
      originUrl: globalThis.location.href,
    });
    if (!response || response.error || !response.ok) {
      content.overlay.toast(
        (response && (response.error || response.reason)) || 'Could not start the broadcast.',
        'bad',
        8000
      );
      return;
    }
    if (!response.targets || !response.targets.length) {
      content.overlay.toast('No other AI is switched on. Pick some in the popup.', '', 7000);
      return;
    }
    if (response.queued) {
      content.overlay.toast('Queued: another prompt is still going out.', '', 6000);
    }
  }

  // ---------------------------------------------------------------------------
  // The user's own sends still get timed
  // ---------------------------------------------------------------------------

  async function maybeTimeUserSend(trigger) {
    if (!ready) return;
    const info = await content.tracker.detectUserSend(trigger);
    if (!info) return;
    startWatcher(info.jobId);
    content.tracker.markPromptSent();
    content.tracker.markInFlight(info.jobId, info.sentAt, 'user');
    WF.browser.send({
      type: WF.MSG.STATE,
      jobId: info.jobId,
      siteId: site.id,
      phase: WF.PHASE.SENT,
      sentAt: info.sentAt,
      firstWordAt: null,
      doneAt: null,
      awayMs: 0,
      origin: 'user',
    });
  }

  function onKeydown(event) {
    if (!event.isTrusted || event.key !== 'Enter' || event.shiftKey || event.altKey) return;
    if (event.ctrlKey || event.metaKey) return;
    const composer = WF.dom.findComposer(document, site);
    if (!composer) return;
    if (event.target !== composer && !composer.contains(event.target)) return;
    maybeTimeUserSend('enter');
  }

  function onClick(event) {
    if (!event.isTrusted) return;
    const node = event.target;
    if (!node || !node.closest) return;
    const control = node.closest('button, [role="button"]');
    if (!control) return;
    const composer = WF.dom.findComposer(document, site);
    if (!composer) return;
    const isSend =
      WF.dom.pick(document, site.send.selectors) === control ||
      /(^|\b)(send|submit)(\b|$)/i.test(WF.dom.labelOf(control));
    if (!isSend) return;
    maybeTimeUserSend('click');
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  WF.browser.onMessage(async (msg) => {
    if (!msg || !msg.type) return undefined;

    switch (msg.type) {
      case WF.MSG.PING:
        return {
          ok: true,
          siteId: site.id,
          url: globalThis.location.href,
          hasComposer: !!WF.dom.findComposer(document, site),
        };

      case WF.MSG.SEND:
        return handleSend(msg);

      case WF.MSG.TEST_TARGET:
        return { ok: true, diagnostic: WF.dom.diagnose(document, site, globalThis.location.href) };

      case WF.MSG.CHIME:
        return { ok: content.overlay.chime(msg.volume) };

      case WF.MSG.ANSWERS:
        content.overlay.setAnswers(msg.answers || []);
        return { ok: true };

      case WF.MSG.JOB:
        if (msg.job) content.overlay.jobStarted(msg.job);
        return { ok: true };

      case WF.MSG.JOB_TARGET:
        content.overlay.targetUpdate(msg.siteId, msg.patch || {});
        return { ok: true };

      case WF.MSG.CANCEL_JOB:
        if (watcher) watcher.stop('cancelled');
        return { ok: true };

      case WF.MSG.SETTINGS_CHANGED:
        settings = msg.settings ? WF.settings.normalize(msg.settings) : await WF.storage.getSettings();
        content.overlay.setSettings(settings);
        if (!settings.overlayEnabled) content.overlay.destroy();
        return { ok: true };

      default:
        return undefined;
    }
  });

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  async function boot() {
    settings = await WF.storage.getSettings();

    content.tracker.attach(document, site, settings);

    if (settings.overlayEnabled !== false) {
      content.overlay.init({
        doc: document,
        site,
        settings,
        handlers: {
          onBroadcast: broadcastHere,
          onOpenAnswer: (answerId) => WF.browser.send({ type: WF.MSG.OPEN_ANSWER, answerId }),
          onClearAnswers: async () => {
            const res = await WF.browser.send({ type: 'wf:clear-answers' });
            if (res && res.answers) content.overlay.setAnswers(res.answers);
          },
        },
      });
    }

    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('click', onClick, true);

    // Hello early so the background can talk to us, then say what we really found
    // once a slow single-page app has finished drawing its composer.
    await WF.browser.send({
      type: WF.MSG.HELLO,
      siteId: site.id,
      url: globalThis.location.href,
      hasComposer: !!WF.dom.findComposer(document, site),
    });
    ready = true;

    setTimeout(() => evaluateStatus(), 2500);
    setInterval(evaluateStatus, 60000);

    // Single-page navigation: a new conversation means a fresh status.
    setInterval(() => {
      if (globalThis.location.href === lastHref) return;
      lastHref = globalThis.location.href;
      if (watcher) watcher.stop('navigated');
      WF.browser.send({
        type: WF.MSG.HELLO,
        siteId: site.id,
        url: lastHref,
        hasComposer: !!WF.dom.findComposer(document, site),
      });
      setTimeout(evaluateStatus, 1500);
    }, 800);
  }

  content.reportWarning = reportWarning;
  content.broadcastHere = broadcastHere;
  content.startWatcher = startWatcher;
  content.unload = () => {
    content.tracker.flush();
    content.tracker.detach();
  };

  globalThis.addEventListener('pagehide', () => content.unload());

  boot();
})();
