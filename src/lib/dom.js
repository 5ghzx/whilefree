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

  const STOP_LABEL = /^(stop|stop generating|stop response|stop streaming)$/i;

  /**
   * The site's stop button, if it is up.
   *
   * Asked on every tick of an answer, and on a page with hundreds of buttons the fallback
   * sweep is the expensive half: reading a label is a string, while `isVisible` costs a
   * layout — and a layout forced from inside a page that is busy streaming is exactly the
   * sort of thing that makes it feel slow. So the label is read first and geometry is asked
   * only about the handful of nodes that could be it.
   */
  function findStopButton(doc, site) {
    const explicit = pick(doc, site.stop.selectors);
    if (explicit && isVisible(explicit)) return explicit;
    let nodes;
    try {
      nodes = doc.querySelectorAll('button, [role="button"]');
    } catch (err) {
      return null;
    }
    for (const node of nodes) {
      if (!STOP_LABEL.test(labelOf(node).trim())) continue;
      if (isVisible(node)) return node;
    }
    return null;
  }

  /**
   * The two halves of the banner probe, and why they are not the same cost.
   *
   * `[role="alert"]` is an attribute-value match: the engine keeps an index of those, so the
   * query is a lookup that costs about a millisecond on a big page. `[class*="modal"]` is a
   * substring match over every class attribute in the document, and it has to build a result
   * list before anything can be skipped — measured on a page twenty times the size of a long
   * conversation, the first family is 1.5ms and the second is 36ms.
   *
   * Thirty-six milliseconds is not a number that matters once. It matters because this runs
   * every other tick while an answer is arriving — on a page that is re-laying-out on every
   * token — and each scan is a forced layout landing in the middle of that. So the cheap half
   * runs every time, and the expensive half runs on a budget.
   */
  const CHEAP_BANNER_SELECTORS = [
    '[role="alert"]',
    '[role="dialog"]',
    '[role="status"]',
    '[data-testid*="limit" i]',
  ];
  const SLOW_BANNER_SELECTORS = [
    '[class*="banner" i]',
    '[class*="toast" i]',
    '[class*="modal" i]',
    '[class*="alert" i]',
    '[class*="captcha" i]',
    '[class*="challenge" i]',
  ];
  // Long enough that the scans are rare, short enough that a quota banner is seen while the
  // answer it interrupted is still on screen.
  const SLOW_BANNER_MS = 15000;
  const PER_SELECTOR = 3;
  let slowBannerAt = 0;

  function readBanners(doc, selectors) {
    const parts = [];
    for (const selector of selectors) {
      let nodes;
      try {
        nodes = doc.querySelectorAll(selector);
      } catch (err) {
        continue;
      }
      let taken = 0;
      for (const node of nodes) {
        if (taken >= PER_SELECTOR) break;
        const text = (node.textContent || '').trim();
        // Text before geometry: an empty node needs no layout to be judged empty.
        if (!text) continue;
        if (!isVisible(node)) continue;
        taken += 1;
        parts.push(text.slice(0, 400));
        if (parts.length > 20) break;
      }
      if (parts.length > 20) break;
    }
    return parts;
  }

  /**
   * Text of the banner-ish regions only, so a conversation about "limits" is not mistaken for
   * a real limit banner.
   */
  function bannerText(doc) {
    const cheap = readBanners(doc, CHEAP_BANNER_SELECTORS);
    if (cheap.length) return cheap.join(' \u2022 ').slice(0, 4000);

    const now = Date.now();
    if (now - slowBannerAt < SLOW_BANNER_MS) return '';
    slowBannerAt = now;
    return readBanners(doc, SLOW_BANNER_SELECTORS).join(' \u2022 ').slice(0, 4000);
  }

  function matchPatterns(patterns, text) {
    for (const pattern of patterns) {
      if (pattern.test(text)) return pattern;
    }
    return null;
  }

  /**
   * The site's own sign-in door, if it is on screen right now.
   *
   * Returns the words on the button, which is what the report shows, or null. Buttons and
   * links only, visible only, and short labels only: a "Log in" inside a hidden sidebar is
   * not a door, and neither is the sentence "Log in to get answers based on saved chats"
   * sitting in a paragraph of marketing copy.
   */
  /**
   * What a control calls itself: its accessible name first, its visible text second.
   *
   * `aria-label`/`title` come first because that is the name a control is announced by, and it is
   * the *only* name an icon-only control has — a picture of a person whose accessible name is
   * "Sign in", which is how these headers draw a signed-out account. Reading `textContent` alone
   * finds nothing on a control like that, and a signed-out page that still has a message box on it
   * then passes as ready. Same order as `labelOf` and `cleanLabel`, for the same reason.
   */
  function doorLabel(node) {
    const raw = node.getAttribute
      ? node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent
      : node.textContent;
    return String(raw || '').replace(/\s+/g, ' ').trim();
  }

  function loginDoor(doc) {
    const words = WF.sites.SIGN_IN_WORDS || [];
    let nodes;
    try {
      nodes = doc.querySelectorAll('a, button, [role="button"]');
    } catch (err) {
      return null;
    }
    // Label first, then geometry. A label is a string to read; `isVisible` asks for client
    // rects and computed style, which costs a layout — and the moment this runs most often is
    // during an answer, on a page that is already relaying out on every token. Only the
    // handful of labels that could be a door are worth that question.
    for (const node of nodes) {
      const text = doorLabel(node);
      if (!text || text.length > 40) continue;
      let looksLikeADoor = false;
      for (const word of words) {
        if (word.test(text)) {
          looksLikeADoor = true;
          break;
        }
      }
      if (!looksLikeADoor) continue;
      if (isVisible(node)) return text;
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

    // Asked whether there is a composer or not, because on these sites a message box is
    // not a session: ChatGPT answers a stranger, Gemini shows a box that says "Sign in to
    // save activity". The old order — only look for a sign-in door when no box was found —
    // is what let a prompt go out to a signed-out page and then be reported as "no answer"
    // with the answer sitting right there on screen, in the anonymous transcript.
    const door = loginDoor(doc);
    if (door) return { reason: WF.ATTENTION.SIGNED_OUT, evidence: door };
    if (!hasComposer && pick(doc, site.login.selectors)) {
      return { reason: WF.ATTENTION.SIGNED_OUT, evidence: 'login link' };
    }
    if (!hasComposer) {
      // Give slow SPAs a moment before declaring the box missing.
      return { reason: WF.ATTENTION.NO_COMPOSER, evidence: 'no editable area found' };
    }
    return null;
  }

  /**
   * Nodes that hold the *user's* turn, in the names these apps use for it.
   *
   * Needed because a streaming container is not the answer. While a reply is arriving, one
   * of these sites puts its streaming attribute on the wrapper around the whole exchange,
   * and the prompt inside it counts as "assistant output" the moment it is painted — which
   * is why a four-second answer was once recorded as arriving in 14 milliseconds.
   */
  const USER_TURN = '[data-testid="user-message"], .font-user-message, [data-message-author-role="user"]';

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
        // A node holding the user's own message is the conversation, not the answer. Skip
        // it rather than counting the prompt as output.
        try {
          if (node.querySelector(USER_TURN)) continue;
        } catch (err) {
          /* a node that cannot be searched is judged on its own text */
        }
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
      // Zero-width and bidi marks are invisible and never part of what was typed, but they
      // are exactly what makes a read-back "not equal" to the prompt after an insertion that
      // did land — which is how a second insertion end up layered on the first.
      .replace(/[\u200b\u200c\u200d\u2060\u200e\u200f\ufeff]/g, '')
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

  /**
   * Empty the composer, whatever kind of editor is behind it.
   *
   * Clearing first is what makes "replace the contents" mean replace. Without it, a box that
   * already held something — a draft, or the text this very function inserted a moment ago
   * that the read-back could not confirm — collects a second and third copy as each strategy
   * is tried. That is not hypothetical: on Perplexity one call to this function left the
   * prompt in the box three times, which is a tripled question waiting for a send button.
   *
   * `deleteFromDocument` is the one that works on the editors that track their own selection:
   * measured on a live Perplexity box, `execCommand('delete')` after selecting the contents
   * removed nothing at all, while deleting the selected range emptied it completely.
   */
  function clearComposer(doc, el) {
    if (!el) return { ok: false, empty: true };
    const view = doc.defaultView;

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      try {
        setNativeValue(el, '');
        return { ok: true, empty: (el.value || '') === '' };
      } catch (err) {
        return { ok: false, empty: false };
      }
    }

    try {
      selectAll(el);
      const selection = view.getSelection();
      if (selection && selection.deleteFromDocument) {
        selection.deleteFromDocument();
      } else if (selection && selection.rangeCount) {
        selection.getRangeAt(0).deleteContents();
      } else {
        el.textContent = '';
      }
      el.dispatchEvent(new view.InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    } catch (err) {
      try {
        el.textContent = '';
      } catch (err2) {
        return { ok: false, empty: false };
      }
    }

    // Some editors expose `deleteFromDocument` and quietly do nothing with it — measured on
    // Kimi, where selecting the contents and deleting left every character in place. The only
    // evidence worth trusting is the box itself, so ask it and fall back if the answer is no.
    if (normalize(composerText(el)) !== '') {
      try {
        el.textContent = '';
      } catch (err) {
        /* nothing else to try */
      }
    }
    return { ok: true, empty: normalize(composerText(el)) === '' };
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
   * What is in the box, judged against the prompt that should be there.
   *
   * `exact` is the claim worth acting on. `copies` is how many times the prompt appears,
   * which is the number that decides whether the box is safe to send: one copy with a
   * little whitespace around it is a prompt, and three copies is a question the user is
   * charged for three times.
   */
  function readComposer(el, wanted) {
    const got = normalize(composerText(el));
    return {
      text: got,
      exact: got === wanted,
      copies: wanted ? got.split(wanted).length - 1 : 0,
      contains: !!wanted && got.includes(wanted),
    };
  }

  /**
   * Put `text` in the composer, replacing whatever is there.
   *
   * The order is the one that was measured on live pages, not the one that sounds most
   * thorough. Focusing the box, selecting its contents and using `execCommand('insertText')`
   * is the pair that rich editors implement as "replace what is selected" — on Perplexity's
   * Lexical editor it is the only thing that lands the prompt, and it needs the document to
   * have focus, which a tab in the background does not.
   *
   * Two rules keep a failed attempt from becoming a second prompt:
   *
   * - nothing is inserted on top of a box that already holds the prompt (`copies >= 1` is a
   *   result, not a reason to try again), and
   * - a box left holding two copies is emptied rather than sent.
   *
   * A direct DOM write is the fallback, and it is the one a background tab can do: no focus
   * required, because it is not the browser's editing behaviour, it is ours. Editors that
   * track their own model accept it once told, which is what the `input` event is for.
   */
  function setComposerText(doc, el, text) {
    const view = doc.defaultView;
    if (!el) return { ok: false, method: 'none' };
    const wanted = normalize(text);

    // The prompt is already in the box — which is what a retry after "may have landed" sees,
    // and what a second attempt must not type over.
    const present = readComposer(el, wanted);
    if (present.exact) return { ok: true, method: 'already-there' };

    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      try {
        el.focus();
        setNativeValue(el, '');
        setComposerText.lastMethod = 'value';
        setNativeValue(el, text);
        const after = readComposer(el, wanted);
        if (after.exact) return { ok: true, method: 'value' };
      } catch (err) {
        /* fall through to the rich-editor paths */
      }
    } else {
      try {
        el.focus();
        selectAll(el);
        if (doc.execCommand && doc.execCommand('insertText', false, text)) {
          const after = readComposer(el, wanted);
          if (after.exact) return { ok: true, method: 'insertText' };
          if (after.copies > 1) {
            clearComposer(doc, el);
            return { ok: false, method: 'insertText', reason: 'doubled' };
          }
        }
      } catch (err) {
        /* fall through */
      }

      try {
        clearComposer(doc, el);
        el.textContent = text;
        el.dispatchEvent(new view.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      } catch (err) {
        return { ok: false, method: 'failed', error: String((err && err.message) || err) };
      }
    }

    const after = readComposer(el, wanted);
    if (after.exact) return { ok: true, method: 'dom' };
    if (after.copies > 1) {
      clearComposer(doc, el);
      return { ok: false, method: 'dom', reason: 'doubled', copies: after.copies };
    }
    // Present once with other text around it is a box we did not put the prompt in on its
    // own; saying so is better than pressing send on a surprise.
    if (after.contains) return { ok: false, method: 'dom', reason: 'surrounded', copies: after.copies };
    // Whatever is in there, it is not what we were asked to put there: an editor that
    // re-rendered from its own state, or a box we never reached at all.
    return {
      ok: false,
      method: 'dom',
      reason: after.text ? 'other-text' : 'empty-after-insert',
      text: after.text.slice(0, 40),
    };
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

  // ---------------------------------------------------------------------------
  // Facts about a page that are not about sending
  // ---------------------------------------------------------------------------

  /** "GPT-5", "Claude 4.5 Sonnet", "Gemini 3 Pro" — a product name, not prose. */
  const MODEL_HINT = /\b(gpt|o[1-9]|claude|sonnet|opus|haiku|gemini|flash|pro|deepseek|r1|v3|grok|copilot|mistral|magistral|qwen|kimi|llama|think)/i;

  /**
   * Which model is on the other end, read from the site's own model switcher.
   *
   * This is a label, not the conversation: the dashboard can split answer times by
   * model only if we know which model answered, and no answer text is involved. The
   * heuristic variant is deliberately narrow — a short, visible string containing a
   * model-ish word, next to the composer — because a wrong model on a chart is worse
   * than no model at all.
   */
  function modelLabel(doc, site) {
    const selectors = (site && site.modelSelectors) || [];
    const direct = pick(doc, selectors);
    if (direct) {
      const text = cleanLabel(direct);
      if (text) return { label: text, source: 'selector' };
    }
    const composer = findComposer(doc, site);
    const region = composer ? composer.closest('form, main, section, div') || doc.body : doc.body;
    if (!region) return null;
    const candidates = region.querySelectorAll('button, [role="button"], [aria-haspopup]');
    for (const node of candidates) {
      if (!isVisible(node)) continue;
      const text = cleanLabel(node);
      if (!text || text.length > 32) continue;
      if (!MODEL_HINT.test(text)) continue;
      return { label: text, source: 'heuristic' };
    }
    return null;
  }

  function cleanLabel(node) {
    const raw =
      node.getAttribute('aria-label') ||
      node.getAttribute('title') ||
      (node.textContent || '').replace(/\s+/g, ' ').trim();
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    // "Model selector, GPT-5" -> "GPT-5"
    const tail = text.split(/[,:·|]/).map((part) => part.trim()).filter(Boolean);
    const interesting = tail.find((part) => MODEL_HINT.test(part));
    return truncateText(interesting || text, 32);
  }

  function truncateText(text, n) {
    return text.length <= n ? text : `${text.slice(0, n - 1)}\u2026`;
  }

  /**
   * The last prompt the site has accepted into this conversation. Used only to answer
   * "did that send land?", so a miss degrades to a slower confirmation, never to a
   * wrong action.
   */
  function lastUserText(doc, site) {
    const selectors = ((site && site.userMessageSelectors) || []).concat([
      '[data-message-author-role="user"]',
      '[data-testid="user-message"]',
      '[class*="user-bubble"]',
      '.query-text-line',
      'user-query',
    ]);
    let best = null;
    for (const selector of selectors) {
      let nodes = [];
      try {
        nodes = [...doc.querySelectorAll(selector)];
      } catch (err) {
        continue;
      }
      for (const node of nodes) {
        if (!isVisible(node)) continue;
        const text = (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        if (!text || text.length > 20000) continue;
        const rect = rectOf(node);
        // Lowest on the page wins: that is the most recent turn in every one of these
        // layouts, and the rect is cheaper and steadier than trusting DOM order.
        if (!best || rect.top >= best.top) best = { top: rect.top, text };
      }
    }
    return best ? best.text : '';
  }

  /** The site's own "new chat" control, if it is reachable from here. */
  function findNewChatControl(doc, site) {
    const explicit = pick(doc, (site && site.newChatSelectors) || []);
    if (explicit) return explicit;
    const candidates = doc.querySelectorAll('a[href], button, [role="button"]');
    for (const node of candidates) {
      if (!isVisible(node)) continue;
      const label = labelOf(node) || '';
      if (!/^(new chat|new conversation|start a new chat|new thread|\+\s*new|yeni sohbet)$/i.test(label)) continue;
      return node;
    }
    return null;
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
    loginDoor,
    assistantNodes,
    assistantChars,
    composerText,
    setComposerText,
    clearComposer,
    readComposer,
    pressEnter,
    selectAll,
    normalize,
    isContentEditable,
    bannerText,
    SLOW_BANNER_MS,
    diagnose,
    modelLabel,
    lastUserText,
    findNewChatControl,
  };
})();
