/** Image Viewer's state: which image is open, how it is turned, and its place in its folder. */
import path from "node:path";
import { errorText, localPath } from "@moire/app-tools";

/** Extensions the viewer decodes (ffmpeg's image readers), without dots. */
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"];

export function isImage(file: string): boolean {
  return IMAGE_EXTENSIONS.includes(path.extname(file).slice(1).toLowerCase());
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/** Natural name order ("img2" before "img10"), as the file chooser and Files list them. */
export function sortImages(files: readonly string[]): string[] {
  return [...files].sort((a, b) => collator.compare(path.basename(a), path.basename(b)));
}

export type ViewerState =
  | { kind: "empty"; error?: string }
  | {
      kind: "open";
      file: string;
      /** Quarter turns clockwise; a preview only, the file is never rewritten. */
      turns: number;
      /** Bumped by Try again, to decode the same file afresh. */
      attempt: number;
    };

export type ViewerAction =
  | { type: "open"; file: string }
  | { type: "close"; error?: string }
  | { type: "rotate"; by: 1 | -1 }
  | { type: "retry" };

/** The state for a launch argument (a path or file URL), if any. */
export function initialState(argument?: string): ViewerState {
  if (!argument) return { kind: "empty" };
  try {
    return { kind: "open", file: localPath(argument), turns: 0, attempt: 0 };
  } catch (error) {
    return { kind: "empty", error: errorText(error) };
  }
}

export function reduce(state: ViewerState, action: ViewerAction): ViewerState {
  switch (action.type) {
    case "open":
      return { kind: "open", file: action.file, turns: 0, attempt: 0 };
    case "close":
      return { kind: "empty", error: action.error };
    case "rotate":
      return state.kind === "open" ? { ...state, turns: state.turns + action.by } : state;
    case "retry":
      return state.kind === "open" ? { ...state, attempt: state.attempt + 1 } : state;
  }
}

/** Where `file` sits among its folder's images: "3 of 12". Null when it is not listed. */
export function folderPosition(
  images: readonly string[],
  file: string,
): { index: number; total: number } | null {
  const index = images.indexOf(path.resolve(file));
  return index < 0 ? null : { index, total: images.length };
}

/** The image `delta` places from `file` in its folder, or null at either end. */
export function neighbour(images: readonly string[], file: string, delta: number): string | null {
  const position = folderPosition(images, file);
  if (!position) return null;
  return images[position.index + delta] ?? null;
}
