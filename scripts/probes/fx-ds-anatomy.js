// What DeepSeek's composer actually is, right now, in a signed-in tab.
//
//   node scripts/rdp.mjs eval deepseek @scripts/probes/fx-ds-anatomy.js
//
// The adapter's readings (`fx-diagnose.js`) say what our selectors *found*; this says what is
// there to be found, so a moved button is a diff rather than a mystery. Deliberately uses no
// WF helpers: the point is to look at the page without the extension's opinions in the way.
(() => {
  const brief = (el) => {
    if (!el) return null;
    const text = (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return {
      tag: el.tagName.toLowerCase(),
      cls: (el.className && String(el.className).slice(0, 80)) || '',
      aria: el.getAttribute('aria-label'),
      title: el.getAttribute('title'),
      role: el.getAttribute('role'),
      type: el.getAttribute('type'),
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      text,
    };
  };

  const area = document.querySelector('textarea#chat-input');
  const anyArea = document.querySelector('textarea');
  const map = (nodes, n) => [...nodes].slice(0, n).map(brief);

  // Anything clickable in the composer's own neighbourhood: walk up from the textarea.
  const near = [];
  if (anyArea) {
    let node = anyArea;
    for (let up = 0; up < 4 && node; up += 1) node = node.parentElement;
    if (node) {
      for (const el of node.querySelectorAll('button, [role="button"], [role="switch"], [role="checkbox"]')) {
        near.push(brief(el));
      }
    }
  }

  return JSON.stringify(
    {
      url: location.href,
      title: document.title,
      signedIn: !document.querySelector('a[href*="/sign_in"]'),
      chatInputById: brief(area),
      textareaCount: document.querySelectorAll('textarea').length,
      firstTextarea: brief(anyArea),
      textareaPlaceholder: anyArea ? anyArea.getAttribute('placeholder') : null,
      nearControls: near.slice(0, 14),
      toggles: map(document.querySelectorAll('.ds-toggle-button'), 8),
      toggleSelected: map(document.querySelectorAll('.ds-toggle-button--selected'), 8),
      roleSwitch: map(document.querySelectorAll('[role="switch"]'), 8),
      modelSelector: brief(document.querySelector('.ds-model-selector')),
      modelButtons: map(document.querySelectorAll('button[aria-label*="model" i], .ds-model-selector'), 6),
      sendCandidates: map(document.querySelectorAll('[aria-label*="send" i], [aria-label*="stop" i]'), 8),
      stopCandidates: map(document.querySelectorAll('button[aria-label*="stop" i], div[role="button"][aria-label*="stop" i]'), 4),
    },
    null,
    1
  );
})()
