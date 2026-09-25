/**
 * Generate the answer chime: src/assets/chime.wav.
 *
 * The file is generated rather than downloaded, for the same reason the icons are:
 * everything shipped in this repo is ours to license. It is a two-note bell — a soft
 * A5 into D6 — with the partials and decay written out below, so changing the sound
 * is a matter of changing numbers rather than finding a sample.
 *
 *   node scripts/make-audio.mjs
 *
 * Committed to the repo, so a build does not depend on having run this.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const OUT = path.join(root, 'src', 'assets', 'chime.wav');

const RATE = 22050; // speech-grade is plenty for a bell, and it keeps the file tiny
const DURATION = 0.62;
const PEAK = 0.6; // headroom, because the player applies its own volume on top

/** One struck note: a fundamental plus two quiet partials, decaying exponentially. */
function note({ freq, start, decay, gain }) {
  return (t) => {
    const dt = t - start;
    if (dt < 0) return 0;
    const env = Math.exp(-dt / decay) * Math.min(1, dt / 0.006); // 6 ms attack, no click
    const partials =
      Math.sin(2 * Math.PI * freq * dt) +
      0.35 * Math.sin(2 * Math.PI * freq * 2 * dt) +
      0.12 * Math.sin(2 * Math.PI * freq * 3 * dt);
    return gain * env * partials;
  };
}

const voices = [
  note({ freq: 880.0, start: 0.0, decay: 0.16, gain: 1.0 }), // A5
  note({ freq: 1174.66, start: 0.105, decay: 0.2, gain: 0.85 }), // D6
];

const frames = Math.round(RATE * DURATION);
const samples = new Float32Array(frames);
for (let i = 0; i < frames; i += 1) {
  const t = i / RATE;
  let value = 0;
  for (const voice of voices) value += voice(t);
  samples[i] = value;
}

// Normalise to PEAK so the two notes keep their relative balance whatever the gains.
let loudest = 0;
for (const value of samples) loudest = Math.max(loudest, Math.abs(value));
const scale = loudest > 0 ? PEAK / loudest : 0;

function wavBuffer() {
  const dataBytes = frames * 2; // 16-bit mono
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(RATE, 24);
  buffer.writeUInt32LE(RATE * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < frames; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] * scale));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buffer;
}

await mkdir(path.dirname(OUT), { recursive: true });
const wav = wavBuffer();
await writeFile(OUT, wav);
console.log(
  `wrote ${path.relative(root, OUT)}  ${(wav.length / 1024).toFixed(1)} KiB  ${(DURATION * 1000) | 0} ms`
);
