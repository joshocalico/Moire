/**
 * Drag-and-drop widgets — platform-agnostic; Wayland plugs in via setDndBridge.
 *
 * Draggable: pointer-down + move threshold starts a real drag (not click-to-drag).
 * DropTarget: registers for incoming drops; Wayland receive path calls notifyDrop.
 */
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { Group, Rect, type HitPointerEvent } from "@moire/react-host";
import { useWidgetTheme, type WidgetBoxStyle } from "#ui/widget-theme";
import { requestActiveWindowRedraw } from "#ui/window";

/* ---------- Bridge (plugged in by platform, optional) ---------- */

/** Icon graphic for the drag preview — same shape as `Icon`'s name/color. */
export type DragIconSpec = { name: string; color?: number };

export type DragPreviewSpec = {
  label?: string;
  icon?: DragIconSpec;
  /** Source widget bounds, used to keep the preview the same size. */
  width: number;
  height: number;
  /** Pointer-down position within those bounds. */
  hotspotX: number;
  hotspotY: number;
};

type DndBridge = {
  startDrag?: (payload: unknown, mimeTypes: string[], opts: DragPreviewSpec) => void;
};

let dndBridge: DndBridge | null = null;

export function setDndBridge(b: DndBridge | null): void {
  dndBridge = b;
}

/* ---------- Incoming drop registry (Wayland → DropTarget) ---------- */

export type DropSink = {
  mimeTypes: string[];
  onDrop: (payload: unknown, mimeTypes: string[], x: number, y: number) => void;
  onHover?: (hovering: boolean) => void;
};

const dropSinks = new Set<DropSink>();

export function registerDropSink(sink: DropSink): () => void {
  dropSinks.add(sink);
  return () => {
    dropSinks.delete(sink);
  };
}

/** Called by the Wayland platform when a drag enters/leaves this client. */
export function notifyDropHover(hovering: boolean): void {
  for (const s of dropSinks) s.onHover?.(hovering);
}

/**
 * Called by the Wayland platform after receiving drop payload bytes.
 * `x`/`y` are window-local pixel coordinates of the drop, for callers that
 * want to resolve a more specific target (e.g. `hitTestDropData`).
 */
export function notifyDrop(payload: unknown, mimeTypes: string[], x: number, y: number): void {
  for (const s of dropSinks) {
    if (s.mimeTypes.length === 0 || mimeTypes.some((m) => s.mimeTypes.includes(m))) {
      s.onDrop(payload, mimeTypes, x, y);
    }
  }
}

export function preferredDropMimes(): string[] {
  const out = new Set<string>();
  for (const s of dropSinks) {
    for (const m of s.mimeTypes) out.add(m);
  }
  if (out.size === 0) {
    out.add("text/uri-list");
    out.add("text/plain");
  }
  return [...out];
}

/* ---------- Local drag (intra-process fallback / highlight) ---------- */

let activeDrag: { payload: unknown; mimeTypes: string[] } | null = null;

/**
 * Reset callback for the `Draggable` currently mid-drag, if any. A real
 * Wayland drag never delivers a local `onPointerUp` back to the source once
 * `data_device.start_drag` is sent — the compositor intercepts button-up
 * for DnD globally, even for a drop within the same window — so the source
 * can't clear its own "dragging" visual on release. The platform calls
 * `notifyDragEnded` when it gets `data_source_cancelled`/`dnd_finished`.
 */
let activeDragEndCb: (() => void) | null = null;

export function notifyDragEnded(): void {
  activeDrag = null;
  const cb = activeDragEndCb;
  activeDragEndCb = null;
  cb?.();
  requestActiveWindowRedraw();
}

const DRAG_THRESHOLD_PX = 6;

export type DndFeedbackKind = "dragging" | "drop-target";

/** Shared, renderer-neutral DnD feedback used by every interaction owner. */
export function DndFeedback(props: {
  width: number;
  height: number;
  kind: DndFeedbackKind;
}): ReactNode {
  const recipe = useWidgetTheme().recipes.dnd;
  const style: WidgetBoxStyle = props.kind === "dragging" ? recipe.dragging : recipe.dropTarget;
  return (
    <Rect
      x={0}
      y={0}
      width={Math.max(0, props.width)}
      height={Math.max(0, props.height)}
      fill={style.fill}
      radius={style.radius}
      stroke={style.stroke}
      strokeWidth={style.strokeWidth}
    />
  );
}

/* ---------- Draggable ---------- */

export type DraggableProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  mimeTypes?: string[];
  getPayload?: () => unknown;
  /** Optional chip label; defaults to basename of file:// payload. */
  label?: string;
  /** Icon shown in the drag preview (the item's own graphic instead of a plain chip). */
  previewIcon?: DragIconSpec;
  /**
   * Opaque payload exposed via `hitTestDropData(x, y)` when a drop lands on
   * this element's bounds — lets a widget also act as a drop target (e.g. a
   * folder row that other items can be dropped onto to move into it).
   *
   * When set, this element also gets a live hover highlight (dragenter /
   * dragleave style) while a drag is geometrically over it — resolved
   * per-instance by position, so another element that happens to carry the
   * same `dropData` value never lights up instead.
   */
  dropData?: unknown;
  /** The drag ended: dropped anywhere, or cancelled. */
  onDragEnd?: () => void;
  /** Fired on click (no drag). */
  onPress?: () => void;
  onDoublePress?: () => void;
  onContextMenu?: (event: HitPointerEvent) => void;
  children?: ReactNode;
};

export type DragSourceOptions = Pick<
  DraggableProps,
  "width" | "height" | "mimeTypes" | "getPayload" | "label" | "previewIcon" | "onDragEnd"
>;

export type DragSourceController = {
  dragging: boolean;
  onPointerDown: (event: HitPointerEvent) => void;
  onPointerMove: (event: HitPointerEvent) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  /** Consume the click suppression left by a drag that crossed the threshold. */
  consumePressSuppression: () => boolean;
};

function labelFromPayload(payload: unknown, explicit?: string): string {
  if (explicit && explicit.trim()) return explicit.trim();
  if (typeof payload === "string") {
    const line = payload
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.startsWith("file:"));
    if (line) {
      try {
        const p = decodeURIComponent(line.replace(/^file:\/\//, ""));
        const base = p.split("/").filter(Boolean).pop();
        if (base) return base;
      } catch {
        /* fall through */
      }
    }
    const t = payload.trim();
    if (t) return t.length > 28 ? t.slice(0, 27) + "…" : t;
  }
  return "Item";
}

/**
 * Narrow drag behavior for composition by semantic interaction owners such as
 * CollectionItem. It owns only drag threshold/session state, never selection,
 * activation, or context-menu policy.
 */
export function useDragSource(options: DragSourceOptions): DragSourceController {
  const [dragging, setDragging] = useState(false);
  const down = useRef<{ x: number; y: number } | null>(null);
  const started = useRef(false);
  const suppressPress = useRef(false);

  const beginDrag = () => {
    if (started.current) return;
    started.current = true;
    suppressPress.current = true;
    const hotspot = down.current ?? {
      x: options.width / 2,
      y: options.height / 2,
    };
    const payload = options.getPayload?.() ?? null;
    const types = options.mimeTypes ?? [];
    const label = labelFromPayload(payload, options.label);
    activeDrag = { payload, mimeTypes: types };
    setDragging(true);
    activeDragEndCb = () => {
      setDragging(false);
      down.current = null;
      started.current = false;
      options.onDragEnd?.();
    };
    dndBridge?.startDrag?.(payload, types, {
      label,
      icon: options.previewIcon,
      width: options.width,
      height: options.height,
      hotspotX: hotspot.x,
      hotspotY: hotspot.y,
    });
  };

  return {
    dragging,
    onPointerDown(event) {
      down.current = { x: event.localX, y: event.localY };
      started.current = false;
      suppressPress.current = false;
    },
    onPointerMove(event) {
      if (!down.current || started.current) return;
      const dx = event.localX - down.current.x;
      const dy = event.localY - down.current.y;
      if (dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
        beginDrag();
      }
    },
    onPointerUp() {
      down.current = null;
      if (dragging) setDragging(false);
      if (started.current) options.onDragEnd?.();
      started.current = false;
    },
    onPointerLeave() {
      if (!started.current) down.current = null;
    },
    consumePressSuppression() {
      const suppressed = suppressPress.current;
      suppressPress.current = false;
      return suppressed;
    },
  };
}

export function Draggable(props: DraggableProps): ReactNode {
  const drag = useDragSource(props);
  const [dropHover, setDropHover] = useState(false);
  const lastClick = useRef(0);

  const handleClick = () => {
    if (drag.consumePressSuppression()) return;
    const now = Date.now();
    if (props.onDoublePress && now - lastClick.current < 400) {
      lastClick.current = 0;
      props.onDoublePress();
      return;
    }
    lastClick.current = now;
    props.onPress?.();
  };

  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height}>
      {props.children}
      <Rect
        x={0}
        y={0}
        width={props.width}
        height={props.height}
        fill={0x00000000}
        data={props.dropData}
        onDropHoverChange={props.dropData !== undefined ? setDropHover : undefined}
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onPointerUp={drag.onPointerUp}
        onPointerLeave={drag.onPointerLeave}
        onPress={handleClick}
        onContextMenu={props.onContextMenu}
      />
      {drag.dragging ? (
        <DndFeedback width={props.width} height={props.height} kind="dragging" />
      ) : null}
      {dropHover ? (
        <DndFeedback width={props.width} height={props.height} kind="drop-target" />
      ) : null}
    </Group>
  );
}

/* ---------- DropZone ---------- */

export type DropZoneProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  /** Payload exposed via `hitTestDropData(x, y)` when a drop lands here. */
  id: unknown;
  children?: ReactNode;
};

/**
 * Drop-target-only counterpart to `Draggable`'s `dropData` mode — for
 * elements that should accept drops but aren't themselves draggable (e.g. a
 * Places sidebar row or breadcrumb segment). Same acceptor semantics: live
 * hover highlight while a drag is geometrically over it, resolved by
 * `hitTestDropData` at drop time.
 */
export function DropZone(props: DropZoneProps): ReactNode {
  const [hover, setHover] = useState(false);

  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height}>
      {props.children}
      <Rect
        x={0}
        y={0}
        width={props.width}
        height={props.height}
        fill={0x00000000}
        data={props.id}
        onDropHoverChange={setHover}
      />
      {hover ? <DndFeedback width={props.width} height={props.height} kind="drop-target" /> : null}
    </Group>
  );
}

/* ---------- DropTarget ---------- */

export type DropTargetProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  mimeTypes?: string[];
  onDrop?: (payload: unknown, mimeTypes: string[], x: number, y: number) => void;
  /**
   * "area" outlines the whole target while a compatible drag is over it.
   * "none" leaves feedback to the specific drop zones inside it, for a view
   * where most of the area is not itself a meaningful destination.
   */
  feedback?: "area" | "none";
  children?: ReactNode;
};

export function DropTarget(props: DropTargetProps): ReactNode {
  const [hovered, setHovered] = useState(false);
  const mimeTypes = props.mimeTypes ?? [];
  const mimeKey = mimeTypes.join("\u0000");

  // Keep callback changes cheap through a ref. A semantic MIME-list change
  // refreshes the registered sink so a live target cannot retain stale types.
  const onDropRef = useRef(props.onDrop);
  onDropRef.current = props.onDrop;

  useEffect(() => {
    return registerDropSink({
      mimeTypes: [...mimeTypes],
      onDrop: (payload, mimes, x, y) => onDropRef.current?.(payload, mimes, x, y),
      onHover: setHovered,
    });
    // A semantic MIME list change replaces the sink; callback identity does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mimeKey]);

  const acceptsLocal = () => {
    if (!activeDrag) return false;
    if (mimeTypes.length === 0) return true;
    return activeDrag.mimeTypes.some((t) => mimeTypes.includes(t));
  };

  const showHover = props.feedback !== "none" && hovered && (!activeDrag || acceptsLocal());

  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height}>
      {props.children}
      {showHover ? (
        <DndFeedback width={props.width} height={props.height} kind="drop-target" />
      ) : null}
    </Group>
  );
}
