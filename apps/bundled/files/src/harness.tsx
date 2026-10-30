/**
 * Test harness for Files workflow smokes: a disposable home, a real headless
 * Window running FilesApp, and input helpers that find controls by focus id or text.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import React from "react";
import { PNG } from "pngjs";
import type { HitRegion, SceneNode } from "@moire/react-host";
import {
  Window,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
  tickAllMotions,
  type ContextMenuAction,
} from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { FilesApp, type FilesAppProps } from "./main";

type Internals = { hits: HitRegion[]; root: { container: SceneNode } };
const ENVIRONMENT = [
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
] as const;
const NO_MODIFIERS = { ctrl: false, shift: false, alt: false, meta: false };
type Modifiers = Partial<typeof NO_MODIFIERS>;

export type FilesHarness = Awaited<ReturnType<typeof openFiles>>;

/** Run `work` with HOME, XDG data/config and the session runtime directory inside a fixture. */
export async function withHome(work: (home: string) => Promise<void>): Promise<void> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "moire-files-smoke-"));
  const previous = ENVIRONMENT.map((name) => [name, process.env[name]] as const);
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = path.join(home, ".config");
  process.env.XDG_DATA_HOME = path.join(home, ".local", "share");
  process.env.XDG_CACHE_HOME = path.join(home, ".cache");
  process.env.XDG_RUNTIME_DIR = path.join(home, ".run");
  try {
    await work(home);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await fs.rm(home, { recursive: true, force: true });
  }
}

export async function openFiles(
  options: Partial<FilesAppProps> & {
    initialPath: string;
    width?: number;
    height?: number;
    scale?: number;
    view?: "grid" | "list" | "columns";
    scheme?: "dark" | "light";
    /** Extra view preferences, e.g. `{ railExpanded: true }`. */
    preferences?: Record<string, unknown>;
    /** Give the app the window's controls, as a real window has. */
    windowControls?: boolean;
  },
) {
  const { width = 1100, height = 700, scale = 1, view = "list", scheme } = options;
  const config = path.join(process.env.XDG_CONFIG_HOME!, "moire");
  await fs.mkdir(config, { recursive: true });
  await fs.writeFile(
    path.join(config, "files-view.json"),
    JSON.stringify({ view, ...options.preferences }),
  );
  setUiScaleFactor(scale);
  await installUiFonts();
  const backend = new HeadlessPlatform();
  await backend.connect();
  const window = new Window({ title: "Files smoke", width, height, decorated: false });
  const menu = { title: "", actions: [] as ContextMenuAction[], x: 0, y: 0, count: 0 };
  let busy = false;
  const theme = scheme
    ? createPersonalizedWidgetTheme(
        discoverPersonalization("linux", {
          themeFamily: "moire",
          colorScheme: scheme,
          reducedMotion: true,
        }),
      )
    : null;
  const app = (size: { width: number; height: number }) => (
    <FilesApp
      {...size}
      onQuit={() => {}}
      onBusyChange={(value) => {
        busy = value;
      }}
      onShowContextMenu={(request) => {
        Object.assign(menu, request, { count: menu.count + 1 });
        return true;
      }}
      windowActions={options.windowControls ? window : undefined}
      {...options}
    />
  );
  window.setContent((size) =>
    theme ? <WidgetThemeProvider theme={theme}>{app(size)}</WidgetThemeProvider> : app(size),
  );
  window.mount(backend);
  const native = backend.getWindows()[0]!;
  const internals = window as unknown as Internals;
  const tick = () => {
    tickAllMotions(1 / 30);
    window.requestRedraw();
    window.tick();
  };
  const settle = async (frames = 20) => {
    for (let frame = 0; frame < frames; frame++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      tick();
    }
  };
  const texts = (): string[] => {
    const found: string[] = [];
    const walk = (node: SceneNode) => {
      if (node.kind === "text" && node.text) found.push(node.text);
      node.children.forEach(walk);
    };
    walk(internals.root.container);
    return found;
  };
  const hit = (focusId: string) => {
    const region = internals.hits.find((candidate) => candidate.focusId === focusId);
    assert.ok(region, `No control ${focusId}`);
    return region;
  };
  const center = (focusId: string) => {
    const region = hit(focusId);
    return { x: region.x + region.width / 2, y: region.y + region.height / 2 };
  };
  const key = (code: number, name: string, modifiers: Modifiers = {}, text?: string) => {
    const all = { ...NO_MODIFIERS, ...modifiers };
    native.injectKey({ type: "down", code, key: name, text, modifiers: all, timeMs: Date.now() });
    native.injectKey({ type: "up", code, key: name, modifiers: all, timeMs: Date.now() });
    tick();
  };
  const type = (value: string) => {
    for (const character of value) key(0, character, {}, character);
  };
  const pointer = (
    type: "down" | "up" | "move",
    x: number,
    y: number,
    button: "left" | "right" = "left",
    modifiers: Modifiers = {},
  ) => {
    native.injectPointer({
      type,
      x,
      y,
      button,
      modifiers: { ...NO_MODIFIERS, ...modifiers },
      timeMs: Date.now(),
    });
    tick();
  };
  const click = (at: { x: number; y: number }, modifiers: Modifiers = {}) => {
    pointer("down", at.x, at.y, "left", modifiers);
    pointer("up", at.x, at.y, "left", modifiers);
  };
  const rightClick = (at: { x: number; y: number }) => pointer("down", at.x, at.y, "right");
  const until = async (condition: () => boolean | Promise<boolean>, message: string) => {
    for (let attempt = 0; attempt < 300; attempt++) {
      if (await condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
      tick();
    }
    assert.fail(`${message}; visible: ${texts().join(" | ").slice(0, 1200)}`);
  };
  /** A menu action by id, searching submenus too. */
  const action = (id: string): ContextMenuAction => {
    const all = (list: readonly ContextMenuAction[]): ContextMenuAction[] =>
      list.flatMap((candidate) => [candidate, ...all(candidate.submenu ?? [])]);
    const found = all(menu.actions).find((candidate) => candidate.id === id);
    assert.ok(
      found,
      `Menu "${menu.title}" has no ${id}: ${menu.actions.map((a) => a.id).join(",")}`,
    );
    return found;
  };
  const invoke = async (id: string) => {
    const found = action(id);
    assert.notEqual(found.disabled, true, `${id} is disabled: ${found.disabledReason ?? ""}`);
    found.onPress?.();
    tick();
    await settle(5);
  };
  /** The window's last frame as a PNG file. */
  const capture = async (file: string) => {
    await settle(10);
    const frame = native.lastFrame!;
    const png = new PNG({ width: window.getWidth(), height: window.getHeight() });
    for (let at = 0; at < frame.length; at += 4)
      png.data.set([frame[at + 2]!, frame[at + 1]!, frame[at]!, 255], at);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, PNG.sync.write(png));
  };
  /** Every text node with its window position, in paint order. */
  const textRects = () => {
    const found: Array<{ text: string; x: number; y: number; width: number; height: number }> = [];
    const walk = (node: SceneNode, x: number, y: number) => {
      x += node.x;
      y += node.y;
      if (node.kind === "text" && node.text)
        found.push({ text: node.text, x, y, width: node.width, height: node.height });
      node.children.forEach((child) => walk(child, x, y));
    };
    walk(internals.root.container, 0, 0);
    return found;
  };
  /** Press a visible button by its label; the topmost (last painted) when several show it. */
  const press = (label: string) => {
    let point: { x: number; y: number } | null = null;
    const walk = (node: SceneNode, x: number, y: number) => {
      x += node.x;
      y += node.y;
      if (node.kind === "text" && node.text === label)
        point = { x: x + node.width / 2, y: y + node.height / 2 };
      node.children.forEach((child) => walk(child, x, y));
    };
    walk(internals.root.container, 0, 0);
    assert.ok(point, `No visible "${label}"`);
    click(point);
  };
  await settle(30);
  return {
    window,
    native,
    menu,
    get busy() {
      return busy;
    },
    hits: () => internals.hits,
    tick,
    settle,
    texts,
    textRects,
    hit,
    center,
    key,
    type,
    pointer,
    click,
    rightClick,
    until,
    action,
    invoke,
    press,
    capture,
    close() {
      window.destroy();
      backend.disconnect();
      setUiScaleFactor(1);
    },
  };
}

export const entryId = (file: string) => `file:${file}`;
