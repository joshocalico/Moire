/** Regional CPU backdrop blur for the flattened compositor path. */
export function blurBackdrop(
  pixels: Uint32Array,
  pitch: number,
  width: number,
  height: number,
  bounds: { x: number; y: number; width: number; height: number; radius: number },
  reach: number,
): void {
  const r = Math.max(1, Math.round(reach / 2));
  const x0 = Math.max(0, Math.floor(bounds.x - r * 2));
  const y0 = Math.max(0, Math.floor(bounds.y - r * 2));
  const w = Math.min(width, Math.ceil(bounds.x + bounds.width + r * 2)) - x0;
  const h = Math.min(height, Math.ceil(bounds.y + bounds.height + r * 2)) - y0;
  if (w <= 0 || h <= 0) return;
  let source = new Uint32Array(w * h);
  let target = new Uint32Array(w * h);
  for (let y = 0; y < h; y++)
    source.set(pixels.subarray((y0 + y) * pitch + x0, (y0 + y) * pitch + x0 + w), y * w);
  // Two separable box passes approximate a soft Gaussian. All reads use a
  // snapshot, so adjacent output pixels cannot feed back into the kernel.
  const kernel = r * 2 + 1;
  for (let pass = 0; pass < 4; pass++) {
    const horizontal = pass % 2 === 0;
    const lines = horizontal ? h : w;
    const length = horizontal ? w : h;
    const index = (line: number, position: number) =>
      horizontal ? line * w + position : position * w + line;
    for (let line = 0; line < lines; line++) {
      let red = 0,
        green = 0,
        blue = 0;
      const add = (position: number, sign: number) => {
        const value = source[index(line, Math.max(0, Math.min(length - 1, position)))]!;
        red += ((value >>> 16) & 255) * sign;
        green += ((value >>> 8) & 255) * sign;
        blue += (value & 255) * sign;
      };
      for (let offset = -r; offset <= r; offset++) add(offset, 1);
      for (let position = 0; position < length; position++) {
        target[index(line, position)] =
          (0xff000000 |
            (Math.round(red / kernel) << 16) |
            (Math.round(green / kernel) << 8) |
            Math.round(blue / kernel)) >>>
          0;
        add(position - r, -1);
        add(position + r + 1, 1);
      }
    }
    [source, target] = [target, source];
  }
  const radius = Math.min(bounds.radius, bounds.width / 2, bounds.height / 2);
  for (
    let y = Math.max(0, Math.ceil(bounds.y));
    y < Math.min(height, bounds.y + bounds.height);
    y++
  ) {
    for (
      let x = Math.max(0, Math.ceil(bounds.x));
      x < Math.min(width, bounds.x + bounds.width);
      x++
    ) {
      const localX = x + 0.5 - bounds.x;
      const localY = y + 0.5 - bounds.y;
      const dx = Math.max(radius - localX, 0, localX - (bounds.width - radius));
      const dy = Math.max(radius - localY, 0, localY - (bounds.height - radius));
      if (dx * dx + dy * dy > radius * radius) continue;
      pixels[y * pitch + x] = source[(y - y0) * w + x - x0]!;
    }
  }
}
