/**
 * Drag-and-drop stubs — local callback wiring; no platform imports.
 * Call setDndBridge() from the Wayland layer to hook in real DataTransfer.
 */
import { createElement, useState, type ReactNode } from "react";
import { Group, Rect } from "@moire/react-host";
import { themePalette } from "../theme.js";
import { Pressable } from "./pressable.js";

/* ---------- Bridge (plugged in by platform, optional) ---------- */

type DndBridge = {
  startDrag?: (payload: unknown, mimeTypes: string[]) => void;
};

let dndBridge: DndBridge | null = null;

export function setDndBridge(b: DndBridge | null): void {
  dndBridge = b;
}

/* ---------- Module-level DnD state ---------- */

let activeDrag: { payload: unknown; mimeTypes: string[] } | null = null;

/* ---------- Draggable ---------- */

export type DraggableProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  /** MIME types this drag exposes, e.g. ["text/plain", "moire/file-path"]. */
  mimeTypes?: string[];
  /** Called to get the drag payload when a drag begins. */
  getPayload?: () => unknown;
  children?: ReactNode;
};

export function Draggable(props: DraggableProps): ReactNode {
  const [dragging, setDragging] = useState(false);
  const pal = themePalette();

  const handlePress = () => {
    const payload = props.getPayload?.() ?? null;
    const types = props.mimeTypes ?? [];
    activeDrag = { payload, mimeTypes: types };
    setDragging(true);
    dndBridge?.startDrag?.(payload, types);
    // Release dragging indicator after a short time (no real drag protocol yet)
    setTimeout(() => setDragging(false), 300);
  };

  return createElement(
    Group,
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: props.width,
      height: props.height,
    },
    createElement(Pressable, {
      x: 0,
      y: 0,
      width: props.width,
      height: props.height,
      onPress: handlePress,
    }),
    // Drag-active outline
    dragging
      ? createElement(Rect, {
          x: 0,
          y: 0,
          width: props.width,
          height: 1,
          fill: pal.accentLine,
        })
      : null,
    dragging
      ? createElement(Rect, {
          x: 0,
          y: props.height - 1,
          width: props.width,
          height: 1,
          fill: pal.accentLine,
        })
      : null,
    dragging
      ? createElement(Rect, {
          x: 0,
          y: 1,
          width: 1,
          height: props.height - 2,
          fill: pal.accentLine,
        })
      : null,
    dragging
      ? createElement(Rect, {
          x: props.width - 1,
          y: 1,
          width: 1,
          height: props.height - 2,
          fill: pal.accentLine,
        })
      : null,
    props.children,
  );
}

/* ---------- DropTarget ---------- */

export type DropTargetProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  /** Accepted MIME types; if empty, accepts anything. */
  mimeTypes?: string[];
  /** Called when a compatible payload is dropped. */
  onDrop?: (payload: unknown, mimeTypes: string[]) => void;
  children?: ReactNode;
};

export function DropTarget(props: DropTargetProps): ReactNode {
  const [hovered, setHovered] = useState(false);
  const pal = themePalette();

  const accepts = () => {
    if (!activeDrag) return false;
    if (!props.mimeTypes || props.mimeTypes.length === 0) return true;
    return activeDrag.mimeTypes.some((t) => props.mimeTypes!.includes(t));
  };

  const handlePress = () => {
    if (activeDrag && accepts()) {
      props.onDrop?.(activeDrag.payload, activeDrag.mimeTypes);
      activeDrag = null;
    }
  };

  return createElement(
    Group,
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: props.width,
      height: props.height,
    },
    // Highlight when hovering with an active drag
    hovered && accepts()
      ? createElement(Rect, {
          x: 0,
          y: 0,
          width: props.width,
          height: props.height,
          fill: pal.selection,
        })
      : null,
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.width,
      height: props.height,
      fill: 0x00000000,
      onPointerEnter: () => setHovered(true),
      onPointerLeave: () => setHovered(false),
      onPress: handlePress,
    }),
    props.children,
  );
}
