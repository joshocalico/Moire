/** Keyboard navigation inside a folder page: arrows, Home/End, Space to preview, Ctrl+Space. */
import type { HitKeyEvent, SelectionModel } from "@moire/ui";

export type CollectionShape =
  /** One focus order: Up/Down step through cards then rows; Left/Right step among cards. */
  | { kind: "list"; card: boolean }
  /** Tiles in rows of `columns`. */
  | { kind: "grid"; columns: number };

export function handleCollectionKey(
  event: HitKeyEvent,
  key: string,
  context: {
    selection: SelectionModel<string>;
    shape: CollectionShape;
    onPreview(key: string): void;
  },
): boolean {
  const { selection, shape } = context;
  const additive = event.ctrlKey || event.metaKey;
  if (event.key === " " || event.code === 57) {
    // Ctrl+Space toggles the focused item; Space alone previews it.
    if (additive || event.shiftKey)
      selection.select(key, { toggle: additive, range: event.shiftKey });
    else {
      if (!selection.isSelected(key)) selection.select(key);
      context.onPreview(key);
    }
    return true;
  }
  const moveOptions = { extend: event.shiftKey, preserveSelection: additive && !event.shiftKey };
  if (event.key === "Home" || event.code === 102) {
    selection.first(moveOptions);
    return true;
  }
  if (event.key === "End" || event.code === 107) {
    selection.last(moveOptions);
    return true;
  }
  const left = event.key === "ArrowLeft" || event.code === 105;
  const right = event.key === "ArrowRight" || event.code === 106;
  const up = event.key === "ArrowUp" || event.code === 103;
  const down = event.key === "ArrowDown" || event.code === 108;
  if (!(left || right || up || down) || event.altKey) return false;
  const sideways = shape.kind === "grid" || shape.card;
  const step = shape.kind === "grid" ? shape.columns : 1;
  const delta = left ? (sideways ? -1 : 0) : right ? (sideways ? 1 : 0) : (up ? -1 : 1) * step;
  if (delta !== 0) selection.move(delta, moveOptions);
  return true;
}
