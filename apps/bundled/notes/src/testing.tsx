import { type ReactNode } from "react";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Window, installUiFonts, type WindowSize } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
export async function harness(
  render: (size: WindowSize, window: Window) => ReactNode,
  width = 800,
  height = 650,
) {
  await installUiFonts();
  const backend = new HeadlessPlatform();
  await backend.connect();
  const window = new Window({ title: "Productivity smoke", width, height, decorated: false });
  window.setContent((size) => render(size, window));
  window.mount(backend);
  await Promise.resolve();
  window.tick();
  const native = backend.getWindows()[0]!;
  const key = (
    code: number,
    key: string,
    options: { ctrl?: boolean; shift?: boolean; text?: string } = {},
  ) => {
    const modifiers = {
      ctrl: options.ctrl ?? false,
      shift: options.shift ?? false,
      alt: false,
      meta: false,
    };
    native.injectKey({
      type: "down",
      code,
      key,
      text: options.text,
      modifiers,
      timeMs: Date.now(),
    });
    native.injectKey({ type: "up", code, key, modifiers, timeMs: Date.now() });
    window.tick();
  };
  const text = (text: string) => key(0, text, { text });
  const click = (x: number, y: number) => {
    native.injectPointer({ type: "down", button: "left", x, y, timeMs: 1 });
    native.injectPointer({ type: "up", button: "left", x, y, timeMs: 2 });
    window.tick();
  };
  const settle = async () => {
    for (let frame = 0; frame < 16; frame++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      window.tick();
    }
  };
  return {
    backend,
    window,
    native,
    key,
    text,
    click,
    settle,
    capture: async (file: string) => {
      window.tick();
      const frame = native.lastFrame;
      if (!frame) throw new Error("Notes produced no frame.");
      await fs.mkdir(path.dirname(file), { recursive: true });
      const raw = `${file}.bgra`;
      await fs.writeFile(raw, frame);
      try {
        execFileSync(
          "ffmpeg",
          [
            "-v",
            "error",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "bgra",
            "-s",
            `${window.getWidth()}x${window.getHeight()}`,
            "-i",
            raw,
            "-frames:v",
            "1",
            "-update",
            "1",
            "-y",
            file,
          ],
          { stdio: "pipe", timeout: 10000 },
        );
      } finally {
        await fs.rm(raw, { force: true });
      }
    },
    destroy: () => {
      window.destroy();
      backend.disconnect();
    },
  };
}

/** Invoke the real Notes action menu through its public keyboard shortcut. */
export async function noteAction(
  app: Awaited<ReturnType<typeof harness>>,
  index: number,
): Promise<void> {
  app.key(50, "m", { ctrl: true, shift: true });
  await app.settle();
  app.key(102, "Home");
  for (let row = 0; row < index; row++) app.key(108, "ArrowDown");
  app.key(28, "Enter");
  await app.settle();
}
