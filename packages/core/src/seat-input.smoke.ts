/**
 * Keyboard and pointer prefs through the actual compositor seat: rule names, repeat_info on
 * bind and on change, keymap re-advertisement, the layout switch shortcut, and pointer device
 * config. XKB is a fake backend here; the native compile is covered by
 * packages/sys/test/keymap-layouts.native.smoke.ts.
 */
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeHeader } from "@moire/protocol";
import { wlCompositor, wlDisplay, wlKeyboard, wlRegistry, wlSeat } from "@moire/protocol/generated";
import {
  DEFAULT_KEYBOARD_SETTINGS,
  DEFAULT_POINTER_SETTINGS,
  type InputSettings,
  type KeyboardSettings,
} from "@moire/prefs";
import type {
  KeyboardModifierMask,
  KeymapMemfd,
  PointerConfigOption,
  PointerDeviceConfig,
  PointerDeviceConfigTarget,
  PointerDeviceInfo,
  XkbRuleNames,
} from "@moire/sys";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-seat-input-"));
const previous = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, "config");
const { CompositorServer, ClientSession } = await import("./server");
const {
  applyPointerSettings,
  LayoutSwitchDetector,
  pointerDeviceConfigFor,
  repeatInfoFor,
  xkbRuleNamesFor,
} = await import("./seat-input");

let cases = 0;
function pass(name: string): void {
  cases++;
  console.log(`PASS ${name}`);
}

// --- Pure mapping -----------------------------------------------------------------------------

const twoLayouts: KeyboardSettings = {
  ...DEFAULT_KEYBOARD_SETTINGS,
  layouts: [
    { layout: "us", variant: "" },
    { layout: "de", variant: "nodeadkeys" },
  ],
  capsLock: "escape",
};
assert.deepEqual(xkbRuleNamesFor(DEFAULT_KEYBOARD_SETTINGS), {
  rules: "evdev",
  model: "pc105",
  layout: "us",
  variant: "",
  options: "",
});
assert.deepEqual(xkbRuleNamesFor(twoLayouts), {
  rules: "evdev",
  model: "pc105",
  layout: "us,de",
  variant: ",nodeadkeys",
  options: "caps:escape",
});
assert.equal(xkbRuleNamesFor({ ...twoLayouts, capsLock: "ctrl" }).options, "ctrl:nocaps");
assert.deepEqual(repeatInfoFor(DEFAULT_KEYBOARD_SETTINGS), { rate: 40, delay: 400 });
assert.deepEqual(repeatInfoFor({ ...DEFAULT_KEYBOARD_SETTINGS, repeatEnabled: false }), {
  rate: 0,
  delay: 400,
});
pass("prefs map to XKB rule names and repeat_info");

{
  const pressed = new Set<number>();
  const feed = (
    detector: InstanceType<typeof LayoutSwitchDetector>,
    code: number,
    value: number,
  ) => {
    if (value === 0) pressed.delete(code);
    else pressed.add(code);
    return detector.handle({ code, value }, pressed);
  };
  const superSpace = new LayoutSwitchDetector("super-space");
  assert.deepEqual(feed(superSpace, 57, 1), { cycle: false, consume: false }, "plain Space");
  feed(superSpace, 57, 0);
  feed(superSpace, 125, 1);
  assert.deepEqual(feed(superSpace, 57, 1), { cycle: true, consume: true });
  assert.deepEqual(feed(superSpace, 57, 2), { cycle: false, consume: true }, "repeat swallowed");
  feed(superSpace, 125, 0);
  assert.deepEqual(feed(superSpace, 57, 0), { cycle: false, consume: true }, "release swallowed");
  assert.deepEqual(feed(superSpace, 57, 1), { cycle: false, consume: false });
  feed(superSpace, 57, 0);

  const altShift = new LayoutSwitchDetector("alt-shift");
  feed(altShift, 56, 1);
  assert.equal(feed(altShift, 42, 1).cycle, false, "chords fire on release");
  assert.deepEqual(feed(altShift, 42, 0), { cycle: true, consume: false });
  feed(altShift, 56, 0);
  feed(altShift, 56, 1);
  feed(altShift, 42, 1);
  feed(altShift, 15, 1); // Alt+Shift+Tab is not a layout switch
  feed(altShift, 15, 0);
  assert.equal(feed(altShift, 42, 0).cycle, false);
  feed(altShift, 56, 0);

  const ctrlShift = new LayoutSwitchDetector("ctrl-shift");
  feed(ctrlShift, 29, 1);
  feed(ctrlShift, 42, 1);
  feed(ctrlShift, 20, 1); // Ctrl+Shift+T reaches apps and disarms
  feed(ctrlShift, 20, 0);
  assert.equal(feed(ctrlShift, 42, 0).cycle, false);
  feed(ctrlShift, 29, 0);

  const none = new LayoutSwitchDetector("none");
  feed(none, 125, 1);
  assert.deepEqual(feed(none, 57, 1), { cycle: false, consume: false });
  feed(none, 57, 0);
  feed(none, 125, 0);
  assert.equal(pressed.size, 0);
}
pass("layout switch shortcuts: Super+Space swallows its key, chords fire on clean release");

// --- Pointer config mapping through a fake libinput-shaped device ---------------------------

class FakeDevice implements PointerDeviceConfigTarget {
  readonly calls: [PointerConfigOption, unknown][] = [];
  constructor(
    readonly info: PointerDeviceInfo,
    private readonly available: readonly PointerConfigOption[],
  ) {}
  supports(option: PointerConfigOption): boolean {
    return this.available.includes(option);
  }
  set<K extends PointerConfigOption>(option: K, value: PointerDeviceConfig[K]): void {
    assert.ok(this.supports(option), `setter for unsupported ${option} must not be called`);
    this.calls.push([option, value]);
  }
}
const prefs = {
  ...DEFAULT_POINTER_SETTINGS,
  speed: 0.5,
  accelProfile: "flat" as const,
  naturalScrollMouse: false,
  naturalScrollTouchpad: true,
  tapToClick: true,
  scrollMethod: "edge" as const,
  disableWhileTyping: false,
  leftHanded: true,
  middleEmulation: true,
};
const allOptions: PointerConfigOption[] = [
  "accelSpeed",
  "accelProfile",
  "naturalScroll",
  "leftHanded",
  "middleEmulation",
  "tap",
  "scrollMethod",
  "disableWhileTyping",
  "kineticScroll",
  "clickMethod",
];
const touchpad = new FakeDevice(
  { path: "/dev/input/event5", name: "Touchpad", kind: "touchpad", relative: true },
  allOptions,
);
const touchpadResult = applyPointerSettings(prefs, touchpad);
assert.deepEqual(Object.fromEntries(touchpad.calls), {
  accelSpeed: 0.5,
  accelProfile: "flat",
  naturalScroll: true,
  leftHanded: true,
  middleEmulation: true,
  tap: true,
  scrollMethod: "edge",
  disableWhileTyping: false,
  kineticScroll: true,
  clickMethod: "clickfinger",
});
assert.deepEqual(touchpadResult.unsupported, []);
const mouse = new FakeDevice(
  { path: "/dev/input/event3", name: "Mouse", kind: "mouse", relative: true },
  ["accelSpeed", "accelProfile", "naturalScroll", "leftHanded", "middleEmulation"],
);
const mouseResult = applyPointerSettings(prefs, mouse);
assert.equal(Object.fromEntries(mouse.calls).naturalScroll, false, "mouse uses the mouse pref");
assert.deepEqual(mouseResult.unsupported.sort(), [
  "clickMethod",
  "disableWhileTyping",
  "kineticScroll",
  "scrollMethod",
  "tap",
]);
const tablet = new FakeDevice(
  { path: "/dev/input/event2", name: "VM tablet", kind: "mouse", relative: false },
  ["naturalScroll", "leftHanded", "middleEmulation"],
);
applyPointerSettings(prefs, tablet);
assert.equal(
  tablet.calls.some(([option]) => option === "accelSpeed"),
  false,
  "absolute devices get no acceleration",
);
assert.deepEqual(pointerDeviceConfigFor(prefs, mouse.info).tap, false);
pass("pointer prefs map onto a libinput-shaped device API, per device kind");

// --- Compositor seat ----------------------------------------------------------------------------

type FakeState = {
  group: number;
  count: number;
  closed: boolean;
};
const keymaps: { names: XkbRuleNames | undefined; map: KeymapMemfd }[] = [];
const states: FakeState[] = [];
const scratch = path.join(fixture, "keymaps");
fs.mkdirSync(scratch);
const backend = {
  createKeymap(names?: XkbRuleNames): KeymapMemfd {
    if (names?.layout.includes("broken")) throw new Error("fixture XKB rejects this layout");
    const file = path.join(scratch, `map-${keymaps.length}`);
    const body = `keymap ${JSON.stringify(names ?? null)}\0`;
    fs.writeFileSync(file, body);
    const map = { fd: fs.openSync(file, "r"), size: Buffer.byteLength(body) };
    keymaps.push({ names, map });
    return map;
  },
  createState(map: KeymapMemfd) {
    const entry = keymaps.find((k) => k.map === map);
    const state: FakeState = {
      group: 0,
      count: entry?.names ? entry.names.layout.split(",").length : 1,
      closed: false,
    };
    states.push(state);
    const mask = (): KeyboardModifierMask => ({
      depressed: 0,
      latched: 0,
      locked: 0,
      group: state.group,
    });
    return {
      snapshot: mask,
      update: () => null,
      layoutCount: () => state.count,
      layoutName: (index: number) => `Layout ${index}`,
      setLayoutIndex(index: number) {
        if (index === state.group) return null;
        state.group = index;
        return mask();
      },
      close() {
        state.closed = true;
      },
    };
  },
};

class Keyboard extends EventEmitter {
  start(): void {}
  stop(): void {}
}
class Server extends CompositorServer {
  protected override keyboardBackend = backend;
  activate(keyboard: Keyboard): void {
    this.startKeyboardInput(keyboard);
  }
}
class Connection extends EventEmitter {
  peerPid = 4343;
  sent: { data: Buffer; fds: number[] }[] = [];
  send(data: Buffer, fds: number[] = []): boolean {
    this.sent.push({ data: Buffer.from(data), fds: [...fds] });
    return true;
  }
  close(): void {
    this.emit("close");
  }
}

const settings = (keyboard: Partial<KeyboardSettings> = {}): InputSettings => ({
  keyboard: { ...DEFAULT_KEYBOARD_SETTINGS, ...keyboard },
  pointer: DEFAULT_POINTER_SETTINGS,
});

const server = new Server(fixture);
const shellLayouts: string[] = [];
let launcherUndone = 0;
try {
  // Start with two layouts already in prefs: the keymap is compiled before input starts.
  server.applyInputSettings(settings({ layouts: twoLayouts.layouts }));
  assert.equal(keymaps.at(-1)?.names?.layout, "us,de");
  const keyboard = new Keyboard();
  server.activate(keyboard);
  assert.equal(states.length, 1);
  assert.equal(server.keyboardLayout().id, "us");
  assert.equal(server.keyboardLayout().count, 2);
  Object.assign(server, {
    shell: {
      onKey: () => false,
      onPointerButton: () => false,
      paint() {},
      isLauncherOpen: () => false,
      setKeyboardLayout: (layout: { id: string }) => shellLayouts.push(layout.id),
      onLayoutShortcut: () => launcherUndone++,
    },
  });

  function bind(id: number, seatVersion: number) {
    const conn = new Connection();
    const client = new ClientSession(server, conn as never, id);
    (server as unknown as { clients: Set<unknown> }).clients.add(client);
    conn.emit("message", wlDisplay.requests.getRegistry.encode(1, 2));
    const globals = conn.sent
      .filter(({ data }) => decodeHeader(data).objectId === 2)
      .map(({ data }) => wlRegistry.events.global.decode(data));
    for (const [name, version, target] of [
      ["wl_compositor", 4, 3],
      ["wl_seat", seatVersion, 4],
    ] as const) {
      const global = globals.find((g) => g.interfaceValue === name);
      assert.ok(global);
      conn.emit("message", wlRegistry.requests.bind.encode(2, global.name, name, version, target));
    }
    conn.emit("message", wlCompositor.requests.createSurface.encode(3, 10));
    conn.emit("message", wlSeat.requests.getKeyboard.encode(4, 11));
    const keyboardEvents = (opcode: number) =>
      conn.sent.filter(
        ({ data }) => decodeHeader(data).objectId === 11 && decodeHeader(data).opcode === opcode,
      );
    return {
      conn,
      client,
      repeats: () =>
        keyboardEvents(wlKeyboard.events.repeatInfo.opcode).map(({ data }) => {
          const event = wlKeyboard.events.repeatInfo.decode(data);
          return [event.rate, event.delay];
        }),
      keymaps: () => keyboardEvents(wlKeyboard.events.keymap.opcode),
      groups: () =>
        keyboardEvents(wlKeyboard.events.modifiers.opcode).map(
          ({ data }) => wlKeyboard.events.modifiers.decode(data).group,
        ),
      keys: () =>
        keyboardEvents(wlKeyboard.events.key.opcode).map(({ data }) => {
          const event = wlKeyboard.events.key.decode(data);
          return [event.key, event.state];
        }),
    };
  }

  const modern = bind(1, 7);
  const legacy = bind(2, 3);
  assert.deepEqual(modern.repeats(), [[40, 400]], "repeat_info from prefs on get_keyboard");
  assert.deepEqual(legacy.repeats(), [], "repeat_info is v4+");
  assert.equal(modern.keymaps().length, 1);
  assert.equal(modern.keymaps()[0]!.fds.length, 1, "keymap carries its fd");
  pass("get_keyboard advertises the configured keymap and repeat_info");

  server.applyInputSettings(
    settings({ layouts: twoLayouts.layouts, repeatDelayMs: 250, repeatRate: 30 }),
  );
  assert.deepEqual(modern.repeats(), [
    [40, 400],
    [30, 250],
  ]);
  assert.equal(modern.keymaps().length, 1, "repeat changes do not resend the keymap");
  server.applyInputSettings(
    settings({
      layouts: twoLayouts.layouts,
      repeatDelayMs: 250,
      repeatRate: 30,
      repeatEnabled: false,
    }),
  );
  assert.deepEqual(modern.repeats().at(-1), [0, 250], "disabled repeat is rate 0");
  assert.deepEqual(legacy.repeats(), []);
  pass("repeat_info is re-sent live when repeat prefs change");

  // Focus the modern client so modifier/group updates are observable.
  const surface = modern.client.surfaceById(10)!;
  Object.assign(surface, { mapped: true, role: "toplevel", width: 100, height: 100 });
  server.focusClient(modern.client, 10);
  const press = (code: number, value: number) =>
    (
      server as unknown as { onKey(ev: { code: number; value: number; timeMs: number }): void }
    ).onKey({ code, value, timeMs: 1 });
  press(125, 1);
  press(57, 1);
  press(57, 0);
  press(125, 0);
  assert.equal(server.keyboardLayout().id, "de(nodeadkeys)");
  assert.equal(server.keyboardLayout().name, "Layout 1");
  assert.equal(modern.groups().at(-1), 1, "focused client gets the new group");
  assert.deepEqual(
    modern.keys().map(([key]) => key),
    [125, 125],
    "Space never reaches the client; Super press and release do",
  );
  assert.equal(launcherUndone, 1);
  assert.deepEqual(shellLayouts, ["de(nodeadkeys)"]);
  press(125, 1);
  press(57, 1);
  press(57, 0);
  press(125, 0);
  assert.equal(server.keyboardLayout().index, 0, "cycling wraps");
  assert.equal(server.cycleKeyboardLayout(1).id, "de(nodeadkeys)", "explicit index");
  pass("Super+Space cycles the group, updates the client, and notifies the shell");

  // New layout list: a new keymap goes to every keyboard, and the active layout is kept.
  const before = modern.keymaps().length;
  server.applyInputSettings(
    settings({
      layouts: [
        { layout: "fr", variant: "" },
        { layout: "de", variant: "nodeadkeys" },
      ],
      capsLock: "ctrl",
    }),
  );
  assert.equal(keymaps.at(-1)?.names?.layout, "fr,de");
  assert.equal(keymaps.at(-1)?.names?.options, "ctrl:nocaps");
  assert.equal(modern.keymaps().length, before + 1);
  assert.equal(legacy.keymaps().length, 2, "every bound keyboard gets the new keymap");
  assert.equal(states[0]!.closed, true, "old XKB state released");
  assert.equal(server.keyboardLayout().id, "de(nodeadkeys)", "still typing German");
  assert.equal(modern.groups().at(-1), 1);
  // A layout XKB rejects falls back to the default keymap instead of losing the keyboard.
  server.applyInputSettings(settings({ layouts: [{ layout: "broken", variant: "" }] }));
  assert.equal(keymaps.at(-1)?.names, undefined, "default keymap");
  // Shortcut none: Super+Space reaches the client.
  server.applyInputSettings(settings({ layouts: twoLayouts.layouts, switchShortcut: "none" }));
  const keysBefore = modern.keys().length;
  press(125, 1);
  press(57, 1);
  press(57, 0);
  press(125, 0);
  assert.equal(modern.keys().length, keysBefore + 4);
  assert.equal(server.keyboardLayout().index, 0);
  pass("layout and Caps Lock changes rebuild and re-advertise the keymap");
} finally {
  server.stop();
  process.env.HOME = previous.HOME;
  process.env.XDG_CONFIG_HOME = previous.XDG_CONFIG_HOME;
  fs.rmSync(fixture, { recursive: true, force: true });
}
console.log(
  JSON.stringify({ suite: "seat input prefs", cases, nativeXkb: false, deviceAccess: 0 }),
);
