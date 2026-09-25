/**
 * What the content script sees on this page, read from inside its own world.
 *
 * Run with the Firefox rig, which is the only place this question can be asked:
 *
 *   node scripts/rdp.mjs eval <tab> @scripts/probes/content-reading.js
 *
 * The reading is taken with the extension's own functions — `WF.dom.findComposer`,
 * `WF.dom.detectAttention`, `WF.dom.loginDoor`, `WF.content.composer.settledAttention` — so
 * what this reports is what a PING reply would have said, with the raw reading kept alongside
 * the settled one instead of being replaced by it.
 *
 * Two halves, because the console actor cannot wait for a promise: the first half takes the
 * reading and starts the settled one, the second half (after the `::after` marker) collects it.
 * The settled read is the extension's own function, not a re-implementation of it, so its
 * timing is the timing a real PING pays in this tab — in a hidden tab that number is where
 * Firefox's timer throttling shows up.
 */
JSON.stringify(
  (() => {
    const reading = globalThis.__wfReading || (globalThis.__wfReading = {});
    const site = WF.sites.fromUrl(globalThis.location.href);
    if (!site) return { error: 'not a site this extension knows', url: globalThis.location.href };

    const url = globalThis.location.href;
    const composer = WF.dom.findComposer(document, site);
    const send = WF.dom.findSendButton(document, site, composer);
    const raw = WF.dom.detectAttention(document, site, url, !!composer);

    // Every label on the page that a sign-in door could have been read from: the whole reason a
    // wrong verdict is possible is that these words are on screen before the session is. The
    // label order is `WF.dom.doorLabel`'s, which is not exported — the same three sources in
    // the same order, because an icon-only control has no text at all.
    const labelOf = (node) => {
      const raw = node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent;
      return String(raw || '').replace(/\s+/g, ' ').trim();
    };
    const doors = [];
    for (const node of document.querySelectorAll('a, button, [role="button"]')) {
      const label = labelOf(node);
      if (!label || label.length > 40) continue;
      if ((WF.sites.SIGN_IN_WORDS || []).some((word) => word.test(label))) doors.push(label);
    }

    const first = {
      site: site.id,
      url,
      readyState: document.readyState,
      hidden: document.hidden,
      visibility: document.visibilityState,
      composerFound: !!composer,
      composerTag: composer ? composer.tagName : null,
      composerChars: composer ? String(composer.value ?? composer.textContent ?? '').length : null,
      composerReadable: !!(composer && !composer.disabled && !composer.readOnly),
      sendFound: !!send,
      raw,
      door: WF.dom.loginDoor(document),
      doors: [...new Set(doors)].slice(0, 6),
      banner: (WF.dom.bannerText(document) || '').slice(0, 200),
      settleMs: WF.content.composer.SIGN_OUT_SETTLE_MS,
    };

    // The extension's own settling read, timed. Its answer is what a PING would have returned.
    const started = Date.now();
    reading.status = 'running';
    reading.first = first;
    // A count of animation frames in the window between the two halves. Firefox suspends
    // them in a page nobody is looking at, so a flat zero here is the throttling itself
    // rather than an inference from it.
    reading.rafTicks = 0;
    (function tick() {
      reading.rafTicks += 1;
      globalThis.requestAnimationFrame(tick);
    })();
    WF.content.composer
      .settledAttention(document, site, url, !!composer)
      .then((attention) => {
        reading.status = 'done';
        reading.settled = attention;
        reading.settledMs = Date.now() - started;
        reading.composerAfter = !!WF.dom.findComposer(document, site);
      })
      .catch((err) => {
        reading.status = 'error';
        reading.error = String(err);
      });

    return first;
  })()
)

// ::after 4000
JSON.stringify(globalThis.__wfReading)
