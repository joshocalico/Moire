import { type ReactNode } from "react";
import { Window, installUiFonts, tickAllMotions, type WindowSize } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { windowControl } from "@moire/app-tools/testing";

type SceneNode = { kind: string; text?: string; children: SceneNode[] };

/** A real headless Window around the editor, with key, pointer and scene helpers. */
export async function harness(
  render: (size: WindowSize, window: Window) => ReactNode,
  width = 800,
  height = 650,
) {
  await installUiFonts();
  const backend = new HeadlessPlatform();
  await backend.connect();
  const window = new Window({ title: "Editor smoke", width, height });
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
      tickAllMotions(1);
      window.tick();
    }
  };
  /** Every painted string in the window, in scene order. */
  const texts = () => {
    const found: string[] = [];
    const walk = (node: SceneNode) => {
      if (node.kind === "text" && node.text) found.push(node.text);
      for (const child of node.children) walk(child);
    };
    walk((window as unknown as { root: { container: SceneNode } }).root.container);
    return found;
  };
  /** Click a visible control found by focusId or by the label painted on it. */
  const press = async (match: { focusId: string } | { text: string }) => {
    const point = windowControl(window, match);
    click(point.x, point.y);
    await settle();
  };
  return {
    backend,
    window,
    native,
    key,
    text,
    click,
    settle,
    texts,
    press,
    destroy: () => {
      window.destroy();
      backend.disconnect();
    },
  };
}
