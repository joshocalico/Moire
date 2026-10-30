/** Tooltips in an OverlayHost paint above later siblings, flip at the edges and stay inside. */
import assert from "node:assert/strict";
import React from "react";
import {
  Group,
  createShellRoot,
  renderShell,
  sceneOrigin,
  type SceneNode,
} from "@moire/react-host";
import { OverlayHost, Surface, TextBlock, Tooltip, installUiFonts, tickAllMotions } from "./index";

await installUiFonts();

const W = 320,
  H = 200;

/** Every painted text with its position, in paint order. */
function painted(node: SceneNode, found: { text: string; x: number; y: number }[] = []) {
  if (node.kind === "text" && node.text) found.push({ text: node.text, ...sceneOrigin(node) });
  for (const child of node.children) painted(child, found);
  return found;
}

async function show(trigger: { x: number; y: number }, placement: "top" | "bottom") {
  const root = createShellRoot();
  const scene = () => (
    <OverlayHost width={W} height={H}>
      <Group width={W} height={H}>
        <Tooltip
          x={trigger.x}
          y={trigger.y}
          width={40}
          height={30}
          label="Mute output"
          placement={placement}
          delayMs={0}
          open
        />
        {/* A later row that an inline tooltip would sit under. */}
        <Surface x={0} y={trigger.y + 34} width={W} height={60} fill={0xff202020}>
          <TextBlock width={W} height={60} text="Later row" />
        </Surface>
      </Group>
    </OverlayHost>
  );
  renderShell(root, scene());
  for (let frame = 0; frame < 4; frame++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    tickAllMotions(1);
    renderShell(root, scene());
    await new Promise((resolve) => setImmediate(resolve));
  }
  const texts = painted(root.container);
  renderShell(root, null);
  return texts;
}

// Below its trigger, the tip paints after the later row, so it shows on top of it.
const below = await show({ x: 20, y: 40 }, "bottom");
const tip = below.findIndex((entry) => entry.text === "Mute output");
assert.ok(tip > below.findIndex((entry) => entry.text === "Later row"), "the tip paints last");
assert.ok(below[tip]!.y > 40 + 30, "a bottom tip sits below its trigger when it fits");
assert.ok(below[tip]!.x >= 4, "the tip keeps inside the host's left edge");

// At the host's foot there is no room below, so it flips above the trigger.
const foot = await show({ x: 260, y: H - 34 }, "bottom");
const flipped = foot.find((entry) => entry.text === "Mute output");
assert.ok(flipped && flipped.y < H - 34, "a bottom tip with no room flips above its trigger");
assert.ok(flipped.x <= W - 4, "the tip keeps inside the host's right edge");

console.log("[ui/tooltip-layer] top-layer paint, edge flip and containment passed");
