/* eslint-disable import/no-relative-parent-imports -- Exercise real app layout and Window dispatch. */
import assert from "node:assert/strict";
import React from "react";
import {
  createShellRoot,
  renderShell,
  collectHits,
  type SceneNode,
} from "../../../../packages/react-host/src/index";
import { installUiFonts, setUiScaleFactor } from "@moire/ui";
import { ArchiveManagerApp } from "./main";
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
      // The start view offers opening an archive (chooser first) and starting a new one.
      const texts = walk(root.container).filter((node) => node.kind === "text");
      assert.ok(
        texts.some((node) => node.text === "Open an archive"),
        `start view missing at width${width}/scale${scale}`,
      );
      const labels = texts.filter((node) =>
        ["Open archive…", "New archive"].includes(node.text ?? ""),
      );
      assert.equal(labels.length, 2);
      for (const label of labels) {
        const { x, y } = position(label);
        assert.ok(
          x >= 0 && x + label.width <= width,
          `${label.text} clipped at width${width}/scale${scale}`,
        );
        // New archive is a header action; the chooser button belongs in the body.
        if (label.text === "Open archive…")
          assert.ok(y >= 48 * scale, `${label.text} overlaps the title bar`);
      }
      // Narrow windows scroll the stacked cards: check the pointer-visible part of each control.
      for (const hit of collectHits(root.container).filter((hit) => hit.focusable)) {
        const clip = hit.pointerClip;
        const top = Math.max(hit.y, clip?.y ?? hit.y),
          bottom = Math.min(hit.y + hit.height, clip ? clip.y + clip.height : Infinity);
        if (bottom <= top) continue;
        assert.ok(
          hit.x >= 0 && hit.x + hit.width <= width + 1 && top >= 0 && bottom <= 700 + 1,
          `${hit.focusId} outside the window at width${width}/scale${scale}`,
        );
      }
      layouts++;
    } finally {
      renderShell(root, null);
    }
  }
setUiScaleFactor(1);
console.log(`Archive ${layouts} actual start layouts passed; workflows are in workflow.smoke.tsx`);
