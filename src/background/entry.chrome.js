/**
 * Chrome entry point.
 *
 * Chrome runs this as a module service worker, so every shared and background file
 * is pulled in here, in dependency order. Firefox instead lists the same files in
 * `background.scripts` and loads them as classic scripts — same files, same globals,
 * no bundler and no build step for the logic itself.
 */
import '../lib/browser.js';
import '../lib/app.js';
import '../lib/util.js';
import '../lib/protocol.js';
import '../lib/sites.js';
import '../lib/storage.js';
import '../lib/settings.js';
import '../lib/stats.js';
import '../lib/files.js';
import './store.js';
import './tracker.js';
import './answers.js';
import './engine.js';
import './background.js';
