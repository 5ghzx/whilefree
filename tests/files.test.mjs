import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'src');

await import('../src/lib/browser.js');
await import('../src/lib/app.js');
await import('../src/lib/util.js');
await import('../src/lib/protocol.js');
await import('../src/lib/sites.js');
await import('../src/lib/files.js');

const { files, MSG, PHASE, STATES, STATE_LABEL } = globalThis.WF;

test('every registered file exists, because the manifest will reference it', () => {
  for (const rel of [...files.contentScripts(), ...files.backgroundScripts(), 'background/entry.chrome.js']) {
    assert.ok(existsSync(path.join(SRC, rel)), `missing: ${rel}`);
  }
});

test('no file is listed twice: double execution would double-count timings', () => {
  for (const list of [files.contentScripts(), files.backgroundScripts()]) {
    assert.equal(new Set(list).size, list.length);
  }
});

test('the content script bundle ends with the bootstrap', () => {
  const list = files.contentScripts();
  assert.equal(list[list.length - 1], 'content/main.js');
});

test('the background bundle ends with the worker that initialises everything', () => {
  const list = files.backgroundScripts();
  assert.equal(list[list.length - 1], 'background/background.js');
});

test('shared helpers are loaded before the code that uses them', () => {
  const list = files.contentScripts();
  const at = (name) => list.findIndex((rel) => rel.endsWith(name));
  assert.ok(at('lib/browser.js') < at('lib/util.js'));
  assert.ok(at('lib/util.js') < at('lib/sites.js'));
  assert.ok(at('lib/sites.js') < at('lib/settings.js'));
  assert.ok(at('lib/settings.js') < at('lib/stats.js'));
  assert.ok(at('lib/dom.js') < at('content/composer.js'));
});

test('the background does not ship DOM helpers', () => {
  assert.equal(files.backgroundScripts().includes('lib/dom.js'), false);
});

test('no content CSS file is declared: the overlay styles itself in a shadow root', () => {
  assert.equal(files.CONTENT_CSS, undefined);
  assert.equal(files.contentScripts().some((rel) => rel.endsWith('.css')), false);
});

test('message and phase constants are frozen and complete', () => {
  assert.ok(Object.isFrozen(MSG));
  assert.ok(Object.isFrozen(PHASE));
  assert.ok(Object.isFrozen(STATES));

  for (const [key, value] of Object.entries(MSG)) {
    assert.match(value, /^wf:/, `${key} should be namespaced`);
  }
  assert.equal(new Set(Object.values(MSG)).size, Object.keys(MSG).length, 'no duplicate values');

  // Every message the router must answer has a route in background/background.js.
  for (const key of ['HELLO', 'STATE', 'ACTIVITY', 'BROADCAST', 'GET_STATE', 'SET_SETTINGS', 'TEST_SITE']) {
    assert.ok(MSG[key], `missing message type: ${key}`);
  }
  // Every phase a content script can report is handled.
  for (const phase of ['SENT', 'STREAMING', 'DONE', 'ERROR', 'ATTENTION', 'TIMEOUT']) {
    assert.ok(PHASE[phase], `missing phase: ${phase}`);
  }
  assert.deepEqual(STATES, ['writing', 'waiting', 'waitingAway', 'reading']);
  for (const state of STATES) {
    assert.equal(typeof STATE_LABEL[state], 'string');
  }
});

test('identity is read from the manifest, and the licence is a free one', () => {
  // Outside an extension there is no manifest to read, so name() falls back.
  assert.equal(typeof globalThis.WF.app.name(), 'string');
  assert.ok(globalThis.WF.app.name().length > 0);
  assert.equal(globalThis.WF.app.license, 'MIT');
  assert.match(globalThis.WF.app.repo, /^https:\/\/github\.com\//);
  assert.equal(typeof globalThis.WF.app.footer(), 'string');
});
