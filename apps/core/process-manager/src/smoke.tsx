import assert from "node:assert/strict";
import React from "react";
import {
  collectHits,
  createShellRoot,
  hitRegionContains,
  renderShell,
  type SceneNode,
} from "@moire/react-host";
import { installUiFonts } from "@moire/ui";
import { tickMotionFrame } from "@moire/ui/motion";
import { SystemMonitor } from "./main";
await installUiFonts();
let command = "fixture worker",
  calls = 0,
  reject = true;
const terminated: Array<{ pid: number; force: boolean }> = [];
const client: NonNullable<Parameters<typeof SystemMonitor>[0]["client"]> = {
  snapshot: async () => ({
    totalMemoryBytes: 1024 * 1024 * 1024,
    availableMemoryBytes: 256 * 1024 * 1024,
    swapTotalBytes: 0,
    swapFreeBytes: 0,
    processes: [
      {
        pid: 42,
        name: "Fixture Worker",
        appId: "org.moire.Fixture",
        command,
        rssBytes: 10000,
        cpuPercent: 12.5,
        protected: false,
      },
    ],
  }),
  terminate: async (pid, force) => {
    calls++;
    if (reject) throw new Error("fixture service disconnected");
    terminated.push({ pid, force: !!force });
    return true;
  },
};
const root = createShellRoot(),
  tree = <SystemMonitor width={860} height={620} client={client} />;
const refresh = () => {
  tickMotionFrame(1 / 60);
  renderShell(root, tree);
};
const texts = (node: SceneNode): string[] => [
  ...(node.kind === "text" ? [node.text ?? ""] : []),
  ...node.children.flatMap(texts),
];
const position = (
  label: string,
  node = root.container,
  x = 0,
  y = 0,
): { x: number; y: number } | null => {
  x += node.x;
  y += node.y;
  let found = node.kind === "text" && node.text === label ? { x: x + 1, y: y + 1 } : null;
  for (const child of node.children) {
    const match = position(label, child, x, y);
    if (match) found = match;
  }
  return found;
};
const press = (label: string) => {
  const at = position(label);
  assert.ok(at, `No ${label}: ${texts(root.container).join(" | ")}`);
  const hit = collectHits(root.container)
    .filter(
      (hit) => hit.focusScopeActive !== false && hit.onPress && hitRegionContains(hit, at.x, at.y),
    )
    .at(-1);
  assert.ok(hit?.onPress);
  hit.onPress({ x: at.x, y: at.y, localX: at.x - hit.x, localY: at.y - hit.y });
  refresh();
};
const wait = async (condition: () => boolean) => {
  for (let step = 0; step < 200 && !condition(); step++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    refresh();
  }
  assert.ok(condition(), texts(root.container).join(" | "));
};
try {
  refresh();
  await wait(() => texts(root.container).includes("Fixture Worker"));
  press("Resources");
  assert.ok(texts(root.container).some((text) => text.includes("Process CPU total · 12.5%")));
  press("Processes");
  press("Fixture Worker");
  press("Quit");
  await wait(() =>
    texts(root.container).some((text) => text.includes("fixture service disconnected")),
  );
  assert.equal(calls, 1);
  press("Force Quit");
  await wait(() => texts(root.container).includes("Force quit Fixture Worker?"));
  command = "replaced worker";
  press("Force Quit");
  await wait(() => texts(root.container).some((text) => text.includes("exited or changed")));
  assert.equal(calls, 1, "confirmation cannot target a changed process row");
  command = "fixture worker";
  reject = false;
  await wait(() => texts(root.container).includes("fixture worker"));
  press("Fixture Worker");
  press("Quit");
  await wait(() => terminated.length === 1);
  assert.deepEqual(terminated, [{ pid: 42, force: false }]);
  console.log(
    "System Monitor actual controls: resources, service error recovery, retained status and frozen process confirmation passed",
  );
} finally {
  renderShell(root, null);
}
