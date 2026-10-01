#!/usr/bin/env node
// Diff two captured parity-probe readings.
//
// The two browser rigs hand back the payload in different wrappers (CDP wraps the whole
// value in a JSON-encoded string; RDP prints it after a "actor: " prefix), so this pulls the
// last balanced {...} out of each file and compares the fields that *must* agree across
// browsers.  `browser`/`isFirefox` are expected to differ and are ignored.
//
//   node scripts/probes/diff-parity.mjs /tmp/wf-c.json /tmp/wf-f.json
import { readFileSync } from 'node:fs';

const IGNORE = new Set(['browser', 'isFirefox']);

const payload = (file) => {
  const text = readFileSync(file, 'utf8').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`no JSON object in ${file}`);
  const candidates = [text];
  if (start > 0 || end < text.length - 1) candidates.push(text.slice(start, end + 1));
  for (const raw of candidates) {
    try {
      const value = JSON.parse(raw);
      // CDP double-encodes: the printed value is a JSON string whose content is the JSON we want.
      return typeof value === 'string' ? JSON.parse(value) : value;
    } catch {
      /* try the next shape */
    }
  }
  throw new Error(`could not parse a JSON payload out of ${file}`);
};

const a = payload(process.argv[2]);
const b = payload(process.argv[3]);
const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !IGNORE.has(k));

let drift = 0;
for (const key of keys) {
  const av = JSON.stringify(a[key]);
  const bv = JSON.stringify(b[key]);
  if (av === bv) {
    console.log(`  same  ${key}`);
  } else {
    drift += 1;
    console.log(`  DIFF  ${key}\n          chrome: ${av}\n          firefox: ${bv}`);
  }
}
console.log(drift ? `\n${drift} field(s) drift` : `\nall ${keys.length} fields agree across both browsers`);
process.exit(drift ? 1 : 0);
