/** Pure colour math: HEX/RGB/HSL conversion and WCAG contrast. */
export type RGB = { r: number; g: number; b: number };
export type HSL = { h: number; s: number; l: number };

export function parseHex(value: string): RGB {
  const hex = value.trim().replace(/^#/, "");
  const expanded = /^[0-9a-f]{3}$/i.test(hex)
    ? hex
        .split("")
        .map((char) => char + char)
        .join("")
    : hex;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) throw new Error("Use a HEX color such as #BF5AF2 or #F80.");
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}

/** The colour a HEX string names, or null while it is incomplete or invalid. */
export function tryParseHex(value: string): RGB | null {
  try {
    return parseHex(value);
  } catch {
    return null;
  }
}

export function isChannel(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 255;
}

export function rgbHex(rgb: RGB): string {
  const values = [rgb.r, rgb.g, rgb.b];
  if (!values.every(isChannel))
    throw new Error("RGB channels must be whole numbers from 0 to 255.");
  return "#" + values.map((value) => value.toString(16).padStart(2, "0").toUpperCase()).join("");
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l: Math.round(l * 100) };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h =
    max === rn
      ? (gn - bn) / d + (gn < bn ? 6 : 0)
      : max === gn
        ? (bn - rn) / d + 2
        : (rn - gn) / d + 4;
  return {
    h: Math.round(h * 60) % 360,
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function formatRgb(rgb: RGB): string {
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}
export function formatHsl(rgb: RGB): string {
  const { h, s, l } = rgbToHsl(rgb);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

export type CopyFormat = "hex" | "rgb" | "hsl";
export const COPY_FORMATS: ReadonlyArray<{
  id: CopyFormat;
  label: string;
  format(rgb: RGB): string;
}> = [
  { id: "hex", label: "HEX", format: rgbHex },
  { id: "rgb", label: "RGB", format: formatRgb },
  { id: "hsl", label: "HSL", format: formatHsl },
];

/** The ARGB fill a renderer surface takes. */
export function colorFill(rgb: RGB): number {
  return (0xff000000 | (rgb.r << 16) | (rgb.g << 8) | rgb.b) >>> 0;
}

/** WCAG 2.x relative luminance. */
export function luminance(rgb: RGB): number {
  const linear = (value: number) => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b);
}

export function contrastRatio(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG thresholds for normal-size text; compared unrounded, as the guideline requires. */
export const WCAG_AA = 4.5;
export const WCAG_AAA = 7;

export type ContrastCheck = { ratio: number; aa: boolean; aaa: boolean };
export function contrastCheck(color: RGB, background: RGB): ContrastCheck {
  const ratio = contrastRatio(color, background);
  return { ratio, aa: ratio >= WCAG_AA, aaa: ratio >= WCAG_AAA };
}

/** "4.62:1", truncated rather than rounded so 4.499 never reads as a pass. */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
}

export const WHITE: RGB = { r: 255, g: 255, b: 255 };
export const BLACK: RGB = { r: 0, g: 0, b: 0 };

/** Black or white, whichever reads better on the colour. */
export function contrastText(rgb: RGB): number {
  return contrastRatio(rgb, BLACK) >= contrastRatio(rgb, WHITE) ? 0xff000000 : 0xffffffff;
}
