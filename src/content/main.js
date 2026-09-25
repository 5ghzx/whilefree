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
  let net = null;
  let lastHref = globalThis.location.href;
  let ready = false;
  let dormant = false;
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
    // The settled reading, not the raw one: this is the loop that writes the site list, and a
    // verdict read off a page mid-hydration is how an AI the user is signed in to ends up
    // parked at "Signed out" until they go and argue with a switch.
    return content.composer
      .settledAttention(document, site, globalThis.location.href, !!composer)
      .then((attention) => {
        if (attention && attention.reason !== WF.ATTENTION.NO_COMPOSER) {
          reportStatus(attention);
          content.overlay.toast(`${site.name} needs you: ${WF.attentionLabel(attention.reason)}.`, 'bad', 9000);
          return attention;
        }
        reportStatus(null);
        return null;
      });
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

  function startWatcher(jobId, submittedAt) {
    if (watcher) watcher.stop('superseded');
    watcher = new WF.content.detect.AnswerWatcher({
      doc: document,
      site,
      jobId,
      onPhase,
    });
    // The press that sent it, not the moment the press was confirmed.
    const sentAt = watcher.start(submittedAt);
    WF.browser.send({
      type: WF.MSG.STATE,
      jobId,
      siteId: site.id,
      phase: WF.PHASE.SENT,
      sentAt,
      firstWordAt: null,
      doneAt: null,
      awayMs: 0,
      // Which model is on the other end, read from the page's switcher. A label.
      model: watcher.model || null,
      origin: 'broadcast',
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
      // The page's own verdict goes back with the failure. A refusal that came from the
      // page — signed out, out of quota, a check, no message box — is the page telling the
      // background what it is showing, and the background can only act on that if it is
      // told. A press that merely did not take (`send-failed`) is not reported that way: a
      // single bad press is not evidence that the site needs a human.
      reportStatus(reason === WF.ATTENTION.SEND_FAILED ? null : { reason });
      content.overlay.toast(`${site.name}: ${WF.attentionLabel(reason)}.`, 'bad', 9000);
      content.tracker.markProgrammatic(0);
      return { ok: false, reason, diagnostic: result.diagnostic };
    }

    const sentAt = startWatcher(msg.jobId, result.submittedAt);
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
      const reason = response && (response.error || response.reason);
      const message =
        reason === 'off'
          ? 'WhileFree is switched off. Turn it on in the popup.'
          : reason === 'no-verified-targets'
            ? 'Nothing sent. Open the popup and switch an AI on.'
            : reason === 'no-targets'
              ? 'No AI is switched on. Pick some in the popup.'
              : reason || 'Could not start the broadcast.';
      content.overlay.toast(message, 'bad', 9000);
      return;
    }
    if (!response.targets || !response.targets.length) {
      content.overlay.toast('No AI is switched on. Pick some in the popup.', '', 7000);
      return;
    }
  }

  // ---------------------------------------------------------------------------
  // The user's own sends still get timed
  // ---------------------------------------------------------------------------

  async function maybeTimeUserSend(trigger) {
    if (!ready) return;
    const info = await content.tracker.detectUserSend(trigger);
    if (!info) return;
    // A prompt typed by hand is timed from when the page saw it leave, which is what the
    // activity record already holds.
    startWatcher(info.jobId, info.sentAt);
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
    await maybeFanOut(info);
  }

  function siteName(siteId) {
    const found = WF.sites.byId(siteId);
    return found ? found.name : siteId;
  }

  /**
   * You sent a prompt in one AI's own message box. If auto-send is on, the others you
   * have switched on get it too — that is the whole point of the extension, and it
   * should not need a second press.
   *
   * The decision is not made here. The background knows what it delivered itself, so a
   * capture that is really the echo of our own fan-out is dropped there; this side just
   * reports what it saw and shows what happened.
   */
  async function maybeFanOut(info) {
    if (!settings.autoCapture) return;
    if (!info.prompt || !info.hash) return;

    const res = await WF.browser.send({
      type: WF.MSG.CAPTURE,
      siteId: site.id,
      prompt: info.prompt,
      hash: info.hash,
      url: globalThis.location.href,
    });
    if (!res || res.error || res.ok === false) return;
    if (res.echo || res.duplicate) return;

    if (res.blocked && res.blocked.length) {
      const names = res.blocked.map(siteName).join(' and ');
      content.overlay.toast(
        `Nothing sent: ${names} ${res.blocked.length === 1 ? 'is' : 'are'} not ready.`,
        'bad',
        9000
      );
      return;
    }

    const sent = (res.targets || []).length;
    if (sent) {
      content.overlay.toast(`Also sent to ${sent} other AI${sent === 1 ? '' : 's'}.`, 'good', 6000);
    } else if (res.noTargets) {
      content.overlay.toast('No AI is switched on. Pick some in the popup.', '', 7000);
    }
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
      // The cheapest question in the protocol, and the only one asked of every tab before
      // a fan-out types into it. It answers with the page's own live verdict on its session
      // as well as on its message box, because this reply is read at exactly the moment the
      // answer matters: a check from last week says nothing about a session that has ended
      // since, and the send that follows is the one thing that must not be wasted.
      case WF.MSG.PING: {
        const composer = WF.dom.findComposer(document, site);
        const live = await content.composer.settledAttention(
          document,
          site,
          globalThis.location.href,
          !!composer
        );
        // The second reading's composer, because the first one's is 1.5 seconds old and the
        // question "may a prompt go here" is about now.
        const nowComposer = WF.dom.findComposer(document, site);
        const reason = live ? live.reason : null;
        return {
          ok: true,
          siteId: site.id,
          url: globalThis.location.href,
          hasComposer: !!nowComposer,
          signedIn: !!nowComposer && reason !== WF.ATTENTION.SIGNED_OUT,
          attention: reason,
        };
      }

      case WF.MSG.SEND:
        return handleSend(msg);

      // The warm-up. This case is what makes a fan-out work from a page the user is not
      // looking at: the background asks each tab to wait for its own message box, and the
      // wait happens here, in the page, because only the page knows when it has drawn.
      // When the wait is answered with silence the background can only read that as
      // "this site has no message box", which is how every target comes back broken.
      case WF.MSG.READY: {
        const timeout = Math.min(Math.max(Number(msg.timeoutMs) || 15000, 1000), 60000);
        const composer = await content.composer.waitForComposer(document, site, timeout);
        if (!composer) return { ok: false, reason: WF.ATTENTION.NO_COMPOSER };
        return { ok: true, siteId: site.id, url: globalThis.location.href };
      }

      // The turn-on check. The page is the only thing that knows whether it is signed
      // in — the session lives in the site's own cookies and the DOM is what shows the
      // result — so turning an AI on opens its tab and asks here.
      case WF.MSG.VERIFY_SITE: {
        const timeout = Math.min(Math.max(Number(msg.timeoutMs) || 20000, 1000), 60000);
        const composer = await content.composer.waitForComposer(document, site, timeout);
        const attention = await content.composer.settledAttention(
          document,
          site,
          globalThis.location.href,
          !!composer
        );
        const reason = attention ? attention.reason : null;
        reportStatus(attention || (composer ? null : { reason: WF.ATTENTION.NO_COMPOSER }));
        // Signed out is the one that cannot be worked around; a quota banner or a
        // verification check is a signed-in site that needs you, which the badge and the
        // site list already say.
        const signedIn = !!composer && reason !== WF.ATTENTION.SIGNED_OUT;
        return {
          ok: true,
          siteId: site.id,
          signedIn,
          hasComposer: !!composer,
          attention: signedIn ? null : reason || WF.ATTENTION.SIGNED_OUT,
          url: globalThis.location.href,
        };
      }

      case WF.MSG.TEST_SITE:
        return {
          ok: true,
          diagnostic: WF.dom.diagnose(document, site, globalThis.location.href),
          // Whether the timing can lean on the network, or is watching the DOM on its
          // own. Worth surfacing: it is the difference between a measurement and a
          // guess, and it is the first thing to check when a timing looks wrong.
          networkTiming: !!(net && net.running),
          endpoints: (site.endpointPatterns || []).length,
        };

      case WF.MSG.PROBE:
        return content.composer.probe({ doc: document, site, hash: msg.hash });

      case WF.MSG.NEW_CHAT:
        return content.composer.newChat({ doc: document, site });

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
        // A site switched on while this page was asleep wakes up here, and one switched
        // off goes back to costing nothing.
        if (dormant && WF.settings.siteEnabled(settings, site.id)) {
          dormant = false;
          boot().catch(() => undefined);
        }
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

    // A site the user has switched off costs nothing at all: no ticker, no overlay, no
    // observers, no polling. The message listener above is the only thing still awake, so
    // a later turn-on can reach this page — and the verify step needs a page that answers
    // whether it is signed in. This is the cheapest optimisation in the extension: ten AI
    // tabs open is an ordinary thing to have, and three of them being switched on is
    // ordinary too.
    if (!WF.settings.siteEnabled(settings, site.id)) {
      dormant = true;
      await WF.browser.send({
        type: WF.MSG.HELLO,
        siteId: site.id,
        url: globalThis.location.href,
        hasComposer: !!WF.dom.findComposer(document, site),
        dormant: true,
      });
      return;
    }

    content.tracker.attach(document, site, settings);

    // Network timing first, so a stream that is already in flight when the page
    // settles is still seen.
    net = new WF.content.netwatch.NetWatcher({
      site,
      onStream: (event) => content.detect.noteStream(event),
    });
    net.start();

    if (settings.overlayEnabled !== false) {
      content.overlay.init({
        doc: document,
        site,
        settings,
        handlers: {
          onBroadcast: broadcastHere,
          onOpenAnswer: (answerId) => WF.browser.send({ type: WF.MSG.OPEN_ANSWER, answerId }),
          onClearAnswers: async () => {
            const res = await WF.browser.send({ type: WF.MSG.CLEAR_ANSWERS });
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
    // Asked again on the way in, because a page that has just been looked at is the page whose
    // answer the user is about to read. The interval below is the backstop for a tab nobody
    // visits; this is the one that runs while somebody is reading the site list.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) evaluateStatus();
    });
    // Every two minutes, whether or not anyone is looking. The visibility test that used to gate
    // this was the other half of the staleness: a broadcast's tabs live in a window of their own
    // with (at most) one of them in front, so for the nine behind it the timer never fired and a
    // verdict from whenever the page last loaded stood for as long as the tab did. The scan is
    // the expensive part and it already has its own budget in lib/dom.js — the cheap half of the
    // banner probe every time, the substring sweeps on a fifteen-second clock — and a hidden tab
    // is a tab nobody is typing into, so there is nothing there to interrupt anyway.
    setInterval(() => evaluateStatus(), 120000);

    // Single-page navigation: a new conversation means a fresh status. Polling for a URL
    // change once every 800ms was the most expensive loop in the extension for the least
    // information; the title changes on every SPA navigation long before the URL settles,
    // so a listener on one text node does the real work and the poll is only a backstop.
    const titleNode = document.querySelector('title');
    if (titleNode) {
      try {
        new MutationObserver(onUrlMaybe).observe(titleNode, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      } catch (err) {
        /* the poll below still covers it */
      }
    }
    globalThis.addEventListener('popstate', onUrlMaybe);
    globalThis.addEventListener('hashchange', onUrlMaybe);
    setInterval(onUrlMaybe, 3000);

    function onUrlMaybe() {
      if (globalThis.location.href === lastHref) return;
      lastHref = globalThis.location.href;
      if (watcher && watcher.running) {
        // The first prompt of a conversation moves the page to that conversation's own
        // address, and the answer is still coming to the box we have been watching. Keep the
        // watch and re-measure from the new page; only a move that leaves this site, or one
        // that takes the message box away, ends a wait.
        const stillThisSite = WF.sites.fromUrl(lastHref) === site;
        if (stillThisSite && WF.dom.findComposer(document, site)) watcher.rebase();
        else watcher.stop('navigated');
      } else if (watcher) {
        watcher.stop('navigated');
      }
      WF.browser.send({
        type: WF.MSG.HELLO,
        siteId: site.id,
        url: lastHref,
        hasComposer: !!WF.dom.findComposer(document, site),
      });
      setTimeout(() => evaluateStatus(), 1500);
    }
  }

  content.reportWarning = reportWarning;
  content.broadcastHere = broadcastHere;
  content.startWatcher = startWatcher;
  content.unload = () => {
    content.tracker.flush();
    content.tracker.detach();
    if (net) net.stop();
  };

  globalThis.addEventListener('pagehide', () => content.unload());

  boot();
})();
