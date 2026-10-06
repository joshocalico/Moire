/* eslint-disable import/no-relative-parent-imports -- Integration fixture imports the shipped app. */
/** RSS sorting must move keyed process rows without duplicating host scene nodes. */
import assert from "node:assert/strict";
import React from "react";
import {
  createShellRoot,
  renderShell,
  RetainedSceneRenderer,
  RetainedSoftwareRenderer,
  collectHits,
  Group,
  Rect,
  type SceneNode,
} from "@moire/react-host";
import {
  installUiFonts,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
} from "@moire/ui";
import { SystemMonitor } from "../../../apps/core/process-manager/src/main";

type Client = NonNullable<React.ComponentProps<typeof SystemMonitor>["client"]>;
type Snapshot = Awaited<ReturnType<Client["snapshot"]>>;
const mib = 1024 * 1024;
const processes: Snapshot["processes"] = [
  {
    pid: 3096,
    name: "Moire Compositor",
    appId: "moire",
    command: "compositor",
    rssBytes: 370 * mib,
    cpuPercent: 86.6,
    protected: true,
  },
  {
    pid: 3411,
    name: "System Monitor",
    appId: "system-monitor",
    command: "process-manager",
    rssBytes: 303 * mib,
    cpuPercent: 10.9,
    protected: false,
  },
  {
    pid: 3412,
    name: "Image Viewer",
    appId: "image-viewer",
    command: "image-viewer",
    rssBytes: 283 * mib,
    cpuPercent: 0,
    protected: false,
  },
  {
    pid: 3261,
    name: "Files",
    appId: "files",
    command: "files",
    rssBytes: 276 * mib,
    cpuPercent: 0,
    protected: false,
  },
  {
    pid: 3258,
    name: "Terminal",
    appId: "terminal",
    command: "terminal",
    rssBytes: 265 * mib,
    cpuPercent: 13.9,
    protected: false,
  },
];
let imageMemory = 283,
  snapshots = 0,
  includeImage = true;
function snapshot(): Snapshot {
  return {
    totalMemoryBytes: 4 * 1024 * mib,
    availableMemoryBytes: 2700 * mib,
    swapTotalBytes: 0,
    swapFreeBytes: 0,
    processes: processes
      .filter((row) => includeImage || row.pid !== 3412)
      .map((row) => (row.pid === 3412 ? { ...row, rssBytes: imageMemory * mib } : { ...row })),
  };
}
const client: Client = {
  snapshot: async () => {
    snapshots++;
    return snapshot();
  },
  terminate: async () => {
    assert.fail("sorting fixture must not terminate processes");
  },
};
const root = createShellRoot();
const renderer = new RetainedSceneRenderer();
const cpu = new RetainedSoftwareRenderer();
const theme = createPersonalizedWidgetTheme(
  discoverPersonalization("linux", {
    themeFamily: "moire",
    colorScheme: "dark",
    reducedMotion: true,
  }),
);
const failures: string[] = [];
function nodes(node: SceneNode): SceneNode[] {
  return [node, ...node.children.flatMap(nodes)];
}
function checkHostPlacements(): void {
  // Exercise both parent and container placement APIs, including append,
  // insert-before and removal after an existing child has moved repeatedly.
  for (const container of [true, false]) {
    const placement = createShellRoot();
    try {
      for (const keys of [
        ["a", "b", "c"],
        ["c", "a", "b"],
        ["b", "c", "a"],
        ["b", "c"],
      ]) {
        const children = keys.map((key, index) => (
          <Rect
            key={key}
            x={index * 24}
            width={20}
            height={20}
            fill={0xff334455}
            focusable
            focusId={key}
          />
        ));
        renderShell(
          placement,
          container ? (
            <>{children}</>
          ) : (
            <Group width={90} height={20}>
              {children}
            </Group>
          ),
        );
        const all = nodes(placement.container);
        const identitiesUnique = new Set(all).size === all.length;
        const idsUnique = new Set(all.map((node) => node.id)).size === all.length;
        const parentLinksValid = all.every((node) =>
          node.children.every((child) => child.parent === node),
        );
        const hits = collectHits(placement.container);
        const hitsCorrect =
          JSON.stringify(hits.map((hit) => hit.focusId)) === JSON.stringify(keys) &&
          hits.every((hit, index) => hit.x === index * 24);
        const phase = `${container ? "container" : "parent"}-placement-${keys.join("")}`;
        console.log(
          JSON.stringify({
            phase,
            identitiesUnique,
            idsUnique,
            parentLinksValid,
            hitKeys: hits.map((hit) => hit.focusId),
          }),
        );
        if (!identitiesUnique || !idsUnique || !parentLinksValid || !hitsCorrect)
          failures.push(phase);
      }
    } finally {
      renderShell(placement, null);
    }
  }
}
async function freshPixels(): Promise<Uint8Array> {
  const reference = createShellRoot();
  const value = snapshot();
  let reads = 0;
  const referenceClient: Client = {
    snapshot: async () => {
      reads++;
      return value;
    },
    terminate: client.terminate,
  };
  try {
    renderShell(
      reference,
      <WidgetThemeProvider theme={theme}>
        <SystemMonitor width={860} height={620} client={referenceClient} />
      </WidgetThemeProvider>,
    );
    for (let attempt = 0; reads === 0 && attempt < 100; attempt++)
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    return new RetainedSoftwareRenderer().render(
      new RetainedSceneRenderer().render(reference.container, { width: 860, height: 620 }),
    ).pixels;
  } finally {
    renderShell(reference, null);
  }
}
async function inspect(phase: string): Promise<void> {
  const all = nodes(root.container);
  const nodeCounts = new Map<string, number>();
  for (const node of all) nodeCounts.set(node.id, (nodeCounts.get(node.id) ?? 0) + 1);
  const duplicates = [...nodeCounts].filter(([, count]) => count > 1);
  const identitiesUnique = new Set(all).size === all.length;
  const names = Object.fromEntries(
    processes.map((row) => [
      row.name,
      all.filter((node) => node.kind === "text" && node.text === row.name).length,
    ]),
  );
  const frame = renderer.render(root.container, { width: 860, height: 620 });
  const layerCounts = new Map<string, number>();
  for (const layer of frame.layers) layerCounts.set(layer.id, (layerCounts.get(layer.id) ?? 0) + 1);
  const duplicateLayers = [...layerCounts].filter(([, count]) => count > 1);
  const hits = collectHits(root.container).filter((hit) => hit.focusId?.startsWith("table-row:"));
  const expectedOrder = snapshot()
    .processes.sort((a, b) => b.rssBytes - a.rssBytes)
    .map((row) => `table-row:${row.pid}`);
  const hitOrder = hits.map((hit) => hit.focusId);
  const hitsUniqueAndOrdered = JSON.stringify(hitOrder) === JSON.stringify(expectedOrder);
  const pixels = cpu.render(frame).pixels;
  const independentlyCreated = await freshPixels();
  let mismatchedPixels = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (
      pixels
        .subarray(offset, offset + 4)
        .some((value, index) => value !== independentlyCreated[offset + index])
    )
      mismatchedPixels++;
  }
  const namesCorrect = processes.every(
    (row) =>
      names[row.name] ===
      (row.pid === 3412 && !includeImage ? 0 : row.name === "System Monitor" ? 2 : 1),
  );
  console.log(
    JSON.stringify({
      phase,
      imageMemory,
      snapshots,
      names,
      identitiesUnique,
      duplicateNodes: duplicates.length,
      duplicateLayers,
      hitOrder,
      expectedOrder,
      mismatchedPixels,
    }),
  );
  if (
    duplicates.length ||
    !identitiesUnique ||
    duplicateLayers.length ||
    !namesCorrect ||
    !hitsUniqueAndOrdered ||
    mismatchedPixels
  )
    failures.push(phase);
}

try {
  await installUiFonts();
  checkHostPlacements();
  renderShell(
    root,
    <WidgetThemeProvider theme={theme}>
      <SystemMonitor width={860} height={620} client={client} />
    </WidgetThemeProvider>,
  );
  for (let attempt = 0; snapshots === 0 && attempt < 100; attempt++)
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
  await inspect("initial");
  for (const [phase, memory] of [
    ["image-moves-down", 240],
    ["image-moves-up", 320],
    ["image-restored", 283],
    ["remove-moved-image", 0],
  ] as const) {
    const previous = snapshots;
    imageMemory = memory;
    includeImage = phase !== "remove-moved-image";
    for (let attempt = 0; snapshots === previous && attempt < 150; attempt++)
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    assert.ok(
      snapshots > previous,
      "actual System Monitor refresh interval did not poll its client",
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    await inspect(phase);
  }
  assert.deepEqual(failures, [], "RSS sorting duplicated keyed process scene nodes");
  console.log(
    "[process-row-reconciliation] actual System Monitor polling/sorting keeps every keyed row unique",
  );
} finally {
  renderShell(root, null);
}
