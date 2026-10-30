/**
 * Pluggable text renderer for TTF (or other) engines.
 * @moire/ui registers its FontEngine via setTextRenderer().
 */
export type TextDrawStyle = {
  color?: number;
  /** Legacy bitmap scale (1 = default). Also scales fontSize when fontSize omitted. */
  scale?: number;
  fontSize?: number;
  fontWeight?: "regular" | "medium" | "bold" | string;
  fontFamily?: "sans" | "mono" | string;
  /** Extra advance after each glyph, in pixels (negative tightens). */
  letterSpacing?: number;
};

export type TextRenderer = {
  measure(text: string, style?: TextDrawStyle): { width: number; height: number };
  draw(
    fb: Uint32Array,
    pitchPx: number,
    fbW: number,
    fbH: number,
    x: number,
    y: number,
    text: string,
    style?: TextDrawStyle,
  ): void;
};

let textRenderer: TextRenderer | null = null;

export function setTextRenderer(renderer: TextRenderer | null): void {
  textRenderer = renderer;
}

export function getTextRenderer(): TextRenderer | null {
  return textRenderer;
}
