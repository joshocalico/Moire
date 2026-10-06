/** Deterministic decorative artwork. Coordinates are normalized to the backdrop viewport. */
export type SilkVariant = "greeter" | "fold-e";
export type SilkPalette = Readonly<{
  background: number;
  filament: number;
  highlight: number;
}>;
export type SilkPoint = Readonly<{ x: number; y: number }>;
export type SilkFilament = Readonly<{
  points: readonly SilkPoint[];
  brightness: number;
  edge: boolean;
}>;
export type SilkBackdropSource = Readonly<{
  variant: SilkVariant;
  background: number;
  /** Caller-owned pixels: retain their identity and never mutate them after publication. */
  image: Readonly<{ rgba: Uint8Array; width: number; height: number }>;
  metrics: Readonly<{ filaments: number; segments: number; bytes: number }>;
}>;
export type SilkBackdropOptions = {
  variant: SilkVariant;
  palette?: SilkPalette;
  seed?: number;
  resolution?: "standard" | "high";
};

export const SILK_LIMITS = Object.freeze({ filaments: 512, segmentsPerFilament: 192 });
export const SILK_PALETTES: Readonly<Record<SilkVariant, SilkPalette>> = Object.freeze({
  greeter: Object.freeze({ background: 0xff090d17, filament: 0xff7e65bb, highlight: 0xffedc3b4 }),
  "fold-e": Object.freeze({ background: 0xff080a10, filament: 0xff8a71c0, highlight: 0xffffdfbf }),
});

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}
function noise(seed: number, index: number): number {
  let value = (seed | 0) ^ Math.imul(index + 1, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
}
function illuminatedColor(base: number, highlight: number, amount: number): number {
  const channel = (shift: number) =>
    Math.round(((base >>> shift) & 255) * (1 - amount) + ((highlight >>> shift) & 255) * amount);
  return (0xff000000 | (channel(16) << 16) | (channel(8) << 8) | channel(0)) >>> 0;
}

function foldFrame(t: number) {
  const bezier = (a: number, b: number, c: number, d: number, u: number) =>
    (1 - u) ** 3 * a + 3 * (1 - u) ** 2 * u * b + 3 * (1 - u) * u * u * c + u ** 3 * d;
  let center: SilkPoint;
  let normalX: number, normalY: number, bank: number;
  if (t < 0.32) {
    const u = t / 0.32;
    center = { x: bezier(-0.18, 0.22, 0.49, 0.76, u), y: bezier(1.18, 1.11, 0.66, 0.66, u) };
    const dx = 1.6 * (3 * (1 - u) ** 2 * 0.4 + 6 * (1 - u) * u * 0.27 + 3 * u * u * 0.27);
    const dy = 3 * (1 - u) ** 2 * -0.07 + 6 * (1 - u) * u * -0.45;
    const length = Math.hypot(dx, dy);
    normalX = -dy / length;
    normalY = dx / length;
    bank = -0.8 + u * 0.5;
  } else if (t < 0.84) {
    const u = (t - 0.32) / 0.52;
    const theta = Math.PI / 2 - u * Math.PI * 2;
    center = { x: 0.76 + 0.23 * Math.cos(theta), y: 0.4 + 0.26 * Math.sin(theta) };
    const nx = Math.cos(theta) / (0.23 * 1.6),
      ny = Math.sin(theta) / 0.26;
    const length = Math.hypot(nx, ny);
    normalX = nx / length;
    normalY = ny / length;
    bank = -0.3 + u * 3.6;
  } else {
    const u = (t - 0.84) / 0.16;
    center = { x: bezier(0.76, 1.04, 0.89, 1.15, u), y: bezier(0.66, 0.66, 0.06, -0.24, u) };
    const dx = 1.6 * (3 * (1 - u) ** 2 * 0.28 + 6 * (1 - u) * u * -0.15 + 3 * u * u * 0.26);
    const dy = 6 * (1 - u) * u * -0.6 + 3 * u * u * -0.3;
    const length = Math.hypot(dx, dy);
    normalX = -dy / length;
    normalY = dx / length;
    bank = 3.3 + u * 2.0;
  }
  const width = 0.18 + 0.025 * Math.sin(t * Math.PI);
  return {
    center,
    dx: (width * normalX * Math.cos(bank)) / 1.6,
    dy: width * normalY * Math.cos(bank),
    dz: width * Math.sin(bank),
    arch: 0.02 * Math.sin(t * 8),
    warp: Math.sin(t * Math.PI) * Math.sin(t * 7.8),
  };
}

/** Fixed work independent of output size; no noise changes between frames. */
export function silkGeometry(variant: SilkVariant, seed = 0): readonly SilkFilament[] {
  const filaments: SilkFilament[] = [];
  const foldFrames =
    variant === "fold-e"
      ? Array.from({ length: SILK_LIMITS.segmentsPerFilament + 1 }, (_, segment) => {
          const t = segment / SILK_LIMITS.segmentsPerFilament;
          return foldFrame(t);
        })
      : [];
  for (let index = 0; index < SILK_LIMITS.filaments; index++) {
    const u = index / (SILK_LIMITS.filaments - 1);
    const jitter = (noise(seed, index) - 0.5) * 0.0018;
    const points: SilkPoint[] = [];
    for (let segment = 0; segment <= SILK_LIMITS.segmentsPerFilament; segment++) {
      const t = segment / SILK_LIMITS.segmentsPerFilament;
      if (variant === "greeter") {
        const x = -0.08 + t * 1.16;
        const v = u * 1.5 - 0.75;
        const bend = Math.exp(-Math.pow((x - 0.8) / 0.3, 2));
        const ridge = 0.35 * Math.cos(x * 6.3) + 0.25;
        points.push({
          x,
          y:
            1.15 -
            0.9 * x +
            v * 0.9 +
            0.19 * Math.sin(x * 6.3 + v * 1.2) -
            0.125 * bend * Math.tanh(7 * (v - ridge)) +
            0.06 * bend * Math.sin(x * 11 + v * 1.3) +
            jitter,
        });
      } else {
        // A smooth oval coil, projected depth and staggered strands keep curved ridges.
        const frame = foldFrames[segment]!;
        const across = u * 2 - 1 + jitter;
        const sample = Math.max(0, Math.min(1, t + 0.065 * across * frame.warp));
        const sampleIndex = sample * SILK_LIMITS.segmentsPerFilament;
        const before = foldFrames[Math.floor(sampleIndex)]!;
        const after =
          foldFrames[Math.min(SILK_LIMITS.segmentsPerFilament, Math.floor(sampleIndex) + 1)]!;
        const fraction = sampleIndex - Math.floor(sampleIndex);
        const mix = (a: number, b: number) => a + (b - a) * fraction;
        const projection = 1 / (1 + mix(before.dz, after.dz) * across);
        const center = {
          x: mix(before.center.x, after.center.x),
          y: mix(before.center.y, after.center.y),
        };
        points.push({
          x:
            0.74 +
            (center.x -
              0.74 +
              mix(before.dx, after.dx) * across +
              frame.arch * 0.25 * (1 - across * across)) *
              projection,
          y:
            0.42 +
            (center.y -
              0.42 +
              mix(before.dy, after.dy) * across +
              frame.arch * (1 - across * across)) *
              projection,
        });
      }
    }
    filaments.push({
      points,
      brightness:
        (index % 4 === 0 || index === SILK_LIMITS.filaments - 1 ? 1 : 0.3) *
        (0.75 + noise(seed + 17, index) * 0.25),
      edge: index === 0 || index === SILK_LIMITS.filaments - 1,
    });
  }
  return filaments;
}

function blend(
  pixels: Uint8Array,
  offset: number,
  r: number,
  g: number,
  b: number,
  alpha: number,
): void {
  if (alpha <= 0) return;
  const oldAlpha = pixels[offset + 3]! / 255;
  const remaining = oldAlpha * (1 - alpha);
  const nextAlpha = alpha + remaining;
  pixels[offset] = (r * alpha + pixels[offset]! * remaining) / nextAlpha;
  pixels[offset + 1] = (g * alpha + pixels[offset + 1]! * remaining) / nextAlpha;
  pixels[offset + 2] = (b * alpha + pixels[offset + 2]! * remaining) / nextAlpha;
  pixels[offset + 3] = Math.round(nextAlpha * 255);
}

function strokeSegment(
  pixels: Uint8Array,
  width: number,
  height: number,
  from: SilkPoint,
  to: SilkPoint,
  color: number,
  thickness: number,
  alpha: number,
  quietMask: Float32Array | undefined,
): void {
  const ax = from.x * width;
  const ay = from.y * height;
  const dx = (to.x - from.x) * width;
  const dy = (to.y - from.y) * height;
  const squaredLength = dx * dx + dy * dy;
  if (squaredLength <= 0) return;
  const inverseLength = 1 / Math.sqrt(squaredLength);
  const radius = thickness / 2;
  const pad = radius + 0.5;
  const left = Math.max(0, Math.floor(Math.min(ax, ax + dx) - pad));
  const right = Math.min(width - 1, Math.ceil(Math.max(ax, ax + dx) + pad));
  const top = Math.max(0, Math.floor(Math.min(ay, ay + dy) - pad));
  const bottom = Math.min(height - 1, Math.ceil(Math.max(ay, ay + dy) + pad));
  const r = (color >>> 16) & 255;
  const g = (color >>> 8) & 255;
  const b = color & 255;
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const px = x + 0.5 - ax;
      const py = y + 0.5 - ay;
      const t = (px * dx + py * dy) / squaredLength;
      // Half-open strips prevent doubled brightness at every tessellation joint.
      if (t < 0 || t >= 1) continue;
      const distance = Math.abs(px * dy - py * dx) * inverseLength;
      const coverage = Math.max(0, Math.min(1, pad - distance));
      const quiet = quietMask?.[x] ?? 1;
      blend(pixels, (y * width + x) * 4, r, g, b, coverage * alpha * quiet);
    }
  }
}

/** No cache: the caller controls lifetime. Published buffers are never updated in place. */
export function createSilkBackdrop(options: SilkBackdropOptions): SilkBackdropSource {
  const width = options.resolution === "high" ? 1920 : 1280;
  const height = options.resolution === "high" ? 1200 : 800;
  const palette = options.palette ?? SILK_PALETTES[options.variant];
  const rgba = new Uint8Array(width * height * 4);
  const geometry = silkGeometry(options.variant, options.seed);
  const quietMask =
    options.variant === "greeter"
      ? Float32Array.from({ length: width }, (_, x) => smoothstep(0.3, 0.76, x / width))
      : undefined;
  const scale = width / 1280;
  for (let filamentIndex = 0; filamentIndex < geometry.length; filamentIndex++) {
    const filament = geometry[filamentIndex]!;
    for (let index = 1; index < filament.points.length; index++) {
      const from = filament.points[index - 1]!;
      const to = filament.points[index]!;
      const quietLeft = options.variant === "greeter";
      // The side facing the light lifts gently; dense interior strands stay translucent.
      const across = filamentIndex / (SILK_LIMITS.filaments - 1);
      const at = index / SILK_LIMITS.segmentsPerFilament;
      const ridge = 0.35 * Math.cos(from.x * 6.3) + 0.25;
      const sheen = quietLeft
        ? Math.exp(-Math.pow((across * 1.5 - 0.75 - ridge) / 0.12, 2)) *
          Math.exp(-Math.pow((from.x - 0.8) / 0.3, 2))
        : (0.5 + 0.5 * Math.cos((at - 0.62) * 9)) *
          (0.2 + 0.8 * Math.pow(Math.abs(across * 2 - 1), 3));
      const brightness =
        filament.brightness * (quietLeft ? 0.75 + sheen * 0.8 : 0.45 + sheen * 0.55);
      const color = illuminatedColor(
        palette.filament,
        palette.highlight,
        quietLeft ? 0.08 + Math.pow(sheen, 4) * 0.5 : 0.08 + Math.pow(sheen, 10) * 0.58,
      );
      strokeSegment(
        rgba,
        width,
        height,
        from,
        to,
        color,
        (quietLeft ? 2.8 : 4.2) * scale,
        (filament.edge ? 0.1 : 0.055) * brightness,
        quietMask,
      );
      strokeSegment(
        rgba,
        width,
        height,
        from,
        to,
        filament.edge && !quietLeft ? illuminatedColor(color, palette.highlight, 0.65) : color,
        (filament.edge && !quietLeft ? 1 : 0.65) * scale,
        (filament.edge && !quietLeft ? 0.68 : 0.42) * brightness,
        quietMask,
      );
    }
  }
  return Object.freeze({
    variant: options.variant,
    background: (palette.background | 0xff000000) >>> 0,
    image: Object.freeze({ rgba, width, height }),
    metrics: Object.freeze({
      filaments: SILK_LIMITS.filaments,
      segments: SILK_LIMITS.filaments * SILK_LIMITS.segmentsPerFilament,
      bytes: rgba.byteLength,
    }),
  });
}
