/**
 * Site adapters.
 *
 * Each entry is data first: a list of candidate selectors, tried in order, then a
 * heuristic fallback in lib/dom.js. Sites redesign their DOM constantly, so the
 * rule here is "many weak signals beat one clever selector", and every selector
 * lives in this one file so a fix is a one-line pull request.
 *
 * No brand logos are shipped: the UI uses a colour + monogram chip per site
 * (see assets/README.md).
 */
(() => {
  const WF = (globalThis.WF = globalThis.WF || {});

  /** @type {Record<string, any>} */
  const SITES = {
    chatgpt: {
      id: 'chatgpt',
      name: 'ChatGPT',
      monogram: 'G',
      color: '#10a37f',
      hosts: ['chatgpt.com', 'chat.openai.com'],
      matchPatterns: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
      newChatUrl: 'https://chatgpt.com/',
      input: {
        kind: 'contenteditable',
        selectors: [
          '#prompt-textarea',
          'div[contenteditable="true"][id="prompt-textarea"]',
          'form div[contenteditable="true"]',
          'div[contenteditable="true"].ProseMirror',
        ],
      },
      send: {
        mode: 'click',
        selectors: [
          'button[data-testid="send-button"]',
          'button[aria-label="Send prompt"]',
          'button[aria-label="Send message"]',
          'form button[type="submit"]',
        ],
      },
      stop: {
        selectors: [
          'button[data-testid="stop-button"]',
          'button[aria-label="Stop streaming"]',
          'button[aria-label="Stop generating"]',
        ],
      },
      answer: {
        selectors: [
          '[data-message-author-role="assistant"]',
          'div.agent-turn',
          'article[data-testid^="conversation-turn"]',
        ],
      },
      login: {
        selectors: [
          'a[href*="/auth/login"]',
          'button[data-testid="login-button"]',
          'a[data-testid="login-button"]',
        ],
        urlPatterns: ['/auth/login', '/auth/0'],
      },
      answerTimeoutMs: 300000,
      togglesOff: [],
    },

    claude: {
      id: 'claude',
      name: 'Claude',
      monogram: 'C',
      color: '#d97757',
      hosts: ['claude.ai'],
      matchPatterns: ['https://claude.ai/*'],
      newChatUrl: 'https://claude.ai/new',
      input: {
        kind: 'contenteditable',
        selectors: [
          'div[contenteditable="true"].ProseMirror',
          'div[contenteditable="true"][aria-label*="prompt" i]',
          'fieldset div[contenteditable="true"]',
          'div[contenteditable="true"]',
        ],
      },
      send: {
        mode: 'click',
        selectors: [
          'button[aria-label="Send message"]',
          'button[aria-label="Send Message"]',
          'button[aria-label="Send prompt"]',
          'fieldset button[type="submit"]',
        ],
      },
      stop: {
        selectors: ['button[aria-label="Stop response"]', 'button[aria-label="Stop"]'],
      },
      answer: {
        selectors: [
          '[data-testid="assistant-message"]',
          'div.font-claude-message',
          'div[data-is-streaming]',
        ],
      },
      login: {
        selectors: ['a[href*="/login"]', 'button[data-testid="login-button"]'],
        urlPatterns: ['/login'],
      },
      answerTimeoutMs: 300000,
      togglesOff: [{ text: /extended thinking/i, optional: true }],
    },

    gemini: {
      id: 'gemini',
      name: 'Gemini',
      monogram: '✦',
      color: '#4285f4',
      hosts: ['gemini.google.com'],
      matchPatterns: ['https://gemini.google.com/*'],
      newChatUrl: 'https://gemini.google.com/app',
      input: {
        kind: 'contenteditable',
        selectors: [
          'div.ql-editor[contenteditable="true"]',
          'rich-textarea div[contenteditable="true"]',
          'div[contenteditable="true"][role="textbox"]',
        ],
      },
      send: {
        mode: 'click',
        selectors: [
          'button[aria-label="Send message"]',
          'button.send-button',
          'button[aria-label*="Send" i]',
        ],
      },
      stop: {
        selectors: ['button[aria-label="Stop response"]', 'button[aria-label*="Stop" i]'],
      },
      answer: {
        selectors: ['model-response', '.model-response-text', 'message-content'],
      },
      login: {
        selectors: ['a[href*="accounts.google.com"]', 'a[href*="ServiceLogin"]'],
        urlPatterns: ['accounts.google.com'],
      },
      answerTimeoutMs: 300000,
      togglesOff: [],
    },

    perplexity: {
      id: 'perplexity',
      name: 'Perplexity',
      monogram: 'P',
      color: '#20808d',
      // Both spellings redirect to the same place, and a user can land on either.
      // The order here matches matchPatterns index for index, which the tests pin.
      hosts: ['www.perplexity.ai', 'perplexity.ai'],
      matchPatterns: ['https://www.perplexity.ai/*', 'https://perplexity.ai/*'],
      newChatUrl: 'https://www.perplexity.ai/',
      input: {
        kind: 'contenteditable',
        selectors: [
          '#ask-input',
          'div[contenteditable="true"][id="ask-input"]',
          'textarea[placeholder*="Ask" i]',
          'div[contenteditable="true"]',
        ],
      },
      send: {
        mode: 'click',
        selectors: [
          'button[aria-label="Submit"]',
          'button[aria-label="Send"]',
          'button[data-testid="submit-button"]',
        ],
      },
      stop: {
        selectors: [
          'button[aria-label="Stop"]',
          'button[aria-label="Stop generating"]',
          'button[data-testid="stop-button"]',
        ],
      },
      answer: {
        selectors: ['div[data-testid="answer"]', '.prose', '[id^="markdown-content"]'],
      },
      login: {
        selectors: ['a[href*="/login"]', 'button[data-testid="login-button"]'],
        urlPatterns: ['/login'],
      },
      answerTimeoutMs: 420000,
      togglesOff: [],
    },

    deepseek: {
      id: 'deepseek',
      name: 'DeepSeek',
      monogram: 'D',
      color: '#4d6bfe',
      hosts: ['chat.deepseek.com'],
      matchPatterns: ['https://chat.deepseek.com/*'],
      newChatUrl: 'https://chat.deepseek.com/',
      input: {
        kind: 'auto',
        selectors: ['textarea#chat-input', 'textarea[placeholder]', 'textarea'],
      },
      send: {
        // DeepSeek's send control is a role=button div: pressing Enter is more
        // reliable than guessing the node, so Enter is primary and the click is
        // only a fallback.
        mode: 'enter',
        selectors: ['div[role="button"][aria-label*="Send" i]', 'button[type="submit"]'],
      },
      stop: {
        selectors: ['div[role="button"][aria-label*="Stop" i]', 'button[aria-label*="Stop" i]'],
      },
      answer: {
        selectors: ['div[class*="ds-markdown"]', '.ds-markdown--block'],
      },
      login: {
        selectors: ['a[href*="/sign_in"]', 'button[class*="login"]'],
        urlPatterns: ['/sign_in'],
      },
      answerTimeoutMs: 420000,
      // DeepSeek remembers DeepThink/Search toggles between visits. Leaving them on
      // makes every broadcast answer slow, so WhileFree switches them off first.
      togglesOff: [{ text: /deep\s?think/i }, { text: /^search$/i, optional: true }],
    },
  };

  const ORDER = ['chatgpt', 'claude', 'gemini', 'perplexity', 'deepseek'];
  const list = () => ORDER.map((id) => SITES[id]);

  /** Which site does this URL belong to? */
  function fromUrl(url) {
    if (!url) return null;
    let host;
    try {
      host = new URL(url).hostname.replace(/^www\./, '');
    } catch (err) {
      return null;
    }
    for (const site of list()) {
      if (site.hosts.some((h) => h.replace(/^www\./, '') === host)) return site;
    }
    return null;
  }

  function byId(id) {
    return SITES[id] || null;
  }

  function matchPatterns(ids) {
    const wanted = ids && ids.length ? ids : ORDER;
    return wanted
      .map((id) => SITES[id])
      .filter(Boolean)
      .flatMap((site) => site.matchPatterns);
  }

  /** Client-side strings that mean "this site wants a human" (never auto-solved). */
  const ATTENTION_PATTERNS = {
    quota: [
      /you(?:'| ha)?ve (?:reached|hit) (?:your|the) (?:usage |message |free )?limit/i,
      /\blimit (?:will )?resets?\b/i,
      /out of (?:messages|credits|quota)/i,
      /free plan .{0,24}until/i,
      /too many requests/i,
      /you(?:'| a)?re out of/i,
      /buy more (?:credits|messages)/i,
      /reached the (?:maximum|cap)/i,
    ],
    check: [
      /verify (?:you are|that you are|you're) (?:a )?human/i,
      /unusual (?:traffic|activity)/i,
      /checking your browser/i,
      /just a moment/i,
      /press and hold/i,
      /complete the (?:check|challenge|verification)/i,
      /are you a robot/i,
      /cloudflare/i,
    ],
  };

  /** Elements that must not be mistaken for the composer. */
  const COMPOSER_BLOCKLIST = [
    '[role="dialog"]',
    '[aria-hidden="true"]',
    'input',
    '[contenteditable="false"]',
  ];

  // Quirks run inside the page, just before a prompt is sent.
  const QUIRKS = {
    /** Click a site's slow-mode toggle only when it is currently switched on. */
    async toggleOff(ctx, toggle) {
      const { doc } = ctx;
      const nodes = doc.querySelectorAll('button, [role="button"], [role="switch"]');
      for (const node of nodes) {
        const label = (node.getAttribute('aria-label') || node.textContent || '').trim();
        if (!label || label.length > 60) continue;
        if (!toggle.text.test(label)) continue;
        const on =
          node.getAttribute('aria-pressed') === 'true' ||
          node.getAttribute('aria-checked') === 'true' ||
          /(^|\s)(active|selected|enabled|on)(\s|$)/i.test(node.className || '') ||
          !!node.querySelector('svg[fill="currentColor"]');
        const looksFilled =
          node.dataset.state === 'on' || (on && toggle.text.test(label));
        if (looksFilled) {
          node.click();
          await WF.util.sleep(180);
          return true;
        }
      }
      if (!toggle.optional) {
        // Report it rather than loop forever: the user can see the mode is on.
        ctx.warn(`Could not switch off ${toggle.text} before sending`);
      }
      return false;
    },
  };

  async function applyQuirks(site, ctx, settings) {
    const disabled = (settings && settings.disableSlowModes && settings.disableSlowModes[site.id]) !== false;
    if (!disabled || !site.togglesOff || !site.togglesOff.length) return;
    for (const toggle of site.togglesOff) {
      await QUIRKS.toggleOff(ctx, toggle);
    }
  }

  WF.sites = {
    SITES,
    ORDER,
    list,
    byId,
    fromUrl,
    matchPatterns,
    applyQuirks,
    ATTENTION_PATTERNS,
    COMPOSER_BLOCKLIST,
  };
})();
