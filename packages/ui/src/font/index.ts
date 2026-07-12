/**
 * Install FontEngine as the react-host text renderer.
 * Global UI scale multiplies all glyph sizes (Moire chrome + @moire/ui apps).
 */
import { setTextRenderer } from "@moire/react-host";
import {
  getFontEngine,
  getFontEngineSync,
  type FontFamily,
  type FontWeight,
  type TextStyle,
} from "./engine.js";

let uiScaleFactor = 1;

export function setUiScaleFactor(scale: number): void {
  uiScaleFactor = Math.min(2, Math.max(0.75, scale || 1));
}

export function getUiScaleFactor(): number {
  return uiScaleFactor;
}

function mapWeight(w?: string): FontWeight {
  if (w === "bold" || w === "700") return "bold";
  if (w === "medium" || w === "500" || w === "600") return "medium";
  return "regular";
}

function mapFamily(f?: string): FontFamily {
  if (f === "mono" || f === "monospace") return "mono";
  return "sans";
}

function toStyle(style?: {
  color?: number;
  scale?: number;
  fontSize?: number;
  fontWeight?: string;
  fontFamily?: string;
}): TextStyle {
  const local = style?.scale ?? 1;
  // Quantize so glyph cache stays bounded across uiScale tweaks.
  const raw = (style?.fontSize ?? 14 * local) * uiScaleFactor;
  const size = Math.round(raw * 4) / 4;
  return {
    color: style?.color,
    size,
    weight: mapWeight(style?.fontWeight),
    family: mapFamily(style?.fontFamily),
  };
}

function installRenderer(
  engine: Awaited<ReturnType<typeof getFontEngine>>,
): void {
  setTextRenderer({
    measure(text, style) {
      return engine.measure(text, toStyle(style));
    },
    draw(fb, pitchPx, fbW, fbH, x, y, text, style) {
      engine.draw(fb, pitchPx, fbW, fbH, x, y, text, toStyle(style));
    },
  });
}

export async function installUiFonts(): Promise<void> {
  const engine = await getFontEngine();
  installRenderer(engine);
}

/** Best-effort sync install if fonts already loaded. */
export function installUiFontsIfReady(): boolean {
  const engine = getFontEngineSync();
  if (!engine?.isReady()) return false;
  installRenderer(engine);
  return true;
}

export {
  FontEngine,
  getFontEngine,
  getFontEngineSync,
  type FontFamily,
  type FontWeight,
  type TextStyle,
} from "./engine.js";
