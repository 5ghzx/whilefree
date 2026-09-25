/**
 * Consistency checks, the typechecker this project does not have.
 *
 * A no-build extension has one real hazard: the manifest, the runtime file lists and
 * the source can drift apart silently. Everything here exists to make that drift
 * impossible to merge.
 *
 *   node scripts/check.mjs
 */
import { readFile, readdir, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const SRC = path.join(root, 'src');

let failures = 0;
let checks = 0;

function ok(message) {
  checks += 1;
  console.log(`  ok    ${message}`);
}

function fail(message) {
  checks += 1;
  failures += 1;
  console.log(`  FAIL  ${message}`);
}

async function walk(dir, filter) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, filter)));
    else if (!filter || filter(full)) out.push(full);
  }
  return out;
}

// --- 1. Every JavaScript file parses ----------------------------------------

const jsFiles = [
  ...(await walk(SRC, (f) => f.endsWith('.js'))),
  ...(await walk(here, (f) => f.endsWith('.mjs'))),
];

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`syntax: ${path.relative(root, file)}\n${result.stderr.trim()}`);
  }
}
if (!failures) ok(`${jsFiles.length} JavaScript files parse`);

// --- 2. Every JSON file parses ---------------------------------------------

const jsonFiles = [
  ...(await walk(SRC, (f) => f.endsWith('.json'))),
  path.join(root, 'package.json'),
];
for (const file of jsonFiles) {
  try {
    JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    fail(`json: ${path.relative(root, file)}: ${err.message}`);
  }
}
ok(`${jsonFiles.length} JSON files parse`);

// --- 3. The file registry matches the source tree ---------------------------

await import(pathToFileURL(path.join(SRC, 'lib', 'files.js')).href);
const files = globalThis.WF.files;
const expected = [
  ...files.contentScripts(),
  ...files.backgroundScripts(),
  'background/entry.chrome.js',
];
const missing = expected.filter((rel) => !existsSync(path.join(SRC, rel)));
if (missing.length) fail(`listed in lib/files.js but missing: ${missing.join(', ')}`);
else ok(`all ${expected.length} registered files exist`);

// The other direction, which is the dangerous one: a file that exists, is referenced
// by something that runs, and is in no list. Nothing loads it, so the reference fails
// at runtime — inside a page, with no build step to complain first.
// Page scripts are reached through an HTML <script src>, and whatever those import.
// Walking the import graph rather than hardcoding a list keeps a new page script from
// silently counting as "loaded by something".
const registered = new Set(expected);
const queue = [];
for (const file of await walk(SRC, (f) => f.endsWith('.html'))) {
  const html = await readFile(file, 'utf8');
  for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    queue.push(path.resolve(path.dirname(file), match[1]));
  }
}
while (queue.length) {
  const file = queue.shift();
  const rel = path.relative(SRC, file).split(path.sep).join('/');
  if (registered.has(rel)) continue;
  registered.add(rel);
  let text = '';
  try {
    text = await readFile(file, 'utf8');
  } catch (err) {
    continue;
  }
  for (const match of text.matchAll(/^\s*import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/gm)) {
    if (match[1].startsWith('.')) queue.push(path.resolve(path.dirname(file), match[1]));
  }
}

const unregistered = (await walk(SRC, (f) => f.endsWith('.js')))
  .map((f) => path.relative(SRC, f).split(path.sep).join('/'))
  .filter((rel) => !registered.has(rel));
if (unregistered.length) {
  fail(`JavaScript in src/ that nothing loads: ${unregistered.join(', ')}`);
} else {
  ok('every source file is loaded by something');
}

// Order matters: content scripts and background scripts share globals, so a file
// that defines something must come before the file that uses it.
function indexOf(list, needle) {
  return list.findIndex((rel) => rel.includes(needle));
}
const content = files.contentScripts();
const orderRules = [
  ['lib/browser.js', 'lib/util.js'],
  ['lib/util.js', 'lib/sites.js'],
  ['lib/protocol.js', 'content/composer.js'],
  ['lib/dom.js', 'content/main.js'],
  ['content/detect.js', 'content/main.js'],
];
for (const [before, after] of orderRules) {
  const a = indexOf(content, before);
  const b = indexOf(content, after);
  if (a === -1 || b === -1 || a > b) fail(`load order: ${before} must come before ${after}`);
}
if (!failures) ok('content script load order is sound');

const backgroundOrder = files.backgroundScripts();
if (!backgroundOrder[backgroundOrder.length - 1].endsWith('background/background.js')) {
  fail('background/background.js must be last: it self-initialises');
} else {
  ok('background script order is sound');
}

// The Chrome service worker cannot be handed a list — a module worker imports what it
// needs — so `background/entry.chrome.js` repeats the same files by hand. That is the one
// place a file can ship and simply never load, and it is invisible to everything else:
// the tests load the canonical list, so a file missing from the entry breaks Chrome and
// nothing else. It has happened twice (no delivery ledger, no WF.status).
const entryRel = 'background/entry.chrome.js';
const entryText = await readFile(path.join(SRC, entryRel), 'utf8');
const entryImports = [...entryText.matchAll(/^\s*import\s+'([^']+)'/gm)].map((m) => m[1]);
const expectedImports = backgroundOrder.map((rel) =>
  rel.startsWith('lib/') ? `../${rel}` : `./${rel.slice('background/'.length)}`
);
const notImported = expectedImports.filter((rel) => !entryImports.includes(rel));
const unexpected = entryImports.filter((rel) => !expectedImports.includes(rel));
const outOfOrder = expectedImports.findIndex((rel, i) => entryImports[i] !== rel) !== -1;
if (notImported.length) fail(`${entryRel} does not import: ${notImported.join(', ')}`);
if (unexpected.length) fail(`${entryRel} imports files the background list does not: ${unexpected.join(', ')}`);
if (!notImported.length && !unexpected.length && outOfOrder) {
  fail(`${entryRel} imports the right files in the wrong order`);
}
if (!notImported.length && !unexpected.length && !outOfOrder) {
  ok(`${entryRel} loads exactly the background list, in order`);
}

// --- 4. Manifest sanity -----------------------------------------------------

const base = JSON.parse(await readFile(path.join(SRC, 'manifest.base.json'), 'utf8'));
if (base.manifest_version !== 3) fail('manifest_version must be 3');

const patterns = base.host_permissions || [];
if (!patterns.length) fail('host_permissions is empty');
const badPattern = patterns.find((p) => !/^https?:\/\/[^/]+\/\*$/.test(p));
if (badPattern) fail(`host_permissions entry is not a valid match pattern: ${badPattern}`);

// Content scripts must be injectable everywhere we claim to work.
const contentMatches = patterns.filter((p) => p.startsWith('https://'));
if (contentMatches.length !== patterns.length) fail('all host permissions should be https');

const permissions = base.permissions || [];
// We deliberately avoid "tabs": with host permissions we can read the url of our own
// five sites and nothing else. Adding it would ask for the whole browsing history.
if (permissions.includes('tabs')) {
  fail('the tabs permission is not needed and costs a scary install warning');
}
if (!permissions.includes('storage')) fail('storage permission is required');
for (const key of ['name', 'version', 'description', 'icons', 'action', 'options_ui']) {
  if (!base[key]) fail(`manifest.base.json is missing ${key}`);
}
for (const size of ['16', '32', '48', '128']) {
  const rel = base.icons[size];
  if (!rel || !existsSync(path.join(SRC, rel))) fail(`missing icon ${size}: ${rel}`);
}
if (base.version && !/^\d+\.\d+\.\d+$/.test(base.version)) {
  fail(`manifest version must be 1-4 dot separated integers: ${base.version}`);
}
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (pkg.version !== base.version) {
  fail(`package.json version (${pkg.version}) and manifest version (${base.version}) disagree`);
}
ok('manifest base looks sane');

// --- 4b. Every message sent into a tab is handled in a tab -------------------
//
// The bug this exists for: the engine warmed every target with `WF.MSG.READY`, and no
// content script had ever heard of it. In a browser that is indistinguishable from a site
// with no message box, so every target failed with "its message box never appeared" while
// the pages were perfectly fine — and twelve other checks were green. The same mistake
// left "Check markup" (TEST_SITE) answering from nowhere.

const contentDir = path.join(SRC, 'content');
const contentText = (
  await Promise.all((await walk(contentDir, (f) => f.endsWith('.js'))).map((f) => readFile(f, 'utf8')))
).join('\n');
const contentHandles = new Set(
  [...contentText.matchAll(/case\s+(?:WF\.)?MSG\.([A-Z][A-Z0-9_]*)\s*:/g)].map((m) => m[1])
);

const unanswered = [];
for (const file of await walk(path.join(SRC, 'background'), (f) => f.endsWith('.js'))) {
  const text = await readFile(file, 'utf8');
  // `sendToTab(tabId, { type: MSG.X ... })` — the call style this codebase uses. A
  // message assembled elsewhere and passed as a variable cannot be checked here; those
  // are all job updates the content scripts are known to handle.
  for (const match of text.matchAll(/sendToTab\([^;]{0,240}?type:\s*(?:WF\.)?MSG\.([A-Z][A-Z0-9_]*)/g)) {
    if (!contentHandles.has(match[1])) {
      unanswered.push(`${match[1]} (${path.relative(root, file)})`);
    }
  }
}
if (unanswered.length) {
  fail(`sent into a tab but handled by no content script: ${[...new Set(unanswered)].join(', ')}`);
} else {
  ok(`${contentHandles.size} tab messages, all answered in the content scripts`);
}

// --- 5. Message types used in code are declared -----------------------------

const protocol = await readFile(path.join(SRC, 'lib', 'protocol.js'), 'utf8');
const declared = new Set(
  [...protocol.matchAll(/^\s{4}([A-Z][A-Z0-9_]*):\s*'/gm)].map((m) => m[1])
);
const used = new Map();
for (const file of await walk(SRC, (f) => f.endsWith('.js'))) {
  const text = await readFile(file, 'utf8');
  for (const match of text.matchAll(/\bMSG\.([A-Z][A-Z0-9_]*)\b/g)) {
    if (!used.has(match[1])) used.set(match[1], path.relative(root, file));
  }
}
const undeclared = [...used.keys()].filter((key) => !declared.has(key));
if (undeclared.length) {
  fail(
    `message types used but not declared in lib/protocol.js: ${undeclared
      .map((k) => `${k} (${used.get(k)})`)
      .join(', ')}`
  );
} else {
  ok(`${used.size} message types used, all declared`);
}

// --- 6. HTML references resolve to real files -------------------------------

const htmlFiles = await walk(SRC, (f) => f.endsWith('.html'));
for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  const refs = [
    ...[...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<link[^>]+href="([^"]+)"/g)].map((m) => m[1]),
  ].filter((ref) => !/^(https?:)?\/\//.test(ref));
  for (const ref of refs) {
    const resolved = path.resolve(path.dirname(file), ref);
    try {
      await access(resolved);
    } catch (err) {
      fail(`${path.relative(root, file)} references a missing file: ${ref}`);
    }
  }
}
if (!failures) ok(`${htmlFiles.length} HTML files reference real assets`);

// --- 7. ES module entry points keep working ---------------------------------

for (const rel of ['popup/popup.js', 'dashboard/dashboard.js', 'background/entry.chrome.js']) {
  const text = await readFile(path.join(SRC, rel), 'utf8');
  if (!/\bimport\b/.test(text)) fail(`${rel} is loaded as a module but imports nothing`);
  // Shared files must stay dual-mode: importable as a module and loadable as a
  // classic script, which means no import/export of their own.
}
for (const rel of files.SHARED.concat(files.CONTENT_LIB, files.CONTENT, files.BACKGROUND)) {
  const text = await readFile(path.join(SRC, rel), 'utf8');
  if (/^\s*(import|export)\b/m.test(text)) {
    fail(`${rel} must not use import/export: it is also loaded as a classic script`);
  }
  if (!/globalThis\.WF/.test(text)) fail(`${rel} does not register anything on globalThis.WF`);
}
ok('shared files are dual-mode (classic script and ES module)');

// --- 8. No stray debugging or secrets --------------------------------------

for (const file of await walk(SRC, (f) => f.endsWith('.js'))) {
  const text = await readFile(file, 'utf8');
  if (/console\.log\(/.test(text)) {
    fail(`${path.relative(root, file)} has a console.log in shipped code`);
  }
  if (/(api[_-]?key|secret|password)\s*[:=]\s*['"][^'"]{8,}/i.test(text)) {
    fail(`${path.relative(root, file)} looks like it contains a credential`);
  }
}
ok('no console.log or credentials in src/');

// --- 9. Namespace references resolve ----------------------------------------
// Nothing compiles this project, so a typo like `WF.stats.weeklyDigets(...)` would only
// show up when that code path runs — possibly weeks later, in front of a user. Every
// `WF.x.y` and `bg.x.y` reference must have a definition in the file that owns `WF.x`.

const sources = new Map();
for (const file of await walk(SRC, (f) => f.endsWith('.js'))) {
  sources.set(file, await readFile(file, 'utf8'));
}

/**
 * The file(s) that create a namespace, and whether it is actually an object literal we
 * can check members against. `WF.MAY_HAVE_LANDED = Object.freeze([...])` is a value, not
 * a namespace: `WF.MAY_HAVE_LANDED.includes` is Array.prototype, not a missing function.
 */
function owners(prefix) {
  const escaped = prefix.replace(/\./g, '\\.');
  const files = [];
  let objectLike = false;
  for (const [file, text] of sources) {
    const match = text.match(new RegExp(`\\b${escaped}\\s*=\\s*([^;\\n]*)`));
    if (!match) continue;
    files.push({ rel: path.relative(SRC, file).split(path.sep).join('/'), text });
    const rhs = match[1].trim();
    if (rhs.startsWith('{') || /^[\w$.]+\s*\|\|\s*\{/.test(rhs)) objectLike = true;
  }
  return { files, objectLike };
}

function isDefined(texts, name) {
  const escaped = name.replace(/[$]/g, '\\$');
  const patterns = [
    new RegExp(`\\bfunction\\s+${escaped}\\b`),
    new RegExp(`\\basync\\s+${escaped}\\b`),
    // Object-literal method shorthand: `name() { ... }`.
    new RegExp(`\\b${escaped}\\s*\\([^)]*\\)\\s*\\{`),
    new RegExp(`\\bclass\\s+${escaped}\\b`),
    // Shorthand in an exported object literal: `{ AnswerWatcher, noteStream }`.
    new RegExp(`[{,]\\s*${escaped}\\s*[,}]`),
    new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\b`),
    new RegExp(`\\b${escaped}\\s*:`),
    new RegExp(`\\b${escaped}\\s*=[^=]`),
  ];
  return texts.some((text) => patterns.some((re) => re.test(text)));
}

// Namespaces that are not plain `WF.<ns> = {...}` objects are checked elsewhere:
// MSG keys by check 5, and `WF.bg` is only ever a container for the others.
//
// The content scripts and the background both hold a local alias for their own
// namespace (`const content = (WF.content = ...)`, `const bg = ...`), so a reference can
// arrive as `content.overlay.toast` or `bg.engine.state` just as easily as
// `WF.stats.summarize`. Those aliases are where the interesting mistakes live, so they
// are resolved back to the file that owns the namespace rather than skipped.
const skip = new Set(['MSG', 'bg']);
const dangling = new Set();
const seen = new Set();

function prefixFor(rootName, ns) {
  if (rootName === 'bg') return `bg.${ns}`;
  if (rootName === 'content') return `content.${ns}`;
  // `WF.content.overlay.x` and `content.overlay.x` are the same object; the namespace is
  // created as `content.overlay = {...}` in both cases.
  if (rootName === 'WF.content') return `content.${ns}`;
  return `WF.${ns}`;
}

const refPattern = /\b(WF\.content|WF|bg|content)\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g;

for (const [file, text] of sources) {
  for (const match of text.matchAll(refPattern)) {
    const rootName = match[1];
    const ns = match[2];
    const name = match[3];
    const prefix = prefixFor(rootName, ns);
    if (rootName === 'WF' && skip.has(ns)) continue;
    const key = `${prefix}.${name}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const { files: ownerFiles, objectLike } = owners(prefix);
    const referrer = path.relative(SRC, file).split(path.sep).join('/');
    if (!ownerFiles.length) {
      dangling.add(`${key} (no file defines ${prefix}) at ${path.relative(root, file)}`);
    } else if (objectLike && !isDefined(ownerFiles.map((o) => o.text), name)) {
      dangling.add(`${key} at ${path.relative(root, file)}`);
    } else {
      // The reference resolves — but only if the file defining it actually loads in the
      // same context. `content/netwatch.js` and `background/ledger.js` were both reachable
      // and unregistered at once, which passes every other check here and still leaves a
      // dead extension on every page. So: same list, or this is a bug.
      const lists = [
        { name: 'content scripts', files: files.contentScripts() },
        { name: 'background scripts', files: files.backgroundScripts() },
      ];
      for (const list of lists) {
        if (!list.files.includes(referrer)) continue;
        const loaded = ownerFiles.some((owner) => list.files.includes(owner.rel));
        if (!loaded) {
          const where = ownerFiles.map((owner) => owner.rel).join(', ');
          dangling.add(
            `${key} at ${referrer}: defined in ${where}, which is not in the ${list.name} list in lib/files.js`
          );
        }
      }
    }
  }
}

if (dangling.size) {
  fail(`references with no definition:\n      ${[...dangling].join('\n      ')}`);
} else {
  ok(`${seen.size} namespace references resolve, in a list that loads them`);
}

// --- Summary ----------------------------------------------------------------

console.log('');
if (failures) {
  console.log(`${failures} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`all ${checks} checks passed`);
