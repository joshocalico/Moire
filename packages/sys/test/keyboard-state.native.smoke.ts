/** Real XKB server state serialized into the real client keymap; no devices. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { closeFd, createXkbKeymapMemfd, XkbKeyboardState } from "@moire/sys";
// oxlint-disable-next-line import/no-relative-parent-imports -- Verify the actual mask consumer independently of server bindings.
import { createXkbClientKeymap } from "../../ui/src/platforms/wayland/xkb";

const map = createXkbKeymapMemfd();
const source = Buffer.alloc(map.size);
assert.equal(fs.readSync(map.fd, source, 0, source.length, 0), source.length);
const server = new XkbKeyboardState(map);
const client = createXkbClientKeymap(source);
function edge(code: number, value: 0 | 1 | 2) {
  const change = server.update({ code, value, timeMs: 0 });
  if (change) client.updateMask(change);
  return change;
}
try {
  for (const [code, name] of [
    [42, "shift"],
    [29, "ctrl"],
    [56, "alt"],
    [125, "meta"],
  ] as const) {
    assert.ok(edge(code, 1), `${name} press changes masks`);
    assert.equal(client.modifiers()[name], true);
    assert.equal(edge(code, 2), null, `${name} repeat leaves masks unchanged`);
    assert.equal(client.modifiers()[name], true);
    assert.ok(edge(code, 0), `${name} release changes masks`);
    assert.equal(client.modifiers()[name], false);
  }
  edge(42, 1);
  assert.equal(client.translate(30).text, "A");
  edge(42, 0);
  assert.equal(client.translate(30).text, "a");
  edge(58, 1);
  edge(58, 0);
  assert.notEqual(server.snapshot().locked, 0);
  assert.equal(client.translate(30).text, "A");
  const locked = server.snapshot();
  assert.equal(edge(58, 2), null);
  assert.deepEqual(server.snapshot(), locked);
  edge(58, 1);
  edge(58, 0);
  assert.equal(server.snapshot().locked, 0);
  assert.equal(client.translate(30).text, "a");
  // Focus transfer initializes a fresh client from the current authoritative mask.
  edge(56, 1);
  const transferred = createXkbClientKeymap(source);
  try {
    transferred.updateMask(server.snapshot());
    assert.equal(transferred.modifiers().alt, true);
  } finally {
    transferred.destroy();
  }
  edge(56, 0);
  assert.deepEqual(client.modifiers(), {
    shift: false,
    ctrl: false,
    alt: false,
    meta: false,
  });
  console.log(
    JSON.stringify({
      suite: "native server XKB state",
      modifierEdges: 4,
      shiftText: true,
      capsLock: true,
      repeatStable: true,
      focusSnapshot: true,
      deviceAccess: 0,
    }),
  );
} finally {
  client.destroy();
  server.close();
  server.close();
  closeFd(map.fd);
}
