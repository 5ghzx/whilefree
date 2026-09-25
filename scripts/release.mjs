/**
 * Cut a release.
 *
 *   node scripts/release.mjs patch            # 0.1.0 -> 0.1.1
 *   node scripts/release.mjs minor|major      # the other two
 *   node scripts/release.mjs 1.2.0            # or say the version outright
 *   node scripts/release.mjs patch --push     # and push the commit and the tag
 *
 * The checklist in docs/STORE_LISTING.md is six steps, and four of them are mechanical. Leaving
 * them to hand is how a release ends up tagged v0.2.0 while the manifest inside the uploaded zip
 * still says 0.1.0: `npm run check` can compare the two version strings, and cannot see a git tag
 * at all. So the four are here, in order, and the tag is made from the same string that was just
 * written into both files.
 *
 * The tag is also the whole trigger for the release on GitHub: .github/workflows/verify.yml runs
 * the checks, builds both browsers, zips them for the stores, and attaches those zips to a release
 * named after the tag. Nothing here uploads anything, which is why --push is explicit and why the
 * parts a human still has to do — the smoke test and the store uploads — are printed at the end
 * rather than pretended away.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const MANIFEST = path.join(root, 'src', 'manifest.base.json');
const PACKAGE = path.join(root, 'package.json');
const CHANGELOG = path.join(root, 'CHANGELOG.md');

const args = process.argv.slice(2);
const push = args.includes('--push');
const wanted = args.find((arg) => !arg.startsWith('--'));

function run(command, commandArgs, options) {
  const result = spawnSync(command, commandArgs, { cwd: root, encoding: 'utf8', ...(options || {}) });
  if (result.status !== 0) {
    console.error(`\n${command} ${commandArgs.join(' ')} failed:\n${result.stderr || result.stdout}`);
    process.exit(1);
  }
  return result.stdout || '';
}

/** The next version, from the one we are on. No semver dependency: this is all the arithmetic. */
function bump(current, level) {
  const parts = current.split('.').map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    console.error(`The current version is not x.y.z: ${current}`);
    process.exit(1);
  }
  const [major, minor, patch] = parts;
  if (level === 'major') return `${major + 1}.0.0`;
  if (level === 'minor') return `${major}.${minor + 1}.0`;
  if (level === 'patch') return `${major}.${minor}.${patch + 1}`;
  return level;
}

if (!wanted) {
  console.error('usage: node scripts/release.mjs patch|minor|major|x.y.z [--push]');
  process.exit(1);
}

// A release is a commit of a tree that was tested, so the tree has to be the one that gets
// committed: anything left uncommitted is work that will silently miss the tag, and the changelog
// entry for this version would be describing code that is not in the zip.
const dirty = run('git', ['status', '--porcelain']).trim();
if (dirty) {
  const lines = dirty.split('\n');
  console.error(`The working tree has ${lines.length} uncommitted change${lines.length === 1 ? '' : 's'}:`);
  for (const line of lines.slice(0, 12)) console.error(`  ${line}`);
  if (lines.length > 12) console.error(`  … and ${lines.length - 12} more`);
  console.error('\nCommit or stash them first: a release has to be a commit of what was tested.');
  process.exit(1);
}

const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
const pkg = JSON.parse(await readFile(PACKAGE, 'utf8'));

if (manifest.version !== pkg.version) {
  // `npm run check` says the same thing, earlier and in the same words. Doing it here too means a
  // release cannot get as far as a tag with the two files disagreeing.
  console.error(`package.json says ${pkg.version} and the manifest says ${manifest.version}; they have to match.`);
  process.exit(1);
}

const current = manifest.version;
const next = bump(current, wanted);
if (next === current) {
  console.error(`Already on ${current}.`);
  process.exit(1);
}

const tag = `v${next}`;
const today = new Date().toISOString().slice(0, 10);

console.log(`releasing ${current} -> ${next} (${tag})\n`);

// 1. Both versions, so the built manifest and the package agree with the tag.
//
// The version *string* is replaced rather than the file re-serialised. The manifest keeps its
// content-script match lists on one line each, so JSON.stringify would reflow every one of them,
// and a release should read as a one-line change, not as a file that was printed again.
function withVersion(text, version) {
  const replaced = text.replace(/^\s*"version"\s*:\s*"[^"]*"/m, `  "version": "${version}"`);
  if (replaced === text) {
    console.error('Found no version field to replace.');
    process.exit(1);
  }
  return replaced;
}

await writeFile(MANIFEST, withVersion(await readFile(MANIFEST, 'utf8'), next));
await writeFile(PACKAGE, withVersion(await readFile(PACKAGE, 'utf8'), next));

// 2. The changelog. Keep a Changelog wants the released version to keep its own section and a
// fresh Unreleased above it, which is what makes "what changed since the last release" a heading
// rather than a diff between tags.
const changelog = await readFile(CHANGELOG, 'utf8');
const heading = '## [Unreleased]';
if (!changelog.includes(heading)) {
  console.error(`${path.relative(root, CHANGELOG)} has no ${heading} heading to cut.`);
  process.exit(1);
}
await writeFile(
  CHANGELOG,
  changelog.replace(heading, `${heading}\n\n## [${next}] - ${today}`)
);

// 3. The checks and both builds, exactly as the workflow will run them.
console.log('running check, tests and both builds…');
run('npm', ['run', 'verify'], { stdio: 'inherit' });

// 4. The store zips.
console.log('\npackaging…');
run('npm', ['run', 'package'], { stdio: 'inherit' });

// 5. The commit and the tag. One commit, named after the version, because a release is one thing.
run('git', ['add', 'package.json', 'src/manifest.base.json', 'CHANGELOG.md']);
run('git', ['commit', '-m', `Release ${tag}`]);
run('git', ['tag', '-a', tag, '-m', tag]);

console.log(`\ncommitted and tagged ${tag}`);

if (push) {
  console.log('\npushing…');
  run('git', ['push', 'origin', 'HEAD'], { stdio: 'inherit' });
  run('git', ['push', 'origin', tag], { stdio: 'inherit' });
  console.log(`\nThe workflow is building ${tag} now. When it finishes, the release with both zips is at:`);
  console.log(`  https://github.com/5ghzx/whilefree/releases/tag/${tag}`);
} else {
  console.log('\nNothing was pushed. To publish it:');
  console.log('  git push origin HEAD && git push origin ' + tag);
}

console.log(`
Still yours to do, because neither can be scripted honestly:
  1. Load both builds unpacked and run the smoke list in docs/STORE_LISTING.md — broadcast from a
     page, broadcast from the popup, an answer landing while you are on another tab, the badge, one
     click to open, the dashboard, export/import, and Diagnose this tab on a couple of sites.
  2. Upload dist/whilefree-chrome-${next}.zip and dist/whilefree-firefox-${next}.zip, and the
     source archive for Firefox if it asks.
`);
