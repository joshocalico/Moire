/**
 * Night light: a warm colour scale the renderer applies to every presented output as its final
 * step (see `CompositorOutputRenderer.setOutputColorScale`), after composition and never to
 * captures, so screenshots and client readbacks keep their true colours and nothing is scaled
 * twice. The controller follows the prefs and schedule and fades between strengths; with reduce
 * motion on it switches at once.
 */
import fs from "node:fs";
import {
  DEFAULT_NIGHT_LIGHT,
  loadSettings,
  nightLightScale,
  nightLightState,
  readZoneLocation,
  settingsPath,
  type DaylightContext,
  type NightLightSettings,
} from "@moire/prefs";
import type { OutputColorScale } from "@moire/sys";

/** How long a change of strength takes to fade in or out. */
export const NIGHT_LIGHT_FADE_MS = 1200;
/** How often the schedule is checked; a sunset boundary lands within this. */
export const NIGHT_LIGHT_EVALUATE_MS = 30_000;

export type NightLightInputs = {
  /** Night light prefs and reduce motion, read when they may have changed. */
  read(): { nightLight: NightLightSettings; reducedMotion: boolean };
  /** A cheap token that changes when the prefs file does. */
  stamp(): string;
  context(): DaylightContext;
};

function settingsStamp(): string {
  try {
    const stat = fs.statSync(settingsPath(), { bigint: true });
    return `${stat.ino}:${stat.mtimeNs}:${stat.size}`;
  } catch {
    return "";
  }
}

export const prefsNightLightInputs: NightLightInputs = {
  read() {
    try {
      const settings = loadSettings();
      return { nightLight: settings.nightLight, reducedMotion: settings.reducedMotion };
    } catch {
      return { nightLight: DEFAULT_NIGHT_LIGHT, reducedMotion: false };
    }
  },
  stamp: settingsStamp,
  context: () => readZoneLocation(),
};

export class NightLightController {
  private stampSeen: string | null = null;
  private settings: NightLightSettings = DEFAULT_NIGHT_LIGHT;
  private reducedMotion = false;
  private evaluatedAt = -Infinity;
  /** The strength being faded to, and the one shown now. */
  private target = 0;
  private current = 0;
  private lastTick: number | null = null;

  constructor(
    private readonly inputs: NightLightInputs = prefsNightLightInputs,
    private readonly options: { fadeMs?: number; evaluateMs?: number } = {},
  ) {}

  /**
   * Follow prefs, the schedule and the fade up to `nowMs` (wall clock). Returns true when the
   * outputs must be drawn again.
   */
  tick(nowMs: number): boolean {
    const stamp = this.inputs.stamp();
    const prefsChanged = stamp !== this.stampSeen;
    if (prefsChanged) {
      this.stampSeen = stamp;
      const read = this.inputs.read();
      this.settings = read.nightLight;
      this.reducedMotion = read.reducedMotion;
    }
    const evaluateMs = this.options.evaluateMs ?? NIGHT_LIGHT_EVALUATE_MS;
    if (prefsChanged || nowMs - this.evaluatedAt >= evaluateMs || nowMs < this.evaluatedAt) {
      this.evaluatedAt = nowMs;
      const state = nightLightState(this.settings, new Date(nowMs), this.inputs.context());
      this.target = state.active ? this.settings.strength : 0;
    }
    const previous = this.current;
    const elapsed = this.lastTick == null ? Infinity : Math.max(0, nowMs - this.lastTick);
    this.lastTick = nowMs;
    if (this.current !== this.target) {
      const fadeMs = this.options.fadeMs ?? NIGHT_LIGHT_FADE_MS;
      // The first frame starts settled: night light is already on at login, not fading in.
      const step = this.reducedMotion || fadeMs <= 0 ? Infinity : elapsed / fadeMs;
      this.current =
        this.current < this.target
          ? Math.min(this.target, this.current + step)
          : Math.max(this.target, this.current - step);
    }
    return this.current !== previous;
  }

  /** Whether a fade is under way (each frame then needs drawing). */
  animating(): boolean {
    return this.current !== this.target;
  }

  /** The strength shown now, 0–1. */
  strength(): number {
    return this.current;
  }

  /** The renderer's multipliers now, or null when night light changes nothing. */
  scale(): OutputColorScale | null {
    return this.current > 0 ? nightLightScale(this.current) : null;
  }
}

const luts = new Map<string, [Uint8Array, Uint8Array, Uint8Array]>();

function lookup(scale: OutputColorScale): [Uint8Array, Uint8Array, Uint8Array] {
  const key = scale.map((channel) => channel.toFixed(4)).join(",");
  let found = luts.get(key);
  if (!found) {
    const table = (factor: number) => {
      const out = new Uint8Array(256);
      for (let value = 0; value < 256; value++) out[value] = Math.round(value * factor);
      return out;
    };
    found = [table(scale[0]), table(scale[1]), table(scale[2])];
    if (luts.size > 64) luts.clear();
    luts.set(key, found);
  }
  return found;
}

/**
 * Scale a presented XRGB8888 / BGRA output in place: the software renderer's final step, the
 * same transform the EGL renderer's output pass applies with a colour matrix.
 */
export function scaleOutputColors(
  pixels: Uint8Array,
  width: number,
  height: number,
  pitch: number,
  scale: OutputColorScale,
): void {
  if (scale.every((channel) => channel === 1)) return;
  const [red, green, blue] = lookup(scale);
  for (let y = 0; y < height; y++) {
    const row = y * pitch;
    const end = row + width * 4;
    for (let at = row; at < end; at += 4) {
      pixels[at] = blue[pixels[at]!]!;
      pixels[at + 1] = green[pixels[at + 1]!]!;
      pixels[at + 2] = red[pixels[at + 2]!]!;
    }
  }
}
