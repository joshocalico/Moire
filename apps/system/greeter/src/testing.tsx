/** Disposable actual Window dispatch and presented pixels; no native session authority. */
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ReactNode } from "react";
import { Window, installUiFonts, type WindowSize } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
export async function greeterHarness(
  render: (size: WindowSize, window: Window) => ReactNode,
  width = 1280,
  height = 800,
) {
  await installUiFonts();
  const backend = new HeadlessPlatform();
  await backend.connect();
  const window = new Window({
    title: "Greeter welcome fixture",
    width,
    height,
    decorated: false,
    fullscreen: true,
  });
  window.setContent((size) => render(size, window));
  window.mount(backend);
  await Promise.resolve();
  window.tick();
  const native = backend.getWindows()[0]!;
  const key = (code: number, name: string, shift = false, repeat = false) => {
    const modifiers = { ctrl: false, alt: false, meta: false, shift };
    native.injectKey({ type: repeat ? "repeat" : "down", code, key: name, modifiers, timeMs: 0 });
    native.injectKey({ type: "up", code, key: name, modifiers, timeMs: 1 });
    window.tick();
  };
  const click = (x: number, y: number) => {
    native.injectPointer({ type: "down", button: "left", x, y, timeMs: 0 });
    native.injectPointer({ type: "up", button: "left", x, y, timeMs: 1 });
    window.tick();
  };
  const settle = async () => {
    for (let count = 0; count < 5; count++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      window.tick();
    }
  };
  const capture = async (file: string, size: WindowSize) => {
    window.tick();
    if (!native.lastFrame) throw new Error("Greeter produced no frame.");
    await fs.mkdir(path.dirname(file), { recursive: true });
    const raw = `${file}.bgra`;
    await fs.writeFile(raw, native.lastFrame);
    try {
      await promisify(execFile)("ffmpeg", [
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
    key,
    click,
    settle,
    capture,
    destroy: () => {
      window.destroy();
      backend.disconnect();
    },
  };
}
