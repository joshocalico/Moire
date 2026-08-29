/**
 * Create an XKB keymap memfd for wl_keyboard.keymap (format xkb_v1).
 */
import koffi from "koffi";
import { assertLinux } from "./platform";
import { getLibc, closeFd } from "./libc";

const MFD_CLOEXEC = 0x0001;
const XKB_CONTEXT_NO_FLAGS = 0;
const XKB_KEYMAP_COMPILE_NO_FLAGS = 0;
const XKB_KEYMAP_FORMAT_TEXT_V1 = 1;

let xkb: ReturnType<typeof koffi.load> | null = null;

function getXkb() {
  if (!xkb) {
    for (const name of [
      "libxkbcommon.so.0",
      "libxkbcommon.so",
      "/usr/lib/aarch64-linux-gnu/libxkbcommon.so.0",
      "/usr/lib/x86_64-linux-gnu/libxkbcommon.so.0",
    ]) {
      try {
        xkb = koffi.load(name);
        break;
      } catch {
        // continue
      }
    }
    if (!xkb) throw new Error("Failed to load libxkbcommon");
  }
  return xkb;
}

export type KeymapMemfd = {
  fd: number;
  size: number;
};

/** Build a default (evdev/pc105/us) keymap in a sealed memfd. */
export function createXkbKeymapMemfd(): KeymapMemfd {
  assertLinux("xkb keymap");
  const lib = getXkb();
  const libc = getLibc();

  const xkb_context_new = lib.func("void *xkb_context_new(int flags)");
  const xkb_context_unref = lib.func("void xkb_context_unref(void *context)");
  const xkb_keymap_new_from_names = lib.func(
    "void *xkb_keymap_new_from_names(void *context, void *names, int flags)",
  );
  const xkb_keymap_get_as_string = lib.func(
    "void *xkb_keymap_get_as_string(void *keymap, int format)",
  );
  const xkb_keymap_unref = lib.func("void xkb_keymap_unref(void *keymap)");
  const strlen = libc.func("size_t strlen(const char *s)");
  const free = libc.func("void free(void *ptr)");
  const memfd_create = libc.func("int memfd_create(const char *name, unsigned int flags)");
  const write = libc.func("long write(int fd, const void *buf, size_t count)");
  const lseek = libc.func("long lseek(int fd, long offset, int whence)");

  const ctx = xkb_context_new(XKB_CONTEXT_NO_FLAGS);
  if (!ctx) throw new Error("xkb_context_new failed");

  let keymapPtr: unknown;
  let strPtr: unknown;
  try {
    // NULL names → system defaults
    keymapPtr = xkb_keymap_new_from_names(ctx, null, XKB_KEYMAP_COMPILE_NO_FLAGS);
    if (!keymapPtr) throw new Error("xkb_keymap_new_from_names failed");

    strPtr = xkb_keymap_get_as_string(keymapPtr, XKB_KEYMAP_FORMAT_TEXT_V1);
    if (!strPtr) throw new Error("xkb_keymap_get_as_string failed");

    const size = Number(strlen(strPtr));
    const fd = memfd_create("moire-keymap", MFD_CLOEXEC) as number;
    if (fd < 0) throw new Error("memfd_create failed");

    const written = Number(write(fd, strPtr, size));
    if (written !== size) {
      closeFd(fd);
      throw new Error(`keymap write incomplete ${written}/${size}`);
    }
    // Rewind so client reads from start
    lseek(fd, 0, 0 /* SEEK_SET */);

    return { fd, size };
  } finally {
    if (strPtr) free(strPtr);
    if (keymapPtr) xkb_keymap_unref(keymapPtr);
    xkb_context_unref(ctx);
  }
}
