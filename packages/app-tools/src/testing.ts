import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import syncFs from "node:fs";
import { PNG } from "pngjs";
import type { HitRegion, SceneNode } from "@moire/react-host";
import type { ReactNode } from "react";
import { Window, installUiFonts, tickAllMotions, type WindowSize } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { privatePreviewsSettled, runTool } from "./index";
import { PlaybackSession, type PlaybackState } from "./playback";
export async function withFixture(work: (directory: string) => Promise<void>): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-app-workflow-"));
  const previous = {
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    XDG_STATE_HOME: process.env.XDG_STATE_HOME,
    TMPDIR: process.env.TMPDIR,
  };
  await fs.mkdir(path.join(directory, "tmp"));
  process.env.TMPDIR = path.join(directory, "tmp");
  process.env.HOME = directory;
  process.env.XDG_CONFIG_HOME = path.join(directory, "config");
  process.env.XDG_DATA_HOME = path.join(directory, "data");
  process.env.XDG_STATE_HOME = path.join(directory, "state");
  try {
    await work(directory);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    // Views dispose previews without awaiting; let them finish inside the fixture first.
    await privatePreviewsSettled();
    await fs.rm(directory, { recursive: true, force: true });
  }
}
export async function playbackSmoke(video: boolean): Promise<void> {
  await withFixture(async (directory) => {
    const file = path.join(directory, video ? "test.mp4" : "test.wav");
    await runTool(
      "ffmpeg",
      video
        ? [
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=64x32:d=3",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=3",
            "-shortest",
            "-c:v",
            "mpeg4",
            file,
          ]
        : ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", file],
    );
    assert.ok(
      Number(
        (
          await runTool("ffprobe", [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            file,
          ])
        ).trim(),
      ) >= 3,
    );
    let missing: PlaybackState = { kind: "idle" };
    const unavailable = new PlaybackSession(
      (value) => {
        missing = value;
      },
      { binary: path.join(directory, "no-mpv") },
    );
    await unavailable.open(file);
    await unavailable.close();
    assert.equal(missing.kind, "error", "a missing playback process is an explicit error");
    let available = true;
    try {
      await runTool("mpv", ["--version"]);
    } catch {
      available = false;
    }
    if (!available) {
      console.log(
        `[${video ? "video" : "music"}] real media fixture/probe and missing-backend state passed; mpv playback unavailable on this host`,
      );
      return;
    }
    let state: PlaybackState = { kind: "idle" };
    const session = new PlaybackSession(
      (value) => {
        state = value;
      },
      { video, extraArgs: ["--ao=null", "--vo=null"] },
    );
    try {
      await session.open(file);
      const get = () => state;
      const opened = get();
      assert.equal(opened.kind, "ready");
      assert.ok(
        opened.kind === "ready" && opened.duration >= 3,
        "open resolves with loaded media metadata",
      );
      const duration = await session.command(["get_property", "duration"]);
      assert.ok(typeof duration === "number" && duration >= 3);
      if (video) {
        assert.equal(
          await session.command(["get_property", "video-params/w"]),
          64,
          "video stream is actually decoded by mpv",
        );
      }
      await session.control(["set_property", "pause", false]);
      const waitFor = async (property: string, condition: (value: unknown) => boolean) => {
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
          const value = await session.command(["get_property", property]);
          if (condition(value)) return value;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error(`mpv property ${property} did not reach the expected state.`);
      };
      const position = await waitFor("time-pos", (value) => typeof value === "number" && value > 0);
      assert.ok(typeof position === "number" && position > 0);
      await session.control(["set_property", "pause", true]);
      assert.equal(await session.command(["get_property", "pause"]), true);
      await session.control(["seek", 1, "absolute+exact"]);
      const seek = await waitFor(
        "time-pos",
        (value) => typeof value === "number" && Math.abs(value - 1) < 0.5,
      );
      assert.ok(typeof seek === "number" && Math.abs(seek - 1) < 0.5);
      await session.control(["set_property", "volume", 37]);
      assert.equal(await session.command(["get_property", "volume"]), 37);
    } finally {
      await session.close();
    }
    console.log(
      `[${video ? "video" : "music"}] real mpv pause/play/seek/volume/stop passed with null audio/video output`,
    );
  });
}
type WindowInternals = { hits: HitRegion[]; root: { container: SceneNode } };
/**
 * The centre of a live Window control, for injecting pointer input in workflow smokes. Matches a
 * control by `focusId`, or by a painted label/placeholder `text` inside a focusable control.
 * Reads the window's last committed scene, so call it after `window.tick()`.
 */
export function windowControl(
  window: Window,
  match: { focusId: string } | { text: string },
): { x: number; y: number } {
  const internals = window as unknown as WindowInternals;
  const hits = internals.hits.filter((hit) => hit.focusable);
  let hit: HitRegion | undefined;
  // A label inside a larger control (a list row) is pressed where it is painted, not at the
  // control's centre, which may be a different row.
  let at: { x: number; y: number } | null = null;
  if ("focusId" in match) hit = hits.find((candidate) => candidate.focusId === match.focusId);
  else {
    // Painted positions include paint-only offsets (scrolling, motion), as hit regions do.
    const offset = (value: SceneNode["translateX"]) =>
      typeof value === "number" ? value : (value?.get() ?? 0);
    const find = (node: SceneNode, x: number, y: number): { x: number; y: number } | null => {
      x += node.x + offset(node.translateX);
      y += node.y + offset(node.translateY);
      if (node.kind === "text" && node.text === match.text)
        return { x: x + node.width / 2, y: y + node.height / 2 };
      for (const child of node.children) {
        const found = find(child, x, y);
        if (found) return found;
      }
      return null;
    };
    const point = find(internals.root.container, 0, 0);
    // The topmost control under the text: a dialog's, not one behind its modal barrier.
    if (point)
      hit = hits
        .filter(
          (candidate) =>
            candidate.focusScopeActive !== false &&
            point.x >= candidate.x &&
            point.x <= candidate.x + candidate.width &&
            point.y >= candidate.y &&
            point.y <= candidate.y + candidate.height,
        )
        .at(-1);
    if (hit) at = point;
  }
  assert.ok(hit, `No visible control for ${JSON.stringify(match)}`);
  return at ?? { x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 };
}

/** Every painted text in a live Window's last committed scene, in paint order. */
export function windowTexts(window: Window): string[] {
  const found: string[] = [];
  const walk = (node: SceneNode) => {
    if (node.kind === "text" && node.text) found.push(node.text);
    for (const child of node.children) walk(child);
  };
  walk((window as unknown as WindowInternals).root.container);
  return found;
}

export type MountedWindow = Awaited<ReturnType<typeof mountWindow>>;
/**
 * Render content into a headless Window for workflow smokes, with helpers that inject real
 * keyboard and pointer input. `press` finds a control by focusId or painted label, so smokes
 * survive layout changes.
 */
export async function mountWindow(
  render: (size: WindowSize, window: Window) => ReactNode,
  options: { width?: number; height?: number; title?: string } = {},
) {
  await installUiFonts();
  const backend = new HeadlessPlatform();
  await backend.connect();
  const window = new Window({
    title: options.title ?? "Workflow smoke",
    width: options.width ?? 860,
    height: options.height ?? 620,
    decorated: false,
  });
  window.setContent((size) => render(size, window));
  window.mount(backend);
  await Promise.resolve();
  window.tick();
  const native = backend.getWindows()[0]!;
  const noModifiers = { shift: false, ctrl: false, alt: false, meta: false };
  const tick = () => {
    tickAllMotions(1);
    window.tick();
  };
  /** Press and release a key; `code` is the evdev code, `text` the character it types. */
  const key = (
    code: number,
    name: string,
    options: { ctrl?: boolean; shift?: boolean; alt?: boolean; text?: string } = {},
  ) => {
    const modifiers = {
      ...noModifiers,
      ctrl: options.ctrl ?? false,
      shift: options.shift ?? false,
      alt: options.alt ?? false,
    };
    native.injectKey({ type: "down", code, key: name, text: options.text, modifiers, timeMs: 1 });
    native.injectKey({ type: "up", code, key: name, modifiers, timeMs: 2 });
    tick();
  };
  /** Type text into the focused control. */
  const type = (text: string) => {
    for (const character of text) key(0, character, { text: character });
  };
  const click = (x: number, y: number) => {
    native.injectPointer({ type: "down", button: "left", x, y, timeMs: 1 });
    native.injectPointer({ type: "up", button: "left", x, y, timeMs: 2 });
    tick();
  };
  const press = (match: { focusId: string } | { text: string }) => {
    const point = windowControl(window, match);
    click(point.x, point.y);
  };
  /** Let timers, promises and motions run, ticking the window between them. */
  const settle = async (frames = 8) => {
    for (let frame = 0; frame < frames; frame++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      tick();
    }
  };
  /** Settle until `condition` holds, failing after `timeoutMs`. */
  const until = async (condition: () => boolean, message: string, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
      assert.ok(Date.now() < deadline, message);
      await settle(1);
    }
  };
  return {
    backend,
    window,
    native,
    tick,
    key,
    type,
    click,
    press,
    settle,
    until,
    texts: () => windowTexts(window),
    /** Write the last presented frame (BGRA) as a PNG, for looking at a state by eye. */
    screenshot: (file: string) => {
      const frame = native.lastFrame;
      assert.ok(frame, "No frame has been presented yet");
      const { width, height } = native as unknown as { width: number; height: number };
      const png = new PNG({ width, height });
      for (let index = 0; index < frame.length; index += 4) {
        png.data[index] = frame[index + 2]!;
        png.data[index + 1] = frame[index + 1]!;
        png.data[index + 2] = frame[index]!;
        png.data[index + 3] = frame[index + 3]!;
      }
      syncFs.mkdirSync(path.dirname(file), { recursive: true });
      syncFs.writeFileSync(file, PNG.sync.write(png));
    },
    destroy: () => {
      window.destroy();
      backend.disconnect();
    },
  };
}
