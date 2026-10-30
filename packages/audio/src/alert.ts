/**
 * The Moire alert: a 180 ms two-note chime (C6 then G6, soft attack, exponential decay), made
 * here rather than drawn from an asset library. `assets/alert.wav` is this function's output;
 * `src/generate-alert-sound.ts` rewrites it and a smoke checks they still match.
 */
import { fileURLToPath } from "node:url";
import type { Pcm } from "./wav";

export const ALERT_SOUND_PATH = fileURLToPath(new URL("../assets/alert.wav", import.meta.url));

const RATE = 48000;
const LENGTH_MS = 180;
const NOTES = [
  { hz: 1046.5, startMs: 0, decayMs: 45 },
  { hz: 1568, startMs: 55, decayMs: 50 },
] as const;
const ATTACK_MS = 3;
const LEVEL = 0.32;

export function alertPcm(): Pcm {
  const frames = Math.round((RATE * LENGTH_MS) / 1000);
  const samples = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const ms = (i * 1000) / RATE;
    let value = 0;
    for (const note of NOTES) {
      const t = ms - note.startMs;
      if (t < 0) continue;
      const attack = Math.min(1, t / ATTACK_MS);
      const envelope = attack * Math.exp(-t / note.decayMs);
      // A quiet octave partial gives the chime its body.
      const phase = (2 * Math.PI * note.hz * t) / 1000;
      value += envelope * (Math.sin(phase) + 0.18 * Math.sin(2 * phase));
    }
    // Fade the last 10 ms so the end never clicks.
    const fade = Math.min(1, (LENGTH_MS - ms) / 10);
    samples[i] = LEVEL * value * fade;
  }
  return { rate: RATE, channels: 1, samples };
}
