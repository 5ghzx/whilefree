/**
 * Sending into a page: find the box, put the prompt in it, press send, then check
 * that something actually started.
 *
 * Every step is verified. Rather than assume a click worked, we look for evidence
 * (the box emptied, a stop button appeared, the answer started growing) and report
 * failure honestly so the panel can say "send did not go through" instead of
 * silently showing a spinner forever.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});
  const content = (WF.content = WF.content || {});

  const WAIT_FOR_COMPOSER_MS = 12000;

  function delay(pair) {
    return WF.settings.delayFrom(pair || [220, 650]);
  }

  async function waitForComposer(doc, site, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || WAIT_FOR_COMPOSER_MS);
    let last = null;
    while (Date.now() < deadline) {
      const composer = WF.dom.findComposer(doc, site);
      if (composer) return composer;
      last = composer;
      await WF.util.sleep(250);
    }
    return last;
  }

  /** Evidence that a send is under way, sampled right after we press send. */
  function sendEvidence(doc, site, input) {
    return {
      stop: !!WF.dom.findStopButton(doc, site),
      inputEmpty: WF.dom.normalize(WF.dom.composerText(input)) === '',
      answers: WF.dom.assistantChars(doc, site),
    };
  }

  async function confirmStarted(doc, site, input, before, timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 5000);
    while (Date.now() < deadline) {
      const now = sendEvidence(doc, site, input);
      if (now.stop) return { started: true, via: 'stop button' };
      if (now.inputEmpty && WF.dom.normalize(WF.dom.composerText(input)) === '') {
        // The box emptied: either it sent, or we cleared it. Combined with a change
        // in answer count it is strong evidence.
        if (!before.inputEmpty) return { started: true, via: 'composer emptied' };
      }
      if (now.answers.chars > before.answers.chars || now.answers.nodes > before.answers.nodes) {
        return { started: true, via: 'answer appeared' };
      }
      await WF.util.sleep(150);
    }
    return { started: false, via: null };
  }

  /**
   * The full send. Returns a result object; never throws.
   * `{ ok, phase, reason, method, attention, diagnostic }`
   */
  async function sendPrompt({ doc, site, prompt, settings }) {
    const input = await waitForComposer(doc, site);
    if (!input) {
      return {
        ok: false,
        reason: WF.ATTENTION.NO_COMPOSER,
        diagnostic: WF.dom.diagnose(doc, site, doc.location.href),
      };
    }

    const url = doc.location.href;
    const attention = WF.dom.detectAttention(doc, site, url, !!input);
    if (attention && attention.reason !== WF.ATTENTION.NO_COMPOSER) {
      return { ok: false, reason: attention.reason, attention };
    }

    // Site quirks: switch off a slow mode the site left on (DeepSeek's DeepThink).
    await WF.sites.applyQuirks(
      site,
      {
        doc,
        warn: (message) => content.reportWarning && content.reportWarning(message, site),
      },
      settings
    );

    const before = sendEvidence(doc, site, input);

    const written = WF.dom.setComposerText(doc, input, prompt);
    if (!written.ok) {
      return {
        ok: false,
        reason: WF.ATTENTION.NO_COMPOSER,
        method: written.method,
        diagnostic: WF.dom.diagnose(doc, site, url),
      };
    }

    // A pause where a person would pause. Roughly half the time we press Enter
    // instead of clicking, because both paths break on different redesigns.
    await WF.util.sleep(delay(settings && settings.settleMs));

    const mode = (site.send && site.send.mode) || 'click';
    const button = WF.dom.findSendButton(doc, site, input);
    let method = 'none';

    if (mode === 'enter' || !button) {
      WF.dom.pressEnter(input);
      method = 'enter';
    } else {
      try {
        button.click();
        method = 'click';
      } catch (err) {
        WF.dom.pressEnter(input);
        method = 'enter';
      }
    }

    let confirm = await confirmStarted(doc, site, input, before, mode === 'enter' ? 5000 : 3500);

    if (!confirm.started && method === 'enter' && button) {
      // Enter was swallowed (some editors insert a newline). Try the button.
      try {
        button.click();
        method = 'click';
        confirm = await confirmStarted(doc, site, input, before, 3500);
      } catch (err) {
        /* handled below */
      }
    }

    if (!confirm.started && method === 'click') {
      // The button click did nothing. Enter is the other half of the coin.
      WF.dom.pressEnter(input);
      method = 'enter';
      confirm = await confirmStarted(doc, site, input, before, 3500);
    }

    if (!confirm.started) {
      return {
        ok: false,
        reason: WF.ATTENTION.SEND_FAILED,
        method,
        diagnostic: WF.dom.diagnose(doc, site, url),
      };
    }

    return { ok: true, method, via: confirm.via };
  }

  content.composer = {
    sendPrompt,
    waitForComposer,
    delay,
    // Reused by the tracker to confirm that a send the user made by hand really
    // went out, so manual prompts get timed too.
    sendEvidence,
    confirmStarted,
  };
})();
