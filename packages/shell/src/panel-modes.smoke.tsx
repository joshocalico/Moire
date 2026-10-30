/**
 * Panel style changes (floating islands ↔ full-width bar, titles ↔ icons only) animate between
 * layouts, and switch at once under reduced motion.
 */
import assert from "node:assert/strict";
import React from "react";
import { createShellRoot, renderShell, rasterize, type SceneNode } from "@moire/react-host";
import {
  getWidgetTheme,
  installUiFonts,
  tickAllMotions,
  WidgetThemeProvider,
  type WidgetTheme,
} from "@moire/ui";
import { Panel, panelStatusGeometry, panelTaskRects, type PanelMaterial } from "./Panel";
import type { TaskWindowInfo } from "./ssd";

await installUiFonts();
const width = 1280;
const height = 800;
const tasks: TaskWindowInfo[] = ["Files", "Terminal", "Editor", "Calculator"].map(
  (title, index) => ({
    clientId: 1,
    surfaceId: index + 1,
    title,
    appId: `org.moire.${title}`,
    focused: index === 0,
    minimized: false,
  }),
);
const settle = () => new Promise((resolve) => setImmediate(resolve));
const noop = () => {};

/** The painted x of the second window's chip (its press target, which follows the slide). */
function secondChipX(root: ReturnType<typeof createShellRoot>): number {
  const hits = rasterize(root.container, width, height).hits;
  const geometry = panelStatusGeometry({ screenW: width, screenH: height, tasks, taskCount: 4 });
  const chips = hits
    .filter(
      (hit) =>
        !!hit.onPress &&
        hit.y >= geometry.panel.y &&
        !hit.focusId?.startsWith("panel:") &&
        !hit.focusId?.startsWith("apps:"),
    )
    .sort((a, b) => a.x - b.x);
  assert.ok(chips.length >= 4, "every window has a press target");
  return chips[1]!.x;
}

async function run(theme: WidgetTheme) {
  const root = createShellRoot();
  let glass: readonly PanelMaterial[] = [];
  const mount = (props: { fullWidth?: boolean; iconsOnly?: boolean }) =>
    renderShell(
      root,
      <WidgetThemeProvider theme={theme}>
        <Panel
          screenW={width}
          screenH={height}
          clock="14:20"
          tasks={tasks}
          onTaskPress={noop}
          onGlass={(shapes) => (glass = shapes)}
          {...props}
        />
      </WidgetThemeProvider>,
    );
  mount({});
  await settle();
  tickAllMotions(5);
  await settle();
  const labelledX = secondChipX(root);
  const islandCount = glass.length;

  // Titles → icons only.
  mount({ iconsOnly: true });
  await settle();
  tickAllMotions(0.12);
  await settle();
  const midX = secondChipX(root);
  // The last tween frame hands chips back to their own slide; it lands on the next frames.
  for (let frame = 0; frame < 3; frame++) {
    tickAllMotions(5);
    await settle();
  }
  const iconsX = secondChipX(root);

  // Islands → one bar.
  mount({ iconsOnly: true, fullWidth: true });
  await settle();
  tickAllMotions(0.06);
  await settle();
  const earlyGlass = glass.length;
  tickAllMotions(5);
  await settle();
  const barGlass = glass;
  renderShell(root, null);
  return { labelledX, midX, iconsX, islandCount, earlyGlass, barGlass };
}

const base = getWidgetTheme();
const animated = await run(base);
const geometry = (iconsOnly: boolean) =>
  panelStatusGeometry({ screenW: width, screenH: height, tasks, taskCount: 4, iconsOnly });
const labelledTarget = geometry(false).panel.x + panelTaskRects(geometry(false), 4)[1]!.x;
const iconsTarget = geometry(true).panel.x + panelTaskRects(geometry(true), 4)[1]!.x;
assert.equal(
  Math.round(animated.labelledX),
  Math.round(labelledTarget),
  "labelled layout settles exactly",
);
assert.equal(
  Math.round(animated.iconsX),
  Math.round(iconsTarget),
  "icons-only layout settles exactly",
);
const [low, high] = [Math.min(labelledTarget, iconsTarget), Math.max(labelledTarget, iconsTarget)];
assert.ok(
  animated.midX > low + 2 && animated.midX < high - 2,
  `switching to icons only moves the chips through the space between (${low} < ${animated.midX} < ${high})`,
);
assert.equal(animated.islandCount, 3, "floating islands blur as three shapes");
assert.equal(animated.earlyGlass, 3, "early in the merge the islands still own the blur");
assert.equal(animated.barGlass.length, 1, "the merged bar blurs as one shape");
assert.equal(animated.barGlass[0]!.width, geometry(true).panel.width, "spanning the panel band");

const still = await run({
  ...base,
  foundations: {
    ...base.foundations,
    motion: { ...base.foundations.motion, fastMs: 0, normalMs: 0, slowMs: 0 },
  },
});
assert.equal(
  Math.round(still.midX),
  Math.round(iconsTarget),
  "reduced motion switches to icons only at once",
);
assert.equal(still.earlyGlass, 1, "and merges into the bar at once");
console.log("[shell/panel-modes] animated and reduced-motion mode changes passed");

export type { SceneNode };
