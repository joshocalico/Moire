// oxlint-disable-next-line no-restricted-imports -- This audited client XKB FFI boundary follows sys/ffi.ts.
import koffi, { type IKoffiLib, type KoffiFunc } from "koffi";
import type { UiKeyModifiers } from "#ui/platform";
import type { ClientKeymap, KeymapTranslation, WaylandModifierMask } from "./keymap-types";

const maxKeymapBytes = 1024 * 1024;
const effectiveModifiers = 1 << 3;
// Same audited binding boundary as sys/ffi.ts, local until sys exports that helper.
// Koffi returns an untyped variadic function; only this boundary asserts its ABI.
function bindNativeFunction<Fn extends (...args: never[]) => unknown>(
  library: IKoffiLib,
  declaration: string,
): KoffiFunc<Fn> {
  return library.func(declaration) as KoffiFunc<Fn>;
}
const navigation: Readonly<Partial<Record<number, string>>> = {
  0xff1b: "Escape",
  0xff09: "Tab",
  0xfe20: "Tab",
  0xff0d: "Enter",
  0xff8d: "Enter",
  0xff08: "Backspace",
  0xffff: "Delete",
  0xff9f: "Delete",
  0xff63: "Insert",
  0xff9e: "Insert",
  0xff50: "Home",
  0xff95: "Home",
  0xff57: "End",
  0xff9c: "End",
  0xff51: "ArrowLeft",
  0xff96: "ArrowLeft",
  0xff52: "ArrowUp",
  0xff97: "ArrowUp",
  0xff53: "ArrowRight",
  0xff98: "ArrowRight",
  0xff54: "ArrowDown",
  0xff99: "ArrowDown",
  0xff55: "PageUp",
  0xff9a: "PageUp",
  0xff56: "PageDown",
  0xff9b: "PageDown",
  0xffe1: "Shift",
  0xffe2: "Shift",
  0xffe3: "Control",
  0xffe4: "Control",
  0xffe9: "Alt",
  0xffea: "Alt",
  0xffe7: "Meta",
  0xffe8: "Meta",
  0xffeb: "Meta",
  0xffec: "Meta",
  0xffe5: "CapsLock",
  0xff7f: "NumLock",
  0xff14: "ScrollLock",
  0xfe03: "AltGraph",
};

function loadBindings() {
  if (process.platform !== "linux") throw new Error("Client keymap unavailable");
  let library: ReturnType<typeof koffi.load> | null = null;
  for (const name of [
    "libxkbcommon.so.0",
    "libxkbcommon.so",
    "/usr/lib/aarch64-linux-gnu/libxkbcommon.so.0",
    "/usr/lib/x86_64-linux-gnu/libxkbcommon.so.0",
  ]) {
    try {
      library = koffi.load(name);
      break;
    } catch {
      // Try the existing Linux sonames only.
    }
  }
  if (!library) throw new Error("Client keymap unavailable");
  return {
    contextNew: bindNativeFunction<(flags: number) => unknown>(
      library,
      "void *xkb_context_new(int flags)",
    ),
    contextUnref: bindNativeFunction<(context: unknown) => void>(
      library,
      "void xkb_context_unref(void *context)",
    ),
    contextLogLevel: bindNativeFunction<(context: unknown, level: number) => void>(
      library,
      "void xkb_context_set_log_level(void *context, int level)",
    ),
    keymapNew: bindNativeFunction<
      (context: unknown, source: string, format: number, flags: number) => unknown
    >(
      library,
      "void *xkb_keymap_new_from_string(void *context, const char *source, int format, int flags)",
    ),
    keymapUnref: bindNativeFunction<(keymap: unknown) => void>(
      library,
      "void xkb_keymap_unref(void *keymap)",
    ),
    stateNew: bindNativeFunction<(keymap: unknown) => unknown>(
      library,
      "void *xkb_state_new(void *keymap)",
    ),
    stateUnref: bindNativeFunction<(state: unknown) => void>(
      library,
      "void xkb_state_unref(void *state)",
    ),
    updateMask: bindNativeFunction<
      (
        state: unknown,
        depressed: number,
        latched: number,
        locked: number,
        depressedGroup: number,
        latchedGroup: number,
        lockedGroup: number,
      ) => number
    >(
      library,
      "unsigned int xkb_state_update_mask(void *state, unsigned int depressed, unsigned int latched, unsigned int locked, unsigned int depressed_group, unsigned int latched_group, unsigned int locked_group)",
    ),
    oneSym: bindNativeFunction<(state: unknown, keycode: number) => number>(
      library,
      "unsigned int xkb_state_key_get_one_sym(void *state, unsigned int keycode)",
    ),
    symUnicode: bindNativeFunction<(symbol: number) => number>(
      library,
      "unsigned int xkb_keysym_to_utf32(unsigned int symbol)",
    ),
    text: bindNativeFunction<
      (state: unknown, keycode: number, output: Buffer, size: number) => number
    >(
      library,
      "int xkb_state_key_get_utf8(void *state, unsigned int keycode, void *output, size_t size)",
    ),
    active: bindNativeFunction<(state: unknown, name: string, components: number) => number>(
      library,
      "int xkb_state_mod_name_is_active(void *state, const char *name, int components)",
    ),
  };
}
let bindings: ReturnType<typeof loadBindings> | null = null;
function getBindings() {
  // Importing the helper never loads libxkbcommon or creates native resources.
  if (!bindings) {
    try {
      bindings = loadBindings();
    } catch {
      throw new Error("Client keymap unavailable");
    }
  }
  return bindings;
}
function uint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}
function printable(value: string): boolean {
  return (
    value.length > 0 &&
    Array.from(value).every((char) => {
      const code = char.codePointAt(0);
      return code !== undefined && code >= 32 && !(code >= 127 && code <= 159);
    })
  );
}
function sourceText(source: Buffer): string {
  if (
    !Buffer.isBuffer(source) ||
    source.length < 16 ||
    source.length > maxKeymapBytes ||
    source[source.length - 1] !== 0 ||
    source.subarray(0, -1).includes(0)
  )
    throw new Error("Invalid client keymap");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(source.subarray(0, -1));
  } catch {
    throw new Error("Invalid client keymap");
  }
  if (!/^\s*xkb_keymap\s*(?:"[^"\r\n]*"\s*)?\{/.test(text) || !/\};\s*$/.test(text))
    throw new Error("Invalid client keymap");
  if (
    Array.from(text).some((char) => {
      const code = char.charCodeAt(0);
      return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
    })
  )
    throw new Error("Invalid client keymap");
  return text;
}

/** Uses the compositor's complete xkb_v1 keymap and serialized client masks. */
export function createXkbClientKeymap(source: Buffer): ClientKeymap {
  const text = sourceText(source);
  const native = getBindings();
  let context: unknown = null;
  let keymap: unknown = null;
  let state: unknown = null;
  let destroyed = false;
  function destroy() {
    if (destroyed) return;
    destroyed = true;
    try {
      if (state) native.stateUnref(state);
    } finally {
      state = null;
      try {
        if (keymap) native.keymapUnref(keymap);
      } finally {
        keymap = null;
        if (context) native.contextUnref(context);
        context = null;
      }
    }
  }
  try {
    // Disable default include paths and environment-selected RMLVO names.
    context = native.contextNew(1 | 2);
    if (!context) throw new Error("Invalid client keymap");
    // Even parse errors must never print compositor-supplied keymap contents.
    native.contextLogLevel(context, 0);
    keymap = native.keymapNew(context, text, 1, 0);
    if (!keymap) throw new Error("Invalid client keymap");
    state = native.stateNew(keymap);
    if (!state) throw new Error("Invalid client keymap");
  } catch {
    destroy();
    throw new Error("Invalid client keymap");
  }
  function live() {
    if (destroyed) throw new Error("Client keymap unavailable");
  }
  function modifiers(): UiKeyModifiers {
    live();
    return {
      shift: native.active(state, "Shift", effectiveModifiers) === 1,
      ctrl: native.active(state, "Control", effectiveModifiers) === 1,
      alt: native.active(state, "Mod1", effectiveModifiers) === 1,
      meta: native.active(state, "Mod4", effectiveModifiers) === 1,
    };
  }
  function updateMask(mask: WaylandModifierMask) {
    live();
    if (![mask.depressed, mask.latched, mask.locked, mask.group].every(uint32))
      throw new Error("Invalid client keymap mask");
    // The group from wl_keyboard.modifiers is the effective layout index.
    native.updateMask(state, mask.depressed, mask.latched, mask.locked, 0, 0, mask.group);
  }
  return {
    updateMask,
    modifiers,
    translate(evdevCode): KeymapTranslation {
      live();
      if (!uint32(evdevCode) || evdevCode > 0xfffffff7) throw new Error("Invalid client key code");
      const keycode = evdevCode + 8;
      const symbol = native.oneSym(state, keycode);
      const unicode = native.symUnicode(symbol);
      let key = navigation[symbol];
      if (!key && symbol >= 0xffbe && symbol <= 0xffc9) key = "F" + (symbol - 0xffbe + 1);
      if (!key && unicode > 0 && unicode <= 0x10ffff && !(unicode >= 0xd800 && unicode <= 0xdfff)) {
        const character = String.fromCodePoint(unicode);
        if (printable(character)) key = character;
      }
      const mods = modifiers();
      if (mods.ctrl || mods.alt || mods.meta) return key === undefined ? {} : { key };
      const output = Buffer.alloc(64);
      try {
        const length = native.text(state, keycode, output, output.length);
        if (
          !Number.isInteger(length) ||
          length < 0 ||
          length >= output.length ||
          output[length] !== 0
        )
          throw new Error("Client key translation unavailable");
        const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
          output.subarray(0, length),
        );
        const text = printable(decoded) ? decoded : undefined;
        return { ...(key === undefined ? {} : { key }), ...(text === undefined ? {} : { text }) };
      } catch {
        throw new Error("Client key translation unavailable");
      } finally {
        output.fill(0);
      }
    },
    reset() {
      updateMask({ depressed: 0, latched: 0, locked: 0, group: 0 });
    },
    destroy,
  };
}
