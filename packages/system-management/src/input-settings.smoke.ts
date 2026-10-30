/** The keyboard & pointer client: prefs as the source of truth, live layout over D-Bus, the fake. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DbusMessage, SessionBus } from "@moire/dbus";
import { loadSettings, updateSettings } from "@moire/prefs";
import {
  connectInputSettings,
  createFakeInputSettings,
  INPUT_BUS,
  INPUT_INTERFACE,
  INPUT_PATH,
  layoutWire,
  parseLayoutWire,
  parsePointerDevicesWire,
  pointerDevicesWire,
  touchpadPresence,
  type InputSettingsState,
} from "./input-settings";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-input-settings-"));
const previous = process.env.XDG_CONFIG_HOME;
process.env.XDG_CONFIG_HOME = fixture;
let cases = 0;
function pass(name: string): void {
  cases++;
  console.log(`PASS ${name}`);
}

try {
  // Fake: same normalization as prefs, records writes, simulates the shortcut.
  {
    const fake = createFakeInputSettings({
      keyboard: {
        layouts: [
          { layout: "us", variant: "" },
          { layout: "de", variant: "nodeadkeys" },
        ],
      },
    });
    const seen: InputSettingsState[] = [];
    fake.subscribe((state) => seen.push(state));
    assert.equal(fake.state.activeLayout.id, "us");
    assert.equal(fake.state.activeLayout.source, "compositor");
    fake.cycleLayout();
    assert.equal(fake.state.activeLayout.id, "de(nodeadkeys)");
    assert.equal((await fake.setActiveLayout(0)).id, "us");
    await assert.rejects(fake.setActiveLayout(5), RangeError);
    const stored = await fake.setKeyboard({ repeatRate: 500, capsLock: "escape" });
    assert.equal(stored.repeatRate, 100, "clamped like prefs");
    assert.equal(stored.capsLock, "escape");
    await fake.setPointer({ speed: -3, leftHanded: true });
    assert.equal(fake.state.pointer.speed, -1);
    assert.equal(fake.state.pointer.leftHanded, true);
    assert.deepEqual(
      fake.writes.map((write) => write.kind),
      ["active-layout", "active-layout", "keyboard", "pointer"],
    );
    assert.equal(seen.length, 4, "a rejected switch publishes nothing");
    const catalog = await fake.availableLayouts();
    assert.equal(catalog.source, "fallback");
    const offline = createFakeInputSettings({ compositor: false });
    assert.equal(offline.state.activeLayout.source, "prefs");
    await assert.rejects(offline.setActiveLayout(0));
    await fake.dispose();
  }
  pass("fake client normalizes, records writes and cycles layouts");

  // Real client without a bus: reads and writes prefs; the active layout comes from prefs.
  {
    const client = await connectInputSettings({ offline: true, pollMs: 20 });
    assert.equal(client.state.keyboard.layouts[0]?.layout, "us");
    assert.equal(client.state.activeLayout.source, "prefs");
    const seen: InputSettingsState[] = [];
    client.subscribe((state) => seen.push(state));
    await client.setKeyboard({
      layouts: [
        { layout: "fr", variant: "" },
        { layout: "us", variant: "intl" },
      ],
      switchShortcut: "alt-shift",
    });
    assert.deepEqual(loadSettings().keyboard.layouts, [
      { layout: "fr", variant: "" },
      { layout: "us", variant: "intl" },
    ]);
    assert.equal(loadSettings().keyboard.switchShortcut, "alt-shift");
    assert.equal(client.state.activeLayout.id, "fr");
    await client.setPointer({ naturalScrollMouse: true });
    assert.equal(loadSettings().pointer.naturalScrollMouse, true);
    assert.equal(loadSettings().keyboard.switchShortcut, "alt-shift", "setters merge, not replace");
    await assert.rejects(client.setActiveLayout(1), /not reachable/);
    // Another writer (the compositor, a second Settings window) is picked up by polling.
    const before = seen.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    updateSettings({ pointer: { ...loadSettings().pointer, speed: 0.25 } });
    for (let i = 0; i < 50 && client.state.pointer.speed !== 0.25; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(client.state.pointer.speed, 0.25);
    assert.ok(seen.length > before);
    await client.dispose();
  }
  pass("offline client writes through prefs and follows external prefs changes");

  // Real client with a fake bus standing in for the compositor's org.moire.Input1.
  {
    let active = 0;
    const layouts = [
      { index: 0, id: "fr", layout: "fr", variant: "", name: "French", count: 2 },
      {
        index: 1,
        id: "us(intl)",
        layout: "us",
        variant: "intl",
        name: "English (US, intl.)",
        count: 2,
      },
    ];
    let signal: ((message: DbusMessage) => void) | null = null;
    let devicesSignal: ((message: DbusMessage) => void) | null = null;
    const calls: string[] = [];
    const bus = {
      async subscribeSignal(match: Record<string, string>, listener: (m: DbusMessage) => void) {
        assert.deepEqual(
          { ...match, member: "" },
          { sender: INPUT_BUS, path: INPUT_PATH, interface: INPUT_INTERFACE, member: "" },
        );
        if (match.member === "PointerDevicesChanged") {
          devicesSignal = listener;
          return async () => {
            devicesSignal = null;
          };
        }
        assert.equal(match.member, "LayoutChanged");
        signal = listener;
        return async () => {
          signal = null;
        };
      },
      async call(input: { member: string; body?: unknown[]; destination: string }) {
        assert.equal(input.destination, INPUT_BUS);
        calls.push(input.member);
        if (input.member === "GetPointerDevices")
          return {
            body: pointerDevicesWire([{ name: "Virtual tablet", kind: "mouse", clickpad: false }]),
          } as DbusMessage;
        if (input.member === "SetActiveLayout") active = Number(input.body?.[0]);
        return { body: layoutWire(layouts[active]!) } as DbusMessage;
      },
      close() {
        throw new Error("a borrowed bus is not closed");
      },
    } as unknown as SessionBus;
    const client = await connectInputSettings({ bus, pollMs: 1_000 });
    assert.equal(client.state.activeLayout.source, "compositor");
    assert.equal(client.state.activeLayout.name, "French");
    const layout = await client.setActiveLayout(1);
    assert.equal(layout.id, "us(intl)");
    // The compositor's signal (e.g. the user pressed the shortcut) updates subscribers.
    const seen: string[] = [];
    client.subscribe((state) => seen.push(state.activeLayout.id));
    signal!({ type: 4, serial: 1, body: layoutWire(layouts[0]!) } as DbusMessage);
    assert.deepEqual(seen, ["fr"]);
    assert.deepEqual(calls, ["GetActiveLayout", "GetPointerDevices", "SetActiveLayout"]);
    assert.equal(parseLayoutWire(["x"]), null);
    // Touchpad rows follow the compositor's open devices: none until a touchpad appears.
    assert.deepEqual(touchpadPresence(client.state), { touchpad: false, clickpad: false });
    devicesSignal!({
      type: 4,
      serial: 2,
      body: pointerDevicesWire([
        { name: "Virtual tablet", kind: "mouse", clickpad: false },
        { name: "SYNA2393 Touchpad", kind: "touchpad", clickpad: true },
      ]),
    } as DbusMessage);
    assert.deepEqual(touchpadPresence(client.state), { touchpad: true, clickpad: true });
    devicesSignal!({ type: 4, serial: 3, body: [[["x", "keyboard", false]]] } as DbusMessage);
    assert.equal(touchpadPresence(client.state).touchpad, true, "malformed lists are ignored");
    assert.equal(parsePointerDevicesWire([Array(33).fill(["x", "mouse", false])]), null);
    await client.dispose();
    assert.equal(signal, null, "signal subscription released");
    assert.equal(devicesSignal, null, "devices subscription released");
  }
  pass("live layout and pointer devices come from the compositor and follow its signals");
} finally {
  process.env.XDG_CONFIG_HOME = previous;
  fs.rmSync(fixture, { recursive: true, force: true });
}
console.log(JSON.stringify({ suite: "input settings client", cases }));
