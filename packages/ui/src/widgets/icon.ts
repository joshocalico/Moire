/**
 * Icon — bundled PNG set under packages/ui/icons/, with geometric fallback.
 * Names: folder | file | image | app | trash | home | desktop | downloads | up | grid | list
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactNode } from "react";
import { Group, Image, Rect } from "@moire/react-host";
import { themePalette } from "../theme.js";
import { loadImageSync, type ImageData } from "../image/load.js";

export type IconName =
  | "folder"
  | "file"
  | "image"
  | "app"
  | "trash"
  | "home"
  | "desktop"
  | "downloads"
  | "up"
  | "grid"
  | "list";

export type IconProps = {
  x?: number;
  y?: number;
  name: IconName | (string & {});
  size?: number;
  /** Tint hint for geometric fallback only; PNGs ship their own colors. */
  color?: number;
  path?: string;
};

const KNOWN: ReadonlySet<string> = new Set([
  "folder",
  "file",
  "image",
  "app",
  "trash",
  "home",
  "desktop",
  "downloads",
  "up",
  "grid",
  "list",
]);

function iconsDir(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../icons",
  );
}

function resolveIconPath(name: string, explicit?: string): string | null {
  if (explicit && fs.existsSync(explicit)) return explicit;
  const bundled = path.join(iconsDir(), `${name}.png`);
  if (fs.existsSync(bundled)) return bundled;
  return null;
}

function tryLoad(name: string, explicit?: string): ImageData | null {
  const p = resolveIconPath(name, explicit);
  if (!p) return null;
  try {
    return loadImageSync(p);
  } catch {
    return null;
  }
}

function r(
  x: number,
  y: number,
  w: number,
  h: number,
  fill: number,
  key?: number,
): ReactNode {
  return createElement(Rect, { key, x, y, width: w, height: h, fill });
}

function drawFallback(
  name: string,
  s: number,
  color: number,
): ReactNode[] {
  const p = Math.max(1, Math.round(s / 16));
  const dim = (color & 0xffffff) | 0x99000000;
  switch (name) {
    case "folder": {
      const tabW = Math.round(s * 0.45);
      const tabH = Math.round(s * 0.18);
      const bodyY = tabH - p;
      return [
        r(0, bodyY, s, s - bodyY, color, 0),
        r(0, 0, tabW, tabH + p, color, 1),
      ];
    }
    case "file": {
      const fold = Math.round(s * 0.3);
      return [
        r(0, 0, s - fold, s, color, 0),
        r(s - fold, fold, fold, s - fold, color, 1),
        r(s - fold, 0, fold, fold, dim, 2),
      ];
    }
    default:
      return [r(0, 0, s, s, color, 0)];
  }
}

export function Icon(props: IconProps): ReactNode {
  const pal = themePalette();
  const size = props.size ?? 16;
  const color = props.color ?? pal.text;
  const name = String(props.name);
  const bitmap = tryLoad(name, props.path);

  if (bitmap) {
    return createElement(Image, {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: size,
      height: size,
      imagePixels: bitmap.rgba,
      imageWidth: bitmap.width,
      imageHeight: bitmap.height,
    });
  }

  const parts = drawFallback(
    KNOWN.has(name) ? name : "file",
    size,
    color,
  );
  return createElement(
    Group,
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: size,
      height: size,
    },
    ...parts,
  );
}
