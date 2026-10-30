import React, { useId, useRef, useState, type ReactNode } from "react";
import { Group, Rect, type HitKeyEvent, type HitPointerEvent } from "@moire/react-host";
import { resolveStatefulStyle, useWidgetTheme } from "#ui/widget-theme";
import { FocusRing } from "./primitives";
import { DndFeedback, useDragSource, type DragSourceOptions } from "./dnd";

export type ContextMenuTriggerProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  onContextMenu: (event: HitPointerEvent) => void;
  onPress?: (event?: HitPointerEvent) => void;
  children?: ReactNode;
};

/**
 * Background interaction surface. Its hit region is painted before children,
 * so more-specific child item triggers win without relying on propagation.
 */
export function ContextMenuTrigger(props: ContextMenuTriggerProps): ReactNode {
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height}>
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
  autoFocus?: boolean;
  /** Controlled focus-ring state for non-Window hosts such as shell chrome. */
  focused?: boolean;
  onPress?: (event?: HitPointerEvent) => void;
  onDoublePress?: () => void;
  onContextMenu?: (event: HitPointerEvent) => void;
  onFocusChange?: (focused: boolean) => void;
  /** Pointer over the item, for hover presentation the children draw. */
  onHoverChange?: (hovered: boolean) => void;
  /** Return true after handling a key to suppress built-in activation. */
  onKeyDown?: (event: HitKeyEvent) => boolean | void;
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
  const theme = useWidgetTheme();
  const generatedId = useId();
  const [internallyFocused, setInternallyFocused] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  const lastClick = useRef(0);
  const drag = useDragSource({
    width: props.width,
    height: props.height,
    ...props.dragSource,
  });

  const activate = (event?: HitPointerEvent) => {
    if (props.disabled) return;
    if (props.dragSource && drag.consumePressSuppression()) return;
    const now = Date.now();
    if (props.onDoublePress && now - lastClick.current < 400) {
      lastClick.current = 0;
      props.onDoublePress();
      return;
    }
    lastClick.current = now;
    props.onPress?.(event);
  };

  const handleKey = (event: HitKeyEvent) => {
    if (props.disabled || event.repeat) return;
    if (props.onKeyDown?.(event) === true) return;
    if (event.key === "Enter" || event.code === 28) {
      (props.onDoublePress ?? props.onPress)?.();
    } else if (event.key === " " || event.code === 57) {
      props.onPress?.();
    }
  };

  const showOutline = props.focused ?? internallyFocused;
  const outline = resolveStatefulStyle(theme.recipes.collectionItem.outline, "focused");

  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height}>
      {props.children}
      <Rect
        x={0}
        y={0}
        width={props.width}
        height={props.height}
        fill={0x00000000}
        focusable={!props.disabled}
        focusId={props.focusId ?? `collection-item:${generatedId}`}
        autoFocus={props.autoFocus}
        onFocusChange={(next) => {
          setInternallyFocused(next);
          props.onFocusChange?.(next);
        }}
        onKeyDown={handleKey}
        onPointerDown={props.disabled || !props.dragSource ? undefined : drag.onPointerDown}
        onPointerMove={props.disabled || !props.dragSource ? undefined : drag.onPointerMove}
        onPointerUp={props.disabled || !props.dragSource ? undefined : drag.onPointerUp}
        onPointerEnter={
          props.disabled || !props.onHoverChange ? undefined : () => props.onHoverChange?.(true)
        }
        onPointerLeave={
          props.disabled || (!props.dragSource && !props.onHoverChange)
            ? undefined
            : () => {
                if (props.dragSource) drag.onPointerLeave();
                props.onHoverChange?.(false);
              }
        }
        onPress={props.disabled ? undefined : activate}
        onContextMenu={props.disabled ? undefined : props.onContextMenu}
        data={props.dropData}
        onDropHoverChange={props.dropData === undefined ? undefined : setDropHover}
      />
      {showOutline ? (
        <FocusRing
          width={props.width}
          height={props.height}
          radius={outline.radius}
          color={outline.stroke}
        />
      ) : null}
      {drag.dragging ? (
        <DndFeedback width={props.width} height={props.height} kind="dragging" />
      ) : null}
      {dropHover ? (
        <DndFeedback width={props.width} height={props.height} kind="drop-target" />
      ) : null}
    </Group>
  );
}
