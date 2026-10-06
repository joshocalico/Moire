import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createSilkBackdrop, silkGeometry, SILK_LIMITS, type SilkVariant } from "./silk";
import { backdropPlacement, resolveBackdropMotion } from "./placement";

for (const variant of ["fold-e", "greeter"] satisfies SilkVariant[]) {
  const geometry = silkGeometry(variant, 7);
  assert.equal(geometry.length, SILK_LIMITS.filaments);
  for (const filament of geometry) {
    assert.equal(filament.points.length, SILK_LIMITS.segmentsPerFilament + 1);
    for (const point of filament.points) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
      assert.ok(Math.abs(point.x) < 2 && Math.abs(point.y) < 2);
    }
    for (let index = 1; index < filament.points.length; index++) {
      const point = filament.points[index]!,
        previous = filament.points[index - 1]!;
      assert.ok(
        Math.hypot(point.x - previous.x, point.y - previous.y) < 0.1,
        "tessellation never creates a huge full-surface stroke",
      );
    }
  }
  const crest = geometry[Math.floor(geometry.length / 2)]!.points;
  let turning = 0;
  let previousAngle: number | undefined;
  for (let index = 66; index < 158; index++) {
    const before = crest[index - 1]!,
      point = crest[index]!;
    const angle = Math.atan2(point.y - before.y, (point.x - before.x) * 1.6);
    if (previousAngle !== undefined) {
      let delta = angle - previousAngle;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      turning += Math.abs(delta);
    }
    previousAngle = angle;
  }
  assert.ok(
    turning > (variant === "fold-e" ? Math.PI : 1),
    "center-right strands form a curved crest rather than a straight diagonal",
  );
  const started = performance.now();
  const source = createSilkBackdrop({ variant, seed: 7 });
  const ms = performance.now() - started;
  const repeated = createSilkBackdrop({ variant, seed: 7 });
  assert.deepEqual(source.image.rgba, repeated.image.rgba, "same seed is byte deterministic");
  assert.notEqual(source.image.rgba, repeated.image.rgba, "no global cache or shared ownership");
  assert.equal(source.metrics.bytes, 1280 * 800 * 4);
  assert.equal(source.metrics.segments, 98304);
  assert.equal(source.metrics.filaments, 512);
  assert.ok(source.image.rgba.some((value, index) => index % 4 === 3 && value > 128));
  let purplePixels = 0,
    warmPixels = 0;
  for (let offset = 0; offset < source.image.rgba.length; offset += 4) {
    const r = source.image.rgba[offset]!,
      g = source.image.rgba[offset + 1]!,
      b = source.image.rgba[offset + 2]!,
      alpha = source.image.rgba[offset + 3]!;
    if (alpha <= 32) continue;
    if (b > r && r > g) purplePixels++;
    if (r > b && r > g) warmPixels++;
  }
  assert.ok(purplePixels > 5000, "default artwork retains visible purple filaments");
  assert.ok(
    warmPixels > 50,
    "default artwork retains warm fringes without recoloring the whole sheet",
  );
  assert.notDeepEqual(source.image.rgba, createSilkBackdrop({ variant, seed: 8 }).image.rgba);
  console.log(
    JSON.stringify({
      variant,
      ms,
      turning,
      purplePixels,
      warmPixels,
      ...source.metrics,
      sha256: createHash("sha256").update(source.image.rgba).digest("hex"),
    }),
  );
}
const high = createSilkBackdrop({ variant: "greeter", resolution: "high" });
assert.equal(high.image.width, 1920);
assert.equal(high.image.height, 1200);
assert.equal(high.metrics.bytes, 1920 * 1200 * 4);
assert.equal(high.metrics.segments, 98304, "high resolution never adds geometry work");

for (const [width, height] of [
  [1280, 800],
  [640, 800],
  [320, 200],
  [5120, 2160],
  [0, 0],
]) {
  const placement = backdropPlacement(width!, height!);
  for (const dx of [-placement.driftX, placement.driftX]) {
    for (const dy of [-placement.driftY, placement.driftY]) {
      assert.ok(placement.x + dx < 0 && placement.y + dy < 0);
      assert.ok(placement.x + dx + placement.width > width!);
      assert.ok(placement.y + dy + placement.height > height!);
    }
  }
}
assert.equal(resolveBackdropMotion(undefined), false);
assert.equal(resolveBackdropMotion({ kind: "static" }), false);
for (const rendering of ["software", "unknown", "hardware-retained"] satisfies Array<
  "software" | "unknown" | "hardware-retained"
>) {
  for (const active of [true, false]) {
    for (const reduced of [true, false]) {
      assert.equal(
        resolveBackdropMotion({ kind: "ambient", rendering, active }, reduced),
        rendering === "hardware-retained" && active && !reduced,
      );
    }
  }
}
console.log("silk geometry, deterministic raster, bounded source and motion policy smoke passed");
