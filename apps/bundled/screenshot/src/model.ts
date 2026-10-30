/** Screenshot app state that is not pixels: tools, capture options, prompts and file naming. */
import os from "node:os";
import path from "node:path";
import type { ImageData } from "@moire/ui";
import { cropBounds, parseColor, type Bounds, type Edit, type Point } from "./image";

export const SCREENSHOT_APP_ID = "org.moire.Screenshot";

export type Tool = "crop" | "pen" | "rectangle";
export const PEN_WIDTH = 4;

/** Whole screen, or the screen followed by dragging out the part to keep. */
export type CaptureArea = "screen" | "area";
export type CaptureOptions = { area: CaptureArea; delay: number };
export const CAPTURE_DELAYS = [0, 3, 5, 10] as const;
export const DEFAULT_CAPTURE: CaptureOptions = { area: "screen", delay: 3 };

/** Things that replace or leave the current image, so unsaved changes are asked about first. */
export type Intent =
  | { kind: "close" }
  | { kind: "open"; file: string }
  | { kind: "capture"; options: CaptureOptions };

/** What runs after a save succeeds. */
export type AfterSave = Intent | { kind: "copy-path" } | { kind: "show-in-files" } | null;

export type SaveRequest = {
  image: ImageData;
  revision: number;
  target: string;
  after: AfterSave;
};

export type Prompt =
  | { kind: "unsaved"; intent: Intent }
  | { kind: "new-capture" }
  | { kind: "choose-open" }
  | { kind: "choose-save"; after: AfterSave }
  | { kind: "crop" }
  | { kind: "overwrite"; save: SaveRequest };

export type Gesture = { start: Point; points: Point[]; end: Point };

/** "Screenshot 2026-10-10 at 14.03.22.png": sortable, readable, and safe on every filesystem. */
export function screenshotName(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `Screenshot ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} at ${pad(date.getHours())}.${pad(date.getMinutes())}.${pad(date.getSeconds())}.png`;
}

/** The name an opened PNG is saved under by default, so the original is not replaced. */
export function editedName(file: string): string {
  return `${path.basename(file, path.extname(file))} (edited).png`;
}

/**
 * The file a typed name saves to: absolute and ~ paths as typed, bare names in `directory`.
 * A name without an extension gets ".png".
 */
export function saveTarget(input: string, directory: string): string {
  const name = input.trim();
  const expanded =
    name === "~"
      ? os.homedir()
      : name.startsWith("~/")
        ? path.join(os.homedir(), name.slice(2))
        : name;
  const file = path.isAbsolute(expanded) ? expanded : path.join(directory, expanded);
  return path.extname(file) ? file : `${file}.png`;
}

/** A folder as people read it: ~/Pictures/Screenshots rather than /home/ada/Pictures/Screenshots. */
export function displayFolder(directory: string): string {
  const home = os.homedir();
  return directory === home || directory.startsWith(home + path.sep)
    ? `~${directory.slice(home.length)}`
    : directory;
}

export function gestureBounds(gesture: Gesture): Bounds {
  return {
    x: Math.min(gesture.start.x, gesture.end.x),
    y: Math.min(gesture.start.y, gesture.end.y),
    width: Math.abs(gesture.end.x - gesture.start.x),
    height: Math.abs(gesture.end.y - gesture.start.y),
  };
}

/** The edit a finished drag makes with `tool`; throws a message to show for an empty crop. */
export function gestureEdit(tool: Tool, gesture: Gesture, image: ImageData, color: string): Edit {
  if (tool === "crop") return { kind: "crop", bounds: cropBounds(image, gestureBounds(gesture)) };
  if (tool === "pen")
    return {
      kind: "pen",
      points: gesture.points,
      color: parseColor(color),
      width: PEN_WIDTH,
    };
  return {
    kind: "rectangle",
    bounds: gestureBounds(gesture),
    color: parseColor(color),
    width: PEN_WIDTH,
  };
}

export function toolHint(tool: Tool): string {
  return tool === "crop"
    ? "Drag over the part to keep"
    : tool === "pen"
      ? "Drag to draw"
      : "Drag to mark a box";
}
