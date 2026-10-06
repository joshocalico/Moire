import type { CompositionRect, WindowContentShape } from "./composition";

/** The compositor's actual frame, not the complete client buffer or its shadows. */
export function windowContentShape(
  bounds: CompositionRect,
  radius: number,
  outside: WindowContentShape["outside"],
): WindowContentShape {
  const r = Math.max(
    0,
    Math.min(64, Math.round(radius), Math.floor(bounds.width / 2), Math.floor(bounds.height / 2)),
  );
  return { bounds, radii: [r, r, r, r], outside };
}

/** Pixel-center coverage; the EGL pass uses the same one-logical-pixel edge. */
export function contentShapeCoverage(shape: WindowContentShape, x: number, y: number): number {
  const { bounds, radii } = shape;
  const localX = x - bounds.x,
    localY = y - bounds.y;
  if (localX < 0 || localY < 0 || localX >= bounds.width || localY >= bounds.height)
    return shape.outside === "translucent-shadow" ? 1 : 0;
  const left = localX < bounds.width / 2,
    top = localY < bounds.height / 2;
  const r = radii[top ? (left ? 0 : 1) : left ? 3 : 2];
  if (r <= 0) return 1;
  if (
    !(left ? localX < r : localX > bounds.width - r) ||
    !(top ? localY < r : localY > bounds.height - r)
  )
    return 1;
  const cx = left ? r : bounds.width - r,
    cy = top ? r : bounds.height - r;
  return Math.max(0, Math.min(1, r + 0.5 - Math.hypot(localX - cx, localY - cy)));
}

/**
 * Paint-only legacy SSD adapters cannot accept a layer mask. Save only their
 * bounded corner squares and restore/blend the actual underlying scene there.
 * Normal SSD raster composition never needs this path or a framebuffer copy.
 */
export function paintShapedHeader(
  fb: Uint32Array,
  pitch: number,
  width: number,
  height: number,
  shape: WindowContentShape,
  paint: () => void,
): void {
  const { bounds, radii } = shape;
  const saved: { index: number; pixel: number; coverage: number }[] = [];
  for (const corner of [0, 1] as const) {
    const r = Math.ceil(radii[corner]);
    const x0 = Math.max(0, Math.floor(bounds.x + (corner === 0 ? 0 : bounds.width - r))),
      x1 = Math.min(width, Math.ceil(bounds.x + (corner === 0 ? r : bounds.width))),
      y0 = Math.max(0, Math.floor(bounds.y)),
      y1 = Math.min(height, Math.ceil(bounds.y + r));
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const coverage = contentShapeCoverage(shape, x + 0.5, y + 0.5);
        if (coverage < 1) saved.push({ index: y * pitch + x, pixel: fb[y * pitch + x]!, coverage });
      }
  }
  paint();
  for (const { index, pixel, coverage } of saved) {
    const next = fb[index]!;
    let result = 0;
    for (let shift = 0; shift <= 24; shift += 8)
      result |=
        Math.round(
          ((next >>> shift) & 255) * coverage + ((pixel >>> shift) & 255) * (1 - coverage),
        ) << shift;
    fb[index] = result >>> 0;
  }
}
