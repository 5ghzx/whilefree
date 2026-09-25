/**
 * Plays one chime, for the background worker. Nothing else lives here.
 *
 * The service worker cannot make a sound, so it opens this document, sends
 * `wf:offscreen-chime`, and closes it again. The reply is sent once, even if the audio
 * fails: the worker waits on it, and a promise that never settles is worse than a
 * chime that never plays.
 */
(() => {
  const api =
    typeof globalThis.browser !== 'undefined' && globalThis.browser.runtime
      ? globalThis.browser
      : globalThis.chrome;

  const ASSET = 'assets/chime.wav';

  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.kind !== 'wf:offscreen-chime') return false;

    let answered = false;
    const reply = (payload) => {
      if (answered) return;
      answered = true;
      try {
        sendResponse(payload);
      } catch (err) {
        /* the worker went away; nothing to do about it */
      }
    };

    try {
      const audio = new Audio(api.runtime.getURL(ASSET));
      const volume = Number(message.volume);
      audio.volume = isFinite(volume) ? Math.min(Math.max(volume, 0), 1) : 0.4;
      audio.addEventListener('ended', () => reply({ ok: true }));
      audio.play().then(
        () => {
          // Some platforms do not fire `ended` for a very short clip.
          setTimeout(() => reply({ ok: true }), 3000);
        },
        (err) => reply({ ok: false, error: String((err && err.message) || err) })
      );
      // A clip that never starts must not leave the caller hanging.
      setTimeout(() => reply({ ok: false, error: 'timed out' }), 3000);
    } catch (err) {
      reply({ ok: false, error: String((err && err.message) || err) });
    }
    return true; // keep the channel open for the reply
  });
})();
