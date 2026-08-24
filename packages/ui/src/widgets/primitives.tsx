/** Theme-aware renderer-neutral text and surface primitives. */
import React, { type ReactNode } from "react";
import {
  Group,
  Rect,
  Text,
  measureTextBounds,
  type HitPressEvent,
} from "@moire/react-host";
import { useWidgetTheme } from "../widget-theme.js";
import {
  registerIntrinsicSize,
  useLayoutMetrics,
  type FlexItemProps,
} from "./layout.js";

const DEFAULT_FONT = 14;

export type LabelProps = FlexItemProps & {
  text: string;
  color?: number;
  scale?: number;
  fontSize?: number;
  fontWeight?: "regular" | "medium" | "bold";
  fontFamily?: "sans" | "mono";
  horizontalAlign?: "start" | "center" | "end";
  verticalAlign?: "start" | "center" | "end";
  wrap?: boolean;
  maxLines?: number;
  lineGap?: number;
  overflow?: "visible" | "clip" | "ellipsis";
};

type TextMeasureStyle = Pick<
  LabelProps,
  "scale" | "fontSize" | "fontWeight" | "fontFamily"
>;

function lineWidth(text: string, style: TextMeasureStyle): number {
  return measureTextBounds(text, style).width;
}

function fitLine(text: string, width: number, style: TextMeasureStyle, ellipsis: boolean): string {
  if (width <= 0) return "";
  if (lineWidth(text, style) <= width) return text;
  const suffix = ellipsis ? "…" : "";
  const characters = Array.from(text);
  let low = 0;
  let high = characters.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (lineWidth(characters.slice(0, middle).join("") + suffix, style) <= width) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return characters.slice(0, low).join("") + suffix;
}

function wrapParagraph(text: string, width: number, style: TextMeasureStyle): string[] {
  if (!text) return [""];
  const words = text.trim().split(/\s+/u);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || lineWidth(candidate, style) <= width) {
      line = candidate;
      if (lineWidth(line, style) <= width) continue;
    }
    if (line && line !== word) lines.push(line);
    const characters = Array.from(word);
    line = "";
    while (characters.length > 0) {
      let low = 1;
      let high = characters.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (lineWidth(characters.slice(0, middle).join(""), style) <= width) {
          low = middle;
        } else {
          high = middle - 1;
        }
      }
      const take = Math.max(1, low);
      const fragment = characters.splice(0, take).join("");
      if (characters.length > 0) lines.push(fragment);
      else line = fragment;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function intrinsicTextSize(props: LabelProps): { width: number; height: number } {
  const scale = props.scale ?? 1;
  const fontSize = props.fontSize ?? (scale > 1 ? DEFAULT_FONT * scale : undefined);
  const style = {
    scale,
    fontSize,
    fontWeight: props.fontWeight,
    fontFamily: props.fontFamily,
  };
  const lines = props.text.split("\n");
  const lineHeight = measureTextBounds("Mg", style).height;
  return {
    width: Math.max(0, ...lines.map((line) => lineWidth(line, style))),
    height: Math.max(1, lines.length) * lineHeight +
      Math.max(0, lines.length - 1) * (props.lineGap ?? 0),
  };
}

/** Measured text with allocation-aware alignment, wrapping, and overflow. */
export function TextBlock(props: LabelProps): ReactNode {
  const palette = useWidgetTheme().foundations.palette;
  const allocated = useLayoutMetrics();
  const scale = props.scale ?? 1;
  const fontSize = props.fontSize ?? (scale > 1 ? DEFAULT_FONT * scale : undefined);
  const style = {
    scale,
    fontSize,
    fontWeight: props.fontWeight,
    fontFamily: props.fontFamily,
  };
  const natural = intrinsicTextSize(props);
  const width = props.width ?? allocated?.width ?? natural.width;
  const lineHeight = measureTextBounds("Mg", style).height;
  const lineGap = props.lineGap ?? 0;
  let lines = props.wrap
    ? props.text.split("\n").flatMap((line) => wrapParagraph(line, width, style))
    : props.text.split("\n");
  const naturalHeight = Math.max(1, lines.length) * lineHeight + Math.max(0, lines.length - 1) * lineGap;
  const height = props.height ?? allocated?.height ?? naturalHeight;
  const heightLimit = props.overflow === "visible"
    ? Number.POSITIVE_INFINITY
    : Math.max(1, Math.floor((height + lineGap) / Math.max(1, lineHeight + lineGap)));
  const lineLimit = Math.max(1, Math.min(props.maxLines ?? Number.POSITIVE_INFINITY, heightLimit));
  const truncated = lines.length > lineLimit;
  lines = lines.slice(0, lineLimit);
  if (props.overflow === "ellipsis") {
    lines = lines.map((line, index) =>
      fitLine(line, width, style, truncated && index === lines.length - 1),
    );
  }
  const contentHeight = lines.length * lineHeight + Math.max(0, lines.length - 1) * lineGap;
  const blockY = props.verticalAlign === "center"
    ? Math.floor((height - contentHeight) / 2)
    : props.verticalAlign === "end"
      ? height - contentHeight
      : 0;
  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={width}
      height={height}
      clip={props.overflow === "clip" || props.overflow === "ellipsis"}
    >
      {lines.map((line, index) => {
        const measuredWidth = lineWidth(line, style);
        const textX = props.horizontalAlign === "center"
          ? Math.floor((width - measuredWidth) / 2)
          : props.horizontalAlign === "end"
            ? width - measuredWidth
            : 0;
        return (
          <Text
            key={`${index}:${line}`}
            x={textX}
            y={blockY + index * (lineHeight + lineGap)}
            text={line}
            color={props.color ?? palette.text}
            scale={scale}
            fontSize={fontSize}
            fontWeight={props.fontWeight}
            fontFamily={props.fontFamily}
          />
        );
      })}
    </Group>
  );
}

export function Label(props: LabelProps): ReactNode {
  return <TextBlock {...props} />;
}

registerIntrinsicSize(TextBlock, intrinsicTextSize);
registerIntrinsicSize(Label, intrinsicTextSize);

export type SurfaceProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  fill?: number;
  radius?: number;
  stroke?: number;
  strokeWidth?: number;
  elevation?: "none" | "low" | "medium" | "high";
  opacity?: number;
  clip?: boolean;
  children?: ReactNode;
  onPress?: () => void;
  onContextMenu?: (event: HitPressEvent) => void;
};

export function Surface(props: SurfaceProps): ReactNode {
  const theme = useWidgetTheme();
  const palette = theme.foundations.palette;
  const elevation = props.elevation && props.elevation !== "none"
    ? theme.foundations.elevation[props.elevation]
    : null;
  const shadowAlpha = elevation ? Math.round(elevation.opacity * 255) : 0;
  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={props.height}
      opacity={props.opacity}
    >
      <Rect
        width={props.width}
        height={props.height}
        fill={props.fill ?? palette.panel}
        radius={props.radius}
        stroke={props.stroke}
        strokeWidth={props.strokeWidth}
        shadow={elevation ? {
          color: (shadowAlpha << 24) >>> 0,
          blurRadius: elevation.blur,
          offsetY: elevation.offsetY,
        } : undefined}
        onPress={props.onPress}
        onContextMenu={props.onContextMenu}
      />
      <Group width={props.width} height={props.height} clip={props.clip}>
        {props.children}
      </Group>
    </Group>
  );
}

export type FocusRingProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  visible?: boolean;
  radius?: number;
  color?: number;
  inset?: number;
};

/** Theme-owned focus outline shared by composite interaction surfaces. */
export function FocusRing(props: FocusRingProps): ReactNode {
  const theme = useWidgetTheme();
  if (props.visible === false) return null;
  const inset = props.inset ?? theme.foundations.focusRing.inset;
  return (
    <Rect
      x={(props.x ?? 0) + inset}
      y={(props.y ?? 0) + inset}
      width={Math.max(1, props.width - inset * 2)}
      height={Math.max(1, props.height - inset * 2)}
      fill={0x00000000}
      radius={props.radius ?? theme.foundations.radii.small + theme.foundations.focusRing.radiusOffset}
      stroke={props.color ?? theme.foundations.palette.focusRing}
      strokeWidth={theme.foundations.focusRing.width}
    />
  );
}

export type PanelProps = SurfaceProps;

export function Panel(props: PanelProps): ReactNode {
  const palette = useWidgetTheme().foundations.palette;
  return <Surface {...props} fill={props.fill ?? palette.surface} />;
}

export type SeparatorProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  color?: number;
};

export function Separator(props: SeparatorProps): ReactNode {
  const palette = useWidgetTheme().foundations.palette;
  return (
    <Rect
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={props.height ?? 1}
      fill={props.color ?? palette.border}
    />
  );
}

/** @deprecated use Separator */
export const Divider = Separator;

export function usePalette() {
  return useWidgetTheme().foundations.palette;
}
