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

/* ---------- Bridge (plugged in by platform, optional) ---------- */

type DndBridge = {
  startDrag?: (
    payload: unknown,
    mimeTypes: string[],
    opts?: { label?: string },
  ) => void;
};

let dndBridge: DndBridge | null = null;

export function setDndBridge(b: DndBridge | null): void {
  dndBridge = b;
}

/* ---------- Incoming drop registry (Wayland → DropTarget) ---------- */

export type DropSink = {
  mimeTypes: string[];
  onDrop: (payload: unknown, mimeTypes: string[]) => void;
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

/** Called by the Wayland platform after receiving drop payload bytes. */
export function notifyDrop(payload: unknown, mimeTypes: string[]): void {
  for (const s of dropSinks) {
    if (
      s.mimeTypes.length === 0 ||
      mimeTypes.some((m) => s.mimeTypes.includes(m))
    ) {
      s.onDrop(payload, mimeTypes);
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

const DRAG_THRESHOLD_PX = 6;

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
  const pal = themePalette();
  const down = useRef<{ x: number; y: number } | null>(null);
  const started = useRef(false);
  const lastClick = useRef(0);

  const beginDrag = () => {
    if (started.current) return;
    started.current = true;
    const payload = props.getPayload?.() ?? null;
    const types = props.mimeTypes ?? [];
    const label = labelFromPayload(payload, props.label);
    activeDrag = { payload, mimeTypes: types };
    setDragging(true);
    dndBridge?.startDrag?.(payload, types, { label });
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
  );
}

/* ---------- DropTarget ---------- */

export type DropTargetProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  mimeTypes?: string[];
  onDrop?: (payload: unknown, mimeTypes: string[]) => void;
  children?: ReactNode;
};

export function DropTarget(props: DropTargetProps): ReactNode {
  const [hovered, setHovered] = useState(false);
  const pal = themePalette();
  const mimeTypes = props.mimeTypes ?? [];

  useEffect(() => {
    return registerDropSink({
      mimeTypes,
      onDrop: (payload, mimes) => props.onDrop?.(payload, mimes),
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
