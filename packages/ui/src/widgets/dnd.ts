/**
 * Drag-and-drop widgets — platform-agnostic; Wayland plugs in via setDndBridge.
 *
 * Draggable: pointer-down + move threshold starts a real drag (not click-to-drag).
 * DropTarget: registers for incoming drops; Wayland receive path calls notifyDrop.
 */
import {
  createElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Group, Rect, type HitPointerEvent } from "@moire/react-host";
import { themePalette } from "../theme.js";
import { requestActiveWindowRedraw } from "../window.js";

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
  startDrag?: (
    payload: unknown,
    mimeTypes: string[],
    opts: DragPreviewSpec,
  ) => void;
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
export function notifyDrop(
  payload: unknown,
  mimeTypes: string[],
  x: number,
  y: number,
): void {
  for (const s of dropSinks) {
    if (
      s.mimeTypes.length === 0 ||
      mimeTypes.some((m) => s.mimeTypes.includes(m))
    ) {
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

/**
 * Wash + 2px accent border, the shared "a compatible drag is hovering this
 * element" visual for `Draggable`'s drop-zone mode and `DropZone`.
 */
function dropHoverRects(
  width: number,
  height: number,
  pal: ReturnType<typeof themePalette>,
): ReactNode[] {
  return [
    createElement(Rect, {
      key: "wash",
      x: 1,
      y: 1,
      width: width - 2,
      height: height - 2,
      fill: pal.selection,
    }),
    createElement(Rect, {
      key: "top",
      x: 0,
      y: 0,
      width,
      height: 2,
      fill: pal.accent,
    }),
    createElement(Rect, {
      key: "bottom",
      x: 0,
      y: height - 2,
      width,
      height: 2,
      fill: pal.accent,
    }),
    createElement(Rect, {
      key: "left",
      x: 0,
      y: 0,
      width: 2,
      height,
      fill: pal.accent,
    }),
    createElement(Rect, {
      key: "right",
      x: width - 2,
      y: 0,
      width: 2,
      height,
      fill: pal.accent,
    }),
  ];
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
  /** Fired on click (no drag). */
  onPress?: () => void;
  onDoublePress?: () => void;
  children?: ReactNode;
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

export function Draggable(props: DraggableProps): ReactNode {
  const [dragging, setDragging] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  const pal = themePalette();
  const down = useRef<{ x: number; y: number } | null>(null);
  const started = useRef(false);
  const lastClick = useRef(0);

  const beginDrag = () => {
    if (started.current) return;
    started.current = true;
    const hotspot = down.current ?? {
      x: props.width / 2,
      y: props.height / 2,
    };
    const payload = props.getPayload?.() ?? null;
    const types = props.mimeTypes ?? [];
    const label = labelFromPayload(payload, props.label);
    activeDrag = { payload, mimeTypes: types };
    setDragging(true);
    activeDragEndCb = () => {
      setDragging(false);
      down.current = null;
      started.current = false;
    };
    dndBridge?.startDrag?.(payload, types, {
      label,
      icon: props.previewIcon,
      width: props.width,
      height: props.height,
      hotspotX: hotspot.x,
      hotspotY: hotspot.y,
    });
  };

  const handleClick = () => {
    const now = Date.now();
    if (props.onDoublePress && now - lastClick.current < 400) {
      lastClick.current = 0;
      props.onDoublePress();
      return;
    }
    lastClick.current = now;
    props.onPress?.();
  };

  return createElement(
    Group,
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: props.width,
      height: props.height,
    },
    // Children first (visuals), then hit layer on top so we own press/drag.
    props.children,
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.width,
      height: props.height,
      fill: 0x00000000,
      data: props.dropData,
      onDropHoverChange: props.dropData !== undefined ? setDropHover : undefined,
      onPointerDown: (ev: HitPointerEvent) => {
        down.current = { x: ev.localX, y: ev.localY };
        started.current = false;
      },
      onPointerMove: (ev: HitPointerEvent) => {
        if (!down.current || started.current) return;
        const dx = ev.localX - down.current.x;
        const dy = ev.localY - down.current.y;
        if (dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
          beginDrag();
        }
      },
      onPointerUp: () => {
        const wasDrag = started.current;
        down.current = null;
        if (!wasDrag) handleClick();
        if (dragging) setDragging(false);
        started.current = false;
      },
      onPointerLeave: () => {
        // If pointer leaves while held and we've moved enough, drag already started.
        // Otherwise cancel the pending click arm.
        if (!started.current) down.current = null;
      },
    }),
    dragging
      ? createElement(Rect, {
          x: 0,
          y: 0,
          width: props.width,
          height: 1,
          fill: pal.accent,
        })
      : null,
    dragging
      ? createElement(Rect, {
          x: 0,
          y: props.height - 1,
          width: props.width,
          height: 1,
          fill: pal.accent,
        })
      : null,
    dragging
      ? createElement(Rect, {
          x: 0,
          y: 1,
          width: 1,
          height: props.height - 2,
          fill: pal.accent,
        })
      : null,
    dragging
      ? createElement(Rect, {
          x: props.width - 1,
          y: 1,
          width: 1,
          height: props.height - 2,
          fill: pal.accent,
        })
      : null,
    // Drop-zone acceptor highlight — a compatible drag is hovering this
    // element specifically (web dragenter/dragleave equivalent).
    ...(dropHover ? dropHoverRects(props.width, props.height, pal) : []),
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
  const pal = themePalette();

  return createElement(
    Group,
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: props.width,
      height: props.height,
    },
    props.children,
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.width,
      height: props.height,
      fill: 0x00000000,
      data: props.id,
      onDropHoverChange: setHover,
    }),
    ...(hover ? dropHoverRects(props.width, props.height, pal) : []),
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
  children?: ReactNode;
};

export function DropTarget(props: DropTargetProps): ReactNode {
  const [hovered, setHovered] = useState(false);
  const pal = themePalette();
  const mimeTypes = props.mimeTypes ?? [];

  // Registration below is intentionally a one-time effect (stable sink
  // identity for the widget's lifetime), but `onDrop` closes over per-render
  // state in callers (e.g. Files' current `cwd`). Route through a ref that's
  // updated every render so the sink always dispatches to the latest
  // callback instead of the one captured at mount.
  const onDropRef = useRef(props.onDrop);
  onDropRef.current = props.onDrop;

  useEffect(() => {
    return registerDropSink({
      mimeTypes,
      onDrop: (payload, mimes, x, y) => onDropRef.current?.(payload, mimes, x, y),
      onHover: setHovered,
    });
    // Intentionally stable for the widget lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const acceptsLocal = () => {
    if (!activeDrag) return false;
    if (mimeTypes.length === 0) return true;
    return activeDrag.mimeTypes.some((t) => mimeTypes.includes(t));
  };

  return createElement(
    Group,
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: props.width,
      height: props.height,
    },
    hovered || (acceptsLocal() && hovered)
      ? createElement(Rect, {
          x: 2,
          y: 2,
          width: props.width - 4,
          height: props.height - 4,
          fill: pal.selection,
        })
      : null,
    hovered
      ? createElement(Rect, {
          x: 0,
          y: 0,
          width: props.width,
          height: 2,
          fill: pal.accent,
        })
      : null,
    hovered
      ? createElement(Rect, {
          x: 0,
          y: props.height - 2,
          width: props.width,
          height: 2,
          fill: pal.accent,
        })
      : null,
    hovered
      ? createElement(Rect, {
          x: 0,
          y: 0,
          width: 2,
          height: props.height,
          fill: pal.accent,
        })
      : null,
    hovered
      ? createElement(Rect, {
          x: props.width - 2,
          y: 0,
          width: 2,
          height: props.height,
          fill: pal.accent,
        })
      : null,
    props.children,
  );
}
