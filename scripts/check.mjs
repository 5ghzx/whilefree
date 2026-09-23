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

// --- Summary ----------------------------------------------------------------

console.log('');
if (failures) {
  console.log(`${failures} of ${checks} checks failed`);
  process.exit(1);
}
console.log(`all ${checks} checks passed`);
