/**
 * Keyboard and pointer preferences. The compositor applies them live; Settings writes them
 * through `updateKeyboardSettings` / `updatePointerSettings` (see input-settings.ts).
 */

/** One XKB layout, as named in xkeyboard-config (`us`, `de`) plus an optional variant. */
export type KeyboardLayoutRef = {
  layout: string;
  /** Empty for the layout's default variant. */
  variant: string;
};

export type LayoutSwitchShortcut = "super-space" | "alt-shift" | "ctrl-shift" | "none";
export type CapsLockBehavior = "normal" | "ctrl" | "escape";

export type KeyboardSettings = {
  /** Ordered; the first is the layout new sessions start with. XKB allows at most four. */
  layouts: KeyboardLayoutRef[];
  switchShortcut: LayoutSwitchShortcut;
  repeatEnabled: boolean;
  /** Milliseconds a key is held before it starts repeating. */
  repeatDelayMs: number;
  /** Repeats per second. */
  repeatRate: number;
  capsLock: CapsLockBehavior;
};

export type AccelProfile = "adaptive" | "flat";
export type TouchpadScrollMethod = "two-finger" | "edge" | "none";
/** Clickpads: a click's button from where the fingers are (bottom areas) or how many there are. */
export type TouchpadClickMethod = "areas" | "clickfinger";

export type PointerSettings = {
  /** -1 (slowest) .. 1 (fastest); 0 is the device's native speed. */
  speed: number;
  accelProfile: AccelProfile;
  naturalScrollMouse: boolean;
  naturalScrollTouchpad: boolean;
  tapToClick: boolean;
  scrollMethod: TouchpadScrollMethod;
  disableWhileTyping: boolean;
  /** Two-finger scrolling coasts on after a flick. */
  kineticScroll: boolean;
  clickMethod: TouchpadClickMethod;
  /** Swap the primary and secondary buttons. */
  leftHanded: boolean;
  /** Pressing left and right together clicks the middle button. */
  middleEmulation: boolean;
};

export const MAX_KEYBOARD_LAYOUTS = 4;
export const REPEAT_DELAY_RANGE = { min: 150, max: 2000 } as const;
export const REPEAT_RATE_RANGE = { min: 1, max: 100 } as const;

export const DEFAULT_KEYBOARD_SETTINGS: KeyboardSettings = {
  layouts: [{ layout: "us", variant: "" }],
  switchShortcut: "super-space",
  repeatEnabled: true,
  repeatDelayMs: 400,
  repeatRate: 40,
  capsLock: "normal",
};

export const DEFAULT_POINTER_SETTINGS: PointerSettings = {
  speed: 0,
  accelProfile: "adaptive",
  naturalScrollMouse: false,
  naturalScrollTouchpad: true,
  tapToClick: true,
  scrollMethod: "two-finger",
  disableWhileTyping: true,
  kineticScroll: true,
  clickMethod: "clickfinger",
  leftHanded: false,
  middleEmulation: false,
};

/** xkeyboard-config names; anything else could not compile and is never passed to XKB. */
const XKB_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export function isXkbName(value: string): boolean {
  return XKB_NAME.test(value);
}

/** `de(nodeadkeys)`, the conventional XKB spelling, used as a stable layout key. */
export function keyboardLayoutId(ref: KeyboardLayoutRef): string {
  return ref.variant ? `${ref.layout}(${ref.variant})` : ref.layout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function normalizeKeyboardLayouts(value: unknown): KeyboardLayoutRef[] {
  const result: KeyboardLayoutRef[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(value) ? value : []) {
    if (!isRecord(item) || typeof item.layout !== "string") continue;
    const layout = item.layout.trim();
    const variant = typeof item.variant === "string" ? item.variant.trim() : "";
    if (!isXkbName(layout) || (variant && !isXkbName(variant))) continue;
    const ref = { layout, variant };
    const id = keyboardLayoutId(ref);
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(ref);
    if (result.length === MAX_KEYBOARD_LAYOUTS) break;
  }
  return result.length > 0 ? result : DEFAULT_KEYBOARD_SETTINGS.layouts.map((ref) => ({ ...ref }));
}

export function normalizeKeyboardSettings(value: unknown): KeyboardSettings {
  const s = isRecord(value) ? value : {};
  const d = DEFAULT_KEYBOARD_SETTINGS;
  return {
    layouts: normalizeKeyboardLayouts(s.layouts),
    switchShortcut: oneOf(
      s.switchShortcut,
      ["super-space", "alt-shift", "ctrl-shift", "none"],
      d.switchShortcut,
    ),
    repeatEnabled: bool(s.repeatEnabled, d.repeatEnabled),
    repeatDelayMs: Math.round(
      clampNumber(s.repeatDelayMs, REPEAT_DELAY_RANGE.min, REPEAT_DELAY_RANGE.max, d.repeatDelayMs),
    ),
    repeatRate: Math.round(
      clampNumber(s.repeatRate, REPEAT_RATE_RANGE.min, REPEAT_RATE_RANGE.max, d.repeatRate),
    ),
    capsLock: oneOf(s.capsLock, ["normal", "ctrl", "escape"], d.capsLock),
  };
}

export function normalizePointerSettings(value: unknown): PointerSettings {
  const s = isRecord(value) ? value : {};
  const d = DEFAULT_POINTER_SETTINGS;
  return {
    speed: clampNumber(s.speed, -1, 1, d.speed),
    accelProfile: oneOf(s.accelProfile, ["adaptive", "flat"], d.accelProfile),
    naturalScrollMouse: bool(s.naturalScrollMouse, d.naturalScrollMouse),
    naturalScrollTouchpad: bool(s.naturalScrollTouchpad, d.naturalScrollTouchpad),
    tapToClick: bool(s.tapToClick, d.tapToClick),
    scrollMethod: oneOf(s.scrollMethod, ["two-finger", "edge", "none"], d.scrollMethod),
    disableWhileTyping: bool(s.disableWhileTyping, d.disableWhileTyping),
    kineticScroll: bool(s.kineticScroll, d.kineticScroll),
    clickMethod: oneOf(s.clickMethod, ["areas", "clickfinger"], d.clickMethod),
    leftHanded: bool(s.leftHanded, d.leftHanded),
    middleEmulation: bool(s.middleEmulation, d.middleEmulation),
  };
}
