/**
 * Zoom and pan for a picture shown in a viewport (an image, a document page): fit by default,
 * zoom about a point, drag to pan, and clamping so the content never drifts out of view.
 *
 * A view stores the content point shown at the viewport's centre rather than a pixel offset, so
 * it survives window resizes and fit-mode rescaling without jumping.
 */

export type Size = { width: number; height: number };

/** "contain" fits the whole picture; "width" fits its width and lets it scroll vertically. */
export type FitMode = "contain" | "width";

export type ZoomView = {
  /** "fit" follows the viewport; a number is a fixed scale (1 = actual size). */
  scale: "fit" | number;
  /** The content point (in content pixels) at the viewport's centre. */
  centerX: number;
  centerY: number;
};

export type ZoomLimits = {
  min: number;
  max: number;
  /** Fit never enlarges past this scale (1 keeps small images at actual size). */
  maxFit: number;
  fit: FitMode;
  /** Space kept between the content and the viewport edge. */
  margin: number;
};

/** The resolved placement of the content: its scale and its top-left in the viewport. */
export type Placement = {
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export const ZOOM_STEP = 1.25;

/** A fresh view: fitted, centred horizontally, and from the top for width-fitted pages. */
export function initialView(content: Size, limits: Pick<ZoomLimits, "fit">): ZoomView {
  return {
    scale: "fit",
    centerX: content.width / 2,
    centerY: limits.fit === "width" ? 0 : content.height / 2,
  };
}

export function fitScale(content: Size, viewport: Size, limits: ZoomLimits): number {
  if (content.width <= 0 || content.height <= 0) return 1;
  const across = (viewport.width - limits.margin * 2) / content.width;
  const down = (viewport.height - limits.margin * 2) / content.height;
  const scale = limits.fit === "width" ? across : Math.min(across, down);
  return clamp(Math.min(scale, limits.maxFit), limits.min, limits.max);
}

export function currentScale(
  view: ZoomView,
  content: Size,
  viewport: Size,
  limits: ZoomLimits,
): number {
  return view.scale === "fit" ? fitScale(content, viewport, limits) : view.scale;
}

/** One axis: centre content smaller than the viewport, otherwise keep both edges reachable. */
function placeAxis(center: number, scale: number, length: number, span: number, margin: number) {
  const scaled = length * scale;
  if (scaled + margin * 2 <= span) return (span - scaled) / 2;
  return clamp(span / 2 - center * scale, span - margin - scaled, margin);
}

export function place(
  view: ZoomView,
  content: Size,
  viewport: Size,
  limits: ZoomLimits,
): Placement {
  const scale = currentScale(view, content, viewport, limits);
  return {
    scale,
    x: placeAxis(view.centerX, scale, content.width, viewport.width, limits.margin),
    y: placeAxis(view.centerY, scale, content.height, viewport.height, limits.margin),
    width: Math.max(1, Math.round(content.width * scale)),
    height: Math.max(1, Math.round(content.height * scale)),
  };
}

/** The view that shows `placement`, so clamped positions become the stored state. */
function viewOf(scale: ZoomView["scale"], placement: Placement, viewport: Size): ZoomView {
  return {
    scale,
    centerX: (viewport.width / 2 - placement.x) / placement.scale,
    centerY: (viewport.height / 2 - placement.y) / placement.scale,
  };
}

/** Zoom to `next`, keeping the content under `anchor` (viewport pixels) where it is. */
export function zoomTo(
  view: ZoomView,
  next: number | "fit",
  content: Size,
  viewport: Size,
  limits: ZoomLimits,
  anchor: { x: number; y: number } = {
    x: viewport.width / 2,
    y: viewport.height / 2,
  },
): ZoomView {
  const before = place(view, content, viewport, limits);
  const scale = next === "fit" ? "fit" : clamp(next, limits.min, limits.max);
  const resolved = scale === "fit" ? fitScale(content, viewport, limits) : scale;
  const pointX = (anchor.x - before.x) / before.scale;
  const pointY = (anchor.y - before.y) / before.scale;
  const moved: ZoomView = {
    scale,
    centerX: pointX + (viewport.width / 2 - anchor.x) / resolved,
    centerY: pointY + (viewport.height / 2 - anchor.y) / resolved,
  };
  return viewOf(scale, place(moved, content, viewport, limits), viewport);
}

/** Zoom in (`steps` > 0) or out by whole ZOOM_STEPs about `anchor`. */
export function zoomBy(
  view: ZoomView,
  steps: number,
  content: Size,
  viewport: Size,
  limits: ZoomLimits,
  anchor?: { x: number; y: number },
): ZoomView {
  const scale = currentScale(view, content, viewport, limits);
  return zoomTo(view, scale * ZOOM_STEP ** steps, content, viewport, limits, anchor);
}

/** Move the content by a pointer drag of (dx, dy) viewport pixels. */
export function panBy(
  view: ZoomView,
  dx: number,
  dy: number,
  content: Size,
  viewport: Size,
  limits: ZoomLimits,
): ZoomView {
  const scale = currentScale(view, content, viewport, limits);
  const moved = {
    ...view,
    centerX: view.centerX - dx / scale,
    centerY: view.centerY - dy / scale,
  };
  return viewOf(view.scale, place(moved, content, viewport, limits), viewport);
}

/** Show the top (or bottom) of the content, keeping the scale and horizontal position. */
export function scrollToEdge(
  view: ZoomView,
  edge: "top" | "bottom",
  content: Size,
  viewport: Size,
  limits: ZoomLimits,
): ZoomView {
  const moved = { ...view, centerY: edge === "top" ? 0 : content.height };
  return viewOf(view.scale, place(moved, content, viewport, limits), viewport);
}

/** Whether the content overflows the viewport, so dragging it does something. */
export function canPan(placement: Placement, viewport: Size): boolean {
  return (
    placement.x < 0 ||
    placement.y < 0 ||
    placement.x + placement.width > viewport.width ||
    placement.y + placement.height > viewport.height
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
