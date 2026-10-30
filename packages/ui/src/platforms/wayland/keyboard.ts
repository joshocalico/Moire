/** Seat keyboard focus and held-key state decoded from Wayland events. */
import type { MessageReader } from "@moire/protocol";
import { wlKeyboard } from "@moire/protocol/generated";
import type { UiKeyEvent, UiKeyModifiers } from "#ui/platform";
import { nodeKeymapFdIo, readKeymapFd } from "./keymap-fd";
import type {
  ClientKeymap,
  ClientKeymapFactory,
  KeymapAvailability,
  KeymapFdIo,
  KeymapTranslation,
} from "./keymap-types";
import { createXkbClientKeymap } from "./xkb";

const navigationKeys: Readonly<Record<number, string>> = Object.freeze({
  1: "Escape",
  14: "Backspace",
  15: "Tab",
  28: "Enter",
  102: "Home",
  103: "ArrowUp",
  105: "ArrowLeft",
  106: "ArrowRight",
  107: "End",
  108: "ArrowDown",
  111: "Delete",
});
/** Logs key codes and focus only, never text, so secrets stay out of journals. */
const DEBUG_KEYS = process.env.MOIRE_DEBUG_KEYS === "1";
/** Modifier and lock keys never auto-repeat (evdev codes). */
const nonRepeatingKeys: ReadonlySet<number> = new Set([
  29, 42, 54, 56, 58, 69, 70, 97, 100, 125, 126, 127,
]);
/** wl_keyboard.repeat_info is v4+; older seats get the conventional default. */
const DEFAULT_REPEAT = Object.freeze({ rate: 25, delay: 600 });
export type KeyRepeatTimers = Readonly<{
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}>;
const nodeTimers: KeyRepeatTimers = {
  setTimeout: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    // A held key must never keep a closing client alive.
    handle.unref?.();
    return handle;
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
function noModifiers(): UiKeyModifiers {
  return { shift: false, ctrl: false, alt: false, meta: false };
}

export class WaylandKeyboard<Target> {
  private focus: { surfaceId: number; target: Target } | null = null;
  private repeatRate: number = DEFAULT_REPEAT.rate;
  private repeatDelay: number = DEFAULT_REPEAT.delay;
  private repeating: { key: number; timer: unknown } | null = null;
  private keymap: ClientKeymap | null = null;
  private availability: KeymapAvailability = Object.freeze({
    kind: "unavailable",
    reason: "missing",
  });

  constructor(
    private readonly options: {
      pressedKeys: Set<number>;
      resolveSurface: (surfaceId: number) => Target | null;
      emitKey: (target: Target, event: UiKeyEvent) => void;
      onSerial: (serial: number) => void;
      createKeymap?: ClientKeymapFactory;
      keymapIo?: KeymapFdIo;
      /** Optional decoded-focus observer. Its failure must never affect input delivery. */
      onFocus?: (type: "enter" | "leave", surfaceId: number, target: Target | null) => void;
      /** Client-side key repeat clock; injectable for deterministic tests. */
      timers?: KeyRepeatTimers;
    },
  ) {}

  handle(opcode: number, reader: MessageReader): void {
    const { pressedKeys } = this.options;
    if (opcode === wlKeyboard.events.keymap.opcode) {
      this.replaceKeymap(reader);
      return;
    }
    if (opcode === wlKeyboard.events.repeatInfo.opcode) {
      const event = wlKeyboard.events.repeatInfo.decodeReader(reader);
      this.repeatRate = Math.max(0, event.rate);
      this.repeatDelay = Math.max(0, event.delay);
      if (this.repeatRate === 0) this.stopRepeat();
      return;
    }
    if (opcode === wlKeyboard.events.modifiers.opcode) {
      const event = wlKeyboard.events.modifiers.decodeReader(reader);
      this.options.onSerial(event.serial);
      try {
        this.keymap?.updateMask({
          depressed: event.modsDepressed,
          latched: event.modsLatched,
          locked: event.modsLocked,
          group: event.group,
        });
      } catch {
        this.retireKeymap("invalid");
      }
      return;
    }
    if (opcode === wlKeyboard.events.enter.opcode) {
      const event = wlKeyboard.events.enter.decodeReader(reader);
      if (event.keys.length % 4 !== 0) throw new Error("Invalid wl_keyboard.enter key array");
      this.reset();
      const target = this.options.resolveSurface(event.surface);
      if (DEBUG_KEYS)
        console.log(`[keys] client enter surface=${event.surface} known=${target !== null}`);
      this.observeFocus("enter", event.surface, target);
      if (target === null) return;
      this.focus = { surfaceId: event.surface, target };
      for (let offset = 0; offset < event.keys.length; offset += 4) {
        pressedKeys.add(event.keys.readUInt32LE(offset));
      }
      this.options.onSerial(event.serial);
      return;
    }
    if (opcode === wlKeyboard.events.leave.opcode) {
      const event = wlKeyboard.events.leave.decodeReader(reader);
      if (DEBUG_KEYS) console.log(`[keys] client leave surface=${event.surface}`);
      this.observeFocus("leave", event.surface, this.options.resolveSurface(event.surface));
      if (this.focus?.surfaceId === event.surface) this.reset();
      return;
    }
    if (opcode !== wlKeyboard.events.key.opcode) return;
    const { serial, key, state } = wlKeyboard.events.key.decodeReader(reader);
    if (state !== wlKeyboard.enums.keyState.pressed && state !== wlKeyboard.enums.keyState.released)
      return;
    const pressed = state === wlKeyboard.enums.keyState.pressed;
    // A press for a key already held is not a wl_keyboard event; repeat is ours.
    const duplicate = pressed && pressedKeys.has(key);
    if (DEBUG_KEYS)
      console.log(
        `[keys] client key=${key} pressed=${pressed} duplicate=${duplicate} focus=${this.focus?.surfaceId ?? "none"}`,
      );
    if (!this.focus) return;
    this.options.onSerial(serial);
    if (duplicate) return;
    if (pressed) pressedKeys.add(key);
    else pressedKeys.delete(key);
    if (!pressed && this.repeating?.key === key) this.stopRepeat();
    this.emitTranslated(key, pressed ? "down" : "up");
    if (pressed) this.startRepeat(key);
  }

  private emitTranslated(key: number, type: UiKeyEvent["type"]): void {
    if (!this.focus) return;
    let modifiers = this.modifiers();
    let logical: KeymapTranslation;
    try {
      logical = this.keymap ? this.keymap.translate(key) : { key: navigationKeys[key] };
    } catch {
      this.retireKeymap("invalid");
      logical = { key: navigationKeys[key] };
      modifiers = noModifiers();
    }
    this.options.emitKey(this.focus.target, {
      type,
      code: key,
      key: logical.key,
      text: logical.text,
      modifiers,
      timeMs: Date.now(),
    });
  }

  /** The newest pressed key repeats until released, replaced, or focus ends. */
  private startRepeat(key: number): void {
    this.stopRepeat();
    if (this.repeatRate <= 0 || nonRepeatingKeys.has(key)) return;
    const timers = this.options.timers ?? nodeTimers;
    const interval = Math.max(1, 1000 / this.repeatRate);
    const fire = () => {
      if (!this.repeating || this.repeating.key !== key || !this.options.pressedKeys.has(key)) {
        this.stopRepeat();
        return;
      }
      this.repeating.timer = timers.setTimeout(fire, interval);
      this.emitTranslated(key, "repeat");
    };
    this.repeating = { key, timer: timers.setTimeout(fire, this.repeatDelay) };
  }

  private stopRepeat(): void {
    if (!this.repeating) return;
    (this.options.timers ?? nodeTimers).clearTimeout(this.repeating.timer);
    this.repeating = null;
  }

  private replaceKeymap(reader: MessageReader): void {
    this.retireKeymap("invalid");
    const io = this.options.keymapIo ?? nodeKeymapFdIo;
    let ownedFd: number | null = null;
    try {
      // A protocol FD has no inline payload. Take ownership before size decoding can fail.
      ownedFd = reader.fd();
      const event: ReturnType<typeof wlKeyboard.events.keymap.decodeReader> = {
        fd: ownedFd,
        format: reader.uint(),
        size: reader.uint(),
      };
      if (event.format !== wlKeyboard.enums.keymapFormat.xkbV1) {
        this.availability = Object.freeze({
          kind: "unavailable",
          reason:
            event.format === wlKeyboard.enums.keymapFormat.noKeymap ? "missing" : "unsupported",
        });
        return;
      }
      ownedFd = null; // readKeymapFd owns close, including every read/validation failure.
      const source = readKeymapFd(io, event.fd, event.size);
      const map = (this.options.createKeymap ?? createXkbClientKeymap)(source);
      this.keymap = map;
      map.reset();
      this.availability = Object.freeze({ kind: "available" });
    } catch {
      this.retireKeymap("invalid");
    } finally {
      if (ownedFd !== null) {
        try {
          io.close(ownedFd);
        } catch {
          this.retireKeymap("invalid");
        }
      }
    }
  }

  private retireKeymap(
    reason: Extract<KeymapAvailability, { kind: "unavailable" }>["reason"],
  ): void {
    const previous = this.keymap;
    this.keymap = null;
    this.availability = Object.freeze({ kind: "unavailable", reason });
    try {
      previous?.destroy();
    } catch {
      // Resource failure cannot retain stale logical input or leak native diagnostics.
    }
  }

  keymapState(): KeymapAvailability {
    return this.availability;
  }

  modifiers(): UiKeyModifiers {
    try {
      return this.keymap ? { ...this.keymap.modifiers() } : noModifiers();
    } catch {
      this.retireKeymap("invalid");
      return noModifiers();
    }
  }

  private observeFocus(type: "enter" | "leave", surfaceId: number, target: Target | null): void {
    try {
      this.options.onFocus?.(type, surfaceId, target);
    } catch {
      // A diagnostic observer cannot change focus or held-key state.
    }
  }

  forget(target: Target): void {
    if (this.focus?.target === target) this.reset();
  }

  reset(): void {
    this.stopRepeat();
    this.focus = null;
    this.options.pressedKeys.clear();
    try {
      this.keymap?.reset();
    } catch {
      this.retireKeymap("invalid");
    }
  }

  disconnect(): void {
    this.reset();
    this.retireKeymap("disconnected");
  }
}
