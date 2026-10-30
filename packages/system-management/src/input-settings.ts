/**
 * Keyboard & pointer settings for the Settings app.
 *
 * - Settings are prefs (`~/.config/moire/settings.json`, fields `keyboard` and `pointer`). Every
 *   setter writes prefs; the compositor watches prefs and applies them live. Nothing here talks
 *   to devices.
 * - The active layout is live state owned by the compositor (`org.moire.Input1` on the
 *   compositor's `org.moire.Display1` bus name). Without the compositor (smokes, macOS) it
 *   falls back to the first configured layout, marked `source: "prefs"`.
 * - The layout catalog comes from xkeyboard-config's data files (see keyboard-layouts.ts).
 * - Which pointer devices are open is live compositor state too (`GetPointerDevices`,
 *   `PointerDevicesChanged`). Settings shows touchpad options only when one is a touchpad;
 *   without the compositor the list is empty, so they stay hidden rather than doing nothing.
 */
import { SessionBus } from "@moire/dbus";
import {
  createInputSettingsWatcher,
  keyboardLayoutId,
  loadInputSettings,
  normalizeKeyboardSettings,
  normalizePointerSettings,
  updateKeyboardSettings,
  updatePointerSettings,
  type KeyboardLayoutRef,
  type KeyboardSettings,
  type PointerSettings,
} from "@moire/prefs";
import { loadKeyboardLayoutCatalog, type KeyboardLayoutCatalog } from "./keyboard-layouts";

export {
  FALLBACK_LAYOUTS,
  loadKeyboardLayoutCatalog,
  parseEvdevXml,
  parseRulesLst,
  xkbConfigRootCandidates,
  type KeyboardLayoutCatalog,
  type KeyboardLayoutInfo,
  type KeyboardLayoutVariant,
} from "./keyboard-layouts";
export type {
  AccelProfile,
  CapsLockBehavior,
  KeyboardLayoutRef,
  KeyboardSettings,
  LayoutSwitchShortcut,
  PointerSettings,
  TouchpadClickMethod,
  TouchpadScrollMethod,
} from "@moire/prefs";

export const INPUT_BUS = "org.moire.Display1";
export const INPUT_PATH = "/org/moire/Input1";
export const INPUT_INTERFACE = "org.moire.Input1";

/** The layout clients are typing with. */
export type KeyboardLayoutState = {
  index: number;
  /** `de(nodeadkeys)`; equals `keyboardLayoutId` of the matching prefs entry. */
  id: string;
  layout: string;
  variant: string;
  /** XKB's description from the compiled keymap, or the id. */
  name: string;
  /** Number of configured layouts. */
  count: number;
};

export type ActiveKeyboardLayout = KeyboardLayoutState & { source: "compositor" | "prefs" };

/** An open pointer device, as the compositor reports it. */
export type PointerDeviceSummary = {
  name: string;
  /** "touchpad" only when Moire's multitouch driver runs it. */
  kind: "mouse" | "touchpad";
  /** The whole surface clicks; the click method applies. */
  clickpad: boolean;
};

export type InputSettingsState = {
  keyboard: KeyboardSettings;
  pointer: PointerSettings;
  activeLayout: ActiveKeyboardLayout;
  /** Empty when the compositor isn't reachable. */
  pointerDevices: readonly PointerDeviceSummary[];
};

/** Whether a touchpad is open, and whether one is a clickpad. */
export function touchpadPresence(state: Pick<InputSettingsState, "pointerDevices">): {
  touchpad: boolean;
  clickpad: boolean;
} {
  const pads = state.pointerDevices.filter((device) => device.kind === "touchpad");
  return { touchpad: pads.length > 0, clickpad: pads.some((device) => device.clickpad) };
}

export type InputSettingsClient = {
  /** Latest snapshot; replaced (never mutated) on every change. */
  readonly state: InputSettingsState;
  /** Called after prefs change (from anyone) or the compositor switches layout. */
  subscribe(listener: (state: InputSettingsState) => void): () => void;
  /** Layouts XKB can compile, for the picker. Cached after the first read. */
  availableLayouts(): Promise<KeyboardLayoutCatalog>;
  /** Merge into the stored keyboard prefs; resolves with what was stored (normalized). */
  setKeyboard(patch: Partial<KeyboardSettings>): Promise<KeyboardSettings>;
  /** Merge into the stored pointer prefs; resolves with what was stored (normalized). */
  setPointer(patch: Partial<PointerSettings>): Promise<PointerSettings>;
  /** Switch the live layout to a configured index. Rejects when no compositor is reachable. */
  setActiveLayout(index: number): Promise<ActiveKeyboardLayout>;
  /** Re-read prefs and the compositor's active layout now. */
  refresh(): Promise<void>;
  dispose(): Promise<void>;
};

/** D-Bus body for `GetActiveLayout`, `SetActiveLayout` and `LayoutChanged` (`ussssu`). */
export function layoutWire(layout: KeyboardLayoutState): unknown[] {
  return [layout.index, layout.id, layout.layout, layout.variant, layout.name, layout.count];
}

/** D-Bus body for `GetPointerDevices` and `PointerDevicesChanged` (`a(ssb)`). */
export function pointerDevicesWire(devices: readonly PointerDeviceSummary[]): unknown[] {
  return [devices.map((device) => [device.name, device.kind, device.clickpad])];
}

const MAX_POINTER_DEVICES = 32;

export function parsePointerDevicesWire(
  body: readonly unknown[] | undefined,
): PointerDeviceSummary[] | null {
  const list = body?.[0];
  if (!Array.isArray(list) || list.length > MAX_POINTER_DEVICES) return null;
  const devices: PointerDeviceSummary[] = [];
  for (const entry of list) {
    if (!Array.isArray(entry)) return null;
    const [name, kind, clickpad] = entry;
    if (typeof name !== "string" || (kind !== "mouse" && kind !== "touchpad")) return null;
    devices.push({ name: name.slice(0, 256), kind, clickpad: clickpad === true });
  }
  return devices;
}

export function parseLayoutWire(body: readonly unknown[] | undefined): KeyboardLayoutState | null {
  if (!body || body.length < 6) return null;
  const [index, id, layout, variant, name, count] = body;
  if (typeof id !== "string" || typeof layout !== "string") return null;
  return {
    index: Number(index ?? 0),
    id,
    layout,
    variant: String(variant ?? ""),
    name: String(name ?? id),
    count: Number(count ?? 1),
  };
}

/** The first configured layout, used until (or unless) the compositor answers. */
export function prefsActiveLayout(keyboard: KeyboardSettings): ActiveKeyboardLayout {
  const ref: KeyboardLayoutRef = keyboard.layouts[0] ?? { layout: "us", variant: "" };
  const id = keyboardLayoutId(ref);
  return {
    index: 0,
    id,
    layout: ref.layout,
    variant: ref.variant,
    name: id,
    count: keyboard.layouts.length,
    source: "prefs",
  };
}

/** How often the client re-stats settings.json for changes made elsewhere. */
const PREFS_POLL_MS = 1_000;

class Listeners {
  private readonly set = new Set<(state: InputSettingsState) => void>();
  add(listener: (state: InputSettingsState) => void): () => void {
    this.set.add(listener);
    return () => {
      this.set.delete(listener);
    };
  }
  emit(state: InputSettingsState): void {
    for (const listener of this.set) {
      try {
        listener(state);
      } catch (error) {
        console.warn("[input-settings] listener failed:", error);
      }
    }
  }
  clear(): void {
    this.set.clear();
  }
}

export type ConnectInputSettingsOptions = {
  /** Reuse an existing session bus connection; otherwise one is opened (and closed on dispose). */
  bus?: SessionBus | null;
  /** Skip D-Bus entirely (tests, or processes outside a session). */
  offline?: boolean;
  pollMs?: number;
};

export async function connectInputSettings(
  options: ConnectInputSettingsOptions = {},
): Promise<InputSettingsClient> {
  const listeners = new Listeners();
  let catalog: KeyboardLayoutCatalog | null = null;
  let disposed = false;
  let compositorLayout: KeyboardLayoutState | null = null;
  let pointerDevices: PointerDeviceSummary[] = [];

  const snapshot = (keyboard: KeyboardSettings, pointer: PointerSettings): InputSettingsState => ({
    keyboard,
    pointer,
    activeLayout: compositorLayout
      ? { ...compositorLayout, source: "compositor" }
      : prefsActiveLayout(keyboard),
    pointerDevices,
  });
  const initial = loadInputSettings();
  let state = snapshot(initial.keyboard, initial.pointer);
  const publish = (next: InputSettingsState) => {
    if (disposed || JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    listeners.emit(state);
  };

  const watcher = createInputSettingsWatcher((next) =>
    publish(snapshot(next.keyboard, next.pointer)),
  );
  const timer = setInterval(() => watcher.poll(), options.pollMs ?? PREFS_POLL_MS);
  timer.unref?.();

  let bus: SessionBus | null = null;
  let ownsBus = false;
  let stopSignal: (() => Promise<void>) | null = null;
  let stopDevicesSignal: (() => Promise<void>) | null = null;
  if (!options.offline) {
    try {
      bus = options.bus ?? (await SessionBus.connect());
      ownsBus = !options.bus;
      stopSignal = await bus.subscribeSignal(
        {
          sender: INPUT_BUS,
          path: INPUT_PATH,
          interface: INPUT_INTERFACE,
          member: "LayoutChanged",
        },
        (message) => {
          const layout = parseLayoutWire(message.body);
          if (!layout) return;
          compositorLayout = layout;
          publish(snapshot(state.keyboard, state.pointer));
        },
      );
      stopDevicesSignal = await bus.subscribeSignal(
        {
          sender: INPUT_BUS,
          path: INPUT_PATH,
          interface: INPUT_INTERFACE,
          member: "PointerDevicesChanged",
        },
        (message) => {
          const devices = parsePointerDevicesWire(message.body);
          if (!devices) return;
          pointerDevices = devices;
          publish(snapshot(state.keyboard, state.pointer));
        },
      );
    } catch {
      // No session bus: settings still work through prefs; the active layout comes from prefs.
      if (ownsBus) bus?.close();
      bus = null;
    }
  }

  const callLayout = async (member: string, body?: unknown[]): Promise<KeyboardLayoutState> => {
    if (!bus) throw new Error("The compositor is not reachable");
    const reply = await bus.call({
      destination: INPUT_BUS,
      path: INPUT_PATH,
      interface: INPUT_INTERFACE,
      member,
      ...(body ? { signature: "u", body } : {}),
    });
    const layout = parseLayoutWire(reply.body);
    if (!layout) throw new Error(`Malformed ${member} reply`);
    return layout;
  };

  const readPointerDevices = async (): Promise<PointerDeviceSummary[]> => {
    if (!bus) return [];
    const reply = await bus.call({
      destination: INPUT_BUS,
      path: INPUT_PATH,
      interface: INPUT_INTERFACE,
      member: "GetPointerDevices",
    });
    return parsePointerDevicesWire(reply.body) ?? [];
  };

  const refresh = async () => {
    const settings = loadInputSettings();
    try {
      if (bus) compositorLayout = await callLayout("GetActiveLayout");
    } catch {
      compositorLayout = null;
    }
    try {
      pointerDevices = await readPointerDevices();
    } catch {
      // An older compositor without GetPointerDevices: no touchpad options.
      pointerDevices = [];
    }
    publish(snapshot(settings.keyboard, settings.pointer));
  };
  await refresh();

  return {
    get state() {
      return state;
    },
    subscribe: (listener) => listeners.add(listener),
    availableLayouts: async () => (catalog ??= loadKeyboardLayoutCatalog()),
    async setKeyboard(patch) {
      const keyboard = updateKeyboardSettings(patch);
      publish(snapshot(keyboard, state.pointer));
      return keyboard;
    },
    async setPointer(patch) {
      const pointer = updatePointerSettings(patch);
      publish(snapshot(state.keyboard, pointer));
      return pointer;
    },
    async setActiveLayout(index) {
      compositorLayout = await callLayout("SetActiveLayout", [index]);
      publish(snapshot(state.keyboard, state.pointer));
      return state.activeLayout;
    },
    refresh,
    async dispose() {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
      listeners.clear();
      try {
        await Promise.all([stopSignal?.(), stopDevicesSignal?.()]);
      } finally {
        if (ownsBus) bus?.close();
      }
    },
  };
}

export type FakeInputSettingsOptions = {
  keyboard?: Partial<KeyboardSettings>;
  pointer?: Partial<PointerSettings>;
  catalog?: KeyboardLayoutCatalog;
  /** Behave as if the compositor answered (`source: "compositor"`); default true. */
  compositor?: boolean;
  /** Open pointer devices; default none (no touchpad rows). */
  pointerDevices?: readonly PointerDeviceSummary[];
};

export type FakeInputSettingsClient = InputSettingsClient & {
  /** Every setter call, in order, for assertions. */
  readonly writes: readonly (
    | { kind: "keyboard"; patch: Partial<KeyboardSettings> }
    | { kind: "pointer"; patch: Partial<PointerSettings> }
    | { kind: "active-layout"; index: number }
  )[];
  /** Simulate the user pressing the switch shortcut. */
  cycleLayout(): void;
};

/** In-memory client with the same normalization as prefs, for UI smokes and the gallery. */
export function createFakeInputSettings(
  options: FakeInputSettingsOptions = {},
): FakeInputSettingsClient {
  // The real prefs normalization, without the filesystem.
  let keyboard = normalizeKeyboardSettings(options.keyboard ?? {});
  let pointer = normalizePointerSettings(options.pointer ?? {});
  const compositor = options.compositor ?? true;
  let activeIndex = 0;
  const listeners = new Listeners();
  const writes: FakeInputSettingsClient["writes"][number][] = [];
  const active = (): ActiveKeyboardLayout => {
    const base = prefsActiveLayout(keyboard);
    if (!compositor) return base;
    const index = Math.min(activeIndex, keyboard.layouts.length - 1);
    const ref = keyboard.layouts[index]!;
    const id = keyboardLayoutId(ref);
    return {
      ...base,
      index,
      id,
      layout: ref.layout,
      variant: ref.variant,
      name: id,
      source: "compositor",
    };
  };
  const pointerDevices = compositor ? [...(options.pointerDevices ?? [])] : [];
  let state: InputSettingsState = { keyboard, pointer, activeLayout: active(), pointerDevices };
  const publish = () => {
    state = { keyboard, pointer, activeLayout: active(), pointerDevices };
    listeners.emit(state);
  };
  return {
    get state() {
      return state;
    },
    get writes() {
      return writes;
    },
    subscribe: (listener) => listeners.add(listener),
    availableLayouts: async () =>
      options.catalog ?? loadKeyboardLayoutCatalog([], { exists: () => false, read: () => "" }),
    async setKeyboard(patch) {
      writes.push({ kind: "keyboard", patch });
      keyboard = normalizeKeyboardSettings({ ...keyboard, ...patch });
      if (activeIndex >= keyboard.layouts.length) activeIndex = 0;
      publish();
      return keyboard;
    },
    async setPointer(patch) {
      writes.push({ kind: "pointer", patch });
      pointer = normalizePointerSettings({ ...pointer, ...patch });
      publish();
      return pointer;
    },
    async setActiveLayout(index) {
      writes.push({ kind: "active-layout", index });
      if (!compositor) throw new Error("The compositor is not reachable");
      if (!Number.isInteger(index) || index < 0 || index >= keyboard.layouts.length)
        throw new RangeError(`Layout ${index} is not configured`);
      activeIndex = index;
      publish();
      return state.activeLayout;
    },
    cycleLayout() {
      activeIndex = (activeIndex + 1) % keyboard.layouts.length;
      publish();
    },
    refresh: async () => {},
    dispose: async () => listeners.clear(),
  };
}
