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
  | "close"
  | "chevron-up"
  | "chevron-down"
  | "remove";

export type IconProps = {
  x?: number;
  y?: number;
  name: IconName | (string & {});
  size?: number;
  /** Tint hint for geometric fallback only; PNGs ship their own colors. */
  color?: number;
  path?: string;
  /** Prefer tintable renderer-native artwork over the bundled bitmap. */
  symbolic?: boolean;
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
  "chevron-up",
  "chevron-down",
  "remove",
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
  const dim = (color & 0x00ffffff) | 0x66000000;
  const stroke = Math.max(1, pixel);
  if (name === "folder") {
    const bodyY = Math.max(4, Math.round(size * 0.3));
    return (
      <>
        <Rect x={1} y={bodyY} width={size - 2} height={size - bodyY - 1} fill={color} radius={Math.max(2, pixel * 2)} />
        <Rect x={2} y={2} width={Math.round(size * 0.46)} height={bodyY + 1} fill={color} radius={Math.max(2, pixel * 2)} />
        <Rect x={2} y={bodyY} width={size - 4} height={stroke} fill={dim} />
      </>
    );
  }
  if (name === "file") {
    const fold = Math.round(size * 0.3);
    return (
      <>
        <Rect x={2} y={1} width={size - 4} height={size - 2} fill={0x00000000} radius={Math.max(2, pixel * 2)} stroke={color} strokeWidth={stroke} />
        <Rect x={size - fold - 1} y={1} width={stroke} height={fold + 1} fill={color} />
        <Rect x={size - fold - 1} y={fold + 1} width={fold - 1} height={stroke} fill={color} />
        <Rect x={5} y={Math.round(size * 0.6)} width={size - 10} height={stroke} fill={dim} />
      </>
    );
  }
  if (name === "image") {
    const dot = Math.max(2, Math.round(size * 0.15));
    return (
      <>
        <Rect x={1} y={2} width={size - 2} height={size - 4} fill={0x00000000} radius={Math.max(2, pixel * 2)} stroke={color} strokeWidth={stroke} />
        <Rect x={Math.round(size * 0.62)} y={Math.round(size * 0.28)} width={dot} height={dot} fill={color} radius={dot} />
        <Rect x={3} y={Math.round(size * 0.67)} width={Math.round(size * 0.34)} height={2 * pixel} fill={color} />
        <Rect x={Math.round(size * 0.28)} y={Math.round(size * 0.56)} width={Math.round(size * 0.28)} height={2 * pixel} fill={color} />
        <Rect x={Math.round(size * 0.5)} y={Math.round(size * 0.68)} width={Math.round(size * 0.32)} height={2 * pixel} fill={color} />
      </>
    );
  }
  if (name === "home") {
    return (
      <>
        <Rect x={Math.round(size * 0.42)} y={1} width={Math.round(size * 0.16)} height={2 * pixel} fill={color} />
        <Rect x={Math.round(size * 0.28)} y={3} width={Math.round(size * 0.44)} height={2 * pixel} fill={color} />
        <Rect x={Math.round(size * 0.14)} y={5} width={Math.round(size * 0.72)} height={2 * pixel} fill={color} />
        <Rect x={2} y={7} width={size - 4} height={size - 8} fill={0x00000000} radius={Math.max(2, pixel * 2)} stroke={color} strokeWidth={stroke} />
        <Rect x={Math.round(size * 0.43)} y={Math.round(size * 0.65)} width={Math.max(2, Math.round(size * 0.16))} height={Math.round(size * 0.28)} fill={color} radius={pixel} />
      </>
    );
  }
  if (name === "desktop") {
    return (
      <>
        <Rect x={1} y={2} width={size - 2} height={Math.round(size * 0.62)} fill={0x00000000} radius={Math.max(2, pixel * 2)} stroke={color} strokeWidth={stroke} />
        <Rect x={Math.round(size * 0.44)} y={Math.round(size * 0.66)} width={Math.max(2, Math.round(size * 0.12))} height={Math.round(size * 0.18)} fill={color} />
        <Rect x={Math.round(size * 0.27)} y={size - 3} width={Math.round(size * 0.46)} height={stroke} fill={color} radius={pixel} />
      </>
    );
  }
  if (name === "downloads") {
    return (
      <>
        <Rect x={Math.round(size * 0.45)} y={1} width={Math.max(2, Math.round(size * 0.1))} height={Math.round(size * 0.55)} fill={color} radius={pixel} />
        <Rect x={Math.round(size * 0.28)} y={Math.round(size * 0.42)} width={Math.round(size * 0.44)} height={2 * pixel} fill={color} />
        <Rect x={Math.round(size * 0.38)} y={Math.round(size * 0.54)} width={Math.round(size * 0.24)} height={2 * pixel} fill={color} />
        <Rect x={2} y={size - 5} width={size - 4} height={4} fill={0x00000000} radius={2} stroke={color} strokeWidth={stroke} />
      </>
    );
  }
  if (name === "app") {
    const dot = Math.max(2, Math.round(size * 0.16));
    return (
      <>
        <Rect x={1} y={1} width={size - 2} height={size - 2} fill={0x00000000} radius={Math.max(3, Math.round(size * 0.25))} stroke={color} strokeWidth={stroke} />
        <Rect x={Math.round(size * 0.27)} y={Math.round(size * 0.27)} width={dot} height={dot} fill={color} radius={pixel} />
        <Rect x={Math.round(size * 0.57)} y={Math.round(size * 0.27)} width={dot} height={dot} fill={color} radius={pixel} />
        <Rect x={Math.round(size * 0.27)} y={Math.round(size * 0.57)} width={dot} height={dot} fill={color} radius={pixel} />
        <Rect x={Math.round(size * 0.57)} y={Math.round(size * 0.57)} width={dot} height={dot} fill={color} radius={pixel} />
      </>
    );
  }
  if (name === "grid") {
    const cell = Math.max(3, Math.floor((size - 5) / 2));
    return (
      <>
        {[0, 1].flatMap((row) => [0, 1].map((column) => (
          <Rect key={`${row}:${column}`} x={1 + column * (cell + 3)} y={1 + row * (cell + 3)} width={cell} height={cell} fill={color} radius={Math.max(1, pixel)} />
        )))}
      </>
    );
  }
  if (name === "list") {
    return (
      <>
        {[0, 1, 2].map((row) => (
          <React.Fragment key={row}>
            <Rect x={1} y={2 + row * Math.round(size * 0.3)} width={2 * pixel} height={2 * pixel} fill={color} radius={pixel} />
            <Rect x={5} y={2 + row * Math.round(size * 0.3)} width={size - 6} height={2 * pixel} fill={color} radius={pixel} />
          </React.Fragment>
        ))}
      </>
    );
  }
  if (name === "trash") {
    return (
      <>
        <Rect x={Math.round(size * 0.3)} y={1} width={Math.round(size * 0.4)} height={2 * pixel} fill={color} radius={pixel} />
        <Rect x={1} y={4} width={size - 2} height={2 * pixel} fill={color} radius={pixel} />
        <Rect x={3} y={6} width={size - 6} height={size - 7} fill={0x00000000} radius={2} stroke={color} strokeWidth={stroke} />
        <Rect x={Math.round(size * 0.42)} y={8} width={stroke} height={size - 11} fill={dim} />
        <Rect x={Math.round(size * 0.62)} y={8} width={stroke} height={size - 11} fill={dim} />
      </>
    );
  }
  if (name === "up") {
    return (
      <>
        <Rect x={Math.round(size * 0.44)} y={3} width={Math.max(2, Math.round(size * 0.12))} height={size - 5} fill={color} radius={pixel} />
        <Rect x={Math.round(size * 0.3)} y={3} width={Math.round(size * 0.4)} height={2 * pixel} fill={color} />
        <Rect x={Math.round(size * 0.4)} y={1} width={Math.round(size * 0.2)} height={2 * pixel} fill={color} />
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
  if (name === "chevron-up" || name === "chevron-down") {
    const top = name === "chevron-up";
    const levels = Math.max(3, Math.floor(size / 5));
    return (
      <>
        {Array.from({ length: levels }, (_, index) => {
          const y = top ? levels - index : index;
          const inset = index * 2 * pixel;
          return <Rect key={index} x={inset} y={y * pixel + Math.floor(size / 3)} width={Math.max(pixel, size - inset * 2)} height={pixel} fill={color} radius={pixel} />;
        })}
      </>
    );
  }
  if (name === "remove") {
    return <Rect x={2} y={Math.floor((size - pixel) / 2)} width={size - 4} height={pixel} fill={color} radius={pixel} />;
  }
  return <Rect x={0} y={0} width={size} height={size} fill={color} />;
}

export function Icon(props: IconProps): ReactNode {
  const palette = useWidgetTheme().foundations.palette;
  const size = props.size ?? 16;
  const color = props.color ?? palette.text;
  const name = String(props.name);
  const bitmap = props.symbolic ? null : tryLoad(name, props.path);

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
