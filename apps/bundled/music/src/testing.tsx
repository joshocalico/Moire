import fs from "node:fs/promises";
import path from "node:path";
import type { ReactNode } from "react";
import { Window, installUiFonts, type WindowSize } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { runTool } from "@moire/app-tools";
export async function musicHarness(
  render: (size: WindowSize, window: Window) => ReactNode,
  width = 1280,
  height = 820,
) {
  await installUiFonts();
  const backend = new HeadlessPlatform();
  await backend.connect();
  let lastSize = { width, height };
  const window = new Window({ title: "Music", width, height, decorated: false });
  window.setContent((size) => {
    lastSize = size;
    return render(size, window);
  });
  window.mount(backend);
  await Promise.resolve();
  window.tick();
  const native = backend.getWindows()[0]!;
  const click = (x: number, y: number) => {
    native.injectPointer({ type: "down", button: "left", x, y, timeMs: 1 });
    native.injectPointer({ type: "up", button: "left", x, y, timeMs: 2 });
    window.tick();
  };
  const key = (code: number, key: string, text?: string, ctrl = false) => {
    native.injectKey({
      type: "down",
      code,
      key,
      text,
      modifiers: { ctrl, alt: false, meta: false, shift: false },
      timeMs: 0,
    });
    native.injectKey({
      type: "up",
      code,
      key,
      modifiers: { ctrl, alt: false, meta: false, shift: false },
      timeMs: 1,
    });
    window.tick();
  };
  const settle = async (predicate?: () => boolean, timeout = 10000) => {
    const start = Date.now();
    do {
      await new Promise((resolve) => setTimeout(resolve, 20));
      window.tick();
      if (predicate?.()) return;
    } while (Date.now() - start < (predicate ? timeout : 320));
    if (predicate && !predicate())
      throw new Error("Music did not reach the expected state before timeout.");
  };
  const capture = async (file: string) => {
    window.tick();
    const frame = native.lastFrame;
    if (!frame) throw new Error("Music produced no frame.");
    const size = lastSize;
    await fs.mkdir(path.dirname(file), { recursive: true });
    const raw = `${file}.bgra`;
    await fs.writeFile(raw, frame);
    try {
      await runTool("ffmpeg", [
        "-v",
        "error",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "bgra",
        "-s",
        `${size.width}x${size.height}`,
        "-i",
        raw,
        "-frames:v",
        "1",
        "-update",
        "1",
        "-y",
        file,
      ]);
    } finally {
      await fs.rm(raw, { force: true });
    }
  };
  return {
    backend,
    window,
    native,
    click,
    key,
    settle,
    capture,
    destroy: () => {
      window.destroy();
      backend.disconnect();
    },
  };
}
