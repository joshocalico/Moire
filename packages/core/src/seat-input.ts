/**
 * Keyboard and pointer prefs → seat behaviour: XKB rule names, repeat_info, the layout switch
 * shortcut, and per-device pointer config. Pure where possible so smokes run without devices.
 */
import {
  createXkbKeymapMemfd,
  XkbKeyboardState,
  type KeyboardModifierMask,
  type KeymapMemfd,
  type PointerConfigOption,
  type PointerDeviceConfig,
  type PointerDeviceConfigTarget,
  type PointerDeviceInfo,
  type XkbRuleNames,
} from "@moire/sys";
import {
  keyboardLayoutId,
  type KeyboardLayoutRef,
  type KeyboardSettings,
  type LayoutSwitchShortcut,
  type PointerSettings,
} from "@moire/prefs";

// ---------------------------------------------------------------------------
// Keymap
// ---------------------------------------------------------------------------

const CAPS_LOCK_OPTIONS = {
  normal: [],
  ctrl: ["ctrl:nocaps"],
  escape: ["caps:escape"],
} as const satisfies Record<KeyboardSettings["capsLock"], readonly string[]>;

/**
 * RMLVO names for the configured layouts. Switching is done by the compositor's own shortcut,
 * so no `grp:` option is added: XKB would otherwise switch on keys clients also receive.
 */
export function xkbRuleNamesFor(keyboard: KeyboardSettings): XkbRuleNames {
  return {
    rules: "evdev",
    model: "pc105",
    layout: keyboard.layouts.map((ref) => ref.layout).join(","),
    variant: keyboard.layouts.map((ref) => ref.variant).join(","),
    options: CAPS_LOCK_OPTIONS[keyboard.capsLock].join(","),
  };
}

/** Whether a change needs a new keymap (as opposed to only new repeat_info or shortcut). */
export function keymapChanged(previous: KeyboardSettings, next: KeyboardSettings): boolean {
  return JSON.stringify(xkbRuleNamesFor(previous)) !== JSON.stringify(xkbRuleNamesFor(next));
}

export type RepeatInfo = { rate: number; delay: number };

/** wl_keyboard.repeat_info: a rate of 0 turns client-side repeat off. */
export function repeatInfoFor(keyboard: KeyboardSettings): RepeatInfo {
  return { rate: keyboard.repeatEnabled ? keyboard.repeatRate : 0, delay: keyboard.repeatDelayMs };
}

/** The server-side XKB state the seat needs; XkbKeyboardState in production. */
export type SeatKeyboardState = {
  snapshot(): KeyboardModifierMask;
  update(event: { code: number; value: number; timeMs: number }): KeyboardModifierMask | null;
  layoutCount(): number;
  layoutName(index: number): string | null;
  setLayoutIndex(index: number): KeyboardModifierMask | null;
  /** UTF-8 a press of `code` produces now, into `output`; the byte count (lock screen input). */
  keyText?(code: number, output: Uint8Array): number;
  close(): void;
};

/** Native XKB access, replaceable in smokes that run without libxkbcommon. */
export type KeyboardBackend = {
  createKeymap(names?: XkbRuleNames): KeymapMemfd;
  createState(map: KeymapMemfd): SeatKeyboardState;
};

export const nativeKeyboardBackend: KeyboardBackend = {
  createKeymap: (names) => createXkbKeymapMemfd(names),
  createState: (map) => new XkbKeyboardState(map),
};

/** The layout clients are typing with, as the shell and Settings see it. */
export type ActiveKeyboardLayout = {
  index: number;
  /** `de(nodeadkeys)`; matches `keyboardLayoutId` of the prefs entry. */
  id: string;
  layout: string;
  variant: string;
  /** XKB's description, such as "German (no dead keys)"; the id when unknown. */
  name: string;
  count: number;
};

export function activeLayoutFor(
  layouts: readonly KeyboardLayoutRef[],
  index: number,
  name: string | null,
): ActiveKeyboardLayout {
  const ref = layouts[index] ?? layouts[0] ?? { layout: "us", variant: "" };
  const id = keyboardLayoutId(ref);
  return {
    index: layouts[index] ? index : 0,
    id,
    layout: ref.layout,
    variant: ref.variant,
    name: name || id,
    count: Math.max(1, layouts.length),
  };
}

// ---------------------------------------------------------------------------
// Layout switch shortcut
// ---------------------------------------------------------------------------

const KEY_SPACE = 57;
const SHIFT = [42, 54];
const CTRL = [29, 97];
const ALT = [56, 100];
const META = [125, 126];

export type LayoutSwitchDecision = { cycle: boolean; consume: boolean };

/**
 * Super+Space fires on the Space press and swallows that key. The two-modifier chords fire on
 * release, and only if nothing else was pressed meanwhile, so Ctrl+Shift+T still reaches apps.
 */
export class LayoutSwitchDetector {
  private consumed = new Set<number>();
  private armed = false;

  constructor(private shortcut: LayoutSwitchShortcut) {}

  setShortcut(shortcut: LayoutSwitchShortcut): void {
    this.shortcut = shortcut;
    this.armed = false;
  }

  /** `pressed` already reflects this event. */
  handle(ev: { code: number; value: number }, pressed: ReadonlySet<number>): LayoutSwitchDecision {
    if (this.consumed.has(ev.code)) {
      if (ev.value === 0) this.consumed.delete(ev.code);
      return { cycle: false, consume: true };
    }
    const held = (codes: readonly number[]) => codes.some((code) => pressed.has(code));
    switch (this.shortcut) {
      case "none":
        return { cycle: false, consume: false };
      case "super-space":
        if (ev.code === KEY_SPACE && ev.value === 1 && held(META) && !held(CTRL) && !held(ALT)) {
          this.consumed.add(ev.code);
          return { cycle: true, consume: true };
        }
        return { cycle: false, consume: false };
      case "alt-shift":
        return this.chord(ev, pressed, ALT, SHIFT);
      case "ctrl-shift":
        return this.chord(ev, pressed, CTRL, SHIFT);
    }
  }

  private chord(
    ev: { code: number; value: number },
    pressed: ReadonlySet<number>,
    a: readonly number[],
    b: readonly number[],
  ): LayoutSwitchDecision {
    const part = a.includes(ev.code) || b.includes(ev.code);
    if (ev.value === 2) return { cycle: false, consume: false };
    if (ev.value === 1) {
      const onlyChord = [...pressed].every((code) => a.includes(code) || b.includes(code));
      this.armed =
        part && onlyChord && a.some((c) => pressed.has(c)) && b.some((c) => pressed.has(c));
      return { cycle: false, consume: false };
    }
    if (part && this.armed) {
      this.armed = false;
      return { cycle: true, consume: false };
    }
    if (!part) this.armed = false;
    return { cycle: false, consume: false };
  }
}

// ---------------------------------------------------------------------------
// Pointer devices
// ---------------------------------------------------------------------------

/** Map the user's prefs onto one device, choosing mouse or touchpad scroll direction. */
export function pointerDeviceConfigFor(
  settings: PointerSettings,
  info: PointerDeviceInfo,
): PointerDeviceConfig {
  const touchpad = info.kind === "touchpad";
  return {
    accelSpeed: settings.speed,
    accelProfile: settings.accelProfile,
    naturalScroll: touchpad ? settings.naturalScrollTouchpad : settings.naturalScrollMouse,
    leftHanded: settings.leftHanded,
    // libinput keeps middle emulation for devices without a middle button; the pref decides.
    middleEmulation: settings.middleEmulation,
    tap: touchpad && settings.tapToClick,
    scrollMethod: touchpad ? settings.scrollMethod : "none",
    disableWhileTyping: touchpad && settings.disableWhileTyping,
    kineticScroll: touchpad && settings.kineticScroll,
    clickMethod: settings.clickMethod,
  };
}

/** A pointer device as Settings sees it (`org.moire.Input1.GetPointerDevices`). */
export type PointerDeviceSummary = {
  name: string;
  /** "touchpad" only when the multitouch driver runs it. */
  kind: "mouse" | "touchpad";
  /** Clicks anywhere on the surface; the click method applies. */
  clickpad: boolean;
};

export type AppliedPointerConfig = {
  device: PointerDeviceInfo;
  applied: Partial<PointerDeviceConfig>;
  unsupported: PointerConfigOption[];
};

const POINTER_OPTIONS: readonly PointerConfigOption[] = [
  "accelProfile",
  "accelSpeed",
  "naturalScroll",
  "leftHanded",
  "middleEmulation",
  "tap",
  "scrollMethod",
  "disableWhileTyping",
  "kineticScroll",
  "clickMethod",
];

/** Apply prefs to one device on add or on change; options it cannot honour are reported. */
export function applyPointerSettings(
  settings: PointerSettings,
  target: PointerDeviceConfigTarget,
): AppliedPointerConfig {
  const config = pointerDeviceConfigFor(settings, target.info);
  const applied: Partial<PointerDeviceConfig> = {};
  const unsupported: PointerConfigOption[] = [];
  for (const option of POINTER_OPTIONS) {
    if (!target.supports(option)) {
      unsupported.push(option);
      continue;
    }
    target.set(option, config[option]);
    Object.assign(applied, { [option]: config[option] });
  }
  return { device: target.info, applied, unsupported };
}
