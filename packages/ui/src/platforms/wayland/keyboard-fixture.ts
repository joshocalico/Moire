/** Test-only deterministic mapping. This proves client event flow, not native XKB layouts. */
import assert from "node:assert/strict";
import { closeSync, fstatSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MessageBuilder } from "@moire/protocol";
import { wlKeyboard } from "@moire/protocol/generated";
import type { ClientKeymap, WaylandModifierMask } from "./keymap-types";

const source = Buffer.from("xkb_keymap { /* deterministic client input fixture */ };\0");
const zeroMask: WaylandModifierMask = { depressed: 0, latched: 0, locked: 0, group: 0 };
const letters: Readonly<Record<number, string>> = { 30: "a", 32: "d", 48: "b" };
const navigation: Readonly<Record<number, string>> = { 28: "Enter", 108: "ArrowDown" };

export function createDeterministicClientKeymap(input: Buffer): ClientKeymap {
  assert.deepEqual(input, source, "only the explicit deterministic fixture source is accepted");
  let mask = zeroMask;
  return {
    updateMask(next) {
      mask = { ...next };
    },
    translate(code) {
      const letter = letters[code];
      if (!letter) return { key: navigation[code] };
      const effective = mask.depressed | mask.latched | mask.locked;
      const text = effective & 1 ? letter.toUpperCase() : letter;
      return { key: text, text };
    },
    modifiers() {
      const effective = mask.depressed | mask.latched | mask.locked;
      return {
        shift: Boolean(effective & 1),
        ctrl: Boolean(effective & 4),
        alt: Boolean(effective & 8),
        meta: Boolean(effective & 16),
      };
    },
    reset() {
      mask = zeroMask;
    },
    destroy() {
      mask = zeroMask;
    },
  };
}

export function installDeterministicKeymap(
  dispatch: (opcode: number, builder: MessageBuilder) => void,
): void {
  const directory = mkdtempSync(path.join(os.tmpdir(), "moire-client-keymap-fixture-"));
  let ownedFd: number | null = null;
  try {
    const filename = path.join(directory, "keymap");
    writeFileSync(filename, source);
    const fd = openSync(filename, "r");
    ownedFd = fd;
    dispatch(
      wlKeyboard.events.keymap.opcode,
      new MessageBuilder().uint(wlKeyboard.enums.keymapFormat.xkbV1).fd(fd).uint(source.length),
    );
    assert.throws(
      () => fstatSync(fd),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "EBADF",
      "production keyboard handling consumes the actual temporary descriptor",
    );
    ownedFd = null;
  } finally {
    if (ownedFd !== null) {
      try {
        closeSync(ownedFd);
      } catch {
        // Failure cleanup only, if the tested consumer already closed the descriptor.
      }
    }
    rmSync(directory, { recursive: true, force: true });
  }
}
