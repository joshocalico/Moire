/** Rubber-band selection over a page's empty space; a plain click there clears the selection. */
import { useRef, useState } from "react";
import { focusIdsInRect, type HitPointerEvent, type SelectionModel } from "@moire/ui";
import { ENTRY_FOCUS_PREFIX, rectFromPoints } from "./model";
import type { RubberBand } from "./views/page-scroller";

/** Pointer travel before a background press becomes a rubber band. */
const THRESHOLD = 4;

export function useRubberBand(selection: SelectionModel<string>): RubberBand {
  // Window coordinates for hit queries, the page's own for drawing.
  const band = useRef<{
    start: { x: number; y: number };
    local: { x: number; y: number };
    base: readonly string[];
    active: boolean;
  } | null>(null);
  const [rect, setRect] = useState<RubberBand["rect"]>(null);
  return {
    rect,
    onPointerDown: (event: HitPointerEvent) => {
      const additive = !!(event.ctrlKey || event.metaKey || event.shiftKey);
      band.current = {
        start: { x: event.x, y: event.y },
        local: { x: event.localX, y: event.localY },
        base: additive ? selection.selectedKeysInOrder : [],
        active: false,
      };
    },
    onPointerMove: (event: HitPointerEvent) => {
      const current = band.current;
      if (!current) return;
      if (
        !current.active &&
        Math.hypot(event.x - current.start.x, event.y - current.start.y) < THRESHOLD
      )
        return;
      current.active = true;
      const covered = focusIdsInRect(rectFromPoints(current.start, { x: event.x, y: event.y }))
        .filter((id) => id.startsWith(ENTRY_FOCUS_PREFIX))
        .map((id) => id.slice(ENTRY_FOCUS_PREFIX.length));
      selection.selectKeys(new Set([...current.base, ...covered]), covered.at(-1) ?? null);
      setRect(
        rectFromPoints(current.local, {
          x: current.local.x + event.x - current.start.x,
          y: current.local.y + event.y - current.start.y,
        }),
      );
    },
    onPointerUp: () => {
      const current = band.current;
      band.current = null;
      setRect(null);
      if (current && !current.active && current.base.length === 0) selection.clear();
    },
  };
}
