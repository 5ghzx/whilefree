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
      togglesOff: [{ text: /deep research/i, optional: true }],
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
      togglesOff: [{ text: /research/i, optional: true }, { text: /pro search/i, optional: true }],
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

    grok: {
      id: 'grok',
      name: 'Grok',
      monogram: 'X',
      color: '#6b7280',
      hosts: ['grok.com', 'www.grok.com'],
      matchPatterns: ['https://grok.com/*', 'https://www.grok.com/*'],
      newChatUrl: 'https://grok.com/',
      input: {
        kind: 'auto',
        selectors: ['textarea[placeholder]', 'div[contenteditable="true"]', 'textarea'],
      },
      send: {
        mode: 'enter',
        selectors: ['button[type="submit"][aria-label]', 'button[aria-label="Submit"]', 'button[aria-label="Send"]'],
      },
      stop: {
        selectors: [
          'button[aria-label="Stop model response"]',
          'button[aria-label*="Stop" i]',
        ],
      },
      answer: {
        selectors: ['.message-bubble', 'div[class*="response-content"]', 'div[class*="message"][class*="assistant"]'],
      },
      login: {
        selectors: ['a[href*="sign-in"]', 'a[href*="sign-up"]', 'button[data-testid="login-button"]'],
        urlPatterns: ['/sign-in', '/sign-up'],
      },
      answerTimeoutMs: 300000,
      togglesOff: [{ text: /deep\s?search/i, optional: true }, { text: /^think/i, optional: true }],
    },

    copilot: {
      id: 'copilot',
      name: 'Copilot',
      monogram: '\u25ce',
      color: '#0078d4',
      hosts: ['copilot.microsoft.com', 'www.copilot.microsoft.com'],
      matchPatterns: ['https://copilot.microsoft.com/*', 'https://www.copilot.microsoft.com/*'],
      newChatUrl: 'https://copilot.microsoft.com/',
      input: {
        kind: 'auto',
        selectors: [
          'textarea#userInput',
          'textarea[data-testid="composer-input"]',
          'textarea[placeholder]',
          'textarea',
        ],
      },
      send: {
        mode: 'click',
        selectors: [
          'button[data-testid="submit-button"]',
          'button[aria-label="Submit message"]',
          'button[title="Submit message"]',
          'button[type="submit"]',
        ],
      },
      stop: {
        selectors: [
          'button[data-testid="stop-button"]',
          'button[aria-label="Stop generating"]',
          'button[aria-label*="Stop" i]',
        ],
      },
      answer: {
        selectors: [
          '[data-content="ai-message"]',
          '[data-testid="message-bubble"]',
          '.ai-message-item',
          'div[class*="assistant"]',
        ],
      },
      login: {
        selectors: ['a[href*="login.live.com"]', 'a[href*="login.microsoftonline.com"]', 'a[href*="signin"]'],
        urlPatterns: ['login.live.com', 'login.microsoftonline.com'],
      },
      answerTimeoutMs: 300000,
      togglesOff: [{ text: /think deeper/i, optional: true }],
    },

    mistral: {
      id: 'mistral',
      name: 'Le Chat',
      monogram: 'M',
      color: '#ff7000',
      hosts: ['chat.mistral.ai'],
      matchPatterns: ['https://chat.mistral.ai/*'],
      newChatUrl: 'https://chat.mistral.ai/chat',
      input: {
        kind: 'contenteditable',
        selectors: [
          'div[contenteditable="true"].ProseMirror',
          'div[contenteditable="true"][role="textbox"]',
          'textarea[placeholder]',
          'textarea',
        ],
      },
      send: {
        mode: 'click',
        selectors: ['button[type="submit"]', 'button[aria-label="Send"]', 'button[aria-label*="Send" i]'],
      },
      stop: {
        selectors: ['button[aria-label="Stop"]', 'button[aria-label*="Stop" i]'],
      },
      answer: {
        selectors: ['div.prose', 'div[class*="assistant"][class*="message"]', 'div[class*="markdown"]'],
      },
      login: {
        selectors: ['a[href*="/auth/login"]', 'a[href*="login"]', 'button[data-testid="login-button"]'],
        urlPatterns: ['/auth/login'],
      },
      answerTimeoutMs: 300000,
      togglesOff: [],
    },

    qwen: {
      id: 'qwen',
      name: 'Qwen',
      monogram: 'Q',
      color: '#615ced',
      hosts: ['chat.qwen.ai', 'chat.qwenlm.ai'],
      matchPatterns: ['https://chat.qwen.ai/*', 'https://chat.qwenlm.ai/*'],
      newChatUrl: 'https://chat.qwen.ai/',
      input: {
        kind: 'auto',
        // Read off chat.qwen.ai: the box is `textarea.message-input-textarea`, placeholder "Ask
        // Qwen", with no id — the `#chat-input` this used to look for first is not there, so
        // every read went through the `textarea[placeholder]` fallback and nothing guaranteed
        // it was the composer rather than some other box on the page.
        selectors: [
          'textarea.message-input-textarea',
          'textarea#chat-input',
          'textarea[placeholder]',
          'div[contenteditable="true"]',
          'textarea',
        ],
      },
      send: {
        mode: 'enter',
        // The control is `button.send-button` with `aria-label="Send"`, and it is disabled until
        // there is something in the box. Enter is still the press that goes out first — it is
        // what the page is built around — and this stays the retry for when Enter is swallowed.
        selectors: [
          'button.send-button',
          'button#send-message-button',
          'div[role="button"][aria-label*="send" i]',
          'button[aria-label*="send" i]',
          'button[type="submit"]',
        ],
      },
      stop: {
        selectors: ['button[id*="stop" i]', 'div[role="button"][aria-label*="stop" i]', 'button[aria-label*="Stop" i]'],
      },
      answer: {
        // `.qwen-chat-message-assistant` is the turn itself; the `response-message` wrappers
        // around it are what the old list matched, which meant every reply was counted three
        // times over — and the one that mattered, the answer, was never named.
        selectors: [
          'div.qwen-chat-message-assistant',
          '.markdown-content',
          'div[class*="response-message"]',
          'div[class*="markdown"]',
        ],
      },
      login: {
        selectors: ['a[href*="/auth"]', 'button[class*="login"]', 'a[href*="login"]'],
        urlPatterns: ['/auth'],
      },
      answerTimeoutMs: 300000,
      togglesOff: [{ text: /^thinking/i, optional: true }],
    },

    kimi: {
      id: 'kimi',
      name: 'Kimi',
      monogram: 'K',
      color: '#1d4ed8',
      // Kimi moved to kimi.ai; the old addresses stay here because a tab that was opened before
      // the rebrand is still this site, and a tab on an address we no longer claim stops answering
      // us without ever looking broken on screen.
      hosts: ['kimi.ai', 'www.kimi.ai', 'kimi.com', 'www.kimi.com', 'kimi.moonshot.cn'],
      matchPatterns: [
        'https://kimi.ai/*',
        'https://www.kimi.ai/*',
        'https://kimi.com/*',
        'https://www.kimi.com/*',
        'https://kimi.moonshot.cn/*',
      ],
      newChatUrl: 'https://www.kimi.ai/',
      input: {
        kind: 'auto',
        selectors: [
          'div[contenteditable="true"]#chat-input',
          'div[contenteditable="true"]',
          'textarea[placeholder]',
          'textarea',
        ],
      },
      send: {
        mode: 'enter',
        selectors: ['div[class*="send-button"]', 'button[aria-label="Send"]', 'button[type="submit"]'],
      },
      stop: {
        selectors: ['div[class*="stop-button"]', 'button[aria-label*="Stop" i]', 'div[class*="stop"]'],
      },
      answer: {
        selectors: ['div[class*="segment-content"]', '.markdown', 'div[class*="markdown"]'],
      },
      login: {
        selectors: ['a[href*="/login"]', 'a[href*="login"]', 'button[class*="login"]'],
        urlPatterns: ['/login'],
      },
      answerTimeoutMs: 300000,
      togglesOff: [{ text: /long thinking/i, optional: true }, { text: /^thinking/i, optional: true }],
    },
  };

  /**
   * Order matters twice: it is the order the popup and dashboard list the AIs, and
   * the order a broadcast walks them in. One prompt at a time, so the ones nearer the
   * top start first.
   */
  const ORDER = [
    'chatgpt',
    'claude',
    'gemini',
    'perplexity',
    'deepseek',
    'grok',
    'copilot',
    'mistral',
    'qwen',
    'kimi',
  ];
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

  /**
   * The words a site puts on its own sign-in door.
   *
   * A visible "Log in" or "Sign in" button is the most reliable evidence that a page has
   * no session, and it is the reason this has to be checked even when a message box is
   * there: ChatGPT and Gemini both let you chat anonymously, so the presence of a composer
   * proves nothing at all. Their markup gives nothing else away — the logged-out ChatGPT
   * page has seven `/auth/login` links and **not one of them is visible** — so the text on
   * the button is the whole signal. One list, because the door says the same thing on every
   * one of them.
   */
  const SIGN_IN_WORDS = [
    /^(log|sign) ?in$/i,
    /^sign ?up( for free)?$/i,
    // "Log in to get answers", "Sign in to Copilot": the site says what is waiting inside.
    /^(log|sign) ?in to .+/i,
    // Federated doors, which is the whole of Copilot's front page: "Sign in with Microsoft".
    /^(log|sign) ?in with .+/i,
  ];

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
    // Opt-in per site. A slow mode is only switched off when the user asked for it
    // (DeepSeek ships on, because it remembers DeepThink between visits). Guessing
    // here would silently click toggles the user never chose, on sites where a
    // "research" switch is something people genuinely want on.
    const wanted = !!(settings && settings.disableSlowModes && settings.disableSlowModes[site.id] === true);
    if (!wanted) return;
    // By selected state first: it survives a translated UI, and it is the only signal
    // DeepSeek gives that DeepThink is on.
    await resetModes(ctx.doc, site);
    if (!site.togglesOff || !site.togglesOff.length) return;
    for (const toggle of site.togglesOff) {
      await QUIRKS.toggleOff(ctx, toggle);
    }
  }

  // ---------------------------------------------------------------------------
  // Per-site facts that only some sites need
  // ---------------------------------------------------------------------------

  /**
   * The conversation endpoints. Watching these is how an answer's *real* timing is
   * known: a DOM that has stopped changing might just be a slow token, but a network
   * request that has ended has ended. Entries are regexes matched against resource
   * URLs; a site with none falls back to the generic rule in content/netwatch.js.
   */
  const ENDPOINTS = {
    chatgpt: [/\/backend-(api|alt)\/(f\/)?conversation/],
    claude: [/\/completion(\?|$)/, /\/retry_completion(\?|$)/],
    gemini: [/\/StreamGenerate/, /\/BardChatUi/],
    perplexity: [/\/rest\/sse\/perplexity_ask/],
    deepseek: [/\/api\/v0\/chat\/completion/],
  };

  /**
   * Where each site states which model is answering. Read for its own sake — the
   * label is a fact about the answer, not the answer — and it is what lets the
   * dashboard split the numbers by model instead of by site.
   */
  const MODEL_SELECTORS = {
    chatgpt: [
      '[data-testid="model-switcher-dropdown-button"]',
      'button[aria-label*="model" i]',
    ],
    claude: ['[data-testid="model-selector-dropdown"]', 'button[data-testid="model-selector"]'],
    gemini: ['button[aria-label*="model" i]', '.gds-mode-switch-button'],
    perplexity: ['[data-testid="model-selector"]', 'button[aria-label*="model" i]'],
    deepseek: ['.ds-model-selector', 'button[aria-label*="model" i]'],
  };

  /**
   * Where your own prompt shows up once the site has accepted it. Used for one thing:
   * confirming that a prompt is in the conversation, so a retry can tell "that send
   * failed" from "that send worked and you would now have two of them".
   */
  const USER_MESSAGES = {
    chatgpt: ['[data-message-author-role="user"]'],
    claude: ['[data-testid="user-message"]'],
    gemini: ['.query-text-line', 'user-query', '.query-text'],
    perplexity: ['.whitespace-pre-line', '[class*="user-bubble"]'],
    deepseek: ['.ds-message'],
  };

  /**
   * A slow mode that the site leaves switched on and remembers between visits. The
   * difference from `togglesOff` is that these are found by their selected state
   * rather than by their label, which does not break when the site is translated.
   * DeepSeek is the one site where this is on by default, because DeepThink and
   * Search change both the cost and the answer.
   */
  const MODE_RESET_SELECTORS = {
    deepseek: ['.ds-toggle-button.ds-toggle-button--selected'],
  };

  for (const [siteId, site] of Object.entries(SITES)) {
    site.endpointPatterns = ENDPOINTS[siteId] || [];
    site.modelSelectors = MODEL_SELECTORS[siteId] || [];
    site.userMessageSelectors = USER_MESSAGES[siteId] || [];
    site.modeResetSelectors = MODE_RESET_SELECTORS[siteId] || [];
  }

  /**
   * Switch off a slow mode that is currently on, found by its selected state. Returns
   * how many toggles were clicked, so the caller can report what it did.
   */
  async function resetModes(doc, site) {
    const selectors = site.modeResetSelectors || [];
    if (!selectors.length) return 0;
    let clicked = 0;
    for (const selector of selectors) {
      let nodes = [];
      try {
        nodes = [...doc.querySelectorAll(selector)];
      } catch (err) {
        continue;
      }
      for (const node of nodes) {
        try {
          node.click();
          clicked += 1;
          await WF.util.sleep(160);
        } catch (err) {
          /* the toggle went away mid-click */
        }
      }
    }
    return clicked;
  }

  /** Is this URL one of the site's conversation endpoints? */
  function isEndpoint(site, url) {
    const patterns = (site && site.endpointPatterns) || [];
    return patterns.some((pattern) => pattern.test(String(url || '')));
  }

  WF.sites = {
    SITES,
    ORDER,
    list,
    byId,
    fromUrl,
    matchPatterns,
    applyQuirks,
    resetModes,
    isEndpoint,
    ATTENTION_PATTERNS,
    SIGN_IN_WORDS,
    COMPOSER_BLOCKLIST,
  };
})();
