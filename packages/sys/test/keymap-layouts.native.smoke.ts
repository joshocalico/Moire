/**
 * Configured keymaps through real libxkbcommon: several layouts with variants and options,
 * server-side layout switching, and the client's view of the same map. Linux only; run by the
 * nix install check (moire-native-desktop). No devices.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { closeFd, createXkbKeymapMemfd, XkbKeyboardState, type XkbRuleNames } from "@moire/sys";
// oxlint-disable-next-line import/no-relative-parent-imports -- Verify the actual client consumer of the advertised map.
import { createXkbClientKeymap } from "../../ui/src/platforms/wayland/xkb";

assert.equal(
  process.platform,
  "linux",
  "Native XKB proof requires Linux; a host skip is not a pass",
);

const KEY_Y = 21;
const KEY_CAPSLOCK = 58;
const CONTROL_MASK = 1 << 2;

function compile(names: XkbRuleNames) {
  const map = createXkbKeymapMemfd(names);
  const source = Buffer.alloc(map.size);
  assert.equal(fs.readSync(map.fd, source, 0, source.length, 0), source.length);
  assert.equal(source.at(-1), 0, "advertised size includes the terminating NUL");
  return { map, source, server: new XkbKeyboardState(map), client: createXkbClientKeymap(source) };
}

let cases = 0;
{
  const { map, server, client } = compile({
    rules: "evdev",
    model: "pc105",
    layout: "us,de",
    variant: ",nodeadkeys",
    options: "caps:escape",
  });
  try {
    assert.equal(server.layoutCount(), 2);
    assert.match(server.layoutName(0) ?? "", /English/);
    assert.match(server.layoutName(1) ?? "", /German/);
    assert.equal(client.translate(KEY_Y).text, "y", "US first");
    const switched = server.setLayoutIndex(1);
    assert.ok(switched, "switching changes the serialized group");
    assert.equal(switched.group, 1);
    client.updateMask(switched);
    assert.equal(client.translate(KEY_Y).text, "z", "German QWERTZ after the switch");
    assert.equal(server.setLayoutIndex(1), null, "already active");
    assert.throws(() => server.setLayoutIndex(2), RangeError);
    // Modifier state survives a layout switch.
    server.update({ code: 42, value: 1, timeMs: 0 });
    const withShift = server.setLayoutIndex(0);
    assert.ok(withShift && withShift.depressed !== 0, "held Shift kept across the switch");
    client.updateMask(withShift);
    assert.equal(client.translate(KEY_Y).text, "Y");
    server.update({ code: 42, value: 0, timeMs: 0 });
    assert.equal(server.snapshot().depressed, 0, "Shift released after the switch");
    // caps:escape: Caps Lock is Escape and never locks.
    assert.equal(client.translate(KEY_CAPSLOCK).key, "Escape");
    server.update({ code: KEY_CAPSLOCK, value: 1, timeMs: 0 });
    server.update({ code: KEY_CAPSLOCK, value: 0, timeMs: 0 });
    assert.equal(server.snapshot().locked, 0);
    cases++;
  } finally {
    client.destroy();
    server.close();
    closeFd(map.fd);
  }
}
{
  const { map, server, client } = compile({
    rules: "evdev",
    model: "pc105",
    layout: "gb,fr,ru",
    variant: "extd,,",
    options: "ctrl:nocaps",
  });
  try {
    assert.equal(server.layoutCount(), 3);
    const caps = server.update({ code: KEY_CAPSLOCK, value: 1, timeMs: 0 });
    assert.ok(caps && (caps.depressed & CONTROL_MASK) !== 0, "ctrl:nocaps makes Caps a Control");
    server.update({ code: KEY_CAPSLOCK, value: 0, timeMs: 0 });
    const russian = server.setLayoutIndex(2);
    assert.ok(russian);
    client.updateMask(russian);
    assert.equal(client.translate(KEY_Y).text, "н", "Cyrillic on the third group");
    cases++;
  } finally {
    client.destroy();
    server.close();
    closeFd(map.fd);
  }
}
assert.throws(
  () =>
    createXkbKeymapMemfd({
      rules: "evdev",
      model: "pc105",
      layout: "no-such-layout",
      variant: "",
      options: "",
    }),
  /xkb_keymap_new_from_names failed for layout=no-such-layout/,
  "an unknown layout is an error the compositor can fall back from",
);
cases++;
// No names still means the system default, exactly as before.
{
  const map = createXkbKeymapMemfd();
  const server = new XkbKeyboardState(map);
  try {
    assert.equal(server.layoutCount(), 1);
  } finally {
    server.close();
    closeFd(map.fd);
  }
  cases++;
}
console.log(
  JSON.stringify({ suite: "native configured keymaps", cases, nativeXkb: true, deviceAccess: 0 }),
);
