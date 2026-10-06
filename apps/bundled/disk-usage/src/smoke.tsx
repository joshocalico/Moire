import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import React from "react";
import { withFixture } from "@moire/app-tools/testing";
import { collectHits, createShellRoot, renderShell, type SceneNode } from "@moire/react-host";
import { installUiFonts } from "@moire/ui";
import { scanUsage } from "./scan";
import { DiskUsageApp } from "./main";
await installUiFonts();
await withFixture(async (fixture) => {
  const directory = path.join(fixture, "tree");
  await fs.mkdir(directory);
  const folder = path.join(directory, "folder");
  await fs.mkdir(folder);
  const file = path.join(folder, "large.bin");
  await fs.writeFile(file, Buffer.alloc(128 * 1024));
  await fs.link(file, path.join(directory, "hard-link"));
  await fs.symlink(folder, path.join(folder, "recursive-link"));
  const result = await scanUsage(directory);
  assert.equal(
    result.root.logical,
    128 * 1024 + Buffer.byteLength(folder),
    "hardlinks counted once and symlink target not traversed",
  );
  assert.equal(result.entries, 5);
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(scanUsage(directory, { signal: cancelled.signal }));
  const limited = await scanUsage(directory, { maxEntries: 2 });
  assert.equal(limited.truncated, true);
  assert.ok(limited.skipped.length > 0);
  const root = createShellRoot(),
    tree = <DiskUsageApp width={720} height={660} initialPath={directory} />;
  const texts = (node: SceneNode): string[] => [
    ...(node.kind === "text" ? [node.text ?? ""] : []),
    ...node.children.flatMap(texts),
  ];
  const refresh = () => renderShell(root, tree);
  refresh();
  const scan = collectHits(root.container).find((hit) => hit.onPress && hit.focusable);
  assert.ok(scan?.onPress);
  scan.onPress({ x: scan.x + 1, y: scan.y + 1, localX: 1, localY: 1 });
  for (
    let step = 0;
    step < 100 && !texts(root.container).some((text) => text.includes("5 entries"));
    step++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    refresh();
  }
  assert.ok(texts(root.container).some((text) => text.includes("5 entries")));
  const item = collectHits(root.container).find(
    (hit) => hit.focusId === `usage:${path.join(result.root.path, "folder")}`,
  );
  assert.ok(item?.onPress);
  item.onPress({ x: item.x + 1, y: item.y + 1, localX: 1, localY: 1 });
  refresh();
  assert.ok(
    texts(root.container).some((text) => text.startsWith("folder ·")),
    "actual app drills into measured directory",
  );
  renderShell(root, null);
});
console.log(
  "Disk Usage actual allocated scan, hardlinks/symlinks, limits, cancel and UI drill-down passed",
);
