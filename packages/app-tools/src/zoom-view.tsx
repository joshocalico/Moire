/**
 * The zoomable, draggable picture shared by Image Viewer and Document Viewer: a hook that owns
 * the view, a surface that turns wheel and drag input into it, and the tool row controls.
 */
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Horizontal,
  PointerArea,
  Surface,
  getUiScaleFactor,
  registerIntrinsicSize,
  type Shortcut,
} from "@moire/ui";
import { ToolButton, ToolReadout, ToolSeparator } from "./frame";
import {
  canPan,
  currentScale,
  initialView,
  panBy,
  place,
  scrollToEdge,
  zoomBy,
  zoomTo,
  type Placement,
  type Size,
  type ZoomLimits,
  type ZoomView,
} from "./zoom";

/** Pixels of wheel travel that make one ZOOM_STEP. */
const WHEEL_PER_STEP = 100;
/** Pixels one arrow-key pan or plain-wheel scroll moves a page. */
const SCROLL_STEP = 60;

export type Zoom = {
  view: ZoomView;
  placement: Placement;
  scale: number;
  fitted: boolean;
  actual: boolean;
  limits: ZoomLimits;
  zoomBy(steps: number, anchor?: { x: number; y: number }): void;
  fit(): void;
  actualSize(): void;
  pan(dx: number, dy: number): void;
  /** Show the top or bottom of the content (a page turn). */
  scrollToEdge(edge: "top" | "bottom"): void;
  /** Start again fitted (a new image or page). */
  reset(): void;
};

/**
 * The view of `content` (null until it is loaded) inside `viewport`. The view resets when `key`
 * changes (another file), but keeps its scale across content of the same key (page turns).
 */
export function useZoom(
  key: string,
  content: Size | null,
  viewport: Size,
  limits: Partial<ZoomLimits> = {},
): Zoom {
  const ui = getUiScaleFactor();
  const resolved: ZoomLimits = {
    min: 0.05,
    max: 8,
    maxFit: 1,
    fit: "contain",
    margin: 16 * ui,
    ...limits,
  };
  const size = content ?? { width: 1, height: 1 };
  const [state, setState] = useState(() => ({
    key,
    view: initialView(size, resolved),
  }));
  let view = state.view;
  if (state.key !== key) {
    view = initialView(size, resolved);
    setState({ key, view });
  }
  const update = (next: (view: ZoomView) => ZoomView) =>
    setState((current) => ({ key: current.key, view: next(current.view) }));
  const placement = place(view, size, viewport, resolved);
  return {
    view,
    placement,
    scale: currentScale(view, size, viewport, resolved),
    fitted: view.scale === "fit",
    actual: view.scale === 1,
    limits: resolved,
    zoomBy: (steps, anchor) =>
      update((current) => zoomBy(current, steps, size, viewport, resolved, anchor)),
    fit: () => update((current) => zoomTo(current, "fit", size, viewport, resolved)),
    actualSize: () => update((current) => zoomTo(current, 1, size, viewport, resolved)),
    pan: (dx, dy) => update((current) => panBy(current, dx, dy, size, viewport, resolved)),
    scrollToEdge: (edge) =>
      update((current) => scrollToEdge(current, edge, size, viewport, resolved)),
    reset: () => setState({ key, view: initialView(size, resolved) }),
  };
}

/** How long zooming or resizing must pause before a new bitmap is rendered for it. */
const RENDER_SETTLE_MS = 150;

/**
 * The zoomed content's long edge in device pixels, once zooming and resizing pause; null until
 * then. Bitmaps are drawn with nearest-neighbour sampling, so a picture is only sharp when it
 * is rendered at the size it is shown: apps re-render their page or image at this size.
 */
export function useShownSize(zoom: Zoom, ready: boolean): number | null {
  const wanted = Math.round(Math.max(zoom.placement.width, zoom.placement.height));
  const [settled, setSettled] = useState<number | null>(null);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => setSettled(wanted), RENDER_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [wanted, ready]);
  return ready ? settled : null;
}

/** Keyboard zoom: + and = zoom in, - zooms out, 0 fits (with or without Ctrl). */
export function zoomShortcuts(zoom: Zoom, disabled = false): Shortcut[] {
  const zoomIn = () => zoom.zoomBy(1);
  const zoomOut = () => zoom.zoomBy(-1);
  return [
    { id: "zoom-in", key: "=", allowRepeat: true, onInvoke: zoomIn },
    {
      id: "zoom-in-shift",
      key: "+",
      shift: true,
      allowRepeat: true,
      onInvoke: zoomIn,
    },
    { id: "zoom-in-keypad", key: "+", allowRepeat: true, onInvoke: zoomIn },
    {
      id: "zoom-in-ctrl",
      key: "=",
      ctrl: true,
      allowRepeat: true,
      onInvoke: zoomIn,
    },
    { id: "zoom-out", key: "-", allowRepeat: true, onInvoke: zoomOut },
    {
      id: "zoom-out-ctrl",
      key: "-",
      ctrl: true,
      allowRepeat: true,
      onInvoke: zoomOut,
    },
    { id: "zoom-fit", key: "0", onInvoke: zoom.fit },
    { id: "zoom-fit-ctrl", key: "0", ctrl: true, onInvoke: zoom.fit },
  ].map((shortcut) => ({ ...shortcut, disabled }));
}

/**
 * Draws `children` at the zoom's placement and turns input into zoom changes: the wheel zooms
 * about the pointer (or, with `wheel="scroll"`, scrolls and zooms only with Ctrl), and dragging
 * pans when the content overflows.
 */
export function ZoomSurface(props: {
  width: number;
  height: number;
  zoom: Zoom;
  wheel?: "zoom" | "scroll";
  focusId?: string;
  children: (placement: Placement) => ReactNode;
}): ReactNode {
  const drag = useRef<{ x: number; y: number } | null>(null);
  const { zoom } = props;
  const viewport = { width: props.width, height: props.height };
  const movable = canPan(zoom.placement, viewport);
  return (
    <Surface width={props.width} height={props.height} fill={0x00000000} clip>
      {props.children(zoom.placement)}
      <PointerArea
        width={props.width}
        height={props.height}
        focusable
        focusId={props.focusId}
        onWheel={(event) => {
          const delta = event.deltaY ?? 0;
          if (!delta) return false;
          if (props.wheel === "scroll" && !event.ctrlKey) {
            if (!movable) return false;
            zoom.pan(0, -Math.sign(delta) * Math.min(Math.abs(delta), SCROLL_STEP * 3));
            return true;
          }
          zoom.zoomBy(-delta / WHEEL_PER_STEP, {
            x: event.localX,
            y: event.localY,
          });
          return true;
        }}
        onPointerDown={(event) => {
          if (event.button && event.button !== "left") return;
          drag.current = { x: event.x, y: event.y };
        }}
        onPointerMove={(event) => {
          const from = drag.current;
          if (!from) return;
          drag.current = { x: event.x, y: event.y };
          if (movable) zoom.pan(event.x - from.x, event.y - from.y);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          const step = SCROLL_STEP * getUiScaleFactor();
          if (!movable) return false;
          if (event.key === "ArrowUp") zoom.pan(0, step);
          else if (event.key === "ArrowDown") zoom.pan(0, -step);
          else if (event.key === "ArrowLeft") zoom.pan(step, 0);
          else if (event.key === "ArrowRight") zoom.pan(-step, 0);
          else return false;
          return true;
        }}
      />
    </Surface>
  );
}

/** Four 32px buttons, the 52px readout and a separator, with the tool row's 2px gaps. */
const ZOOM_CONTROLS_WIDTH = 32 * 4 + 52 + 13 + 2 * 5;

/** Zoom out, the zoom level, zoom in, fit and actual size, for a tool row. */
export function ZoomControls(props: {
  zoom: Zoom;
  idPrefix: string;
  disabled?: boolean;
  /** Tooltip for the fit button ("Fit to window", "Fit width"). */
  fitLabel?: string;
}): ReactNode {
  const ui = getUiScaleFactor();
  const { zoom, disabled } = props;
  return (
    <Horizontal
      width={ZOOM_CONTROLS_WIDTH * ui}
      height={32 * ui}
      gap={2 * ui}
      align="center"
      flexShrink={0}
    >
      <ToolButton
        icon="zoom-out"
        tooltip="Zoom out (-)"
        focusId={`${props.idPrefix}:zoom-out`}
        disabled={disabled || zoom.scale <= zoom.limits.min}
        onPress={() => zoom.zoomBy(-1)}
      />
      <ToolReadout text={disabled ? "—" : `${Math.round(zoom.scale * 100)}%`} />
      <ToolButton
        icon="zoom-in"
        tooltip="Zoom in (+)"
        focusId={`${props.idPrefix}:zoom-in`}
        disabled={disabled || zoom.scale >= zoom.limits.max}
        onPress={() => zoom.zoomBy(1)}
      />
      <ToolSeparator />
      <ToolButton
        icon="zoom-fit"
        tooltip={`${props.fitLabel ?? "Fit to window"} (0)`}
        focusId={`${props.idPrefix}:fit`}
        selected={zoom.fitted}
        disabled={disabled}
        onPress={zoom.fit}
      />
      <ToolButton
        icon="zoom-fit"
        text="1:1"
        tooltip="Actual size"
        focusId={`${props.idPrefix}:actual`}
        selected={zoom.actual}
        disabled={disabled}
        onPress={zoom.actualSize}
      />
    </Horizontal>
  );
}

registerIntrinsicSize(ZoomControls, () => ({
  width: ZOOM_CONTROLS_WIDTH * getUiScaleFactor(),
  height: 32 * getUiScaleFactor(),
}));
