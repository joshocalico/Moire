/* eslint-disable import/no-relative-parent-imports -- Exercise real app layout and Window dispatch. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import React from "react";
import {
  createShellRoot,
  renderShell,
  collectHits,
  type SceneNode,
} from "../../../../packages/react-host/src/index";
import { installUiFonts, setUiScaleFactor, Window } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { withFixture } from "@moire/app-tools/testing";
import { ArchiveManagerApp } from "./main";
import { createArchive } from "./backend";
await installUiFonts();
const walk = (node: SceneNode): SceneNode[] => [node, ...node.children.flatMap(walk)];
const position = (node: SceneNode) => {
  let x = 0,
    y = 0;
  for (let current: SceneNode | null = node; current; current = current.parent) {
    x += current.x;
    y += current.y;
  }
  return { x, y };
};
let layouts = 0;
for (const scale of [1, 1.5, 2])
  for (const width of [440, 640, 860, 1280]) {
    setUiScaleFactor(scale);
    const root = createShellRoot();
    try {
      renderShell(root, <ArchiveManagerApp width={width} height={700} />);
      const labels = walk(root.container).filter(
        (node) => node.kind === "text" && ["Extract", "Create", "Cancel"].includes(node.text ?? ""),
      );
      assert.equal(labels.length, 3);
      for (const label of labels) {
        const { x, y } = position(label);
        assert.ok(
          x >= 0 && x + label.width <= width,
          `${label.text} clipped at width${width}/scale${scale}`,
        );
        assert.ok(
          y >= 44 * scale && y + label.height <= (width < 560 * scale ? 126 : 88) * scale,
          `${label.text} outside the control region`,
        );
      }
      for (const hit of collectHits(root.container).filter((hit) => hit.focusable)) {
        assert.ok(
          hit.x >= 0 &&
            hit.x + hit.width <= width + 1 &&
            hit.y >= 0 &&
            hit.y + hit.height <= 700 + 1,
        );
      }
      layouts++;
    } finally {
      renderShell(root, null);
    }
  }
await withFixture(async (directory) => {
  const source = path.join(directory, "a source ü.txt");
  await fs.writeFile(source, "Archive compact workflow — exact original bytes\n");
  const archive = path.join(directory, "input.tar.gz");
  await createArchive([source], archive);
  for (const scale of [1, 1.5])
    for (const width of [440, 860]) {
      setUiScaleFactor(scale);
      const backend = new HeadlessPlatform();
      await backend.connect();
      const window = new Window({ title: "Archive compact workflow", width, height: 700 });
      window.setContent((size) => <ArchiveManagerApp {...size} initialPath={archive} />);
      window.mount(backend);
      await Promise.resolve();
      window.tick();
      const native = backend.getWindows()[0]!;
      const click = (x: number, y: number) => {
        native.injectPointer({ type: "down", button: "left", x, y, timeMs: Date.now() });
        native.injectPointer({ type: "up", button: "left", x, y, timeMs: Date.now() });
        window.tick();
      };
      const key = (code: number, name: string, text?: string) => {
        const modifiers = { ctrl: false, shift: false, alt: false, meta: false };
        native.injectKey({ type: "down", code, key: name, text, modifiers, timeMs: Date.now() });
        native.injectKey({ type: "up", code, key: name, modifiers, timeMs: Date.now() });
        window.tick();
      };
      const settle = async (condition: () => Promise<boolean>) => {
        for (let attempt = 0; attempt < 100; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          window.tick();
          if (await condition()) return;
        }
        assert.fail("Actual Archive Window operation did not complete");
      };
      try {
        const compact = width < 560 * scale;
        const output = path.join(directory, `extracted-${scale}-${width}`);
        click(compact ? width / 2 : 50 * scale, (44 + 6 + 16) * scale);
        key(0, output, output);
        const buttonY = (compact ? 104 : 66) * scale;
        const extractX = compact
          ? 6 * scale + (width - 24 * scale) / 6
          : width - 237 * scale + 36 * scale;
        click(extractX, buttonY);
        await settle(async () =>
          fs
            .readFile(path.join(output, path.basename(source)), "utf8")
            .then((value) => value === "Archive compact workflow — exact original bytes\n")
            .catch(() => false),
        );
        assert.equal(
          await fs.readFile(source, "utf8"),
          "Archive compact workflow — exact original bytes\n",
        );
        assert.ok(native.lastFrame);
        // A second operation has a genuine existing destination: no overwrite.
        click(extractX, buttonY);
        for (let frame = 0; frame < 10; frame++) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          window.tick();
        }
        assert.equal(
          await fs.readFile(path.join(output, path.basename(source)), "utf8"),
          await fs.readFile(source, "utf8"),
        );
      } finally {
        window.destroy();
        backend.disconnect();
      }
    }
});
setUiScaleFactor(1);
console.log(
  `Archive ${layouts} actual layouts and four compact/wide public Window extraction workflows passed; native acceptance remains separate`,
);
