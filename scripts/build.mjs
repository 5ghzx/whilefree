/**
 * Build: one source tree, two store-ready extensions.
 *
 * There is no bundler. This script copies src/ to dist/<browser> and writes the one
 * file that genuinely has to differ — manifest.json — because Chrome MV3 runs a
 * module service worker and Firefox MV3 runs a classic event page.
 *
 *   node scripts/build.mjs             build both
 *   node scripts/build.mjs --watch     rebuild on change
 *   node scripts/build.mjs chrome      build one
 */
import { readFile, writeFile, mkdir, rm, cp, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const SRC = path.join(root, 'src');
const DIST = path.join(root, 'dist');

const TARGETS = ['chrome', 'firefox'];
const NOT_SHIPPED = ['manifest.base.json'];

/** Load the canonical file lists by running lib/files.js in this process. */
async function loadFileRegistry() {
  const module = pathToFileURL(path.join(SRC, 'lib', 'files.js')).href;
  await import(module);
  const files = globalThis.WF && globalThis.WF.files;
  if (!files) throw new Error('src/lib/files.js did not register WF.files');
  return files;
}

async function assertFilesExist(list) {
  const missing = [];
  for (const rel of list) {
    if (!existsSync(path.join(SRC, rel))) missing.push(rel);
  }
  if (missing.length) {
    throw new Error(`These files are listed in lib/files.js but do not exist:\n  ${missing.join('\n  ')}`);
  }
}

function contentScripts(patterns, files) {
  return [
    {
      matches: patterns,
      js: files.contentScripts(),
      run_at: 'document_idle',
      all_frames: false,
    },
  ];
}

function chromeManifest(base, files) {
  return {
    ...base,
    minimum_chrome_version: '110',
    background: {
      service_worker: 'background/entry.chrome.js',
      type: 'module',
    },
    content_scripts: contentScripts(base.host_permissions, files),
  };
}

function firefoxManifest(base, files) {
  return {
    ...base,
    background: {
      // Firefox MV3 uses an event page, not a service worker. Passing the same
      // files as classic scripts is what lets both builds share one source tree.
      scripts: files.backgroundScripts(),
    },
    browser_specific_settings: {
      gecko: {
        id: 'whilefree@whilefree.app',
        strict_min_version: '115.0',
        // Nothing is collected, sent or sold. Declared explicitly because Firefox
        // asks, and because "none" is the whole privacy story of this extension.
        data_collection_permissions: { required: ['none'] },
      },
    },
    content_scripts: contentScripts(base.host_permissions, files),
  };
}

async function writeIfChanged(file, contents) {
  const next = typeof contents === 'string' ? contents : JSON.stringify(contents, null, 2) + '\n';
  try {
    const current = await readFile(file, 'utf8');
    if (current === next) return false;
  } catch (err) {
    /* not there yet */
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, next);
  return true;
}

async function buildOne(target, base, files) {
  const outDir = path.join(DIST, target);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await cp(SRC, outDir, { recursive: true });

  for (const rel of NOT_SHIPPED) {
    await rm(path.join(outDir, rel), { force: true });
  }
  // The Chrome entry uses `import`, which a classic event page cannot parse, so it is
  // stripped from the Firefox build only. Do not strip it from Chrome: that is the
  // service worker the manifest points at.
  if (target === 'firefox') {
    await rm(path.join(outDir, 'background', 'entry.chrome.js'), { force: true });
  }

  const manifest = target === 'chrome' ? chromeManifest(base, files) : firefoxManifest(base, files);
  await writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await verifyManifestFiles(outDir, manifest);

  const license = path.join(root, 'LICENSE');
  if (existsSync(license)) await cp(license, path.join(outDir, 'LICENSE'), { force: true });

  const count = await countFiles(outDir);
  return { target, outDir, files: count };
}

/**
 * Every file a manifest points at must exist in the build. A missing service worker is
 * a load failure a user sees as "the extension is broken", so it is worth asserting
 * rather than discovering.
 */
async function verifyManifestFiles(outDir, manifest) {
  const referenced = [
    manifest.background && manifest.background.service_worker,
    ...((manifest.background && manifest.background.scripts) || []),
    ...(manifest.content_scripts || []).flatMap((entry) => entry.js || []),
    manifest.action && manifest.action.default_popup,
    manifest.options_ui && manifest.options_ui.page,
    ...Object.values(manifest.icons || {}),
  ].filter(Boolean);

  const missing = referenced.filter((rel) => !existsSync(path.join(outDir, rel)));
  if (missing.length) {
    throw new Error(
      `the generated manifest.json references files that were not built:\n  ${missing.join('\n  ')}`
    );
  }
  return referenced.length;
}

async function countFiles(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await countFiles(full);
    else total += 1;
  }
  return total;
}

async function run() {
  const files = await loadFileRegistry();
  await assertFilesExist([...files.contentScripts(), ...files.backgroundScripts()]);

  const base = JSON.parse(await readFile(path.join(SRC, 'manifest.base.json'), 'utf8'));
  const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const targets = requested.length ? requested : TARGETS;

  for (const target of targets) {
    if (!TARGETS.includes(target)) throw new Error(`Unknown target: ${target}`);
    const result = await buildOne(target, base, files);
    console.log(`built ${result.target}  ->  ${path.relative(root, result.outDir)}  (${result.files} files)`);
  }
}

async function watch() {
  await run();
  const { watch: watchFs } = await import('node:fs');
  let timer = null;
  watchFs(SRC, { recursive: true }, () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      run().catch((err) => console.error(err.message));
    }, 150);
  });
  console.log('watching src/ ...');
}

try {
  if (process.argv.includes('--watch')) await watch();
  else await run();
} catch (err) {
  console.error(`build failed: ${err.message}`);
  process.exit(1);
}
