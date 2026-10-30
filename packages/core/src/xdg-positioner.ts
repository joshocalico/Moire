/** xdg_positioner placement math (xdg-shell stable); pure and protocol-agnostic. */

/** xdg_positioner.anchor / gravity. */
const XDG_ANCHOR_NONE = 0;
const XDG_ANCHOR_TOP = 1;
const XDG_ANCHOR_BOTTOM = 2;
const XDG_ANCHOR_LEFT = 3;
const XDG_ANCHOR_RIGHT = 4;
const XDG_ANCHOR_TOP_LEFT = 5;
const XDG_ANCHOR_BOTTOM_LEFT = 6;
const XDG_ANCHOR_TOP_RIGHT = 7;
const XDG_ANCHOR_BOTTOM_RIGHT = 8;

const XDG_CONSTRAINT_SLIDE_X = 1;
const XDG_CONSTRAINT_SLIDE_Y = 2;

export type PositionerState = {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  anchorW: number;
  anchorH: number;
  anchor: number;
  gravity: number;
  constraintAdjustment: number;
  offsetX: number;
  offsetY: number;
};

export function emptyPositioner(): PositionerState {
  return {
    width: 0,
    height: 0,
    anchorX: 0,
    anchorY: 0,
    anchorW: 0,
    anchorH: 0,
    anchor: XDG_ANCHOR_NONE,
    gravity: XDG_ANCHOR_NONE,
    constraintAdjustment: 0,
    offsetX: 0,
    offsetY: 0,
  };
}

function xdgAnchorPoint(
  x: number,
  y: number,
  w: number,
  h: number,
  anchor: number,
): { x: number; y: number } {
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (anchor) {
    case XDG_ANCHOR_TOP:
      return { x: cx, y };
    case XDG_ANCHOR_BOTTOM:
      return { x: cx, y: y + h };
    case XDG_ANCHOR_LEFT:
      return { x, y: cy };
    case XDG_ANCHOR_RIGHT:
      return { x: x + w, y: cy };
    case XDG_ANCHOR_TOP_LEFT:
      return { x, y };
    case XDG_ANCHOR_BOTTOM_LEFT:
      return { x, y: y + h };
    case XDG_ANCHOR_TOP_RIGHT:
      return { x: x + w, y };
    case XDG_ANCHOR_BOTTOM_RIGHT:
      return { x: x + w, y: y + h };
    default:
      return { x: cx, y: cy };
  }
}

/** Offset from popup top-left to the gravity point. */
function xdgGravityOffset(w: number, h: number, gravity: number): { dx: number; dy: number } {
  switch (gravity) {
    case XDG_ANCHOR_TOP:
      return { dx: w / 2, dy: 0 };
    case XDG_ANCHOR_BOTTOM:
      return { dx: w / 2, dy: h };
    case XDG_ANCHOR_LEFT:
      return { dx: 0, dy: h / 2 };
    case XDG_ANCHOR_RIGHT:
      return { dx: w, dy: h / 2 };
    case XDG_ANCHOR_TOP_LEFT:
      return { dx: 0, dy: 0 };
    case XDG_ANCHOR_BOTTOM_LEFT:
      return { dx: 0, dy: h };
    case XDG_ANCHOR_TOP_RIGHT:
      return { dx: w, dy: 0 };
    case XDG_ANCHOR_BOTTOM_RIGHT:
      return { dx: w, dy: h };
    default:
      return { dx: w / 2, dy: h / 2 };
  }
}

/** Place popup window-geometry relative to parent window-geometry. */
export function placePopupRelative(
  pos: PositionerState,
  outputW: number,
  outputH: number,
  parentGeomScreenX: number,
  parentGeomScreenY: number,
): { x: number; y: number; w: number; h: number } {
  const pw = Math.max(1, pos.width);
  const ph = Math.max(1, pos.height);
  const anchor = xdgAnchorPoint(pos.anchorX, pos.anchorY, pos.anchorW, pos.anchorH, pos.anchor);
  const grav = xdgGravityOffset(pw, ph, pos.gravity);
  let relX = anchor.x - grav.dx + pos.offsetX;
  let relY = anchor.y - grav.dy + pos.offsetY;
  let w = pw;
  let h = ph;

  // Slide into output bounds (parent-relative → screen → clamp → relative).
  const adj = pos.constraintAdjustment;
  let screenX = parentGeomScreenX + relX;
  let screenY = parentGeomScreenY + relY;
  if (adj & XDG_CONSTRAINT_SLIDE_X) {
    if (screenX + w > outputW) screenX = outputW - w;
    if (screenX < 0) screenX = 0;
  }
  if (adj & XDG_CONSTRAINT_SLIDE_Y) {
    if (screenY + h > outputH) screenY = outputH - h;
    if (screenY < 0) screenY = 0;
  }
  // Always soft-clamp so menus stay visible even if client omitted slide flags.
  if (screenX + w > outputW) screenX = Math.max(0, outputW - w);
  if (screenY + h > outputH) screenY = Math.max(0, outputH - h);
  if (screenX < 0) screenX = 0;
  if (screenY < 0) screenY = 0;

  relX = screenX - parentGeomScreenX;
  relY = screenY - parentGeomScreenY;
  return { x: Math.round(relX), y: Math.round(relY), w, h };
}
