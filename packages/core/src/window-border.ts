import type { CompositionLayer, CompositionRect, PixelSurface } from "./composition";

export type WindowBorderStyle = { width: number; color: number; radius: number };

/** Tiny reusable sources: never allocate a transparent full-window texture. */
export class WindowBorderPainter {
  private readonly sources = new Map<string, readonly PixelSurface[]>();

  layers(
    id: string,
    z: number,
    frame: CompositionRect,
    style: WindowBorderStyle,
  ): CompositionLayer[] {
    const width = Math.round(frame.width),
      height = Math.round(frame.height);
    if (width < 2 || height < 2 || style.width <= 0) return [];
    const line = Math.min(style.width, width / 2, height / 2);
    const radius = Math.min(
      Math.max(0, Math.min(64, Math.round(style.radius))),
      Math.floor(width / 2),
      Math.floor(height / 2),
    );
    const key = `${style.color}:${line}:${radius}`;
    let sources = this.sources.get(key);
    if (!sources) {
      sources = borderSources(style.color, line, radius);
      // Sources are CPU values, not native resources. Old scenes retain their
      // own references; cache eviction cannot invalidate a submitted scene.
      if (this.sources.size >= 32) {
        const first = this.sources.keys().next().value;
        if (first !== undefined) this.sources.delete(first);
      }
      this.sources.set(key, sources);
    }
    const patches: CompositionRect[] =
      radius > 0
        ? [
            { x: radius, y: 0, width: width - 2 * radius, height: line },
            { x: radius, y: height - line, width: width - 2 * radius, height: line },
            { x: 0, y: radius, width: line, height: height - 2 * radius },
            { x: width - line, y: radius, width: line, height: height - 2 * radius },
            { x: 0, y: 0, width: radius, height: radius },
            { x: width - radius, y: 0, width: radius, height: radius },
            { x: width - radius, y: height - radius, width: radius, height: radius },
            { x: 0, y: height - radius, width: radius, height: radius },
          ]
        : [
            { x: 0, y: 0, width, height: line },
            { x: 0, y: height - line, width, height: line },
            { x: 0, y: line, width: line, height: height - 2 * line },
            { x: width - line, y: line, width: line, height: height - 2 * line },
          ];
    const layers: CompositionLayer[] = [];
    for (const [index, patch] of patches.entries()) {
      if (patch.width <= 0 || patch.height <= 0) continue;
      const source = sources[index];
      if (!source) throw new Error("Window border source missing");
      layers.push({
        id: `${id}:edge:${index}`,
        z: z + layers.length,
        source,
        destination: { ...patch, x: frame.x + patch.x, y: frame.y + patch.y },
        sampling: "nearest",
      });
    }
    return layers;
  }
}

function borderSources(color: number, line: number, radius: number): readonly PixelSurface[] {
  const source = (size: number, coverage: (x: number, y: number) => number): PixelSurface => {
    const pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const alpha = Math.round(((color >>> 24) & 255) * coverage(x, y));
        const offset = (y * size + x) * 4;
        pixels[offset] = Math.round(((color & 255) * alpha) / 255);
        pixels[offset + 1] = Math.round((((color >>> 8) & 255) * alpha) / 255);
        pixels[offset + 2] = Math.round((((color >>> 16) & 255) * alpha) / 255);
        pixels[offset + 3] = alpha;
      }
    return { pixels, width: size, height: size, stride: size * 4, revision: 1 };
  };
  const pixel = source(1, () => 1);
  if (!radius) return [pixel, pixel, pixel, pixel];
  const corners = [0, 1, 2, 3].map((corner) =>
    source(radius, (x, y) => {
      // Four samples per axis give a smooth fine ring without affecting the
      // client's interior or painting the transparent square corner.
      let inside = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const px = x + (sx + 0.5) / 4,
            py = y + (sy + 0.5) / 4;
          const dx = corner === 0 || corner === 3 ? radius - px : px;
          const dy = corner === 0 || corner === 1 ? radius - py : py;
          const distance = Math.hypot(dx, dy);
          if (distance <= radius && distance >= radius - line) inside++;
        }
      return inside / 16;
    }),
  );
  return [pixel, pixel, pixel, pixel, ...corners];
}
