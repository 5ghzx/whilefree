/**
 * Chrome entry point.
 *
 * Chrome runs this as a module service worker, so every shared and background file
 * is pulled in here, in dependency order. Firefox instead lists the same files in
 * `background.scripts` and loads them as classic scripts — same files, same globals,
 * no bundler and no build step for the logic itself.
 *
 * This list has to match `lib/files.js` exactly, and it is the one place where a file can
 * be shipped and simply not loaded: the tests load the list, so a file missing here breaks
 * Chrome and nothing else. `scripts/check.mjs` now compares the two line by line.
 */
import '../lib/browser.js';
import '../lib/app.js';
import '../lib/util.js';
import '../lib/protocol.js';
import '../lib/sites.js';
import '../lib/storage.js';
import '../lib/settings.js';
import '../lib/stats.js';
import '../lib/badge.js';
import '../lib/status.js';
import '../lib/reach.js';
import '../lib/files.js';
import './store.js';
import './tracker.js';
import './answers.js';
// Before the engine: it reads and writes the delivery ledger.
import './ledger.js';
import './engine.js';
import './background.js';
