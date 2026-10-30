/** Authoritative server XKB state from the exact keymap advertised to clients. */
import fs from "node:fs";
import koffi from "koffi";
import { bindNativeFunction } from "./ffi";
import { assertLinux } from "./platform";
import type { KeymapMemfd } from "./keymap";
import type { EvdevKeyEvent } from "./evdev";

export type KeyboardModifierMask = {
  depressed: number;
  latched: number;
  locked: number;
  group: number;
};

function loadBindings() {
  assertLinux("server keyboard state");
  const lib = koffi.load("libxkbcommon.so.0");
  return {
    contextNew: bindNativeFunction<(flags: number) => unknown>(
      lib,
      "void *xkb_context_new(int flags)",
    ),
    contextUnref: bindNativeFunction<(context: unknown) => void>(
      lib,
      "void xkb_context_unref(void *context)",
    ),
    keymapNew: bindNativeFunction<
      (context: unknown, source: string, format: number, flags: number) => unknown
    >(
      lib,
      "void *xkb_keymap_new_from_string(void *context, const char *source, int format, int flags)",
    ),
    keymapUnref: bindNativeFunction<(keymap: unknown) => void>(
      lib,
      "void xkb_keymap_unref(void *keymap)",
    ),
    stateNew: bindNativeFunction<(keymap: unknown) => unknown>(
      lib,
      "void *xkb_state_new(void *keymap)",
    ),
    stateUnref: bindNativeFunction<(state: unknown) => void>(
      lib,
      "void xkb_state_unref(void *state)",
    ),
    updateKey: bindNativeFunction<(state: unknown, keycode: number, direction: number) => number>(
      lib,
      "unsigned int xkb_state_update_key(void *state, unsigned int keycode, int direction)",
    ),
    serializeMods: bindNativeFunction<(state: unknown, components: number) => number>(
      lib,
      "unsigned int xkb_state_serialize_mods(void *state, int components)",
    ),
    serializeLayout: bindNativeFunction<(state: unknown, components: number) => number>(
      lib,
      "unsigned int xkb_state_serialize_layout(void *state, int components)",
    ),
    updateMask: bindNativeFunction<
      (
        state: unknown,
        depressedMods: number,
        latchedMods: number,
        lockedMods: number,
        depressedLayout: number,
        latchedLayout: number,
        lockedLayout: number,
      ) => number
    >(
      lib,
      "unsigned int xkb_state_update_mask(void *state, unsigned int depressed_mods, unsigned int latched_mods, unsigned int locked_mods, unsigned int depressed_layout, unsigned int latched_layout, unsigned int locked_layout)",
    ),
    numLayouts: bindNativeFunction<(keymap: unknown) => number>(
      lib,
      "unsigned int xkb_keymap_num_layouts(void *keymap)",
    ),
    layoutName: bindNativeFunction<(keymap: unknown, index: number) => string | null>(
      lib,
      "const char *xkb_keymap_layout_get_name(void *keymap, unsigned int idx)",
    ),
    keyUtf8: bindNativeFunction<
      (state: unknown, keycode: number, output: Uint8Array, size: number) => number
    >(
      lib,
      "int xkb_state_key_get_utf8(void *state, unsigned int keycode, void *output, size_t size)",
    ),
  };
}
let bindings: ReturnType<typeof loadBindings> | undefined;

export class XkbKeyboardState {
  private readonly native = (bindings ??= loadBindings());
  private context: unknown;
  private keymap: unknown;
  private state: unknown;

  constructor(map: KeymapMemfd) {
    try {
      const bytes = Buffer.alloc(map.size);
      let offset = 0;
      while (offset < bytes.length) {
        const count = fs.readSync(map.fd, bytes, offset, bytes.length - offset, offset);
        if (!count) throw new Error("Incomplete server keymap");
        offset += count;
      }
      this.context = this.native.contextNew(0);
      if (!this.context) throw new Error("xkb_context_new failed");
      this.keymap = this.native.keymapNew(
        this.context,
        bytes.toString("utf8").replace(/\0$/, ""),
        1,
        0,
      );
      if (!this.keymap) throw new Error("xkb_keymap_new_from_string failed");
      this.state = this.native.stateNew(this.keymap);
      if (!this.state) throw new Error("xkb_state_new failed");
    } catch (error) {
      this.close();
      throw error;
    }
  }

  snapshot(): KeyboardModifierMask {
    if (!this.state) throw new Error("Keyboard state is closed");
    return {
      depressed: this.native.serializeMods(this.state, 1),
      latched: this.native.serializeMods(this.state, 2),
      locked: this.native.serializeMods(this.state, 4),
      group: this.native.serializeLayout(this.state, 128),
    };
  }

  /** Repeats are key delivery only, never another XKB depression/lock edge. */
  update(event: EvdevKeyEvent): KeyboardModifierMask | null {
    if (!this.state) throw new Error("Keyboard state is closed");
    if (event.value === 2) return null;
    const before = this.snapshot();
    this.native.updateKey(this.state, event.code + 8, event.value === 0 ? 0 : 1);
    const after = this.snapshot();
    return before.depressed === after.depressed &&
      before.latched === after.latched &&
      before.locked === after.locked &&
      before.group === after.group
      ? null
      : after;
  }

  /** Number of layouts (XKB groups) in the keymap. */
  layoutCount(): number {
    if (!this.keymap) throw new Error("Keyboard state is closed");
    return this.native.numLayouts(this.keymap);
  }

  /** The keymap's human name for a layout, such as "German (no dead keys)". */
  layoutName(index: number): string | null {
    if (!this.keymap) throw new Error("Keyboard state is closed");
    return this.native.layoutName(this.keymap, index);
  }

  /**
   * Lock the active layout, keeping every modifier component as it is. Returns the new masks,
   * or null when the layout was already active.
   */
  setLayoutIndex(index: number): KeyboardModifierMask | null {
    if (!this.state) throw new Error("Keyboard state is closed");
    const count = this.layoutCount();
    if (!Number.isInteger(index) || index < 0 || index >= count)
      throw new RangeError(`Layout ${index} is outside 0..${count - 1}`);
    const before = this.snapshot();
    if (before.group === index) return null;
    this.native.updateMask(
      this.state,
      before.depressed,
      before.latched,
      before.locked,
      0,
      0,
      index,
    );
    return this.snapshot();
  }

  /**
   * The text a key press produces in the current state, written as UTF-8 into `output` (never a
   * JS string, so a password can be wiped). Call before `update` for that press, as
   * libxkbcommon's own tools do. Returns the byte count; 0 for keys without text.
   */
  keyText(code: number, output: Uint8Array): number {
    if (!this.state) throw new Error("Keyboard state is closed");
    if (!Number.isInteger(code) || code < 0 || code > 0xfffffff7 || output.length < 2) return 0;
    const length = this.native.keyUtf8(this.state, code + 8, output, output.length);
    if (!Number.isInteger(length) || length <= 0 || length >= output.length) {
      output.fill(0);
      return 0;
    }
    return length;
  }

  close(): void {
    if (this.state) this.native.stateUnref(this.state);
    if (this.keymap) this.native.keymapUnref(this.keymap);
    if (this.context) this.native.contextUnref(this.context);
    this.state = this.keymap = this.context = undefined;
  }
}
