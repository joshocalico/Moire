/**
 * Moire design tokens + wallpaper — single source of truth for shell + compositor.
 * GTK CSS under themes/Moire/ should stay aligned with theme.json (manual for now).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  titlebarHeight: number;
  panelHeight: number;
};

export type WallpaperSolid = {
  mode: "solid";
  color?: string;
};

export type WallpaperGradient = {
  mode: "gradient";
  from: string;
  to: string;
  /** Optional mid stop (0–1). */
  mid?: string;
  midAt?: number;
};

export type WallpaperSpec = WallpaperSolid | WallpaperGradient;

export type MoireTheme = {
  name: string;
  version: string;
  gtkTheme: string;
  tokens: MoireTokens;
  wallpaper: WallpaperSpec;
};

const DEFAULT_TOKENS: MoireTokens = {
  bg: "#1a1b1e",
  panel: "#25262b",
  titlebar: "#2a2e33",
  titlebarInactive: "#1e2126",
  accent: "#74c0fc",
  accentLine: "#1a6b7a",
  text: "#f1f3f5",
  muted: "#9aa0a6",
  danger: "#a33b3b",
  surface: "#3a3f46",
  titlebarHeight: 32,
  panelHeight: 36,
};

const DEFAULT_WALLPAPER: WallpaperGradient = {
  mode: "gradient",
  from: "#0e1216",
  to: "#1a6b7a",
  mid: "#152028",
  midAt: 0.55,
};

/** Parse `#RRGGBB` or `#AARRGGBB` → `0xAARRGGBB` for the CPU rasterizer. */
export function hexToArgb(hex: string, alpha = 0xff): number {
  const h = hex.trim().replace(/^#/, "");
  if (h.length === 8) {
    const a = parseInt(h.slice(0, 2), 16);
    const r = parseInt(h.slice(2, 4), 16);
    const g = parseInt(h.slice(4, 6), 16);
    const b = parseInt(h.slice(6, 8), 16);
    return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
  }
  if (h.length !== 6) {
    throw new Error(`invalid hex color: ${hex}`);
  }
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (((alpha & 0xff) << 24) | (r << 16) | (g << 8) | b) >>> 0;
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

/** Vertical gradient into an XRGB/ARGB framebuffer (row-major Uint32). */
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

export function paintWallpaper(
  fb: Uint32Array,
  pitchPx: number,
  width: number,
  height: number,
  theme: MoireTheme,
): void {
  const wp = theme.wallpaper;
  if (wp.mode === "solid") {
    const color = hexToArgb(wp.color ?? theme.tokens.bg);
    if (pitchPx === width) {
      fb.fill(color, 0, width * height);
    } else {
      for (let y = 0; y < height; y++) {
        fb.fill(color, y * pitchPx, y * pitchPx + width);
      }
    }
    return;
  }
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
}

function defaultThemePath(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // packages/theme/src → repo themes/default/theme.json
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
    wallpaper = wp;
  }
  return {
    name: String(raw.name ?? "moire-default"),
    version: String(raw.version ?? "0.0.0"),
    gtkTheme: String(raw.gtkTheme ?? "Moire"),
    tokens,
    wallpaper,
  };
}

/** Cached theme for process lifetime (reload via loadTheme + assign). */
let cached: MoireTheme | null = null;

export function getTheme(): MoireTheme {
  if (!cached) cached = loadTheme();
  return cached;
}

export function setTheme(theme: MoireTheme): void {
  cached = theme;
}

/** Precomputed ARGB palette from tokens — convenient for shell widgets. */
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
  titlebarHeight: number;
  panelHeight: number;
};

export function themePalette(theme: MoireTheme = getTheme()): ThemePalette {
  const t = theme.tokens;
  return {
    bg: hexToArgb(t.bg),
    panel: hexToArgb(t.panel, 0xe8),
    titlebar: hexToArgb(t.titlebar),
    titlebarInactive: hexToArgb(t.titlebarInactive),
    accent: hexToArgb(t.accent),
    accentLine: hexToArgb(t.accentLine),
    text: hexToArgb(t.text),
    muted: hexToArgb(t.muted),
    danger: hexToArgb(t.danger),
    surface: hexToArgb(t.surface),
    titlebarHeight: t.titlebarHeight,
    panelHeight: t.panelHeight,
  };
}
