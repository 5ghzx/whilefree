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

  // How long a sign-in verdict is given to change its mind before it is believed.
  //
  // These pages are server-rendered signed-out chrome that a session hydrates over. Measured
  // on Copilot: the wall is on screen, and the message box either is not there yet or is there
  // and unusable, for as long as the account handshake takes. On a tab opened in the
  // background — which is every tab of an ordinary fan-out, and on Firefox every tab of a
  // broadcast, because the window it opened in is not focused and the page is throttled — the
  // handshake can land seconds later than it would in a tab you are looking at. Read once, the
  // wall is the answer for those seconds, and one reading taken during them wrote "signed out"
  // next to an AI the user was signed in to.
  const SIGN_OUT_SETTLE_MS = 1500;

  /**
   * The page's own verdict, confirmed before it is believed.
   *
   * `detectAttention` is a reading, and a reading of a page that is still arriving is a
   * statement about the loading screen. Being signed out is the one reason that costs the
   * user something to be wrong about — it takes the AI off the list, clears the check the
   * turn-on would have collected, and needs a person to press a switch again — while being
   * wrong about the others costs nothing, because a quota banner and a verification check are
   * read off real banner text and do not appear and disappear on their own.
   *
   * So the reading that matters waits: if the page says signed out, ask it again after the
   * handshake has had its moment and take *that* answer, whatever it is. A door still standing
   * 1.5 seconds later is a door. A door that was gone by then was never a session.
   *
   * A flash in the other direction cannot happen: nothing here turns "signed in" into "signed
   * out" after the fact, and a page already saying it is fine is returned untouched, so nothing
   * on the happy path pays for this.
   */
  async function settledAttention(doc, site, url, hasComposer, settleMs) {
    const first = WF.dom.detectAttention(doc, site, url, hasComposer);
    if (!first || first.reason !== WF.ATTENTION.SIGNED_OUT) return first;
    const wait = Number.isFinite(settleMs) ? Number(settleMs) : SIGN_OUT_SETTLE_MS;
    await WF.util.sleep(wait);
    return WF.dom.detectAttention(doc, site, url, hasComposer);
  }

  /**
   * How long a click-only site is given to draw the control its press needs.
   *
   * Le Chat mounts its send button on the render that follows the typing, not with the box, so
   * at the moment the prompt lands there is nothing to click. Measured on chat.mistral.ai: the
   * button is absent in the same task as the insert and present a beat later. Two seconds is
   * several renders' worth of room on a page that is being looked at, and on a page that is not
   * the wait is woken by the mutation itself rather than by a clock.
   */
  const SEND_CONTROL_WAIT_MS = 2000;

  /** Evidence that a send is under way, sampled right after we press send. */
  function sendEvidence(doc, site, input) {
    return {
      stop: !!WF.dom.findStopButton(doc, site),
      // The box we typed into is no longer in the page at all. On Qwen the composer is part of
      // the new-chat surface and is swapped out the moment the conversation starts, so this is
      // what a successful send looks like there — while the detached textarea still holds the
      // prompt, which is why "the box emptied" was never going to be evidence on that site.
      inputGone: !input || !input.isConnected,
      inputEmpty: WF.dom.normalize(WF.dom.composerText(input)) === '',
      answers: WF.dom.assistantChars(doc, site),
    };
  }

  /**
   * The send control, waited for rather than expected.
   *
   * A site that draws its button only once there is something to send does not have one in the
   * document at the instant the text lands. Looking once and deciding "this site has no control,
   * so it must want Enter" is how a prompt was left sitting in Le Chat's box: Le Chat's Enter
   * starts a new line, so nothing was pressed and nothing was sent. So the wait is armed on the
   * page's own mutation — the thing that actually mounts the button — with a timer only as the
   * way out, because in a hidden tab a timer is the one thing that does not run.
   */
  function waitForSendControl(doc, site, input, timeoutMs) {
    const found = WF.dom.findSendButton(doc, site, input);
    if (found) return Promise.resolve(found);
    return new Promise((resolve) => {
      let observer = null;
      let timer = null;
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (observer) {
          try {
            observer.disconnect();
          } catch (err) {
            /* already gone */
          }
        }
        if (timer) clearTimeout(timer);
        resolve(value);
      };
      try {
        observer = new MutationObserver(() => {
          const control = WF.dom.findSendButton(doc, site, input);
          if (control) finish(control);
        });
        observer.observe(doc.documentElement || doc, { childList: true, subtree: true, attributes: true });
      } catch (err) {
        observer = null; // a document that will not be watched is simply not waited for
      }
      timer = setTimeout(() => finish(WF.dom.findSendButton(doc, site, input)), timeoutMs || SEND_CONTROL_WAIT_MS);
    });
  }

  async function confirmStarted(doc, site, input, before, timeoutMs, submittedAt) {
    const deadline = Date.now() + (timeoutMs || 5000);
    while (Date.now() < deadline) {
      const now = sendEvidence(doc, site, input);
      if (now.stop) return { started: true, via: 'stop button', submittedAt };
      // The surface that held the box is gone: the page left the composer it was on and went
      // into a conversation. This is read before the emptiness checks because on Qwen the
      // detached textarea still holds the prompt — the box did not empty, it stopped existing.
      if (now.inputGone && !before.inputGone) {
        return { started: true, via: 'composer was replaced', submittedAt };
      }
      if (now.inputEmpty && WF.dom.normalize(WF.dom.composerText(input)) === '') {
        // The box emptied: either it sent, or we cleared it. Combined with a change
        // in answer count it is strong evidence.
        if (!before.inputEmpty) return { started: true, via: 'composer emptied', submittedAt };
      }
      if (now.answers.chars > before.answers.chars || now.answers.nodes > before.answers.nodes) {
        return { started: true, via: 'answer appeared', submittedAt };
      }
      await WF.util.sleep(150);
    }
    return { started: false, via: null };
  }

  /**
   * The full send. Returns a result object; never throws.
   * `{ ok, phase, reason, method, attention, diagnostic }`
   */
  async function sendPrompt({ doc, site, prompt, settings, skipInsert }) {
    const input = await waitForComposer(doc, site);
    if (!input) {
      return {
        ok: false,
        reason: WF.ATTENTION.NO_COMPOSER,
        inserted: false,
        diagnostic: WF.dom.diagnose(doc, site, doc.location.href),
      };
    }

    const url = doc.location.href;
    // Confirmed, not merely read: a page that is still hydrating is not a page that is signed
    // out, and the refusal below is what puts an AI back on the "needs you" list.
    const attention = await settledAttention(doc, site, url, !!input);
    if (attention && attention.reason !== WF.ATTENTION.NO_COMPOSER) {
      return { ok: false, reason: attention.reason, inserted: false, attention };
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

    // A retry after a send that may already have gone does not type again: the text is
    // sitting in the box, and typing over it is how a prompt ends up doubled.
    if (!skipInsert) {
      let written = WF.dom.setComposerText(doc, input, prompt);
      if (!written.ok) {
        // An editor can take a frame to accept what was written into it, and judging it on
        // the same tick is what made the next strategy layer a second copy on the first. So
        // look again before deciding it did not land — a little longer than the typing pause,
        // because this is the one case where the text is already in the box and the page has
        // not reconciled it yet (measured on Perplexity, where a background write lands a
        // frame after the read that judges it).
        await WF.util.sleep(Math.max(delay(settings && settings.settleMs), 400));
        const settled = WF.dom.readComposer(input, WF.dom.normalize(prompt));
        if (settled.exact) {
          written = { ok: true, method: `${written.method}+settled` };
        } else {
          return {
            ok: false,
            // A box that took the text and a box that is not there are different problems,
            // and only one of them means "message box not found".
            reason: written.method === 'none' ? WF.ATTENTION.NO_COMPOSER : WF.ATTENTION.SEND_FAILED,
            inserted: false,
            method: written.method,
            reasonDetail: written.reason || null,
            diagnostic: WF.dom.diagnose(doc, site, url),
          };
        }
      }
    }

    // A pause where a person would pause. Roughly half the time we press Enter
    // instead of clicking, because both paths break on different redesigns.
    await WF.util.sleep(delay(settings && settings.settleMs));

    const mode = (site.send && site.send.mode) || 'click';
    // A click-only site whose control is not mounted yet is waited for before the press,
    // because on that kind of site there is no second option to fall back on: Enter is what the
    // box is for, and Le Chat's Enter starts a new line. The wait is skipped on a site that
    // presses Enter, where the control is only ever the retry.
    let button = WF.dom.findSendButton(doc, site, input);
    if (!button && mode !== 'enter') {
      button = await waitForSendControl(doc, site, input, SEND_CONTROL_WAIT_MS);
    }
    // When the prompt left. The clock that matters starts here, at the press, not when this
    // function finishes: confirming the send takes about a second of watching the page, and
    // the site's own request — the one the timing is built on — begins at the press. Measured
    // from the end instead, every wait came out about a second short and the answer's request
    // started before the watch, which left the network clock unable to see it at all.
    let submittedAt = Date.now();
    let method = 'none';

    if (mode === 'enter' || !button) {
      submittedAt = Date.now();
      WF.dom.pressEnter(input);
      method = 'enter';
    } else {
      try {
        submittedAt = Date.now();
        button.click();
        method = 'click';
      } catch (err) {
        submittedAt = Date.now();
        WF.dom.pressEnter(input);
        method = 'enter';
      }
    }

    let confirm = await confirmStarted(doc, site, input, before, mode === 'enter' ? 5000 : 3500, submittedAt);

    if (!confirm.started && method === 'enter' && button) {
      // Enter was swallowed (some editors insert a newline). Try the button.
      try {
        submittedAt = Date.now();
        button.click();
        method = 'click';
        confirm = await confirmStarted(doc, site, input, before, 3500, submittedAt);
      } catch (err) {
        /* handled below */
      }
    }

    if (!confirm.started && !button) {
      // There was nothing to click when the press was made. If the page has drawn its control
      // by now, that click is worth making before giving up on the prompt sitting in the box.
      const late = WF.dom.findSendButton(doc, site, input);
      if (late) {
        button = late;
        try {
          submittedAt = Date.now();
          late.click();
          method = 'click';
          confirm = await confirmStarted(doc, site, input, before, 3500, submittedAt);
        } catch (err) {
          /* handled below */
        }
      }
    }

    if (!confirm.started && method === 'click') {
      // The button click did nothing. Enter is the other half of the coin.
      submittedAt = Date.now();
      WF.dom.pressEnter(input);
      method = 'enter';
      confirm = await confirmStarted(doc, site, input, before, 3500, submittedAt);
    }

    if (!confirm.started) {
      return {
        ok: false,
        // The prompt reached the box and the send did not confirm. That is the one
        // failure where the prompt may still be on its way, which is why it is reported
        // separately from "could not put it in the box".
        reason: WF.ATTENTION.SEND_FAILED,
        inserted: true,
        method,
        diagnostic: WF.dom.diagnose(doc, site, url),
      };
    }

    return { ok: true, method, via: confirm.via, inserted: true, submittedAt: confirm.submittedAt || submittedAt };
  }

  /**
   * Has this exact prompt already been accepted into the conversation?
   *
   * This is the question a retry has to ask before it sends anything: after a failure
   * where the text was already in the box, sending again is how you end up with the
   * same prompt posted twice. Two answers, either of which is enough — the box still
   * holds it (nothing was sent), or the conversation's last turn is it (it was).
   */
  function probe({ doc, site, hash }) {
    const input = WF.dom.findComposer(doc, site);
    if (!input) return { ok: false, reason: 'no-composer' };
    const inComposer = WF.util.fingerprint(WF.dom.composerText(input));
    const lastUser = WF.dom.lastUserText(doc, site);
    const landed = lastUser ? WF.util.fingerprint(lastUser) : null;
    return {
      ok: true,
      composerReady: true,
      inComposer: !!hash && inComposer === hash,
      lastUserMatches: !!hash && landed === hash,
      // An empty box with no matching turn is the clean case: nothing was sent, and
      // nothing is sitting there either, so a retry starts from scratch.
      empty: WF.dom.normalize(WF.dom.composerText(input)) === '',
    };
  }

  /**
   * Start a fresh conversation inside this tab, using the site's own control where it
   * has one. Clicking beats navigating: the site keeps its session, its model choice
   * and its scroll position, and the page does not reload into a login wall.
   */
  async function newChat({ doc, site }) {
    const control = WF.dom.findNewChatControl(doc, site);
    if (!control) return { ok: false, reason: 'no-control' };
    try {
      control.click();
    } catch (err) {
      return { ok: false, reason: 'click-failed' };
    }
    // Give the SPA a moment to swap the conversation and re-mount a composer.
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline) {
      await WF.util.sleep(200);
      const input = WF.dom.findComposer(doc, site);
      if (input && WF.dom.normalize(WF.dom.composerText(input)) === '') return { ok: true };
    }
    return { ok: true, slow: true };
  }

  content.composer = {
    sendPrompt,
    probe,
    newChat,
    waitForComposer,
    waitForSendControl,
    settledAttention,
    SIGN_OUT_SETTLE_MS,
    SEND_CONTROL_WAIT_MS,
    delay,
    // Reused by the tracker to confirm that a send the user made by hand really
    // went out, so manual prompts get timed too.
    sendEvidence,
    confirmStarted,
  };
})();
