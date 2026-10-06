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
function noModifiers(): UiKeyModifiers {
  return { shift: false, ctrl: false, alt: false, meta: false };
}

export class WaylandKeyboard<Target> {
  private focus: { surfaceId: number; target: Target } | null = null;
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
    },
  ) {}

  handle(opcode: number, reader: MessageReader): void {
    const { pressedKeys } = this.options;
    if (opcode === wlKeyboard.events.keymap.opcode) {
      this.replaceKeymap(reader);
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
      this.observeFocus("leave", event.surface, this.options.resolveSurface(event.surface));
      if (this.focus?.surfaceId === event.surface) this.reset();
      return;
    }
    if (opcode !== wlKeyboard.events.key.opcode) return;
    const { serial, key, state } = wlKeyboard.events.key.decodeReader(reader);
    if (state !== wlKeyboard.enums.keyState.pressed && state !== wlKeyboard.enums.keyState.released)
      return;
    if (!this.focus) return;
    const pressed = state === wlKeyboard.enums.keyState.pressed;
    const repeat = pressed && pressedKeys.has(key);
    if (pressed) pressedKeys.add(key);
    else pressedKeys.delete(key);
    this.options.onSerial(serial);
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
      type: repeat ? "repeat" : pressed ? "down" : "up",
      code: key,
      key: logical.key,
      text: logical.text,
      modifiers,
      timeMs: Date.now(),
    });
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
