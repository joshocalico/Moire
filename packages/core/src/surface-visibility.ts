/** Conservative geometric contribution to the compositor's current painted scene. */
import type { CompositionLayer, CompositionRect, WindowContentShape } from "./composition";

export type VisibilityRect = Readonly<CompositionRect>;
export type RectangularVisibilityLayer = Readonly<{
  kind: "rect";
  /** Possible axis-aligned extent after clipping; rounded corners may be transparent. */
  bounds: VisibilityRect;
}> &
  (
    | Readonly<{
        /** Every pixel in bounds has format/full-region proof and no alpha-changing effects. */
        coverage: "opaque";
        opaqueRegion?: never;
      }>
    | Readonly<{
        coverage: "unknown";
        /** Guaranteed full coverage inside the possible bounds; never inferred from pixel reads. */
        opaqueRegion?: VisibilityRect;
      }>
  );
export type SurfaceVisibilitySubject =
  | Readonly<{ kind: "hidden" }>
  | RectangularVisibilityLayer
  | Readonly<{ kind: "unknown" }>;
export type SurfaceVisibilityLayer =
  | RectangularVisibilityLayer
  /** Geometry/effects have no authoritative rectangular coverage bound. */
  | Readonly<{ kind: "unknown" }>;
export type SurfaceVisibilityOutput = Readonly<{
  bounds: VisibilityRect;
  /** Recovery/quarantined outputs cannot supply a visible witness. */
  state: "usable" | "unresolved";
}>;
export type SurfaceVisibilityBudget = Readonly<{
  maxRectangles?: number;
  maxOperations?: number;
}>;
export const SURFACE_VISIBILITY_LIMITS = Object.freeze({ maxRectangles: 256, maxOperations: 4096 });
export type SurfaceVisibilityWork = Readonly<{ operations: number; peakRectangles: number }>;
export type SurfaceVisibilityResult = (
  | { visibility: "visible"; witness: VisibilityRect; outputIndex: number }
  | { visibility: "hidden"; reason: "lifecycle" | "offscreen" | "covered" }
  | {
      visibility: "unknown";
      reason: "geometry" | "subject-opacity" | "coverage" | "output-unresolved" | "budget";
    }
) & { work: SurfaceVisibilityWork };
export type SurfaceVisibilityScene = Readonly<{
  subject: SurfaceVisibilitySubject;
  outputs: readonly SurfaceVisibilityOutput[];
  /** Every painted upper layer, including popups and shell overlays, excluding cursor. */
  above: readonly SurfaceVisibilityLayer[];
  budget?: SurfaceVisibilityBudget;
}>;

function validRect(rect: VisibilityRect): boolean {
  return (
    Number.isSafeInteger(rect.x) &&
    Number.isSafeInteger(rect.y) &&
    Number.isSafeInteger(rect.width) &&
    Number.isSafeInteger(rect.height) &&
    rect.width >= 0 &&
    rect.height >= 0 &&
    Number.isSafeInteger(rect.x + rect.width) &&
    Number.isSafeInteger(rect.y + rect.height)
  );
}
function intersection(a: VisibilityRect, b: VisibilityRect): VisibilityRect | null {
  const x = Math.max(a.x, b.x),
    y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}
function opaqueRegion(layer: RectangularVisibilityLayer): VisibilityRect | undefined {
  return layer.coverage === "opaque" ? layer.bounds : layer.opaqueRegion;
}
function validOpaqueRegion(layer: RectangularVisibilityLayer): boolean {
  const region = layer.opaqueRegion;
  return (
    region === undefined ||
    (validRect(region) &&
      region.x >= layer.bounds.x &&
      region.y >= layer.bounds.y &&
      region.x + region.width <= layer.bounds.x + layer.bounds.width &&
      region.y + region.height <= layer.bounds.y + layer.bounds.height)
  );
}
function limit(requested: number | undefined, maximum: number): number {
  return requested === undefined
    ? maximum
    : Number.isSafeInteger(requested) && requested >= 0
      ? Math.min(requested, maximum)
      : 0;
}

/**
 * Stateless, synchronous and independent of client commits/focus. The caller evaluates
 * each subscribed live surface whenever the actual scene/output availability changes.
 * No alpha reads or retained surface references. Each subtraction pass stores at most
 * maxRectangles fragments; the total comparison work shares one hard operation budget.
 */
export function evaluateSurfaceVisibility(scene: SurfaceVisibilityScene): SurfaceVisibilityResult {
  const maxRectangles = limit(scene.budget?.maxRectangles, SURFACE_VISIBILITY_LIMITS.maxRectangles);
  const maxOperations = limit(scene.budget?.maxOperations, SURFACE_VISIBILITY_LIMITS.maxOperations);
  let operations = 0,
    peakRectangles = 0;
  const work = (): SurfaceVisibilityWork => ({ operations, peakRectangles });
  const unknown = (
    reason: Extract<SurfaceVisibilityResult, { visibility: "unknown" }>["reason"],
  ): SurfaceVisibilityResult => ({ visibility: "unknown", reason, work: work() });
  const take = () => {
    if (operations >= maxOperations) return false;
    operations++;
    return true;
  };
  const subject = scene.subject;
  if (subject.kind === "hidden") return { visibility: "hidden", reason: "lifecycle", work: work() };
  if (subject.kind === "unknown" || !validRect(subject.bounds) || !validOpaqueRegion(subject))
    return unknown("geometry");
  if (subject.bounds.width === 0 || subject.bounds.height === 0)
    return { visibility: "hidden", reason: "offscreen", work: work() };
  // Bound input scans too; a scene cannot hide unbounded work behind empty rectangles.
  if (maxRectangles === 0 || scene.above.length + scene.outputs.length > maxOperations)
    return unknown("budget");
  let onOutput = false,
    uncertainOutputBounds = false;
  for (const output of scene.outputs) {
    if (!take()) return unknown("budget");
    if (!validRect(output.bounds)) uncertainOutputBounds = true;
    else if (intersection(subject.bounds, output.bounds)) onOutput = true;
  }
  if (!onOutput)
    return uncertainOutputBounds
      ? unknown("geometry")
      : { visibility: "hidden", reason: "offscreen", work: work() };
  for (const layer of scene.above) {
    if (!take()) return unknown("budget");
    if (layer.kind === "unknown" || !validRect(layer.bounds) || !validOpaqueRegion(layer))
      return unknown("geometry");
  }

  const subtract = (
    initial: VisibilityRect,
    opaqueOnly: boolean,
  ): readonly VisibilityRect[] | null => {
    let remaining: readonly VisibilityRect[] = [initial];
    peakRectangles = Math.max(peakRectangles, 1);
    for (const layer of scene.above) {
      if (!take()) return null;
      // Unknown geometry was excluded above. Keep the variant narrow without casts.
      if (layer.kind !== "rect") continue;
      const cut = opaqueOnly ? opaqueRegion(layer) : layer.bounds;
      if (!cut) continue;
      const next: VisibilityRect[] = [];
      const append = (rect: VisibilityRect): boolean => {
        if (next.length >= maxRectangles) return false;
        next.push(rect);
        peakRectangles = Math.max(peakRectangles, next.length);
        return true;
      };
      for (const rect of remaining) {
        if (!take()) return null;
        const overlap = intersection(rect, cut);
        if (!overlap) {
          if (!append(rect)) return null;
        } else {
          const right = rect.x + rect.width,
            bottom = rect.y + rect.height;
          const cutRight = overlap.x + overlap.width,
            cutBottom = overlap.y + overlap.height;
          if (
            overlap.y > rect.y &&
            !append({ x: rect.x, y: rect.y, width: rect.width, height: overlap.y - rect.y })
          )
            return null;
          if (
            cutBottom < bottom &&
            !append({ x: rect.x, y: cutBottom, width: rect.width, height: bottom - cutBottom })
          )
            return null;
          if (
            overlap.x > rect.x &&
            !append({ x: rect.x, y: overlap.y, width: overlap.x - rect.x, height: overlap.height })
          )
            return null;
          if (
            cutRight < right &&
            !append({ x: cutRight, y: overlap.y, width: right - cutRight, height: overlap.height })
          )
            return null;
        }
      }
      remaining = next;
      if (remaining.length === 0) break;
    }
    return remaining;
  };

  let intersectsOutput = false;
  let uncertainty: Extract<SurfaceVisibilityResult, { visibility: "unknown" }>["reason"] | null =
    null;
  for (const [outputIndex, output] of scene.outputs.entries()) {
    if (!take()) return unknown("budget");
    if (!validRect(output.bounds)) {
      uncertainty = "geometry";
      continue;
    }
    const clipped = intersection(subject.bounds, output.bounds);
    if (!clipped) continue;
    intersectsOutput = true;
    if (output.state !== "usable") {
      uncertainty = "output-unresolved";
      continue;
    }
    const guaranteed = opaqueRegion(subject);
    const inner = guaranteed ? intersection(guaranteed, output.bounds) : null;
    if (inner) {
      const possible = subtract(inner, false);
      if (!possible) return unknown("budget");
      const witness = possible[0];
      if (witness) return { visibility: "visible", witness, outputIndex, work: work() };
    }
    // Possible ARGB coverage cannot prove hidden; only opaque union subtraction can.
    const unoccluded = subtract(clipped, true);
    if (!unoccluded) return unknown("budget");
    if (unoccluded.length > 0) uncertainty = guaranteed ? "coverage" : "subject-opacity";
  }
  return uncertainty
    ? unknown(uncertainty)
    : {
        visibility: "hidden",
        reason: intersectsOutput ? "covered" : "offscreen",
        work: work(),
      };
}

/** One full-coverage strip, independent of the transparent rounded corner squares. */
function roundedOpaqueRegion(
  shape: WindowContentShape,
  possible: VisibilityRect,
): VisibilityRect | undefined {
  const [tl, tr, br, bl] = shape.radii;
  const left = Math.ceil(Math.max(tl, bl)),
    right = Math.ceil(Math.max(tr, br)),
    top = Math.ceil(Math.max(tl, tr)),
    bottom = Math.ceil(Math.max(bl, br));
  const frame = shape.bounds;
  const vertical = intersection(possible, {
    x: frame.x + left,
    y: frame.y,
    width: Math.max(0, frame.width - left - right),
    height: frame.height,
  });
  const horizontal = intersection(possible, {
    x: frame.x,
    y: frame.y + top,
    width: frame.width,
    height: Math.max(0, frame.height - top - bottom),
  });
  if (!vertical) return horizontal ?? undefined;
  if (!horizontal) return vertical;
  return vertical.width * vertical.height >= horizontal.width * horizontal.height
    ? vertical
    : horizontal;
}

/** Paint metadata only: never touch source.pixels (GPU sources may read back lazily). */
export function compositionVisibilityLayer(
  layer: CompositionLayer,
  opaqueSource: boolean,
): SurfaceVisibilityLayer {
  if (layer.transform || layer.mesh || layer.sourceRect || layer.effects?.length) {
    return { kind: "unknown" };
  }
  let bounds: VisibilityRect = layer.destination;
  if (!validRect(bounds)) return { kind: "unknown" };
  const shape = layer.contentShape;
  const opaqueMaterial = opaqueSource && (layer.opacity ?? 1) === 1 && !layer.cornerRadius;
  const rounded = shape?.radii.some((radius) => radius > 0) ?? false;
  const opaque = opaqueMaterial && !rounded;
  if (shape) {
    if (
      !validRect(shape.bounds) ||
      shape.radii.some(
        (r) =>
          !Number.isFinite(r) ||
          r < 0 ||
          r > 64 ||
          r > shape.bounds.width / 2 ||
          r > shape.bounds.height / 2,
      )
    )
      return { kind: "unknown" };
    // Only ARGB client shadows may remain outside the actual frame.
    if (opaqueSource || shape.outside === "discard")
      bounds = intersection(bounds, shape.bounds) ?? { ...bounds, width: 0, height: 0 };
  } else if (layer.surfaceGeometry && opaque) {
    // The renderer drops opaque padding outside xdg geometry. Nearest sampling
    // uses floor(sourceCoord), so ceil projects its half-open source edges.
    const source = layer.source;
    const geom = layer.surfaceGeometry;
    if (
      layer.sampling !== "nearest" ||
      !validRect(geom) ||
      !Number.isSafeInteger(source.width) ||
      source.width < 1 ||
      !Number.isSafeInteger(source.height) ||
      source.height < 1
    )
      return { kind: "unknown" };
    // CPU floor sampling and GPU pixel-centre sampling differ at scaled mask
    // edges. Until a common mask contract exists, retain the possible full box.
    if (source.width !== bounds.width || source.height !== bounds.height) {
      return { kind: "rect", bounds, coverage: "unknown" };
    }
    const x0 = Math.ceil(
      (Math.max(0, Math.min(source.width, geom.x)) * bounds.width) / source.width,
    );
    const x1 = Math.ceil(
      (Math.max(0, Math.min(source.width, geom.x + geom.width)) * bounds.width) / source.width,
    );
    const y0 = Math.ceil(
      (Math.max(0, Math.min(source.height, geom.y)) * bounds.height) / source.height,
    );
    const y1 = Math.ceil(
      (Math.max(0, Math.min(source.height, geom.y + geom.height)) * bounds.height) / source.height,
    );
    bounds = { x: bounds.x + x0, y: bounds.y + y0, width: x1 - x0, height: y1 - y0 };
  }
  if (layer.clip) {
    if (!validRect(layer.clip)) return { kind: "unknown" };
    bounds = intersection(bounds, layer.clip) ?? { ...bounds, width: 0, height: 0 };
  }
  if (opaque) return { kind: "rect", bounds, coverage: "opaque" };
  const region =
    shape && rounded && opaqueMaterial ? roundedOpaqueRegion(shape, bounds) : undefined;
  return {
    kind: "rect",
    bounds,
    coverage: "unknown",
    ...(region ? { opaqueRegion: region } : {}),
  };
}
