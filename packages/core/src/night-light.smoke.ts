/**
 * Night light at composition: the software renderer scales presented pixels once (never
 * compounding across frames), captures stay true-colour, the EGL renderer hands the scale to
 * its output pass for presentation only, the EGL colour matrix matches the software scale, and
 * the controller follows prefs, the schedule and the fade (instant with reduce motion). With a
 * render node (`/dev/dri/renderD128` or MOIRE_RENDER_NODE) the real EGL pass is checked too.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  DEFAULT_NIGHT_LIGHT,
  nightLightScale,
  type DaylightContext,
  type NightLightSettings,
} from "@moire/prefs";
import { outputColorMatrix, type OutputColorScale } from "@moire/sys";
import {
  EglCompositorOutputRenderer,
  createCompositorOutputRenderer,
  type OutputRenderTarget,
} from "./output-renderer";
import { NightLightController, scaleOutputColors } from "./night-light";

const WIDTH = 4;
const HEIGHT = 2;
/** BGRA: white, mid grey, pure blue, pure red; then black, a skin tone, green, cyan. */
const SCENE = new Uint8Array([
  255, 255, 255, 255, 128, 128, 128, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 255, 120, 160,
  220, 255, 0, 255, 0, 255, 255, 255, 0, 255,
]);

function target(): OutputRenderTarget & { pixels: Uint8Array } {
  return {
    geometry: { id: "TEST-1", x: 0, y: 0, width: WIDTH, height: HEIGHT },
    physicalWidth: WIDTH,
    physicalHeight: HEIGHT,
    // Padded rows: the scale must stay inside each row's pixels.
    pitch: WIDTH * 4 + 8,
    pixels: new Uint8Array((WIDTH * 4 + 8) * HEIGHT).fill(7),
  };
}

function expected(scale: OutputColorScale): Uint8Array {
  const out = new Uint8Array(SCENE);
  for (let at = 0; at < out.length; at += 4) {
    out[at] = Math.round(out[at]! * scale[2]);
    out[at + 1] = Math.round(out[at + 1]! * scale[1]);
    out[at + 2] = Math.round(out[at + 2]! * scale[0]);
  }
  return out;
}

function tight(pixels: Uint8Array, pitch: number): Uint8Array {
  const out = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++)
    out.set(pixels.subarray(y * pitch, y * pitch + WIDTH * 4), y * WIDTH * 4);
  return out;
}

const warm = nightLightScale(0.6);

// ---- Software: presented once per frame, captures untouched, padding untouched.
{
  const renderer = createCompositorOutputRenderer(-1, "software");
  renderer.beginFrame({ pixels: SCENE, width: WIDTH, height: HEIGHT, stride: WIDTH * 4 });
  renderer.setOutputColorScale?.(warm);
  const out = target();
  renderer.renderOutput(out);
  assert.deepEqual(tight(out.pixels, out.pitch), expected(warm), "software presents scaled");
  assert.equal(out.pixels[WIDTH * 4], 7, "row padding is left alone");
  // Presenting again from the same scene into the same buffer does not compound.
  renderer.renderOutput(out);
  assert.deepEqual(tight(out.pixels, out.pitch), expected(warm), "a second frame doesn't compound");
  assert.deepEqual(renderer.captureOutput(out), SCENE, "screenshots stay true-colour");
  renderer.setOutputColorScale?.(null);
  renderer.renderOutput(out);
  assert.deepEqual(tight(out.pixels, out.pitch), SCENE, "off presents the scene");
  // White keeps full red; blue loses the most.
  const white = expected(warm).subarray(0, 4);
  assert.ok(white[2] === 255 && white[0]! < white[1]! && white[1]! < 255, `white ${white}`);
}

// ---- The EGL output pass: its colour matrix, run as the shader runs it, equals the software scale.
{
  const matrix = outputColorMatrix(warm)!;
  assert.equal(outputColorMatrix([1, 1, 1]), null, "neutral needs no pass");
  assert.equal(outputColorMatrix(undefined), null);
  const shader = (bgra: Uint8Array): number[] => {
    // u_has_color_matrix: texture .rgba holds B, G, R, A; semantic is straight RGBA.
    const color = [...bgra].map((byte) => byte / 255);
    const alpha = Math.max(color[3]!, 0.00001);
    const semantic = [color[2]! / alpha, color[1]! / alpha, color[0]! / alpha, color[3]!];
    const row = (index: number) =>
      [0, 1, 2, 3].reduce(
        (sum, column) => sum + matrix[index * 5 + column]! * semantic[column]!,
        0,
      ) + matrix[index * 5 + 4]!;
    const mapped = [0, 1, 2, 3].map((index) => Math.min(1, Math.max(0, row(index))));
    const rgb = mapped.slice(0, 3).map((channel) => channel * mapped[3]!);
    return [rgb[2]!, rgb[1]!, rgb[0]!, mapped[3]!].map((channel) => Math.round(channel * 255));
  };
  const software = new Uint8Array(SCENE);
  scaleOutputColors(software, WIDTH, HEIGHT, WIDTH * 4, warm);
  for (let at = 0; at < SCENE.length; at += 4)
    assert.deepEqual(
      shader(SCENE.subarray(at, at + 4)),
      [...software.subarray(at, at + 4)],
      `pixel ${at / 4}`,
    );
}

// ---- The EGL renderer passes the scale to presentation, never to captures.
{
  const seen: { call: string; colorScale: OutputColorScale | undefined }[] = [];
  const scaler = {
    info: { glRenderer: "fixture", glVersion: "fixture", eglExtensions: "" },
    execution: "hardware",
    beginFrame() {},
    beginComposition() {
      return null;
    },
    snapshotDmabuf() {
      throw new Error("unused");
    },
    renderOutput(output: { colorScale?: OutputColorScale }) {
      seen.push({ call: "renderOutput", colorScale: output.colorScale });
    },
    renderOutputDirect(output: { colorScale?: OutputColorScale }) {
      seen.push({ call: "renderOutputDirect", colorScale: output.colorScale });
      return { framebufferId: 9, stride: WIDTH * 4, width: WIDTH, height: HEIGHT };
    },
    destroy() {},
  };
  const renderer = new EglCompositorOutputRenderer(
    scaler as unknown as ConstructorParameters<typeof EglCompositorOutputRenderer>[0],
    "direct",
  );
  renderer.beginFrame({ pixels: SCENE, width: WIDTH, height: HEIGHT, stride: WIDTH * 4 });
  renderer.setOutputColorScale(warm);
  renderer.renderOutput(target());
  renderer.captureOutput(target());
  renderer.setOutputColorScale(null);
  renderer.renderOutput(target());
  assert.deepEqual(seen, [
    { call: "renderOutputDirect", colorScale: warm },
    { call: "renderOutput", colorScale: undefined },
    { call: "renderOutputDirect", colorScale: undefined },
  ]);
}

// ---- The real EGL pass, where a render node exists (Linux, the VM).
const node = process.env.MOIRE_RENDER_NODE ?? "/dev/dri/renderD128";
if (process.platform === "linux" && fs.existsSync(node)) {
  const { EglOutputScaler } = await import("@moire/sys");
  const { O_CLOEXEC, O_RDWR, openPath, closeFd } = await import("@moire/sys");
  const fd = openPath(node, O_RDWR | O_CLOEXEC);
  const scaler = new EglOutputScaler(fd);
  try {
    scaler.beginFrame(SCENE, WIDTH, HEIGHT);
    const output = (colorScale?: OutputColorScale) => {
      const pixels = new Uint8Array(SCENE.length);
      scaler.renderOutput({
        id: "night-light",
        x: 0,
        y: 0,
        width: WIDTH,
        height: HEIGHT,
        targetWidth: WIDTH,
        targetHeight: HEIGHT,
        targetPitch: WIDTH * 4,
        target: pixels,
        colorScale,
      });
      return pixels;
    };
    const warmed = output(warm);
    const want = expected(warm);
    for (let at = 0; at < want.length; at++)
      assert.ok(
        Math.abs(warmed[at]! - want[at]!) <= 1,
        `EGL byte ${at}: ${warmed[at]} vs ${want[at]}`,
      );
    assert.deepEqual(output(), SCENE, "EGL without a scale is the scene");
    console.log("[night-light] EGL output pass checked on", node);
  } finally {
    scaler.destroy();
    closeFd(fd);
  }
} else console.log("[night-light] no render node; EGL pass checked by its matrix only");

// ---- The controller: prefs, schedule, fade, reduce motion.
{
  let settings: NightLightSettings = { ...DEFAULT_NIGHT_LIGHT };
  let reducedMotion = false;
  let stamp = 1;
  const context: DaylightContext = { timeZone: "UTC", location: null };
  const controller = new NightLightController(
    {
      read: () => ({ nightLight: settings, reducedMotion }),
      stamp: () => String(stamp),
      context: () => context,
    },
    { fadeMs: 1000, evaluateMs: 30_000 },
  );
  const noon = Date.UTC(2026, 2, 1, 12);
  assert.equal(controller.tick(noon), false);
  assert.equal(controller.scale(), null, "off by default");
  // Switched on with no schedule: fades in over a second.
  settings = { ...settings, enabled: true, schedule: "off", strength: 0.8 };
  stamp++;
  assert.equal(controller.tick(noon + 16), true);
  assert.ok(controller.animating());
  controller.tick(noon + 516);
  assert.ok(Math.abs(controller.strength() - 0.5) < 0.02, `half way ${controller.strength()}`);
  controller.tick(noon + 2000);
  assert.equal(controller.strength(), 0.8);
  assert.ok(!controller.animating());
  assert.deepEqual(controller.scale(), nightLightScale(0.8));
  // A custom evening: off at noon, on once the clock passes 20:00 (checked every 30 s).
  settings = { ...settings, schedule: "custom", from: "20:00", to: "07:00" };
  stamp++;
  reducedMotion = true;
  controller.tick(noon + 3000);
  assert.equal(controller.scale(), null, "reduce motion switches at once");
  const evening = Date.UTC(2026, 2, 1, 20, 0, 10);
  assert.equal(controller.tick(evening), true);
  assert.equal(controller.strength(), 0.8);
  // Within the check interval nothing is re-read or re-evaluated.
  assert.equal(controller.tick(evening + 1000), false);
}

console.log("[night-light] software, EGL pass, captures and controller passed");
