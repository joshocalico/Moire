/**
 * PointerArea — a transparent, optionally focusable hit area that reports raw pointer and key
 * input. For surfaces an app draws itself (a drawing canvas, a crop or selection gesture) where
 * Pressable's press semantics and hover feedback do not fit.
 */
import React, { type ReactNode } from "react";
import { Group, Rect, type HitKeyEvent, type HitPointerEvent } from "@moire/react-host";
import { registerIntrinsicSize } from "./layout";

export type PointerAreaProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  focusable?: boolean;
  autoFocus?: boolean;
  focusId?: string;
  onFocusChange?: (focused: boolean) => void;
  /** Return true when the key was handled. */
  onKeyDown?: (event: HitKeyEvent) => boolean | void;
  onPointerDown?: (event: HitPointerEvent) => void;
  onPointerMove?: (event: HitPointerEvent) => void;
  onPointerUp?: (event: HitPointerEvent) => void;
  /** A wheel or touchpad scroll over the area; return false to let an enclosing scroller have it. */
  onWheel?: (event: HitPointerEvent) => boolean | void;
  /** Drawn above the hit area (a selection outline, a cursor). */
  children?: ReactNode;
};

export function PointerArea(props: PointerAreaProps): ReactNode {
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height}>
      <Rect
        width={props.width}
        height={props.height}
        fill={0x00000000}
        focusable={props.focusable}
        autoFocus={props.autoFocus}
        focusId={props.focusId}
        onFocusChange={props.onFocusChange}
        onKeyDown={props.onKeyDown}
        onPointerDown={props.onPointerDown}
        onPointerMove={props.onPointerMove}
        onPointerUp={props.onPointerUp}
        onWheel={props.onWheel}
      />
      {props.children}
    </Group>
  );
}

registerIntrinsicSize(PointerArea, (props) => ({ width: props.width, height: props.height }));
