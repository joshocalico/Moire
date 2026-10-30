/** Round colour swatches with the chosen one ringed; Tab visits each, arrows choose. */
import React, { useState, type ReactNode } from "react";
import { Group, Rect, type HitKeyEvent } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { useWidgetTheme } from "#ui/widget-theme";
import { registerIntrinsicSize } from "./layout";
import { Pressable } from "./pressable";
import { Tooltip } from "./tooltip";

export type Swatch = { id: string; color: number; label: string };

export type SwatchPickerProps = {
  x?: number;
  y?: number;
  swatches: readonly Swatch[];
  value: string | null;
  onChange?: (id: string) => void;
  /** Swatch diameter in unscaled pixels; 22 by default. */
  size?: number;
  disabled?: boolean;
  /** Focus ids become `<focusId>:<swatch id>`. */
  focusId?: string;
};

const GAP = 8;
const RING = 3;

/** The picker's natural width and height for these props. */
export function swatchPickerSize(props: Pick<SwatchPickerProps, "swatches" | "size">) {
  const ui = getUiScaleFactor();
  const cell = ((props.size ?? 22) + RING * 2) * ui;
  return {
    width:
      props.swatches.length * cell + Math.max(0, props.swatches.length - 1) * (GAP - RING * 2) * ui,
    height: cell,
  };
}

/** How many swatches of this size fit across a width. */
export function swatchesThatFit(width: number, size = 22): number {
  const ui = getUiScaleFactor();
  return Math.max(1, Math.floor((width + (GAP - RING * 2) * ui) / ((size + GAP) * ui)));
}

export function SwatchPicker(props: SwatchPickerProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const ui = getUiScaleFactor();
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const size = (props.size ?? 22) * ui;
  const cell = size + RING * 2 * ui;
  const step = cell + (GAP - RING * 2) * ui;
  const selectedIndex = props.swatches.findIndex((swatch) => swatch.id === props.value);
  const { width, height } = swatchPickerSize(props);
  const choose = (index: number) => {
    const swatch = props.swatches[(index + props.swatches.length) % props.swatches.length];
    if (!swatch) return;
    setFocusTarget(swatch.id);
    props.onChange?.(swatch.id);
  };
  const handleKey = (event: HitKeyEvent, index: number) => {
    if (
      event.code === 106 ||
      event.code === 108 ||
      event.key === "ArrowRight" ||
      event.key === "ArrowDown"
    )
      choose(index + 1);
    else if (
      event.code === 105 ||
      event.code === 103 ||
      event.key === "ArrowLeft" ||
      event.key === "ArrowUp"
    )
      choose(index - 1);
    else if (event.code === 102 || event.key === "Home") choose(0);
    else if (event.code === 107 || event.key === "End") choose(props.swatches.length - 1);
    else if (
      !event.repeat &&
      (event.code === 57 || event.code === 28 || event.key === " " || event.key === "Enter")
    )
      choose(index);
  };
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={width} height={height}>
      {props.swatches.map((swatch, index) => {
        const selected = index === selectedIndex;
        return (
          <Group key={swatch.id} x={index * step} width={cell} height={cell}>
            {selected ? (
              <Rect
                width={cell}
                height={cell}
                radius={cell / 2}
                fill={0x00000000}
                stroke={pal.text}
                strokeWidth={2 * ui}
              />
            ) : null}
            <Pressable
              x={RING * ui}
              y={RING * ui}
              width={size}
              height={size}
              radius={size / 2}
              fill={swatch.color}
              hoverFill={swatch.color}
              pressedFill={swatch.color}
              disabled={props.disabled}
              focusable
              autoFocus={focusTarget === swatch.id}
              focusId={props.focusId ? `${props.focusId}:${swatch.id}` : undefined}
              onHoverChange={(next) =>
                setHovered((current) => (next ? swatch.id : current === swatch.id ? null : current))
              }
              onKeyDown={(event) => handleKey(event, index)}
              onPress={() => choose(index)}
            />

            <Tooltip width={cell} height={cell} label={swatch.label} open={hovered === swatch.id} />
          </Group>
        );
      })}
    </Group>
  );
}

registerIntrinsicSize(SwatchPicker, (props) => swatchPickerSize(props));
