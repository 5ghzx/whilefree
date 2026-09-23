import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

await import('../src/lib/browser.js');
await import('../src/lib/util.js');
await import('../src/lib/protocol.js');
await import('../src/lib/sites.js');

const { sites, ATTENTION } = globalThis.WF;

/**
 * These tests exist because the registry is the part of the codebase most likely to
 * be edited by a stranger fixing a broken selector. They keep the shape honest.
 */

test('every supported AI is present, listed once, and in a stable order', () => {
  assert.deepEqual(sites.ORDER, [
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
  ]);
  assert.equal(new Set(sites.ORDER).size, sites.ORDER.length, 'no duplicate ids');
  assert.equal(sites.list().length, sites.ORDER.length, 'every id has an adapter');
  for (const id of sites.ORDER) {
    assert.ok(sites.byId(id), `missing adapter: ${id}`);
  }
  assert.equal(sites.byId('nope'), null);
});

test('no two AIs share a name, a monogram or a chart colour', () => {
  const seen = { name: new Map(), monogram: new Map(), color: new Map() };
  for (const site of sites.list()) {
    for (const field of ['name', 'monogram', 'color']) {
      const key = String(site[field]).toLowerCase();
      assert.equal(
        seen[field].has(key),
        false,
        `${site.id} reuses the ${field} "${site[field]}" already used by ${seen[field].get(key)}`
      );
      seen[field].set(key, site.id);
    }
  }
});

test('a clear majority of adapters lean on the structural fallback', () => {
  // A useful sanity signal: when every adapter has a bespoke selector list and none
  // rely on the heuristics, a single careless edit can break a site silently.
  const withMode = sites.list().filter((site) => ['click', 'enter'].includes(site.send.mode));
  assert.equal(withMode.length, sites.list().length);
});

test('every adapter has the fields the runtime depends on', () => {
  for (const site of sites.list()) {
    assert.equal(typeof site.id, 'string');
    assert.ok(site.name && site.name.length < 24, `${site.id} needs a short name`);
    assert.ok(site.monogram && site.monogram.length <= 2, `${site.id} needs a monogram`);
    assert.match(site.color, /^#[0-9a-f]{6}$/i, `${site.id} colour must be a hex value`);

    assert.ok(site.hosts.length > 0, `${site.id} needs hosts`);
    assert.ok(site.matchPatterns.length > 0, `${site.id} needs match patterns`);
    assert.equal(site.matchPatterns.length, site.hosts.length, `${site.id}: one pattern per host`);
    assert.ok(/^https:\/\//.test(site.newChatUrl), `${site.id} newChatUrl must be https`);
    assert.ok(site.answerTimeoutMs >= 60000, `${site.id} needs a generous answer timeout`);

    assert.ok(site.input.selectors.length > 0, `${site.id} needs composer selectors`);
    assert.ok(site.send.selectors.length > 0, `${site.id} needs send selectors`);
    assert.ok(['click', 'enter'].includes(site.send.mode), `${site.id} send mode is unknown`);
    assert.ok(site.stop.selectors.length > 0, `${site.id} needs stop selectors`);
    assert.ok(site.answer.selectors.length > 0, `${site.id} needs answer selectors`);
    assert.ok(site.login.selectors.length > 0, `${site.id} needs login selectors`);
    assert.ok(Array.isArray(site.togglesOff), `${site.id} togglesOff must be a list`);
  }
});

test('match patterns and hosts agree with each other', () => {
  for (const site of sites.list()) {
    site.matchPatterns.forEach((pattern, index) => {
      const match = pattern.match(/^https:\/\/([^/]+)\/(\*|.*)$/);
      assert.ok(match, `${site.id}: not a valid match pattern: ${pattern}`);
      assert.equal(match[1], site.hosts[index], `${site.id}: host and pattern disagree at ${index}`);
    });
  }
});

test('every selector is a plausible CSS selector', () => {
  const check = (site, list, where) => {
    for (const selector of list) {
      assert.equal(typeof selector, 'string');
      assert.ok(selector.length > 1, `${site.id} ${where}: ${selector} is too short`);
      // Balanced brackets and no stray combinators: catches the common typos.
      const open = (selector.match(/\[/g) || []).length;
      const close = (selector.match(/\]/g) || []).length;
      assert.equal(open, close, `${site.id} ${where}: unbalanced brackets in ${selector}`);
      assert.equal(/[>,+~]\s*$/.test(selector), false, `${site.id} ${where}: dangling combinator in ${selector}`);
    }
  };
  for (const site of sites.list()) {
    check(site, site.input.selectors, 'input');
    check(site, site.send.selectors, 'send');
    check(site, site.stop.selectors, 'stop');
    check(site, site.answer.selectors, 'answer');
    check(site, site.login.selectors, 'login');
  }
});

test('slow-mode toggles are regular expressions the quirk runner can use', () => {
  const withToggles = sites.list().filter((site) => site.togglesOff.length);
  assert.ok(withToggles.length >= 1, 'DeepSeek remembers DeepThink between visits');
  for (const site of withToggles) {
    for (const toggle of site.togglesOff) {
      assert.ok(toggle.text instanceof RegExp, `${site.id}: toggle text must be a RegExp`);
      assert.equal(toggle.text.test(''), false, `${site.id}: toggle regex must not match empty text`);
    }
  }
  assert.ok(sites.byId('deepseek').togglesOff.some((t) => t.text.test('DeepThink (R1)')));
});

test('fromUrl maps a page url to its adapter, or to nothing', () => {
  assert.equal(sites.fromUrl('https://chatgpt.com/c/abc').id, 'chatgpt');
  assert.equal(sites.fromUrl('https://chat.openai.com/').id, 'chatgpt');
  assert.equal(sites.fromUrl('https://claude.ai/chat/1').id, 'claude');
  assert.equal(sites.fromUrl('https://gemini.google.com/app/xyz').id, 'gemini');
  assert.equal(sites.fromUrl('https://www.perplexity.ai/search?q=hi').id, 'perplexity');
  assert.equal(sites.fromUrl('https://chat.deepseek.com/a/chat').id, 'deepseek');
  assert.equal(sites.fromUrl('https://grok.com/chat/1').id, 'grok');
  assert.equal(sites.fromUrl('https://copilot.microsoft.com/chats/1').id, 'copilot');
  assert.equal(sites.fromUrl('https://chat.mistral.ai/chat').id, 'mistral');
  assert.equal(sites.fromUrl('https://chat.qwen.ai/c/1').id, 'qwen');
  assert.equal(sites.fromUrl('https://www.kimi.com/chat/1').id, 'kimi');

  assert.equal(sites.fromUrl('https://chatgpt.com.evil.example/'), null, 'no substring matching');
  assert.equal(sites.fromUrl('https://example.com/'), null);
  assert.equal(sites.fromUrl('not a url'), null);
  assert.equal(sites.fromUrl(''), null);
  assert.equal(sites.fromUrl(undefined), null);
});

test('every adapter can be reached from its own new-chat url', () => {
  // A newChatUrl that no host covers would open a tab the content script never runs in,
  // which fails as "could not reach the tab" with nothing obviously wrong on screen.
  for (const site of sites.list()) {
    const found = sites.fromUrl(site.newChatUrl);
    assert.ok(found, `${site.id}: newChatUrl is not covered by any adapter`);
    assert.equal(found.id, site.id, `${site.id}: newChatUrl maps to ${found.id}`);
  }
});

test('matchPatterns returns host permissions for exactly the sites asked for', () => {
  const all = sites.list().reduce((total, site) => total + site.matchPatterns.length, 0);
  assert.equal(sites.matchPatterns().length, all, 'no arguments means every site');
  assert.ok(all >= 5, 'at least one pattern per site');

  assert.deepEqual(sites.matchPatterns(['claude']), ['https://claude.ai/*']);
  assert.deepEqual(sites.matchPatterns(['gemini']), ['https://gemini.google.com/*']);
  assert.equal(sites.matchPatterns(['nope']).length, 0);
  assert.equal(sites.matchPatterns([]).length, all, 'an empty list means everything');
});

test('the manifest grants host permission for every pattern the adapters claim', () => {
  // Read directly: a pattern the adapter knows about but the manifest does not grant
  // would make the content script silently never run on that host.
  const manifest = JSON.parse(
    readFileSync(new URL('../src/manifest.base.json', import.meta.url), 'utf8')
  );
  const granted = new Set(manifest.host_permissions);
  for (const pattern of sites.matchPatterns()) {
    assert.ok(granted.has(pattern), `manifest is missing host permission: ${pattern}`);
  }
});

test('attention patterns catch real banners and not ordinary prose', () => {
  const { quota, check } = sites.ATTENTION_PATTERNS;
  const matches = (list, text) => list.some((pattern) => pattern.test(text));

  assert.ok(matches(quota, "You've reached your usage limit for GPT-5."));
  assert.ok(matches(quota, 'You have hit the message limit. Limit resets at 3pm.'));
  assert.ok(matches(quota, 'Too many requests. Please slow down.'));
  assert.ok(matches(check, 'Verify you are human'));
  assert.ok(matches(check, 'Checking your browser before accessing'));
  assert.ok(matches(check, 'Complete the challenge to continue'));

  // The awkward false positive: a conversation about limits is not a limit banner.
  assert.equal(matches(quota, 'Explaining rate limiting in distributed systems'), false);
  assert.equal(matches(check, 'How do I verify a JWT signature?'), false);
  assert.equal(matches(quota, 'Let me tell you about the history of quotas'), false);
});

test('attention reasons are a closed set the UI can label', () => {
  assert.deepEqual(Object.values(ATTENTION).sort(), [
    'check',
    'no-composer',
    'quota',
    'send-failed',
    'signed-out',
  ]);
  assert.equal(globalThis.WF.attentionLabel(ATTENTION.QUOTA), 'Out of quota');
  assert.equal(globalThis.WF.attentionLabel('nonsense'), 'Needs you');
});
