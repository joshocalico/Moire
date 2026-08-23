/** Bundled bitmap icons with renderer-neutral geometric fallbacks. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React, { type ReactNode } from "react";
import { Group, Image, Rect } from "@moire/react-host";
import { useWidgetTheme } from "../widget-theme.js";
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
  | "list"
  | "search"
  | "close";

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
  "search",
  "close",
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
  return fs.existsSync(bundled) ? bundled : null;
}

function tryLoad(name: string, explicit?: string): ImageData | null {
  const iconPath = resolveIconPath(name, explicit);
  if (!iconPath) return null;
  try {
    return loadImageSync(iconPath);
  } catch {
    return null;
  }
}

function drawFallback(name: string, size: number, color: number): ReactNode {
  const pixel = Math.max(1, Math.round(size / 16));
  const dim = (color & 0x00ffffff) | 0x99000000;
  if (name === "folder") {
    const tabWidth = Math.round(size * 0.45);
    const tabHeight = Math.round(size * 0.18);
    const bodyY = tabHeight - pixel;
    return (
      <>
        <Rect x={0} y={bodyY} width={size} height={size - bodyY} fill={color} />
        <Rect x={0} y={0} width={tabWidth} height={tabHeight + pixel} fill={color} />
      </>
    );
  }
  if (name === "file") {
    const fold = Math.round(size * 0.3);
    return (
      <>
        <Rect x={0} y={0} width={size - fold} height={size} fill={color} />
        <Rect x={size - fold} y={fold} width={fold} height={size - fold} fill={color} />
        <Rect x={size - fold} y={0} width={fold} height={fold} fill={dim} />
      </>
    );
  }
  if (name === "search") {
    const lens = Math.max(4, Math.round(size * 0.62));
    const handleSteps = Math.max(2, Math.floor((size - lens) / pixel));
    return (
      <>
        <Rect
          x={pixel}
          y={pixel}
          width={lens}
          height={lens}
          fill={0x00000000}
          radius={Math.floor(lens / 2)}
          stroke={color}
          strokeWidth={pixel}
        />
        {Array.from({ length: handleSteps }, (_, index) => (
          <Rect
            key={index}
            x={lens - pixel + index * pixel}
            y={lens - pixel + index * pixel}
            width={pixel}
            height={pixel}
            fill={color}
          />
        ))}
      </>
    );
  }
  if (name === "close") {
    const steps = Math.max(4, Math.floor(size / Math.max(2, pixel * 2)));
    const step = (size - pixel) / Math.max(1, steps - 1);
    return (
      <>
        {Array.from({ length: steps }, (_, index) => {
          const offset = Math.round(index * step);
          return (
            <React.Fragment key={index}>
              <Rect
                x={offset}
                y={offset}
                width={pixel}
                height={pixel}
                fill={color}
              />
              <Rect
                x={size - pixel - offset}
                y={offset}
                width={pixel}
                height={pixel}
                fill={color}
              />
            </React.Fragment>
          );
        })}
      </>
    );
  }
  return <Rect x={0} y={0} width={size} height={size} fill={color} />;
}

export function Icon(props: IconProps): ReactNode {
  const palette = useWidgetTheme().foundations.palette;
  const size = props.size ?? 16;
  const color = props.color ?? palette.text;
  const name = String(props.name);
  const bitmap = tryLoad(name, props.path);

  if (bitmap) {
    return (
      <Image
        x={props.x ?? 0}
        y={props.y ?? 0}
        width={size}
        height={size}
        imagePixels={bitmap.rgba}
        imageWidth={bitmap.width}
        imageHeight={bitmap.height}
      />
    );
  }

  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={size}
      height={size}
    >
      {drawFallback(KNOWN.has(name) ? name : "file", size, color)}
    </Group>
  );
}
