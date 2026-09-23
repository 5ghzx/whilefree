/**
 * DOM heuristics. Content-script side only.
 *
 * Strategy for every probe: try the site's explicit selectors first (lib/sites.js),
 * then fall back to a structural guess. A redesign usually breaks the selectors but
 * leaves the shape of the page intact, so the heuristics are what keep this working
 * between fixes.
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});

  const SEND_LABEL = /^(send|send message|send prompt|submit|ask|検索|送信|发送|提交)$/i;
  const SEND_LOOSE = /(^|\b)(send|submit)(\b|$)/i;

  function isVisible(el) {
    if (!el || typeof el.getClientRects !== 'function') return false;
    if (el.getClientRects().length === 0) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const view = el.ownerDocument && el.ownerDocument.defaultView;
    if (!view) return true;
    const style = view.getComputedStyle(el);
    if (!style) return true;
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (style.opacity !== '' && Number(style.opacity) === 0) return false;
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
    return true;
  }

  function rectOf(el) {
    try {
      return el.getBoundingClientRect();
    } catch (err) {
      return null;
    }
  }

  function labelOf(el) {
    if (!el) return '';
    return (
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.getAttribute('data-testid') ||
      (el.textContent || '').trim().slice(0, 60)
    );
  }

  /** First visible match, walking the candidate list in order. */
  function pick(doc, selectors) {
    for (const selector of selectors || []) {
      let nodes;
      try {
        nodes = doc.querySelectorAll(selector);
      } catch (err) {
        continue; // a selector we can't parse should never break the run
      }
      for (const node of nodes) {
        if (isVisible(node)) return node;
      }
    }
    return null;
  }

  function pickIndex(doc, selectors) {
    for (let i = 0; i < (selectors || []).length; i += 1) {
      const node = pick(doc, [selectors[i]]);
      if (node) return { index: i, selector: selectors[i], node };
    }
    return null;
  }

  function blockedContext(el) {
    return !!el.closest('[role="dialog"], [aria-hidden="true"], [data-wf-overlay]');
  }

  /**
   * The message box. Explicit selectors first, then the biggest visible editable
   * area sitting low in the viewport, which is where every chat product puts it.
   */
  function findComposer(doc, site) {
    const explicit = pick(doc, site.input.selectors);
    if (explicit && !blockedContext(explicit)) return explicit;

    const view = doc.defaultView || globalThis;
    const height = view.innerHeight || 800;
    const candidates = [];
    for (const node of doc.querySelectorAll('div[contenteditable="true"], textarea, [role="textbox"]')) {
      if (!isVisible(node)) continue;
      if (blockedContext(node)) continue;
      if (node.getAttribute('contenteditable') === 'false') continue;
      if (node.disabled) continue;
      const rect = rectOf(node);
      if (!rect || rect.width < 120 || rect.height < 18) continue;
      // Editable areas lower on the page are far more likely to be the composer
      // than a search box or a title field up top.
      const lowness = 0.35 + (rect.top + rect.height / 2) / Math.max(height, 1);
      candidates.push({ node, score: rect.width * rect.height * lowness });
    }
    if (!candidates.length) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0].node;
  }

  function isContentEditable(el) {
    return !!el && el.isContentEditable !== false && (el.getAttribute('contenteditable') === 'true' || el.isContentEditable === true);
  }

  /** The control that submits, preferring one inside/next to the composer. */
  function findSendButton(doc, site, composer) {
    const explicit = pick(doc, site.send.selectors);
    if (explicit && isVisible(explicit)) return explicit;

    if (!composer) return null;
    const scopes = [];
    let cur = composer;
    for (let depth = 0; cur && depth < 7; depth += 1) {
      scopes.push(cur);
      cur = cur.parentElement;
    }
    const composerRect = rectOf(composer);

    for (const scope of scopes) {
      const nodes = scope.querySelectorAll('button, [role="button"], input[type="submit"]');
      let best = null;
      for (const node of nodes) {
        if (!isVisible(node) || node.disabled) continue;
        if (node.getAttribute('aria-disabled') === 'true') continue;
        const label = labelOf(node);
        if (!SEND_LOOSE.test(label) && !SEND_LABEL.test(label)) continue;
        const rect = rectOf(node);
        let score = 1;
        if (rect && composerRect && rect.left >= composerRect.left - 20) score += 1;
        if (label && SEND_LABEL.test(label)) score += 2;
        if (!best || score > best.score) best = { node, score };
      }
      if (best) return best.node;
    }
    return null;
  }

  function findStopButton(doc, site) {
    const explicit = pick(doc, site.stop.selectors);
    if (explicit && isVisible(explicit)) return explicit;
    for (const node of doc.querySelectorAll('button, [role="button"]')) {
      if (!isVisible(node)) continue;
      const label = labelOf(node);
      if (/^(stop|stop generating|stop response|stop streaming)$/i.test(label)) return node;
    }
    return null;
  }

  /** Text of the banner-ish regions only, so a conversation about "limits" is not
   *  mistaken for a real limit banner. */
  function bannerText(doc) {
    const selectors = [
      '[role="alert"]',
      '[role="dialog"]',
      '[role="status"]',
      '[data-testid*="limit" i]',
      '[class*="banner" i]',
      '[class*="toast" i]',
      '[class*="modal" i]',
      '[class*="alert" i]',
      '[class*="captcha" i]',
      '[class*="challenge" i]',
    ];
    const parts = [];
    for (const selector of selectors) {
      let nodes;
      try {
        nodes = doc.querySelectorAll(selector);
      } catch (err) {
        continue;
      }
      for (const node of nodes) {
        if (!isVisible(node)) continue;
        const text = (node.textContent || '').trim();
        if (text) parts.push(text.slice(0, 400));
        if (parts.length > 20) break;
      }
    }
    return parts.join(' \u2022 ').slice(0, 4000);
  }

  function matchPatterns(patterns, text) {
    for (const pattern of patterns) {
      if (pattern.test(text)) return pattern;
    }
    return null;
  }

  /**
   * Does this page need a human? Never solved automatically — just reported, with
   * the reason, so the panel can say which AI is stuck and why.
   */
  function detectAttention(doc, site, url, hasComposer) {
    const text = bannerText(doc);
    if (text) {
      const check = matchPatterns(WF.sites.ATTENTION_PATTERNS.check, text);
      if (check) return { reason: WF.ATTENTION.CHECK, evidence: check.source };
      const quota = matchPatterns(WF.sites.ATTENTION_PATTERNS.quota, text);
      if (quota) return { reason: WF.ATTENTION.QUOTA, evidence: quota.source };
    }

    const urlHit = (site.login.urlPatterns || []).some((p) => String(url || '').includes(p));
    if (urlHit) return { reason: WF.ATTENTION.SIGNED_OUT, evidence: 'url' };
    if (!hasComposer && pick(doc, site.login.selectors)) {
      return { reason: WF.ATTENTION.SIGNED_OUT, evidence: 'login link' };
    }
    if (!hasComposer) {
      // Give slow SPAs a moment before declaring the box missing.
      return { reason: WF.ATTENTION.NO_COMPOSER, evidence: 'no editable area found' };
    }
    return null;
  }

  function assistantNodes(doc, site) {
    const seen = new Set();
    const nodes = [];
    for (const selector of site.answer.selectors) {
      let found;
      try {
        found = doc.querySelectorAll(selector);
      } catch (err) {
        continue;
      }
      for (const node of found) {
        if (seen.has(node)) continue;
        seen.add(node);
        nodes.push(node);
      }
    }
    return nodes;
  }

  /** Characters of assistant output visible right now. Length only, never text. */
  function assistantChars(doc, site) {
    const nodes = assistantNodes(doc, site);
    if (!nodes.length) return { nodes: 0, chars: 0 };
    let chars = 0;
    for (const node of nodes) chars += (node.textContent || '').length;
    return { nodes: nodes.length, chars };
  }

  // ---------------------------------------------------------------------------
  // Writing into the composer
  // ---------------------------------------------------------------------------

  function composerText(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return el.value || '';
    return el.textContent || '';
  }

  function normalize(str) {
    return String(str || '')
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? el.ownerDocument.defaultView.HTMLTextAreaElement.prototype : el.ownerDocument.defaultView.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new el.ownerDocument.defaultView.Event('input', { bubbles: true }));
  }

  function selectAll(el) {
    const doc = el.ownerDocument;
    const view = doc.defaultView;
    const selection = view.getSelection();
    const range = doc.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function pasteText(el, text) {
    const doc = el.ownerDocument;
    const view = doc.defaultView;
    let event;
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      if (!event.clipboardData) throw new Error('no clipboardData');
    } catch (err) {
      try {
        event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        Object.defineProperty(event, 'clipboardData', { value: dt });
      } catch (err2) {
        event = new view.Event('paste', { bubbles: true, cancelable: true });
      }
    }
    el.dispatchEvent(event);
    return event;
  }

  /**
   * Put `text` in the composer, replacing whatever is there.
   *
   * Three strategies in order of how well rich editors like them, each verified by
   * reading the box back. execCommand is deprecated but is still the only way to
   * insert text that ProseMirror, Lexical and Quill all accept as real input.
   */
  function setComposerText(doc, el, text) {
    const view = doc.defaultView;
    if (!el) return { ok: false, method: 'none' };
    const wanted = normalize(text);

    try {
      el.focus();
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        setNativeValue(el, '');
        setComposerText.lastMethod = 'value';
        setNativeValue(el, text);
        if (normalize(composerText(el)) === wanted) return { ok: true, method: 'value' };
      }
    } catch (err) {
      /* fall through to the rich-editor paths */
    }

    try {
      selectAll(el);
      if (doc.execCommand && doc.execCommand('insertText', false, text)) {
        if (normalize(composerText(el)) === wanted) return { ok: true, method: 'insertText' };
      }
    } catch (err) {
      /* fall through */
    }

    try {
      pasteText(el, text);
      if (normalize(composerText(el)) === wanted) return { ok: true, method: 'paste' };
    } catch (err) {
      /* fall through */
    }

    try {
      // Last resort: write the DOM directly and fire the events editors listen for.
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        setNativeValue(el, text);
      } else {
        el.textContent = text;
        el.dispatchEvent(new view.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      }
      const got = normalize(composerText(el));
      return { ok: got === wanted || got.includes(wanted), method: 'dom' };
    } catch (err) {
      return { ok: false, method: 'failed', error: String((err && err.message) || err) };
    }
  }

  function keyEvent(view, type, key, code, keyCode) {
    let event;
    try {
      event = new view.KeyboardEvent(type, {
        key,
        code,
        keyCode,
        which: keyCode,
        bubbles: true,
        cancelable: true,
        composed: true,
      });
      if (event.keyCode !== keyCode) {
        Object.defineProperty(event, 'keyCode', { get: () => keyCode });
        Object.defineProperty(event, 'which', { get: () => keyCode });
      }
    } catch (err) {
      event = new view.Event(type, { bubbles: true, cancelable: true });
    }
    return event;
  }

  /** Press Enter on the composer. The primary submit path for textarea sites. */
  function pressEnter(el) {
    const view = el.ownerDocument.defaultView;
    for (const type of ['keydown', 'keypress', 'keyup']) {
      el.dispatchEvent(keyEvent(view, type, 'Enter', 'Enter', 13));
    }
  }

  // ---------------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------------

  /**
   * What did we actually find on this page? Surfaced as "Check this tab" in the
   * popup so a broken selector is a five-second diagnosis for a contributor.
   */
  function diagnose(doc, site, url) {
    const composer = findComposer(doc, site);
    const explicit = pickIndex(doc, site.input.selectors);
    const send = findSendButton(doc, site, composer);
    const stop = findStopButton(doc, site);
    const answers = assistantChars(doc, site);
    const attention = detectAttention(doc, site, url, !!composer);
    const sendExplicit = pickIndex(doc, site.send.selectors);
    const answerMatches = {};
    for (const selector of site.answer.selectors) {
      try {
        answerMatches[selector] = doc.querySelectorAll(selector).length;
      } catch (err) {
        answerMatches[selector] = -1;
      }
    }
    return {
      siteId: site.id,
      url,
      composer: composer
        ? {
            via: explicit ? `selector #${explicit.index + 1}: ${explicit.selector}` : 'heuristic',
            tag: composer.tagName,
            chars: composerText(composer).length,
            inDialog: blockedContext(composer),
          }
        : null,
      send: send ? { via: sendExplicit ? `selector: ${sendExplicit.selector}` : 'heuristic', label: labelOf(send) } : null,
      stopPresent: !!stop,
      answers,
      answerMatches,
      attention,
    };
  }

  WF.dom = {
    isVisible,
    rectOf,
    labelOf,
    pick,
    pickIndex,
    findComposer,
    findSendButton,
    findStopButton,
    detectAttention,
    assistantNodes,
    assistantChars,
    composerText,
    setComposerText,
    pressEnter,
    selectAll,
    normalize,
    isContentEditable,
    bannerText,
    diagnose,
  };
})();
