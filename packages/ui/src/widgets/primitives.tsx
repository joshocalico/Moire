/** Theme-aware renderer-neutral text and surface primitives. */
import React, { type ReactNode } from "react";
import {
  Group,
  Rect,
  Text,
  type HitPressEvent,
} from "@moire/react-host";
import { getUiScaleFactor } from "../font/index.js";
import { useWidgetTheme } from "../widget-theme.js";

const DEFAULT_FONT = 14;

function textHeight(scale = 1, fontSize?: number): number {
  const base = fontSize ?? DEFAULT_FONT * scale;
  return Math.ceil(base * getUiScaleFactor());
}

export type LabelProps = {
  x?: number;
  y?: number;
  text: string;
  color?: number;
  scale?: number;
  fontSize?: number;
  fontWeight?: "regular" | "medium" | "bold";
  fontFamily?: "sans" | "mono";
  width?: number;
  height?: number;
};

export function Label(props: LabelProps): ReactNode {
  const palette = useWidgetTheme().foundations.palette;
  const scale = props.scale ?? 1;
  const fontSize = props.fontSize ?? (scale > 1 ? DEFAULT_FONT * scale : undefined);
  const text = (
    <Text
      text={props.text}
      color={props.color ?? palette.text}
      scale={scale}
      fontSize={fontSize}
      fontWeight={props.fontWeight}
      fontFamily={props.fontFamily}
    />
  );
  if (props.width != null || props.height != null) {
    return (
      <Group
        x={props.x ?? 0}
        y={props.y ?? 0}
        width={props.width ?? 0}
        height={props.height ?? textHeight(scale, fontSize)}
      >
        {text}
      </Group>
    );
  }
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0}>
      {text}
    </Group>
  );
}

export type SurfaceProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  fill?: number;
  radius?: number;
  stroke?: number;
  strokeWidth?: number;
  clip?: boolean;
  children?: ReactNode;
  onPress?: () => void;
  onContextMenu?: (event: HitPressEvent) => void;
};

export function Surface(props: SurfaceProps): ReactNode {
  const palette = useWidgetTheme().foundations.palette;
  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={props.height}
      clip={props.clip}
    >
      <Rect
        width={props.width}
        height={props.height}
        fill={props.fill ?? palette.panel}
        radius={props.radius}
        stroke={props.stroke}
        strokeWidth={props.strokeWidth}
        onPress={props.onPress}
        onContextMenu={props.onContextMenu}
      />
      {props.children}
    </Group>
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
