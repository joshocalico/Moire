/** The zoom model: fit, zoom about a point, pan clamping and page-edge scrolling. */
import assert from "node:assert/strict";
import {
  canPan,
  fitScale,
  initialView,
  panBy,
  place,
  scrollToEdge,
  zoomBy,
  zoomTo,
  type ZoomLimits,
} from "./zoom";

const image = { width: 2000, height: 1000 };
const viewport = { width: 800, height: 600 };
const contain: ZoomLimits = {
  min: 0.05,
  max: 8,
  maxFit: 1,
  fit: "contain",
  margin: 0,
};

// Fit shows the whole image, centred, and never enlarges small images.
const fitted = place(initialView(image, contain), image, viewport, contain);
assert.equal(fitted.scale, 0.4);
assert.deepEqual([fitted.x, fitted.y, fitted.width, fitted.height], [0, 100, 800, 400]);
assert.equal(fitScale({ width: 100, height: 50 }, viewport, contain), 1);
assert.equal(canPan(fitted, viewport), false);

// Zooming about a point keeps that content point under the pointer.
const anchor = { x: 200, y: 300 };
const before = place(initialView(image, contain), image, viewport, contain);
const pointX = (anchor.x - before.x) / before.scale;
const zoomed = zoomTo(initialView(image, contain), 1, image, viewport, contain, anchor);
const after = place(zoomed, image, viewport, contain);
assert.equal(after.scale, 1);
assert.ok(Math.abs(after.x + pointX * after.scale - anchor.x) < 1e-6, "pointer anchor holds");
assert.ok(canPan(after, viewport));

// Panning moves the content and stops at its edges.
const left = place(panBy(zoomed, 10_000, 0, image, viewport, contain), image, viewport, contain);
assert.equal(left.x, 0, "cannot drag past the left edge");
const right = place(panBy(zoomed, -10_000, 0, image, viewport, contain), image, viewport, contain);
assert.equal(right.x, viewport.width - image.width, "cannot drag past the right edge");

// Steps compound by ZOOM_STEP and clamp to the limits.
const steps = place(zoomBy(zoomed, 100, image, viewport, contain), image, viewport, contain);
assert.equal(steps.scale, 8);
const out = place(zoomBy(zoomed, -100, image, viewport, contain), image, viewport, contain);
assert.equal(out.scale, 0.05);

// Width fit (documents): the page starts at its top and scrolls to the bottom.
const page = { width: 816, height: 1056 };
const width: ZoomLimits = { ...contain, fit: "width", maxFit: 3, margin: 16 };
const top = place(initialView(page, width), page, viewport, width);
assert.equal(top.y, 16, "a width-fitted page opens at its top");
const bottom = place(
  scrollToEdge(initialView(page, width), "bottom", page, viewport, width),
  page,
  viewport,
  width,
);
assert.ok(Math.abs(bottom.y + bottom.height - (viewport.height - 16)) < 1, "End shows the foot");
console.log("[app-tools/zoom] fit, anchored zoom, pan clamping, limits and page edges passed");
