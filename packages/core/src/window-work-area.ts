/** Logical output/work-area placement. Radius/paint/shadow do not change allocation. */
export type WorkAreaRect = { x: number; y: number; width: number; height: number };
export function desktopWorkArea(output: WorkAreaRect, panelTop: number | null): WorkAreaRect {
  return {
    ...output,
    height:
      panelTop === null ? output.height : Math.max(0, Math.min(output.height, panelTop - output.y)),
  };
}
export function fitWindowToWorkArea(input: {
  area: WorkAreaRect;
  preferred: { width: number; height: number };
  position: { x: number; y: number };
  chromeHeight: number;
  minimum: { width: number; height: number };
  maximum: { width: number; height: number };
}) {
  const { area, preferred, chromeHeight, minimum, maximum } = input;
  function dimension(preferredValue: number, available: number, min: number, max: number) {
    const limit = max > 0 ? Math.max(min, max) : Number.POSITIVE_INFINITY;
    return Math.max(min, Math.min(preferredValue, Math.max(1, available), limit));
  }
  const width = dimension(preferred.width, area.width, minimum.width, maximum.width);
  const height = dimension(
    preferred.height,
    area.height - chromeHeight,
    minimum.height,
    maximum.height,
  );
  const x = Math.max(area.x, Math.min(input.position.x, area.x + area.width - width));
  const y = Math.max(
    area.y,
    Math.min(input.position.y, area.y + area.height - height - chromeHeight),
  );
  return {
    x,
    y,
    width,
    height,
    status:
      width > area.width || height + chromeHeight > area.height
        ? "minimum-exceeds-work-area"
        : "fits",
  };
}
