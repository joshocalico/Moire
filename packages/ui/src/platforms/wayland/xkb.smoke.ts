import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MessageBuilder, MessageReader } from "@moire/protocol";
import { wlKeyboard } from "@moire/protocol/generated";
import type { UiKeyEvent } from "#ui/platform";
import { WaylandKeyboard } from "./keyboard";
import type { ClientKeymap } from "./keymap-types";
import { createXkbClientKeymap } from "./xkb";

// Complete serialized fixture. No includes, system layout database, seat or display are needed.
// Group1 has US letter positions; Group2 swaps A/Q and Y/Z and supplies a Unicode emoji.
const serialized = `xkb_keymap {
  xkb_keycodes "client-fixture" {
    minimum = 8; maximum = 255;
    <ESC> = 9; <BKSP> = 22; <TAB> = 23; <AD01> = 24; <AD03> = 26;
    <AD06> = 29; <RTRN> = 36; <AC01> = 38; <SPCE> = 65; <UNIC> = 60;
    <KPEN> = 104; <HOME> = 110; <UP> = 111; <PGUP> = 112;
    <LEFT> = 113; <RGHT> = 114; <END> = 115; <DOWN> = 116;
    <PGDN> = 117; <INS> = 118; <DELE> = 119; <DEAD> = 61;
  };
  xkb_types "client-fixture" {
    type "ONE_LEVEL" { modifiers = None; level_name[Level1] = "Any"; };
    type "TWO_LEVEL" {
      modifiers = Shift; map[Shift] = Level2;
      level_name[Level1] = "Base"; level_name[Level2] = "Shift";
    };
    type "ALPHABETIC" {
      modifiers = Shift+Lock;
      map[Shift] = Level2; map[Lock] = Level2; map[Shift+Lock] = Level1;
      level_name[Level1] = "Base"; level_name[Level2] = "Caps";
    };
    type "FOUR_LEVEL" {
      modifiers = Shift+Mod5;
      map[Shift] = Level2; map[Mod5] = Level3; map[Shift+Mod5] = Level4;
      level_name[Level1] = "Base"; level_name[Level2] = "Shift";
      level_name[Level3] = "AltGr"; level_name[Level4] = "ShiftAltGr";
    };
  };
  xkb_compatibility "client-fixture" {};
  xkb_symbols "client-fixture" {
    name[Group1] = "US fixture"; name[Group2] = "Alternate fixture";
    key <AC01> {
      type[Group1] = "ALPHABETIC", symbols[Group1] = [ a, A ],
      type[Group2] = "ALPHABETIC", symbols[Group2] = [ q, Q ]
    };
    key <AD01> {
      type[Group1] = "ALPHABETIC", symbols[Group1] = [ q, Q ],
      type[Group2] = "ALPHABETIC", symbols[Group2] = [ a, A ]
    };
    key <AD06> {
      type[Group1] = "ALPHABETIC", symbols[Group1] = [ y, Y ],
      type[Group2] = "ALPHABETIC", symbols[Group2] = [ z, Z ]
    };
    key <AD03> {
      type[Group1] = "FOUR_LEVEL", symbols[Group1] = [ e, E, EuroSign, EuroSign ],
      type[Group2] = "FOUR_LEVEL", symbols[Group2] = [ e, E, EuroSign, EuroSign ]
    };
    key <UNIC> {
      type[Group1] = "ALPHABETIC", symbols[Group1] = [ udiaeresis, Udiaeresis ],
      type[Group2] = "ONE_LEVEL", symbols[Group2] = [ 0x0101f642 ]
    };
    key <ESC> { [ Escape ] }; key <BKSP> { [ BackSpace ] };
    key <TAB> { type = "TWO_LEVEL", [ Tab, ISO_Left_Tab ] };
    key <RTRN> { [ Return ] }; key <KPEN> { [ KP_Enter ] };
    key <HOME> { [ Home ] }; key <UP> { [ Up ] }; key <PGUP> { [ Prior ] };
    key <LEFT> { [ Left ] }; key <RGHT> { [ Right ] }; key <END> { [ End ] };
    key <DOWN> { [ Down ] }; key <PGDN> { [ Next ] };
    key <INS> { [ Insert ] }; key <DELE> { [ Delete ] }; key <SPCE> { [ space ] };
    key <DEAD> { [ dead_acute ] };
  };
};
`;
const source = Buffer.from(serialized + "\0");
const privateMarker = "SYNTHETIC-KEYMAP-TEXT";
let cases = 0;
function safeError(error: unknown): boolean {
  return (
    error instanceof Error &&
    !error.message.includes(privateMarker) &&
    !error.stack?.includes(privateMarker)
  );
}
function test(name: string, run: () => void) {
  run();
  cases++;
  console.log("ok " + name);
}
function mask(keymap: ClientKeymap, depressed = 0, locked = 0, group = 0, latched = 0) {
  keymap.updateMask({ depressed, latched, locked, group });
}

for (const [name, invalid] of [
  ["missing terminator", Buffer.from(serialized)],
  ["embedded terminator", Buffer.from(serialized.replace("xkb_types", "xkb\0_types") + "\0")],
  ["double terminator", Buffer.from(serialized + "\0\0")],
  ["empty", Buffer.from([0])],
  ["oversized", Buffer.alloc(1024 * 1024 + 1)],
  [
    "invalid UTF8",
    Buffer.concat([Buffer.from("xkb_keymap {"), Buffer.from([0xff]), Buffer.from("};\0")]),
  ],
  ["control byte", Buffer.from("xkb_keymap { " + privateMarker + "\x01 };\0")],
  ["fragment", Buffer.from("xkb_symbols { " + privateMarker + " };\0")],
  ["missing closing grammar", Buffer.from("xkb_keymap { " + privateMarker + "\0")],
] satisfies [string, Buffer][]) {
  test("strict source boundary rejects " + name, () => {
    assert.throws(() => createXkbClientKeymap(invalid), safeError);
  });
}

if (process.platform !== "linux") {
  test("non-Linux construction is unavailable without a layout fallback", () => {
    assert.throws(() => createXkbClientKeymap(source), /Client keymap unavailable/);
  });
  console.log(
    JSON.stringify({
      suite: "client XKB host source boundary",
      cases,
      actualExitCode: 0,
      nativeXkb: false,
      reason: "non-Linux host",
    }),
  );
} else {
  // Native construction must succeed on the designated existing Linux runtime.
  // Missing libxkbcommon is a failed native gate, never a skip or US substitution.
  const keymap = createXkbClientKeymap(source);
  try {
    test("native keycodes add eight and default group follows the supplied map", () => {
      assert.deepEqual(keymap.translate(30), { key: "a", text: "a" });
      assert.deepEqual(keymap.translate(16), { key: "q", text: "q" });
      assert.deepEqual(keymap.translate(21), { key: "y", text: "y" });
      assert.deepEqual(keymap.translate(57), { key: " ", text: " " });
      assert.deepEqual(keymap.modifiers(), { shift: false, ctrl: false, alt: false, meta: false });
    });
    test("depressed and latched Shift use serialized masks without update_key", () => {
      mask(keymap, 1);
      assert.deepEqual(keymap.translate(30), { key: "A", text: "A" });
      assert.equal(keymap.modifiers().shift, true);
      assert.deepEqual(keymap.translate(15), { key: "Tab" });
      mask(keymap, 0, 0, 0, 1);
      assert.deepEqual(keymap.translate(16), { key: "Q", text: "Q" });
      assert.equal(keymap.modifiers().shift, true);
      // Translation alone cannot consume the compositor's latched mask.
      assert.deepEqual(keymap.translate(16), { key: "Q", text: "Q" });
      keymap.reset();
    });
    test("Caps Lock and Shift plus Caps follow XKB alphabetic type", () => {
      mask(keymap, 0, 2);
      assert.deepEqual(keymap.translate(30), { key: "A", text: "A" });
      assert.equal(keymap.modifiers().shift, false);
      mask(keymap, 1, 2);
      assert.deepEqual(keymap.translate(30), { key: "a", text: "a" });
      keymap.reset();
    });
    test("alternate group changes the real logical letter and full Unicode text", () => {
      mask(keymap, 0, 0, 1);
      assert.deepEqual(keymap.translate(30), { key: "q", text: "q" });
      assert.deepEqual(keymap.translate(16), { key: "a", text: "a" });
      assert.deepEqual(keymap.translate(21), { key: "z", text: "z" });
      assert.deepEqual(keymap.translate(52), { key: "🙂", text: "🙂" });
      mask(keymap, 1, 0, 1);
      assert.deepEqual(keymap.translate(30), { key: "Q", text: "Q" });
      keymap.reset();
      assert.deepEqual(keymap.translate(52), { key: "ü", text: "ü" });
      mask(keymap, 1);
      assert.deepEqual(keymap.translate(52), { key: "Ü", text: "Ü" });
      keymap.reset();
    });
    test("effective Control, Mod1 and Mod4 suppress text and preserve shortcut key", () => {
      for (const [value, name] of [
        [4, "ctrl"],
        [8, "alt"],
        [64, "meta"],
      ] satisfies [number, "ctrl" | "alt" | "meta"][]) {
        mask(keymap, value);
        assert.equal(keymap.modifiers()[name], true);
        assert.deepEqual(keymap.translate(30), { key: "a" });
        keymap.reset();
        mask(keymap, 0, value);
        assert.equal(keymap.modifiers()[name], true);
        assert.deepEqual(keymap.translate(30), { key: "a" });
        keymap.reset();
      }
    });
    test("Mod5 AltGr is not Alt and emits the supplied level-three character", () => {
      mask(keymap, 128);
      assert.equal(keymap.modifiers().alt, false);
      assert.deepEqual(keymap.translate(18), { key: "€", text: "€" });
      keymap.reset();
    });
    test("standard navigation names never become control text", () => {
      for (const [code, key] of [
        [1, "Escape"],
        [14, "Backspace"],
        [15, "Tab"],
        [28, "Enter"],
        [96, "Enter"],
        [102, "Home"],
        [103, "ArrowUp"],
        [104, "PageUp"],
        [105, "ArrowLeft"],
        [106, "ArrowRight"],
        [107, "End"],
        [108, "ArrowDown"],
        [109, "PageDown"],
        [110, "Insert"],
        [111, "Delete"],
      ] satisfies [number, string][]) {
        assert.deepEqual(keymap.translate(code), { key });
      }
      assert.deepEqual(keymap.translate(53), {});
      assert.deepEqual(keymap.translate(200), {});
    });
    test("source buffer lifetime and independent resource ownership", () => {
      const disposable = Buffer.from(source);
      const other = createXkbClientKeymap(disposable);
      disposable.fill(0);
      try {
        mask(other, 1, 0, 1);
        assert.deepEqual(other.translate(30), { key: "Q", text: "Q" });
        assert.deepEqual(keymap.translate(30), { key: "a", text: "a" });
      } finally {
        other.destroy();
        other.destroy();
      }
      assert.deepEqual(keymap.translate(30), { key: "a", text: "a" });
      assert.throws(() => other.translate(30), /Client keymap unavailable/);
      assert.throws(() => other.modifiers(), /Client keymap unavailable/);
      assert.throws(() => other.reset(), /Client keymap unavailable/);
    });
    test("invalid integer masks and keycodes reject before native conversion", () => {
      for (const value of [-1, 1.5, NaN, Infinity, 0x100000000]) {
        for (const field of ["depressed", "latched", "locked", "group"] satisfies Array<
          "depressed" | "latched" | "locked" | "group"
        >) {
          assert.throws(
            () =>
              keymap.updateMask({ depressed: 0, latched: 0, locked: 0, group: 0, [field]: value }),
            safeError,
          );
        }
        assert.throws(() => keymap.translate(value), safeError);
      }
      assert.throws(() => keymap.translate(0xfffffff8), safeError);
      assert.deepEqual(keymap.translate(30), { key: "a", text: "a" });
    });
    test("native grammar failures are generic and do not poison later construction", () => {
      for (const invalid of [
        `xkb_keymap { ${privateMarker} };\0`,
        `xkb_keymap { xkb_keycodes "bad" { include "${privateMarker}" }; };\0`,
        serialized.replace(
          "symbols[Group1] = [ a, A ]",
          `symbols[Group1] = [ a, ; ${privateMarker} ]`,
        ) + "\0",
      ]) {
        assert.throws(() => createXkbClientKeymap(Buffer.from(invalid)), safeError);
        const fresh = createXkbClientKeymap(source);
        assert.deepEqual(fresh.translate(30), { key: "a", text: "a" });
        fresh.destroy();
      }
      for (let i = 0; i < 64; i++) {
        const fresh = createXkbClientKeymap(source);
        fresh.destroy();
        fresh.destroy();
      }
    });
    test("actual Wayland decoding owns real FDs and emits native Shift, Caps, group and replacement text", () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-client-xkb-wire-"));
      fs.chmodSync(directory, 0o700);
      const events: UiKeyEvent[] = [];
      const target = {};
      const pressedKeys = new Set<number>();
      // Default factory and default FD I/O. Nothing substitutes for native XKB here.
      const keyboard = new WaylandKeyboard({
        pressedKeys,
        resolveSurface: (id) => (id === 10 ? target : null),
        emitKey(received, event) {
          assert.equal(received, target);
          events.push(event);
        },
        onSerial() {},
      });
      let sequence = 0;
      function dispatch(opcode: number, builder: MessageBuilder) {
        const message = builder.build(7, opcode);
        keyboard.handle(opcode, new MessageReader(message.data, message.fds));
      }
      function sendMap(bytes: Buffer) {
        const file = path.join(directory, String(++sequence));
        fs.writeFileSync(file, bytes, { mode: 0o600 });
        const fd = fs.openSync(file, "r");
        fs.unlinkSync(file);
        try {
          dispatch(
            wlKeyboard.events.keymap.opcode,
            new MessageBuilder()
              .uint(wlKeyboard.enums.keymapFormat.xkbV1)
              .fd(fd)
              .uint(bytes.length),
          );
          assert.throws(
            () => fs.fstatSync(fd),
            (error: unknown) => error instanceof Error && "code" in error && error.code === "EBADF",
          );
        } finally {
          // On a regression, clean up a descriptor still owned by this test.
          try {
            fs.closeSync(fd);
          } catch {
            /* Already consumed by the decoder. */
          }
        }
      }
      function enter() {
        dispatch(
          wlKeyboard.events.enter.opcode,
          new MessageBuilder().uint(1).object(10).array(Buffer.alloc(0)),
        );
      }
      function wireMask(depressed = 0, locked = 0, group = 0, latched = 0) {
        dispatch(
          wlKeyboard.events.modifiers.opcode,
          new MessageBuilder().uint(2).uint(depressed).uint(latched).uint(locked).uint(group),
        );
      }
      function down(code: number) {
        dispatch(
          wlKeyboard.events.key.opcode,
          new MessageBuilder().uint(3).uint(0).uint(code).uint(1),
        );
        return events.at(-1);
      }
      try {
        sendMap(source);
        assert.deepEqual(keyboard.keymapState(), { kind: "available" });
        enter();
        assert.equal(down(30)?.text, "a");
        wireMask(1);
        const shifted = down(30);
        assert.equal(shifted?.key, "A");
        assert.equal(shifted?.text, "A");
        assert.equal(shifted?.modifiers.shift, true);
        assert.equal(shifted?.type, "repeat");
        wireMask(0, 2);
        const caps = down(30);
        assert.equal(caps?.text, "A");
        assert.equal(caps?.modifiers.shift, false);
        wireMask(0, 0, 1);
        assert.equal(down(30)?.text, "q");
        assert.equal(down(52)?.text, "🙂");
        wireMask(0, 0, 1, 1);
        assert.equal(down(30)?.text, "Q");
        wireMask(128);
        const altGr = down(18);
        assert.equal(altGr?.text, "€");
        assert.equal(altGr?.modifiers.alt, false);
        wireMask(4);
        const shortcut = down(30);
        assert.equal(shortcut?.key, "a");
        assert.equal(shortcut?.text, undefined);
        assert.equal(shortcut?.modifiers.ctrl, true);

        sendMap(
          Buffer.from(
            serialized.replace("symbols[Group1] = [ a, A ]", "symbols[Group1] = [ b, B ]") + "\0",
          ),
        );
        assert.deepEqual(keyboard.keymapState(), { kind: "available" });
        assert.deepEqual(keyboard.modifiers(), {
          shift: false,
          ctrl: false,
          alt: false,
          meta: false,
        });
        assert.equal(down(30)?.text, "b");
        wireMask(1);
        assert.equal(down(30)?.text, "B");
        sendMap(Buffer.from(`xkb_keymap { ${privateMarker} };\0`));
        assert.deepEqual(keyboard.keymapState(), { kind: "unavailable", reason: "invalid" });
        const unavailable = down(30);
        assert.equal(unavailable?.key, undefined);
        assert.equal(unavailable?.text, undefined);
        assert.equal(unavailable?.modifiers.shift, false);
        // Navigation remains usable for dismissal; it never inserts fallback text.
        const navigation = down(15);
        assert.equal(navigation?.key, "Tab");
        assert.equal(navigation?.text, undefined);
        sendMap(source);
        assert.equal(down(30)?.text, "a");
        keyboard.disconnect();
        keyboard.disconnect();
        const before = events.length;
        wireMask(1, 2, 1);
        down(30);
        down(15);
        assert.equal(events.length, before);
        assert.equal(pressedKeys.size, 0);
        assert.deepEqual(keyboard.keymapState(), { kind: "unavailable", reason: "disconnected" });
      } finally {
        keyboard.disconnect();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  } finally {
    keymap.destroy();
    keymap.destroy();
  }
  console.log(
    JSON.stringify({
      suite: "native client XKB serialized keymap",
      cases,
      actualExitCode: 0,
      nativeXkb: true,
      seatConnections: 0,
      deviceAccess: 0,
    }),
  );
}
