import React, { useId, useRef, useState, type ReactNode } from "react";
import { Group, Rect, type HitKeyEvent, type HitPointerEvent } from "@moire/react-host";
import { useWidgetTheme } from "#ui/widget-theme";

export type SplitViewOrientation = "horizontal" | "vertical";

export type SplitViewProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  orientation?: SplitViewOrientation;
  firstSize: number;
  onFirstSizeChange?: (size: number) => void;
  minFirst?: number;
  minSecond?: number;
  dividerSize?: number;
  keyboardStep?: number;
  disabled?: boolean;
  first: ReactNode;
  second: ReactNode;
};

type DragOrigin = { pointer: number; size: number };

/** Controlled two-pane layout with a captured, keyboard-focusable divider. */
export function SplitView(props: SplitViewProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const focusId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragOrigin = useRef<DragOrigin | null>(null);
  const orientation = props.orientation ?? "horizontal";
  const dividerSize = Math.max(3, props.dividerSize ?? 7);
  const total = orientation === "horizontal" ? props.width : props.height;
  const available = Math.max(0, total - dividerSize);
  const minFirst = Math.max(0, props.minFirst ?? 80);
  const minSecond = Math.max(0, props.minSecond ?? 80);
  const upper = Math.max(minFirst, available - minSecond);
  const firstSize = Math.max(minFirst, Math.min(upper, props.firstSize));
  const secondSize = Math.max(0, available - firstSize);
  const active = dragging || focused;
  const visualThickness = active ? 3 : hovered ? 2 : 1;
  const visualOffset = Math.floor((dividerSize - visualThickness) / 2);

  const commit = (size: number) => {
    if (props.disabled) return;
    props.onFirstSizeChange?.(Math.round(Math.max(minFirst, Math.min(upper, size))));
  };
  const pointerAxis = (event: HitPointerEvent) =>
    orientation === "horizontal" ? event.x : event.y;
  const handleKey = (event: HitKeyEvent) => {
    if (props.disabled || event.repeat) return;
    const step = (props.keyboardStep ?? 12) * (event.shiftKey ? 4 : 1);
    const decrease =
      orientation === "horizontal"
        ? event.key === "ArrowLeft" || event.code === 105
        : event.key === "ArrowUp" || event.code === 103;
    const increase =
      orientation === "horizontal"
        ? event.key === "ArrowRight" || event.code === 106
        : event.key === "ArrowDown" || event.code === 108;
    if (decrease) commit(firstSize - step);
    else if (increase) commit(firstSize + step);
    else if (event.key === "Home" || event.code === 102) commit(minFirst);
    else if (event.key === "End" || event.code === 107) commit(upper);
  };
  const handlePointerDown = (event: HitPointerEvent) => {
    if (props.disabled) return;
    dragOrigin.current = { pointer: pointerAxis(event), size: firstSize };
    setDragging(true);
  };
  const handlePointerMove = (event: HitPointerEvent) => {
    if (!dragOrigin.current) return;
    commit(dragOrigin.current.size + pointerAxis(event) - dragOrigin.current.pointer);
  };
  const handlePointerUp = (event: HitPointerEvent) => {
    if (dragOrigin.current) {
      commit(dragOrigin.current.size + pointerAxis(event) - dragOrigin.current.pointer);
    }
    dragOrigin.current = null;
    setDragging(false);
  };

  const divider = (
    <Group
      x={orientation === "horizontal" ? firstSize : 0}
      y={orientation === "vertical" ? firstSize : 0}
      width={orientation === "horizontal" ? dividerSize : props.width}
      height={orientation === "vertical" ? dividerSize : props.height}
    >
      <Rect
        x={orientation === "horizontal" ? visualOffset : 0}
        y={orientation === "vertical" ? visualOffset : 0}
        width={orientation === "horizontal" ? visualThickness : props.width}
        height={orientation === "vertical" ? visualThickness : props.height}
        fill={active ? pal.accent : hovered ? pal.muted : pal.border}
        radius={Math.ceil(visualThickness / 2)}
      />
      <Rect
        width={orientation === "horizontal" ? dividerSize : props.width}
        height={orientation === "vertical" ? dividerSize : props.height}
        fill={0x00000000}
        focusable={!props.disabled}
        focusId={`split-view:${focusId}`}
        onFocusChange={setFocused}
        onKeyDown={handleKey}
        onPointerEnter={props.disabled ? undefined : () => setHovered(true)}
        onPointerLeave={props.disabled ? undefined : () => setHovered(false)}
        onPointerDown={props.disabled ? undefined : handlePointerDown}
        onPointerMove={props.disabled ? undefined : handlePointerMove}
        onPointerUp={props.disabled ? undefined : handlePointerUp}
      />
    </Group>
  );

  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height}>
      <Group
        width={orientation === "horizontal" ? firstSize : props.width}
        height={orientation === "vertical" ? firstSize : props.height}
        clip
      >
        {props.first}
      </Group>
      <Group
        x={orientation === "horizontal" ? firstSize + dividerSize : 0}
        y={orientation === "vertical" ? firstSize + dividerSize : 0}
        width={orientation === "horizontal" ? secondSize : props.width}
        height={orientation === "vertical" ? secondSize : props.height}
        clip
      >
        {props.second}
      </Group>
      {divider}
    </Group>
  );
}
