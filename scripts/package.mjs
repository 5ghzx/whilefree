/**
 * Package the built extensions for store upload.
 *
 *   node scripts/package.mjs
 *
 * Produces dist/whilefree-chrome-<version>.zip and dist/whilefree-firefox-<version>.zip using the
 * system `zip`, because a store upload is a plain zip of the extension directory with the manifest
 * at the root. Falls back to a clear message if zip is unavailable.
 */
import { readFile, mkdir, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const DIST = path.join(root, 'dist');

const version = JSON.parse(await readFile(path.join(root, 'src', 'manifest.base.json'), 'utf8')).version;

function hasZip() {
  const result = spawnSync('zip', ['-v'], { encoding: 'utf8' });
  return result.status === 0;
}

async function sizeOf(dir) {
  let bytes = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) bytes += await sizeOf(full);
    else bytes += (await readFile(full)).length;
  }
  return bytes;
}

if (!existsSync(path.join(DIST, 'chrome')) || !existsSync(path.join(DIST, 'firefox'))) {
  console.error('Nothing built yet. Run: npm run build');
  process.exit(1);
}

if (!hasZip()) {
  console.error('The `zip` command is not available. Install it, or zip dist/<browser> by hand.');
  console.error('Remember: the manifest must be at the root of the archive, not inside a folder.');
  process.exit(1);
}

await mkdir(DIST, { recursive: true });

for (const target of ['chrome', 'firefox']) {
  const source = path.join(DIST, target);
  const out = path.join(DIST, `whilefree-${target}-${version}.zip`);
  await rm(out, { force: true });
  // -r recurse, -X drop extra file attributes (store uploads stay byte-stable),
  // -q quiet. Run from inside the directory so the manifest sits at the root.
  const result = spawnSync('zip', ['-r', '-X', '-q', out, '.'], { cwd: source, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`zip failed for ${target}: ${result.stderr || result.stdout}`);
    process.exit(1);
  }
  const bytes = await sizeOf(source);
  console.log(
    `${path.relative(root, out)}  ${(bytes / 1024).toFixed(0)} KiB uncompressed`
  );
}

console.log('\nBoth zips are ready to upload. See docs/STORE_LISTING.md for the submission checklist.');
