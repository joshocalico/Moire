/** Compare real keyed Table updates with fresh CPU and isolated EGL readbacks. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import React from "react";
import { PNG } from "pngjs";
import {
  createShellRoot,
  renderShell,
  Group,
  Rect,
  Text,
  RetainedSceneRenderer,
  RetainedSoftwareRenderer,
  type RetainedSceneFrame,
} from "@moire/react-host";
import { EglOutputScaler, closeFd, openPath, O_CLOEXEC, O_RDWR } from "@moire/sys";
import {
  installUiFonts,
  Table,
  TextBlock,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  type TableColumn,
} from "@moire/ui";

type ProcessRow = { pid: number; name: string; cpu: string; memory: string };
type Step = {
  name: string;
  rows: ProcessRow[];
  x?: number;
  y?: number;
  clipWidth?: number;
  neighbor?: string;
};
type Frame = { name: string; scene: RetainedSceneFrame; cpu: Uint8Array };
const viewport = { width: 680, height: 360 };
const image = { pid: 3538, name: "Image Viewer", cpu: "0.0%", memory: "263.6 MiB" };
const base: ProcessRow[] = [
  { pid: 3390, name: "Terminal", cpu: "0.1%", memory: "208.3 MiB" },
  { pid: 3401, name: "Files", cpu: "1.7%", memory: "326.1 MiB" },
  { pid: 3499, name: "System Monitor", cpu: "9.9%", memory: "314.2 MiB" },
  image,
];
const calculator = { pid: 3580, name: "Calculator", cpu: "0.0%", memory: "213.7 MiB" };
const columns: TableColumn<ProcessRow>[] = [
  { id: "name", label: "Process", getValue: (row) => row.name },
  { id: "pid", label: "PID", width: 86, getValue: (row) => row.pid },
  ...(["cpu", "memory"] as const).map((id) => ({
    id,
    label: id === "cpu" ? "CPU" : "Memory",
    width: id === "cpu" ? 92 : 120,
    renderCell: (row: ProcessRow, _index: number, width: number) => (
      <TextBlock
        x={10}
        width={width - 20}
        height={38}
        text={row[id]}
        fontFamily="mono"
        fontSize={11}
        verticalAlign="center"
        horizontalAlign="end"
        overflow="ellipsis"
        maxLines={1}
      />
    ),
  })),
];
const steps: Step[] = [
  { name: "initial", rows: base },
  { name: "unchanged", rows: base },
  { name: "insert-calculator-before-image", rows: [...base.slice(0, 3), calculator, image] },
  { name: "remove-calculator", rows: base },
  { name: "reverse-order", rows: [...base].reverse() },
  { name: "restore-order", rows: base },
  { name: "short-numeric-text", rows: base.map((row) => ({ ...row, memory: "9 MiB", cpu: "1%" })) },
  {
    name: "wide-numeric-text",
    rows: base.map((row) => ({ ...row, memory: "1024.9 MiB", cpu: "100.0%" })),
  },
  { name: "restore-numeric-text", rows: base },
  { name: "translated-clipped-left", rows: base, x: -23, y: 11, clipWidth: 510 },
  {
    name: "reorder-while-clipped",
    rows: [image, calculator, ...base.slice(0, 3)],
    x: -23,
    y: 11,
    clipWidth: 510,
  },
  {
    name: "translated-clipped-right",
    rows: [image, ...base.slice(0, 3)],
    x: 37,
    y: -17,
    clipWidth: 510,
  },
  { name: "restore-after-clip", rows: base },
  { name: "insert-after-image", rows: [...base, calculator] },
  { name: "remove-image", rows: [calculator, ...base.slice(0, 3)] },
  { name: "restore-image", rows: base },
  { name: "final-unchanged", rows: base },
  { name: "clipped-table-neighbor-initial", rows: base, clipWidth: 150, neighbor: "111" },
  { name: "clipped-table-neighbor-update", rows: base, clipWidth: 150, neighbor: "222" },
  { name: "clipped-table-neighbor-repeat", rows: base, clipWidth: 150, neighbor: "222" },
  { name: "clipped-table-neighbor-clear", rows: base, clipWidth: 150, neighbor: "" },
];

async function frames(): Promise<Frame[]> {
  await installUiFonts();
  const theme = createPersonalizedWidgetTheme(
    discoverPersonalization("linux", {
      themeFamily: "moire",
      colorScheme: "dark",
      reducedMotion: true,
    }),
  );
  const root = createShellRoot();
  const retained = new RetainedSceneRenderer();
  const cpu = new RetainedSoftwareRenderer();
  const result: Frame[] = [];
  try {
    for (const step of steps) {
      renderShell(
        root,
        <WidgetThemeProvider theme={theme}>
          <Rect width={viewport.width} height={viewport.height} fill={0xff15191f} />
          <Group x={29} y={23} width={step.clipWidth ?? 620} height={285} clip>
            <Group x={step.x ?? 0} y={step.y ?? 0} width={620} height={310}>
              <Table
                width={620}
                height={310}
                columns={columns}
                rows={step.rows}
                getRowKey={(row) => String(row.pid)}
                striped
              />
            </Group>
          </Group>
          {step.neighbor !== undefined ? (
            <Text x={500} y={168} text={step.neighbor} fontSize={32} color={0xffdbe2ef} />
          ) : null}
        </WidgetThemeProvider>,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      const scene = retained.render(root.container, viewport);
      const actual = cpu.render(scene).pixels.slice();
      const fresh = new RetainedSoftwareRenderer().render(
        new RetainedSceneRenderer().render(root.container, viewport),
      ).pixels;
      assert.deepEqual(actual, fresh, `${step.name}: retained CPU differs from fresh CPU`);
      result.push({ name: step.name, scene, cpu: actual });
    }
  } finally {
    renderShell(root, null);
  }
  assert.equal(result[1]!.scene.damage?.length, 0, "unchanged frame must exercise zero damage");
  assert.ok(
    result.some((frame) => frame.scene.layers.some((layer) => layer.clip)),
    "fixture must exercise clipped layers",
  );
  const neighborUpdate = result.find((frame) => frame.name === "clipped-table-neighbor-update");
  assert.ok(neighborUpdate?.scene.damage?.length);
  assert.ok(
    neighborUpdate.scene.damage.every((rect) => rect.x >= 179),
    `neighbor update must damage only outside the Table clip: ${JSON.stringify(neighborUpdate.scene.damage)}`,
  );
  // Test the executor contract directly as well: retained scene producers may
  // preserve invisible layers. A zero-area clipped bound must never let such
  // a layer bypass scissoring during a neighboring partial repaint.
  const neighborInitial = result.find((frame) => frame.name === "clipped-table-neighbor-initial");
  const glyph = neighborInitial?.scene.layers.at(-1);
  assert.ok(glyph, "native fixture needs an actual rasterized text layer");
  assert.ok(glyph.id.endsWith(":text"));
  const hidden = {
    ...glyph,
    id: "native-fully-clipped-text",
    destination: { x: 510, y: 168, width: 92, height: 40 },
    clip: { x: 29, y: 23, width: 150, height: 285 },
    opacity: 0.5,
  };
  const nativeCpu = new RetainedSoftwareRenderer();
  const nativeColors = new Map<number, Uint8Array>();
  for (const [index, color] of [0xff265e90, 0xff853b4c, 0xff853b4c].entries()) {
    let pixels = nativeColors.get(color);
    if (!pixels) {
      pixels = new Uint8Array(new Uint32Array([color]).buffer);
      nativeColors.set(color, pixels);
    }
    const changed = {
      id: "native-changed-neighbor",
      pixels,
      sourceWidth: 1,
      sourceHeight: 1,
      sourceStride: 4,
      revision: color,
      sampling: "nearest" as const,
      destination: { x: 498, y: 166, width: 62, height: 46 },
    };
    const nativeScene: RetainedSceneFrame = {
      ...viewport,
      clearColor: 0xff15191f,
      layers: [changed, hidden],
      damage:
        index === 0 ? [{ x: 0, y: 0, ...viewport }] : index === 1 ? [changed.destination] : [],
    };
    const expected = new RetainedSoftwareRenderer().render({
      ...nativeScene,
      layers: [changed],
      damage: [{ x: 0, y: 0, ...viewport }],
    }).pixels;
    const actual = nativeCpu.render(nativeScene).pixels.slice();
    assert.deepEqual(
      actual,
      expected,
      "fully clipped text must match an oracle without that layer",
    );
    result.push({
      name: `native-empty-clip-${["initial", "neighbor-update", "repeat"][index]}`,
      scene: nativeScene,
      cpu: actual,
    });
  }
  return result;
}

function savePng(filename: string, pixels: Uint8Array): void {
  const png = new PNG(viewport);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    png.data[offset] = pixels[offset + 2]!;
    png.data[offset + 1] = pixels[offset + 1]!;
    png.data[offset + 2] = pixels[offset]!;
    png.data[offset + 3] = pixels[offset + 3]!;
  }
  fs.writeFileSync(filename, PNG.sync.write(png));
}

function difference(actual: Uint8Array, expected: Uint8Array) {
  let pixels = 0,
    maxChannelError = 0;
  let x0 = viewport.width,
    y0 = viewport.height,
    x1 = -1,
    y1 = -1;
  for (let offset = 0; offset < actual.length; offset += 4) {
    let error = 0;
    for (let channel = 0; channel < 4; channel++) {
      error = Math.max(error, Math.abs(actual[offset + channel]! - expected[offset + channel]!));
    }
    if (error === 0) continue;
    pixels++;
    maxChannelError = Math.max(maxChannelError, error);
    const index = offset / 4,
      x = index % viewport.width,
      y = Math.floor(index / viewport.width);
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return {
    pixels,
    maxChannelError,
    bounds: pixels ? { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 } : null,
  };
}

const sequence = await frames();
if (process.argv.includes("--cpu-only")) {
  console.log(`[retained-table-egl] ${sequence.length} actual Table updates match fresh CPU`);
} else {
  const freshArgument = process.argv.indexOf("--fresh-index");
  const freshIndex = freshArgument < 0 ? null : Number(process.argv[freshArgument + 1]);
  const outputArgument = process.argv.indexOf("--output");
  const outputFile = outputArgument < 0 ? null : process.argv[outputArgument + 1];
  if (freshIndex !== null)
    assert.ok(
      Number.isInteger(freshIndex) && sequence[freshIndex] && outputFile,
      "fresh oracle arguments are invalid",
    );
  const fd = openPath(process.env.MOIRE_RENDER_NODE ?? "/dev/dri/renderD128", O_RDWR | O_CLOEXEC);
  let egl: EglOutputScaler | null = null;
  const artifacts =
    freshIndex === null
      ? fs.mkdtempSync(path.join(os.tmpdir(), "moire-retained-table-egl-"))
      : null;
  try {
    egl = new EglOutputScaler(fd);
    if (freshIndex !== null && outputFile) {
      fs.writeFileSync(
        outputFile,
        egl.renderClientCompositionReadback(sequence[freshIndex]!.scene).pixels,
      );
    } else {
      assert.ok(artifacts);
      console.log(`[retained-table-egl] ${JSON.stringify(egl.info)} artifacts=${artifacts}`);
      const failures: string[] = [];
      for (const [index, frame] of sequence.entries()) {
        const before: ReturnType<EglOutputScaler["getTransferMetrics"]> | null =
          typeof egl.getTransferMetrics === "function" ? egl.getTransferMetrics() : null;
        const actual = egl.renderClientCompositionReadback(frame.scene).pixels.slice();
        const after: ReturnType<EglOutputScaler["getTransferMetrics"]> | null =
          typeof egl.getTransferMetrics === "function" ? egl.getTransferMetrics() : null;
        const uploads: { count: number; bytes: number } | null =
          before?.textureUpload && after?.textureUpload
            ? {
                count: after.textureUpload.count - before.textureUpload.count,
                bytes: after.textureUpload.bytes - before.textureUpload.bytes,
              }
            : null;
        if (uploads && frame.scene.damage?.length === 0) {
          assert.deepEqual(
            uploads,
            { count: 0, bytes: 0 },
            `${frame.name}: idle retained frame uploaded CPU pixels`,
          );
        }
        const oracleFile = path.join(artifacts, `${index}.bgra`);
        // Each fresh oracle has its own process/context. Constructing another
        // EGL context in this process would change the retained context's GL state.
        const oracle = spawnSync(
          process.execPath,
          [
            ...process.execArgv,
            fileURLToPath(import.meta.url),
            "--fresh-index",
            String(index),
            "--output",
            oracleFile,
          ],
          { encoding: "utf8" },
        );
        assert.equal(
          oracle.status,
          0,
          `fresh EGL oracle failed: ${oracle.stderr}\n${oracle.stdout}`,
        );
        const fresh = fs.readFileSync(oracleFile);
        fs.unlinkSync(oracleFile);
        assert.equal(fresh.length, actual.length, "fresh EGL readback size differs");
        const retainedDifference = difference(actual, fresh);
        const cpuDifference = difference(fresh, frame.cpu);
        console.log(
          JSON.stringify({
            frame: frame.name,
            damage: frame.scene.damage,
            retainedVsFreshEgl: retainedDifference,
            freshEglVsCpu: cpuDifference,
            measuredCpuTextureUploads: uploads,
          }),
        );
        if (retainedDifference.pixels > 0) {
          failures.push(frame.name);
          savePng(path.join(artifacts, `${index}-${frame.name}-retained.png`), actual);
          savePng(path.join(artifacts, `${index}-${frame.name}-fresh.png`), fresh);
          savePng(path.join(artifacts, `${index}-${frame.name}-cpu.png`), frame.cpu);
          fs.writeFileSync(
            path.join(artifacts, `${index}-${frame.name}-layers.json`),
            JSON.stringify(frame.scene, (key, value) => (key === "pixels" ? undefined : value), 2),
          );
        }
      }
      assert.deepEqual(failures, [], `retained EGL differs from fresh EGL; inspect ${artifacts}`);
      console.log(
        `[retained-table-egl] ${sequence.length} retained updates match fresh EGL; CPU differences logged separately for rasterization tolerance`,
      );
    }
  } finally {
    egl?.destroy();
    closeFd(fd);
  }
}
