import assert from "node:assert/strict";
import { orderedCompositionLayers, type CompositionScene, type PixelSurface } from "./composition";
import {
  evaluateSurfaceVisibility,
  compositionVisibilityLayer,
  SURFACE_VISIBILITY_LIMITS,
  type RectangularVisibilityLayer,
  type SurfaceVisibilityScene,
  type SurfaceVisibilityOutput,
  type VisibilityRect,
} from "./surface-visibility";
import { contentShapeCoverage, windowContentShape } from "./window-content-shape";

const bounds = (x = 0, y = 0, width = 8, height = 8): VisibilityRect =>
  Object.freeze({ x, y, width, height });
const rect = (
  area: VisibilityRect = bounds(),
  coverage: "opaque" | "unknown" = "opaque",
): RectangularVisibilityLayer => ({ kind: "rect", bounds: area, coverage });
const output = (
  area: VisibilityRect = bounds(),
  state: "usable" | "unresolved" = "usable",
): SurfaceVisibilityOutput => ({ bounds: area, state });
const base: SurfaceVisibilityScene = Object.freeze({
  subject: Object.freeze(rect()),
  outputs: Object.freeze([Object.freeze(output())]),
  above: Object.freeze([]),
});
const check = (scene: SurfaceVisibilityScene, expected: "visible" | "hidden" | "unknown") => {
  const actual = evaluateSurfaceVisibility(scene);
  assert.equal(actual.visibility, expected, JSON.stringify({ scene, actual }));
  assert.ok(actual.work.operations <= SURFACE_VISIBILITY_LIMITS.maxOperations);
  assert.ok(actual.work.peakRectangles <= SURFACE_VISIBILITY_LIMITS.maxRectangles);
  return actual;
};
check(base, "visible");
check({ ...base, subject: { kind: "hidden" } }, "hidden"); // unmapped/minimized
check({ ...base, subject: rect(bounds(9, 0)) }, "hidden"); // offscreen
check({ ...base, subject: rect(bounds(9, 0)), above: [{ kind: "unknown" }] }, "hidden");
check({ ...base, subject: rect(bounds(0, 0, 0, 8)) }, "hidden");
check({ ...base, outputs: [] }, "hidden");
check({ ...base, above: [rect()] }, "hidden");
check({ ...base, above: [rect(bounds(0, 0, 4, 8)), rect(bounds(4, 0, 4, 8))] }, "hidden");
check({ ...base, above: [rect(bounds(0, 0, 5, 8)), rect(bounds(3, 0, 5, 8))] }, "hidden");
check({ ...base, above: [rect(bounds(0, 0, 4, 8))] }, "visible");
check({ ...base, above: [rect(bounds(8, 0, 4, 8))] }, "visible"); // touching is no coverage
check({ ...base, above: [rect(bounds(), "unknown")] }, "unknown"); // covering ARGB
check({ ...base, above: [rect(bounds(0, 0, 4, 8), "unknown")] }, "visible");
check(
  { ...base, above: [rect(bounds(0, 0, 4, 8)), rect(bounds(4, 0, 4, 8), "unknown")] },
  "unknown",
);
check({ ...base, subject: rect(bounds(), "unknown") }, "unknown"); // ARGB topmost is not proof
check({ ...base, subject: rect(bounds(), "unknown"), above: [rect()] }, "hidden");
check({ ...base, subject: { kind: "unknown" } }, "unknown"); // subject transformed/effected
check({ ...base, above: [{ kind: "unknown" }] }, "unknown"); // unbounded mesh/effect geometry
check({ ...base, outputs: [output(bounds(), "unresolved")] }, "unknown");
check({ ...base, outputs: [output(bounds(), "unresolved"), output()] }, "visible");
check({ ...base, outputs: [output(bounds(), "unresolved"), output()], above: [rect()] }, "unknown");
check(
  { ...base, outputs: [output(bounds(8, 0), "unresolved"), output()], above: [rect()] },
  "hidden",
);
check({ ...base, outputs: [output(bounds(-4, 0, 4, 8)), output(bounds(4, 0, 4, 8))] }, "visible");
check(
  {
    ...base,
    subject: rect(bounds(-4, 0, 12, 8)),
    outputs: [output(bounds(-4, 0, 4, 8)), output(bounds(4, 0, 4, 8))],
    above: [rect(bounds(-4, 0, 4, 8))],
  },
  "visible",
);
check({ ...base, subject: rect(bounds(0.5)) }, "unknown");
check({ ...base, above: [rect(bounds(NaN))] }, "unknown");
check({ ...base, outputs: [output(bounds(Infinity))] }, "unknown");
check({ ...base, subject: rect(bounds(Number.MAX_SAFE_INTEGER)) }, "unknown");
check({ ...base, subject: rect(bounds(0, 0, -1, 8)) }, "unknown");
const cuts = [rect(bounds(3, 0, 1, 8)), rect(bounds(0, 3, 8, 1))];
assert.equal(
  check({ ...base, above: cuts, budget: { maxRectangles: 2 } }, "unknown").visibility,
  "unknown",
);
assert.deepEqual(check({ ...base, above: cuts, budget: { maxOperations: 3 } }, "unknown").work, {
  operations: 3,
  peakRectangles: 0,
});
check({ ...base, budget: { maxRectangles: 0 } }, "unknown");
check({ ...base, budget: { maxOperations: NaN } }, "unknown");
check(
  {
    ...base,
    above: Array.from({ length: 4097 }, () => rect()),
    budget: { maxOperations: 100_000 },
  },
  "unknown",
);

assert.equal(
  check(
    { ...base, above: Array.from({ length: 2000 }, () => rect(bounds(20, 20, 1, 1), "unknown")) },
    "unknown",
  ).work.operations,
  4096,
  "offscreen/no-op covers still consume the operation budget",
);

// Actual compositor vocabulary/order; the lazy resident source must never read back.
let reads = 0;
const resident: PixelSurface = {
  get pixels(): Uint8Array {
    reads++;
    throw new Error("Visibility attempted a GPU readback");
  },
  width: 8,
  height: 8,
  stride: 32,
};
const scene: CompositionScene = {
  width: 8,
  height: 8,
  clearColor: 0xff000000,
  layers: [
    { id: "popup", z: 30, source: resident, destination: bounds(4, 0, 4, 8) },
    { id: "client:1:9", z: 10, source: resident, destination: bounds() },
    { id: "shell:launcher", z: 40, source: resident, destination: bounds(0, 0, 4, 8) },
  ],
};
const ordered = orderedCompositionLayers(scene);
const subjectLayer = ordered.find((layer) => layer.id === "client:1:9");
assert.ok(subjectLayer);
const subject = rect(subjectLayer.destination);
const upper = ordered
  .filter((layer) => layer.z > 10)
  .map((layer) => rect(layer.destination, "unknown"));
check({ ...base, subject, above: upper }, "unknown");
// Same committed subject/source, only an unrelated launcher moves away: reveal is immediate.
const popup = upper[0];
assert.ok(popup);
check({ ...base, subject, above: [popup] }, "visible");
check({ ...base, subject, above: [] }, "visible");
assert.equal(reads, 0);

assert.deepEqual(
  ordered.map((layer) => layer.id),
  ["client:1:9", "popup", "shell:launcher"],
);

// Actual layer metadata conversion preserves possible ARGB bounds and never samples pixels.
const paintLayer = {
  id: "surface:1:9",
  z: 0,
  source: resident,
  destination: bounds(),
  sampling: "nearest" as const,
};
assert.deepEqual(compositionVisibilityLayer(paintLayer, true), rect());
assert.deepEqual(
  compositionVisibilityLayer({ ...paintLayer, clip: bounds(2, 2, 2, 3) }, true),
  rect(bounds(2, 2, 2, 3)),
);
assert.deepEqual(
  compositionVisibilityLayer({ ...paintLayer, clip: bounds(12, 0, 1, 1) }, true),
  rect(bounds(0, 0, 0, 0)),
);
const mask = { x: 2, y: 1, width: 3, height: 4 };
assert.deepEqual(
  compositionVisibilityLayer({ ...paintLayer, surfaceGeometry: mask }, true),
  rect(bounds(2, 1, 3, 4)),
);
assert.deepEqual(
  compositionVisibilityLayer({ ...paintLayer, surfaceGeometry: mask }, false),
  rect(bounds(), "unknown"),
);
assert.deepEqual(
  compositionVisibilityLayer(
    { ...paintLayer, destination: bounds(0, 0, 4, 4), surfaceGeometry: mask },
    true,
  ),
  rect(bounds(0, 0, 4, 4), "unknown"),
);
assert.equal(compositionVisibilityLayer({ ...paintLayer, opacity: 0.5 }, true).kind, "rect");
assert.deepEqual(
  compositionVisibilityLayer(
    {
      ...paintLayer,
      effects: [{ kind: "drop-shadow", offsetX: 0, offsetY: 8, blurRadius: 20, color: 0x44000000 }],
    },
    true,
  ),
  { kind: "unknown" },
);
assert.deepEqual(
  compositionVisibilityLayer({ ...paintLayer, destination: bounds(0.5, 0, 8, 8) }, true),
  { kind: "unknown" },
);
assert.equal(reads, 0);

const roundedFrame = compositionVisibilityLayer(
  {
    ...paintLayer,
    surfaceGeometry: undefined,
    contentShape: { bounds: bounds(), radii: [3, 3, 3, 3], outside: "discard" },
  },
  true,
);
assert.deepEqual(roundedFrame, {
  kind: "rect",
  bounds: paintLayer.destination,
  coverage: "unknown",
  opaqueRegion: bounds(3, 0, 2, 8),
});
check({ ...base, subject: roundedFrame }, "visible");
check({ ...base, subject: rect(bounds(0, 0, 1, 1)), above: [roundedFrame] }, "unknown");
// The actual corner is uncovered; rectangular policy must never claim hidden.
check({ ...base, subject: rect(bounds(3, 1, 1, 1)), above: [roundedFrame] }, "hidden");
check({ ...base, subject: roundedFrame, above: [rect(bounds(3, 0, 2, 8))] }, "unknown");
check({ ...base, subject: roundedFrame, above: [rect()] }, "hidden");
check({ ...base, subject: roundedFrame, above: [rect(bounds(3, 0, 1, 8))] }, "visible");
check(
  {
    ...base,
    subject: roundedFrame,
    above: [rect(bounds(3, 0, 1, 8)), rect(bounds(4, 0, 1, 8), "unknown")],
  },
  "unknown",
);
check({ ...base, subject: roundedFrame, outputs: [output(bounds(0, 0, 3, 8))] }, "unknown");
check({ ...base, subject: roundedFrame, outputs: [output(bounds(), "unresolved")] }, "unknown");
check(
  {
    ...base,
    subject: {
      kind: "rect",
      bounds: bounds(),
      coverage: "unknown",
      opaqueRegion: bounds(-1, 0, 2, 2),
    },
  },
  "unknown",
);
const invalidWitness = check(
  {
    ...base,
    above: [
      { kind: "rect", bounds: bounds(), coverage: "unknown", opaqueRegion: bounds(0.5, 0, 2, 2) },
    ],
  },
  "unknown",
);
assert.equal(invalidWitness.visibility, "unknown");
if (invalidWitness.visibility === "unknown") assert.equal(invalidWitness.reason, "geometry");
check(
  {
    ...base,
    subject: {
      kind: "rect",
      bounds: bounds(),
      coverage: "unknown",
      opaqueRegion: bounds(0, 0, 0, 8),
    },
  },
  "unknown",
);

const tinyRounded = compositionVisibilityLayer(
  { ...paintLayer, contentShape: windowContentShape(bounds(), 4, "discard") },
  true,
);
assert.deepEqual(tinyRounded, rect(bounds(), "unknown"));
check({ ...base, subject: tinyRounded }, "unknown");
for (const radius of [NaN, Infinity, -1, 65, 5]) {
  assert.deepEqual(
    compositionVisibilityLayer(
      {
        ...paintLayer,
        contentShape: {
          bounds: bounds(),
          radii: [radius, radius, radius, radius],
          outside: "discard",
        },
      },
      true,
    ),
    { kind: "unknown" },
  );
}

// Real mask reference at logical/output sample centres, including fractional radii
// and clipping which can change the larger guaranteed strip.
for (const radii of [
  [12, 12, 12, 12],
  [1.2, 8.3, 7.1, 2.4],
] as const) {
  const frame = bounds(10, 20, 64, 48);
  const shape = { bounds: frame, radii, outside: "discard" as const };
  for (const clip of [undefined, bounds(10, 20, 14, 48), bounds(10, 20, 64, 14)]) {
    const converted = compositionVisibilityLayer(
      { ...paintLayer, destination: frame, contentShape: shape, clip },
      true,
    );
    assert.ok(converted.kind === "rect" && converted.coverage === "unknown");
    const region = converted.opaqueRegion;
    assert.ok(region);
    check({ subject: converted, outputs: [output(frame)], above: [] }, "visible");
    for (const scale of [1, 1.5, 2]) {
      for (
        let y = Math.floor(region.y * scale);
        y < Math.ceil((region.y + region.height) * scale);
        y++
      )
        for (
          let x = Math.floor(region.x * scale);
          x < Math.ceil((region.x + region.width) * scale);
          x++
        ) {
          const sx = (x + 0.5) / scale,
            sy = (y + 0.5) / scale;
          if (contains(region, sx, sy))
            assert.equal(
              contentShapeCoverage(shape, sx, sy),
              1,
              "opaque witness crossed mask antialiasing",
            );
        }
    }
    assert.deepEqual(
      compositionVisibilityLayer(
        { ...paintLayer, destination: frame, contentShape: shape, clip },
        false,
      ),
      { kind: "rect", bounds: clip ?? frame, coverage: "unknown" },
      "ARGB alone never gains an opaque witness",
    );
    assert.ok(
      !(
        "opaqueRegion" in
        compositionVisibilityLayer(
          { ...paintLayer, destination: frame, contentShape: shape, opacity: 0.5 },
          true,
        )
      ),
      "opacity change cannot retain full-coverage proof",
    );
  }
}
const squareFrame = compositionVisibilityLayer(
  {
    ...paintLayer,
    surfaceGeometry: undefined,
    contentShape: { bounds: bounds(1, 1, 6, 6), radii: [0, 0, 0, 0], outside: "discard" },
  },
  true,
);
assert.deepEqual(squareFrame, { kind: "rect", bounds: bounds(1, 1, 6, 6), coverage: "opaque" });
check({ ...base, subject: rect(bounds(0, 0, 1, 1)), above: [squareFrame] }, "visible");
check({ ...base, subject: rect(bounds(2, 2, 1, 1)), above: [squareFrame] }, "hidden");
assert.equal(reads, 0, "shape authority uses paint metadata, never GPU pixels");

// Independent discrete paint oracle: compare rectangle algebra with pixel membership.
function contains(area: VisibilityRect, x: number, y: number): boolean {
  return x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height;
}
function rasterOracle(input: SurfaceVisibilityScene): "visible" | "hidden" | "unknown" {
  if (input.subject.kind !== "rect") return input.subject.kind === "hidden" ? "hidden" : "unknown";
  let uncertain = false;
  for (const display of input.outputs) {
    let outputTouched = false,
      remaining = false,
      uncovered = false;
    for (
      let y = input.subject.bounds.y;
      y < input.subject.bounds.y + input.subject.bounds.height;
      y++
    )
      for (
        let x = input.subject.bounds.x;
        x < input.subject.bounds.x + input.subject.bounds.width;
        x++
      ) {
        if (!contains(display.bounds, x, y)) continue;
        outputTouched = true;
        const layers = input.above.filter(
          (layer) => layer.kind === "rect" && contains(layer.bounds, x, y),
        );
        remaining ||= !layers.some(
          (layer) =>
            layer.kind === "rect" &&
            (layer.coverage === "opaque" ||
              (layer.opaqueRegion && contains(layer.opaqueRegion, x, y))),
        );
        uncovered ||=
          layers.length === 0 &&
          (input.subject.coverage === "opaque" ||
            (input.subject.opaqueRegion !== undefined &&
              contains(input.subject.opaqueRegion, x, y)));
      }
    if (!outputTouched) continue;
    if (display.state !== "usable") {
      uncertain = true;
      continue;
    }
    if (uncovered) return "visible";
    uncertain ||= remaining;
  }
  return uncertain ? "unknown" : "hidden";
}
let seed = 0x15c0de;
const random = (range: number) => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed % range;
};
const randomRect = (): RectangularVisibilityLayer => {
  const area = bounds(random(12) - 3, random(12) - 3, random(9), random(9));
  if (random(3)) return rect(area);
  if (random(2)) return rect(area, "unknown");
  const left = random(area.width + 1),
    top = random(area.height + 1);
  return {
    kind: "rect",
    bounds: area,
    coverage: "unknown",
    opaqueRegion: bounds(
      area.x + left,
      area.y + top,
      random(area.width - left + 1),
      random(area.height - top + 1),
    ),
  };
};
for (let i = 0; i < 1200; i++) {
  const subject = rect(
    bounds(random(6) - 2, random(6) - 2, random(9), random(9)),
    random(3) ? "opaque" : "unknown",
  );
  const above = Array.from({ length: random(7) }, randomRect);
  const sample: SurfaceVisibilityScene = {
    subject,
    above,
    outputs: [
      output(bounds(0, 0, 8, 7)),
      output(bounds(9, 0, 4, 7), random(4) ? "usable" : "unresolved"),
    ],
  };
  const result = check(sample, rasterOracle(sample));
  if (result.visibility === "visible") {
    const display = sample.outputs[result.outputIndex];
    assert.ok(display);
    for (let y = result.witness.y; y < result.witness.y + result.witness.height; y++)
      for (let x = result.witness.x; x < result.witness.x + result.witness.width; x++) {
        assert.ok(contains(subject.bounds, x, y) && contains(display.bounds, x, y));
        assert.ok(
          !above.some((layer) => contains(layer.bounds, x, y)),
          "witness crossed possible coverage",
        );
      }
  }
}
for (let i = 0; i < 1200; i++) {
  const sample: SurfaceVisibilityScene = {
    subject: randomRect(),
    above: Array.from({ length: random(7) }, randomRect),
    outputs: [
      output(bounds(0, 0, 8, 7)),
      output(bounds(9, 0, 4, 7), random(4) ? "usable" : "unresolved"),
    ],
  };
  const result = check(sample, rasterOracle(sample));
  if (result.visibility === "visible" && sample.subject.kind === "rect") {
    const opaque =
      sample.subject.coverage === "opaque" ? sample.subject.bounds : sample.subject.opaqueRegion;
    assert.ok(opaque);
    for (let y = result.witness.y; y < result.witness.y + result.witness.height; y++)
      for (let x = result.witness.x; x < result.witness.x + result.witness.width; x++) {
        assert.ok(contains(opaque, x, y));
        assert.ok(
          !sample.above.some((layer) => layer.kind === "rect" && contains(layer.bounds, x, y)),
        );
      }
  }
}
console.log(
  "[surface/visibility] lifecycle/opaque-union/inner-witness/ARGB/geometry/output-recovery/budget/reveal fixtures and 2400 independent raster oracles passed; no pixel reads. Policy and paint-metadata checks only; production wire/lifecycle is exercised separately.",
);
