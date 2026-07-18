import React, { useId, useRef, useState, type ReactNode } from "react";
import {
  Group,
  Rect,
  type HitKeyEvent,
  type HitPointerEvent,
} from "@moire/react-host";
import { themePalette } from "../theme.js";
import {
  useDragSource,
  type DragSourceOptions,
} from "./dnd.js";

export type ContextMenuTriggerProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  onContextMenu: (event: HitPointerEvent) => void;
  onPress?: () => void;
  children?: ReactNode;
};

/**
 * Background interaction surface. Its hit region is painted before children,
 * so more-specific child item triggers win without relying on propagation.
 */
export function ContextMenuTrigger(props: ContextMenuTriggerProps): ReactNode {
  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={props.height}
    >
      <Rect
        x={0}
        y={0}
        width={props.width}
        height={props.height}
        fill={0x00000000}
        onPress={props.onPress}
        onContextMenu={props.onContextMenu}
      />
      {props.children}
    </Group>
  );
}

export type CollectionItemProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  focusId?: string;
  disabled?: boolean;
  onPress?: () => void;
  onDoublePress?: () => void;
  onContextMenu?: (event: HitPointerEvent) => void;
  onFocusChange?: (focused: boolean) => void;
  dragSource?: Omit<DragSourceOptions, "width" | "height">;
  /** Optional destination identity when this item also accepts drops. */
  dropData?: unknown;
  children?: ReactNode;
};

/**
 * Semantic owner for collection-item focus, activation, context menus, and an
 * optional drag behavior. `useDragSource` remains narrow and knows nothing
 * about selection or menus.
 */
export function CollectionItem(props: CollectionItemProps): ReactNode {
  const pal = themePalette();
  const generatedId = useId();
  const [focused, setFocused] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  const lastClick = useRef(0);
  const drag = useDragSource({
    width: props.width,
    height: props.height,
    ...props.dragSource,
  });

  const activate = () => {
    if (props.disabled) return;
    if (props.dragSource && drag.consumePressSuppression()) return;
    const now = Date.now();
    if (props.onDoublePress && now - lastClick.current < 400) {
      lastClick.current = 0;
      props.onDoublePress();
      return;
    }
    lastClick.current = now;
    props.onPress?.();
  };

  const handleKey = (event: HitKeyEvent) => {
    if (props.disabled || event.repeat) return;
    if (event.key === "Enter" || event.code === 28) {
      (props.onDoublePress ?? props.onPress)?.();
    } else if (event.key === " " || event.code === 57) {
      props.onPress?.();
    }
  };

  const showOutline = focused || drag.dragging || dropHover;

  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={props.height}
    >
      {props.children}
      <Rect
        x={0}
        y={0}
        width={props.width}
        height={props.height}
        fill={0x00000000}
        focusable={!props.disabled}
        focusId={props.focusId ?? `collection-item:${generatedId}`}
        onFocusChange={(next) => {
          setFocused(next);
          props.onFocusChange?.(next);
        }}
        onKeyDown={handleKey}
        onPointerDown={
          props.disabled || !props.dragSource ? undefined : drag.onPointerDown
        }
        onPointerMove={
          props.disabled || !props.dragSource ? undefined : drag.onPointerMove
        }
        onPointerUp={
          props.disabled || !props.dragSource ? undefined : drag.onPointerUp
        }
        onPointerLeave={
          props.disabled || !props.dragSource ? undefined : drag.onPointerLeave
        }
        onPress={props.disabled ? undefined : activate}
        onContextMenu={props.disabled ? undefined : props.onContextMenu}
        data={props.dropData}
        onDropHoverChange={
          props.dropData === undefined ? undefined : setDropHover
        }
      />
      {showOutline ? (
        <Rect
          x={1}
          y={1}
          width={Math.max(1, props.width - 2)}
          height={Math.max(1, props.height - 2)}
          fill={0x00000000}
          radius={pal.radiusSm}
          stroke={focused ? pal.focusRing : pal.accent}
          strokeWidth={focused ? 2 : 1}
        />
      ) : null}
    </Group>
  );
}
