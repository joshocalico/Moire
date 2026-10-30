/**
 * Moire design tokens + wallpaper — single source of truth for shell + compositor.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resizeImage } from "@moire/file-formats/image";
import { parseThemeFamily, type ThemeFamily } from "./families";
export {
  windowControlLayout,
  applyThemeFamily,
  parseThemeFamily,
  THEME_FAMILIES,
  THEME_FAMILY_LABELS,
} from "./families";
export type { ThemeFamily } from "./families";
export { windowChrome } from "./window-chrome";
export {
  createWallpaperImageLoader,
  loadImageFile,
  type WallpaperImageLoader,
} from "./wallpaper-image";

export type MoireTokens = {
  bg: string;
  panel: string;
  titlebar: string;
  titlebarInactive: string;
  accent: string;
  accentLine: string;
  text: string;
  muted: string;
  danger: string;
  surface: string;
  hover: string;
  pressed: string;
  focusRing: string;
  selection: string;
  border: string;
  borderSubtle: string;
  overlay: string;
  rimLight: string;
  rimShade: string;
  radiusSm: number;
  radiusMd: number;
  radiusLg: number;
  radiusWindow: number;
  titlebarHeight: number;
  panelHeight: number;
};

export type WallpaperSolid = { mode: "solid"; color?: string };
export type WallpaperGradient = {
  mode: "gradient";
  from: string;
  to: string;
  mid?: string;
  midAt?: number;
};
export type WallpaperImage = {
  mode: "image";
  path: string;
  fit?: "cover" | "contain" | "fill";
  vignette?: number;
};
export type WallpaperAtmosphere = {
  mode: "atmosphere";
  from?: string;
  to?: string;
  accent?: string;
};
export type WallpaperSpec =
  | WallpaperSolid
  | WallpaperGradient
  | WallpaperImage
  | WallpaperAtmosphere;

export type MoireTheme = {
  name: string;
  family?: ThemeFamily;
  version: string;
  gtkTheme: string;
  tokens: MoireTokens;
  wallpaper: WallpaperSpec;
};

export const TYPE_ROLES = {
  display: { size: 22, weight: "bold" as const },
  title: { size: 15, weight: "medium" as const },
  body: { size: 13, weight: "regular" as const },
  caption: { size: 11, weight: "regular" as const },
  mono: { size: 12, weight: "regular" as const },
};

export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

/** Shared bounds for the painted panel and its compositor backdrop material. */
export function panelGeometry(screenW: number, screenH: number, theme = getTheme()) {
  const floating = theme.family === "cupertino" || theme.family === "moire" || !theme.family;
  const height = Math.max(theme.tokens.panelHeight, 46) - (floating ? 6 : 0);
  const width = floating
    ? Math.max(1, Math.min(screenW - 24, theme.family === "cupertino" ? 820 : screenW))
    : screenW;
  return {
    x: Math.floor((screenW - width) / 2),
    y: screenH - height - (floating ? 6 : 0),
    width,
    height,
    radius: floating ? 14 : 0,
  };
}

const DEFAULT_TOKENS: MoireTokens = {
  bg: "#14181c",
  panel: "#1e2329",
  titlebar: "#252b32",
  titlebarInactive: "#1a1e24",
  accent: "#7ec8d4",
  accentLine: "#2a8a9a",
  text: "#eef2f5",
  muted: "#8b949e",
  danger: "#c45c5c",
  surface: "#2c333c",
  hover: "#2a323c",
  pressed: "#222830",
  focusRing: "#7ec8d4",
  selection: "#2a8a9a66",
  border: "#3a4450",
  borderSubtle: "#2a323c",
  overlay: "#0a0c0ee6",
  rimLight: "#ffffff18",
  rimShade: "#00000040",
  radiusSm: 4,
  radiusMd: 8,
  radiusLg: 12,
  radiusWindow: 10,
  titlebarHeight: 34,
  panelHeight: 48,
};

const DEFAULT_WALLPAPER: WallpaperAtmosphere = { mode: "atmosphere" };

/**
 * Parse `#RRGGBB`, `#AARRGGBB`, or `#RRGGBBAA` → ARGB uint.
 * 8-digit colors are treated as RRGGBBAA (alpha at end).
 */
export function hexToArgb(hex: string, alpha = 0xff): number {
  const h = hex.trim().replace(/^#/, "");
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return (((alpha & 0xff) << 24) | (r << 16) | (g << 8) | b) >>> 0;
  }
  if (h.length === 8) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    const a = parseInt(h.slice(6, 8), 16);
    return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
  }
  throw new Error(`invalid hex color: ${hex}`);
}

export function argbChannels(c: number): {
  a: number;
  r: number;
  g: number;
  b: number;
} {
  return {
    a: (c >>> 24) & 0xff,
    r: (c >>> 16) & 0xff,
    g: (c >>> 8) & 0xff,
    b: c & 0xff,
  };
}

function lerpByte(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t) & 0xff;
}

export function fillVerticalGradient(
  fb: Uint32Array,
  pitchPx: number,
  width: number,
  height: number,
  fromArgb: number,
  toArgb: number,
  midArgb?: number,
  midAt = 0.5,
): void {
  const a = argbChannels(fromArgb);
  const c = argbChannels(toArgb);
  const m = midArgb != null ? argbChannels(midArgb) : null;
  const mid = Math.min(1, Math.max(0, midAt));

  for (let y = 0; y < height; y++) {
    const t = height <= 1 ? 0 : y / (height - 1);
    let r: number;
    let g: number;
    let b: number;
    let al: number;
    if (m && t < mid) {
      const u = mid <= 0 ? 0 : t / mid;
      r = lerpByte(a.r, m.r, u);
      g = lerpByte(a.g, m.g, u);
      b = lerpByte(a.b, m.b, u);
      al = lerpByte(a.a, m.a, u);
    } else if (m) {
      const u = mid >= 1 ? 1 : (t - mid) / (1 - mid);
      r = lerpByte(m.r, c.r, u);
      g = lerpByte(m.g, c.g, u);
      b = lerpByte(m.b, c.b, u);
      al = lerpByte(m.a, c.a, u);
    } else {
      r = lerpByte(a.r, c.r, t);
      g = lerpByte(a.g, c.g, t);
      b = lerpByte(a.b, c.b, t);
      al = lerpByte(a.a, c.a, t);
    }
    const pixel = ((al << 24) | (r << 16) | (g << 8) | b) >>> 0;
    const row = y * pitchPx;
    fb.fill(pixel, row, row + width);
  }
}

function addBlob(
  fb: Uint32Array,
  pitchPx: number,
  width: number,
  height: number,
  cx: number,
  cy: number,
  radius: number,
  color: number,
  strength: number,
): void {
  const ch = argbChannels(color);
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(width, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(height, Math.ceil(cy + radius));
  for (let y = y0; y < y1; y++) {
    const dy = y - cy;
    for (let x = x0; x < x1; x++) {
      const dx = x - cx;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const t = 1 - d2 / r2;
      const fall = t * t * strength;
      const i = y * pitchPx + x;
      const dst = argbChannels(fb[i]!);
      const a = Math.min(255, fall * 255);
      const inv = 1 - a / 255;
      const r = (ch.r * (a / 255) + dst.r * inv) | 0;
      const g = (ch.g * (a / 255) + dst.g * inv) | 0;
      const b = (ch.b * (a / 255) + dst.b * inv) | 0;
      fb[i] = (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;
    }
  }
}

function hash2(x: number, y: number): number {
  let n = x * 374761393 + y * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967295;
}

export function paintAtmosphere(
  fb: Uint32Array,
  pitchPx: number,
  width: number,
  height: number,
  theme: MoireTheme,
  phase = 0,
): void {
  const t = theme.tokens;
  fillVerticalGradient(
    fb,
    pitchPx,
    width,
    height,
    hexToArgb(t.bg),
    hexToArgb(t.accentLine),
    hexToArgb("#152028"),
    0.62,
  );

  const drift = phase * Math.PI * 2;
  addBlob(
    fb,
    pitchPx,
    width,
    height,
    width * (0.28 + 0.04 * Math.sin(drift)),
    height * (0.35 + 0.05 * Math.cos(drift * 0.7)),
    Math.max(width, height) * 0.45,
    hexToArgb(t.accent),
    0.22,
  );
  addBlob(
    fb,
    pitchPx,
    width,
    height,
    width * (0.78 + 0.03 * Math.cos(drift * 0.9)),
    height * (0.7 + 0.04 * Math.sin(drift)),
    Math.max(width, height) * 0.4,
    hexToArgb(t.accentLine),
    0.28,
  );
  addBlob(
    fb,
    pitchPx,
    width,
    height,
    width * 0.55,
    height * (0.15 + 0.03 * Math.sin(drift * 1.3)),
    Math.max(width, height) * 0.25,
    hexToArgb("#9ad4e0"),
    0.12,
  );

  for (let y = 0; y < height; y++) {
    const vy = (y / Math.max(1, height - 1)) * 2 - 1;
    for (let x = 0; x < width; x++) {
      const vx = (x / Math.max(1, width - 1)) * 2 - 1;
      const vig = Math.min(1, vx * vx * 0.55 + vy * vy * 0.7);
      const grain = (hash2(x, y) - 0.5) * 10;
      const i = y * pitchPx + x;
      const c = argbChannels(fb[i]!);
      let r = c.r + grain;
      let g = c.g + grain;
      let b = c.b + grain;
      r *= 1 - vig * 0.45;
      g *= 1 - vig * 0.45;
      b *= 1 - vig * 0.4;
      fb[i] =
        (0xff000000 |
          (Math.max(0, Math.min(255, r | 0)) << 16) |
          (Math.max(0, Math.min(255, g | 0)) << 8) |
          Math.max(0, Math.min(255, b | 0))) >>>
        0;
    }
  }
}

export type WallpaperCache = {
  width: number;
  height: number;
  pitchPx: number;
  pixels: Uint32Array;
  key: string;
};

let wallpaperCache: WallpaperCache | null = null;

export function invalidateWallpaperCache(): void {
  wallpaperCache = null;
}

export type ImagePixels = { rgba: Uint8Array; width: number; height: number };
let wallpaperImagePixels: ImagePixels | null = null;
let wallpaperPixelsRevision = 0;

/**
 * The picture scaled down to each output's size, by `width×height|fit`. Downscaling averages
 * every source pixel (a 24 MP photo nearest-sampled to 1080p shimmers and aliases), so it runs
 * once per output size rather than per paint; a few entries cover a multi-monitor setup.
 */
const fittedWallpapers = new Map<string, ImagePixels>();
const MAX_FITTED_WALLPAPERS = 4;

/** The decoded wallpaper picture; null paints the theme gradient alone. */
export function setWallpaperImagePixels(img: ImagePixels | null): void {
  wallpaperImagePixels = img;
  wallpaperPixelsRevision++;
  fittedWallpapers.clear();
  invalidateWallpaperCache();
}

/** Changes whenever the picture does; retained wallpaper layers include it in their keys. */
export function wallpaperImageRevision(): number {
  return wallpaperPixelsRevision;
}

/** `img` at its on-screen size when that is smaller, from the cache. */
function fittedWallpaper(
  img: ImagePixels,
  width: number,
  height: number,
  key: string,
): ImagePixels {
  if (width >= img.width && height >= img.height) return img;
  const hit = fittedWallpapers.get(key);
  if (hit) return hit;
  const fitted = resizeImage(img, Math.min(img.width, width), Math.min(img.height, height));
  if (fittedWallpapers.size >= MAX_FITTED_WALLPAPERS)
    fittedWallpapers.delete(fittedWallpapers.keys().next().value!);
  fittedWallpapers.set(key, fitted);
  return fitted;
}

/** How many fitted copies are cached (for smokes). */
export function fittedWallpaperCount(): number {
  return fittedWallpapers.size;
}

function blitImageCover(
  fb: Uint32Array,
  pitchPx: number,
  width: number,
  height: number,
  source: ImagePixels,
  fit: "cover" | "contain" | "fill",
  vignette: number,
): void {
  let scaleX = width / source.width;
  let scaleY = height / source.height;
  if (fit === "cover") {
    const s = Math.max(scaleX, scaleY);
    scaleX = s;
    scaleY = s;
  } else if (fit === "contain") {
    const s = Math.min(scaleX, scaleY);
    scaleX = s;
    scaleY = s;
  }
  // The picture's size on screen; a larger source is averaged down to it once, then sampled ~1:1.
  const drawnWidth = source.width * scaleX;
  const drawnHeight = source.height * scaleY;
  const img = fittedWallpaper(
    source,
    Math.max(1, Math.round(drawnWidth)),
    Math.max(1, Math.round(drawnHeight)),
    `${width}x${height}|${fit}`,
  );
  const sw = img.width;
  const sh = img.height;
  scaleX = drawnWidth / sw;
  scaleY = drawnHeight / sh;
  const ox = (width - drawnWidth) / 2;
  const oy = (height - drawnHeight) / 2;
  for (let y = 0; y < height; y++) {
    const sy = Math.floor((y - oy) / scaleY);
    for (let x = 0; x < width; x++) {
      const sx = Math.floor((x - ox) / scaleX);
      let r = 0;
      let g = 0;
      let b = 0;
      if (sx >= 0 && sy >= 0 && sx < sw && sy < sh) {
        const si = (sy * sw + sx) * 4;
        r = img.rgba[si]!;
        g = img.rgba[si + 1]!;
        b = img.rgba[si + 2]!;
      }
      if (vignette > 0) {
        const vx = (x / Math.max(1, width - 1)) * 2 - 1;
        const vy = (y / Math.max(1, height - 1)) * 2 - 1;
        const vig = Math.min(1, vx * vx * 0.5 + vy * vy * 0.65) * vignette;
        r = (r * (1 - vig)) | 0;
        g = (g * (1 - vig)) | 0;
        b = (b * (1 - vig)) | 0;
      }
      fb[y * pitchPx + x] = (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;
    }
  }
}

function wallpaperKey(theme: MoireTheme, w: number, h: number, phaseBucket: number): string {
  return `${theme.name}|${theme.wallpaper.mode}|${w}x${h}|${phaseBucket}|${wallpaperPixelsRevision}|${JSON.stringify(theme.wallpaper)}`;
}

export function paintWallpaper(
  fb: Uint32Array,
  pitchPx: number,
  width: number,
  height: number,
  theme: MoireTheme,
  phase = 0,
): void {
  const phaseBucket = Math.floor(phase * 20);
  const key = wallpaperKey(theme, width, height, phaseBucket);
  if (
    wallpaperCache &&
    wallpaperCache.key === key &&
    wallpaperCache.width === width &&
    wallpaperCache.height === height
  ) {
    const src = wallpaperCache.pixels;
    if (pitchPx === width) {
      fb.set(src);
    } else {
      for (let y = 0; y < height; y++) {
        fb.set(src.subarray(y * width, y * width + width), y * pitchPx);
      }
    }
    return;
  }

  const wp = theme.wallpaper;
  if (wp.mode === "solid") {
    const color = hexToArgb(wp.color ?? theme.tokens.bg);
    if (pitchPx === width) fb.fill(color, 0, width * height);
    else {
      for (let y = 0; y < height; y++) {
        fb.fill(color, y * pitchPx, y * pitchPx + width);
      }
    }
  } else if (wp.mode === "gradient") {
    fillVerticalGradient(
      fb,
      pitchPx,
      width,
      height,
      hexToArgb(wp.from),
      hexToArgb(wp.to),
      wp.mid ? hexToArgb(wp.mid) : undefined,
      wp.midAt ?? 0.5,
    );
  } else if (wp.mode === "image") {
    fillVerticalGradient(
      fb,
      pitchPx,
      width,
      height,
      hexToArgb(theme.tokens.bg),
      hexToArgb(theme.tokens.accentLine),
      hexToArgb(theme.tokens.panel),
      0.55,
    );
    if (wallpaperImagePixels) {
      blitImageCover(
        fb,
        pitchPx,
        width,
        height,
        wallpaperImagePixels,
        wp.fit ?? "cover",
        wp.vignette ?? 0.35,
      );
    }
  } else {
    paintAtmosphere(fb, pitchPx, width, height, theme, phase);
  }

  const copy = new Uint32Array(width * height);
  for (let y = 0; y < height; y++) {
    copy.set(fb.subarray(y * pitchPx, y * pitchPx + width), y * width);
  }
  wallpaperCache = { width, height, pitchPx: width, pixels: copy, key };
}

function defaultThemePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../../themes/default/theme.json");
}

export function resolveThemePath(explicit?: string): string {
  if (explicit) return path.resolve(explicit);
  if (process.env.MOIRE_THEME) return path.resolve(process.env.MOIRE_THEME);
  return defaultThemePath();
}

export function loadTheme(themePath?: string): MoireTheme {
  const file = resolveThemePath(themePath);
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch (err) {
    console.warn(`[theme] failed to read ${file}, using builtins:`, err);
  }
  const tok = (raw.tokens ?? {}) as Partial<MoireTokens>;
  const tokens: MoireTokens = { ...DEFAULT_TOKENS, ...tok };
  let wallpaper: WallpaperSpec = DEFAULT_WALLPAPER;
  const wp = raw.wallpaper as WallpaperSpec | undefined;
  if (wp && typeof wp === "object" && "mode" in wp) {
    wallpaper =
      wp.mode === "image" ? { ...wp, path: path.resolve(path.dirname(file), wp.path) } : wp;
  }
  invalidateWallpaperCache();
  return {
    name: String(raw.name ?? "moire-default"),
    family: parseThemeFamily(raw.family),
    version: String(raw.version ?? "0.0.0"),
    gtkTheme: String(raw.gtkTheme ?? "Moire"),
    tokens,
    wallpaper,
  };
}

let cached: MoireTheme | null = null;

export function getTheme(): MoireTheme {
  if (!cached) cached = loadTheme();
  return cached;
}

export function setTheme(theme: MoireTheme): void {
  cached = theme;
  invalidateWallpaperCache();
}

export type ThemePalette = {
  bg: number;
  panel: number;
  titlebar: number;
  titlebarInactive: number;
  accent: number;
  accentLine: number;
  text: number;
  muted: number;
  danger: number;
  surface: number;
  hover: number;
  pressed: number;
  focusRing: number;
  selection: number;
  border: number;
  borderSubtle: number;
  overlay: number;
  rimLight: number;
  rimShade: number;
  radiusSm: number;
  radiusMd: number;
  radiusLg: number;
  radiusWindow: number;
  titlebarHeight: number;
  panelHeight: number;
};

export function themePalette(theme: MoireTheme = getTheme()): ThemePalette {
  const t = theme.tokens;
  return {
    bg: hexToArgb(t.bg),
    panel: hexToArgb(t.panel),
    titlebar: hexToArgb(t.titlebar),
    titlebarInactive: hexToArgb(t.titlebarInactive),
    accent: hexToArgb(t.accent),
    accentLine: hexToArgb(t.accentLine),
    text: hexToArgb(t.text),
    muted: hexToArgb(t.muted),
    danger: hexToArgb(t.danger),
    surface: hexToArgb(t.surface),
    hover: hexToArgb(t.hover),
    pressed: hexToArgb(t.pressed),
    focusRing: hexToArgb(t.focusRing),
    selection: hexToArgb(t.selection),
    border: hexToArgb(t.border),
    borderSubtle: hexToArgb(t.borderSubtle),
    overlay: hexToArgb(t.overlay),
    rimLight: hexToArgb(t.rimLight),
    rimShade: hexToArgb(t.rimShade),
    radiusSm: t.radiusSm,
    radiusMd: t.radiusMd,
    radiusLg: t.radiusLg,
    radiusWindow: t.radiusWindow,
    titlebarHeight: t.titlebarHeight,
    panelHeight: t.panelHeight,
  };
}
