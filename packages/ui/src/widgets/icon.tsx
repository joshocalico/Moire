/** A tintable vector family with explicit artwork and geometric fallbacks. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React, { type ReactNode } from "react";
import { Group, Image, Rect } from "@moire/react-host";
import { useWidgetTheme } from "#ui/widget-theme";
import { loadImageSync, type ImageData } from "#ui/image/load";
import { loadSvgIconSync } from "#ui/image/svg-icon";

export const ICON_NAMES = [
  "folder",
  "folder-filled",
  "file",
  "image",
  "app",
  "trash",
  "home",
  "desktop",
  "downloads",
  "up",
  "back",
  "forward",
  "terminal",
  "settings",
  "grid",
  "list",
  "search",
  "close",
  "plus",
  "more",
  "music",
  "chevron-up",
  "chevron-down",
  "chevron-left",
  "chevron-right",
  "remove",
  "editor",
  "notes",
  "calculator",
  "archive",
  "monitor",
  "calendar",
  "clock",
  "screenshot",
  "document",
  "video",
  "disk-usage",
  "font",
  "characters",
  "colors",
  "recorder",
  "weather",
  "dictionary",
  "help",
  "benchmark",
  "showcase",
  "minimize",
  "maximize",
  "restore",
  "check-circle",
  "network",
  "ethernet",
  "network-globe",
  "volume",
  "volume-muted",
  "headphones",
  "brightness",
  "bluetooth",
  "battery",
  "power",
  "moon",
  "bell",
  "bell-check",
  "history",
  "lock",
  "logout",
  "restart",
] as const;
export type IconName = (typeof ICON_NAMES)[number];

export type IconProps = {
  x?: number;
  y?: number;
  name: IconName | (string & {});
  size?: number;
  /** Tint for symbolic vectors and geometric fallbacks; explicit rasters keep their colours. */
  color?: number;
  path?: string;
  /** Keep a missing bundled vector symbolic instead of using a legacy bitmap. */
  symbolic?: boolean;
};

export function applicationIcon(appId: string): IconName {
  const key = appId
    .toLowerCase()
    .replace(/\.desktop$/, "")
    .replace(/^org\.moire\./, "")
    .replace(/^moire-/, "")
    .replace(/[-._ ]/g, "");
  const identities: Readonly<Record<string, IconName>> = {
    files: "folder",
    filemanager: "folder",
    terminal: "terminal",
    settings: "settings",
    editor: "editor",
    texteditor: "editor",
    notes: "notes",
    imageviewer: "image",
    calculator: "calculator",
    music: "music",
    archivemanager: "archive",
    systemmonitor: "monitor",
    processmanager: "monitor",
    calendar: "calendar",
    clock: "clock",
    screenshot: "screenshot",
    documentviewer: "document",
    videoplayer: "video",
    diskusage: "disk-usage",
    fontviewer: "font",
    characters: "characters",
    colors: "colors",
    soundrecorder: "recorder",
    weather: "weather",
    dictionary: "dictionary",
    help: "help",
    benchmark: "benchmark",
    showcase: "showcase",
  };
  return identities[key] ?? "app";
}

const KNOWN: ReadonlySet<string> = new Set(ICON_NAMES);

function iconsDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../icons");
}

function resolveIconPath(name: string, explicit?: string): string | null {
  if (explicit && fs.existsSync(explicit)) return explicit;
  const bundled = path.join(iconsDir(), `${name}.png`);
  return fs.existsSync(bundled) ? bundled : null;
}

function resolveSvgPath(name: string, explicit?: string): string | null {
  if (explicit?.toLowerCase().endsWith(".svg") && fs.existsSync(explicit)) return explicit;
  const bundled = path.join(iconsDir(), `${name}.svg`);
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

function tryLoadSvg(
  name: string,
  size: number,
  color: number,
  explicit?: string,
): ImageData | null {
  const iconPath = resolveSvgPath(name, explicit);
  if (!iconPath) return null;
  try {
    return loadSvgIconSync(iconPath, size, color);
  } catch {
    return null;
  }
}

function drawFallback(name: string, size: number, color: number): ReactNode {
  const pixel = Math.max(1, Math.round(size / 16));
  const dim = (color & 0x00ffffff) | 0x66000000;
  const stroke = Math.max(1, pixel);
  if (name === "check-circle") {
    const points: ReactNode[] = [];
    for (const [startX, startY, endX, endY] of [
      [0.31, 0.5, 0.44, 0.63],
      [0.44, 0.63, 0.69, 0.38],
    ]) {
      const steps = Math.max(
        2,
        Math.ceil(Math.max(Math.abs(endX - startX), Math.abs(endY - startY)) * size),
      );
      for (let index = 0; index <= steps; index++) {
        points.push(
          <Rect
            key={points.length}
            x={(startX + ((endX - startX) * index) / steps) * size - stroke / 2}
            y={(startY + ((endY - startY) * index) / steps) * size - stroke / 2}
            width={stroke}
            height={stroke}
            radius={stroke / 2}
            fill={color}
          />,
        );
      }
    }
    return (
      <>
        <Rect
          x={size / 8}
          y={size / 8}
          width={size * 0.75}
          height={size * 0.75}
          radius={size * 0.375}
          fill={0x00000000}
          stroke={color}
          strokeWidth={stroke}
        />
        {points}
      </>
    );
  }
  if (name === "folder") {
    const bodyY = Math.max(4, Math.round(size * 0.3));
    return (
      <>
        <Rect
          x={1}
          y={bodyY}
          width={size - 2}
          height={size - bodyY - 1}
          fill={color}
          radius={Math.max(2, pixel * 2)}
        />
        <Rect
          x={2}
          y={2}
          width={Math.round(size * 0.46)}
          height={bodyY + 1}
          fill={color}
          radius={Math.max(2, pixel * 2)}
        />
        <Rect x={2} y={bodyY} width={size - 4} height={stroke} fill={dim} />
      </>
    );
  }
  if (name === "file") {
    const fold = Math.round(size * 0.3);
    return (
      <>
        <Rect
          x={2}
          y={1}
          width={size - 4}
          height={size - 2}
          fill={0x00000000}
          radius={Math.max(2, pixel * 2)}
          stroke={color}
          strokeWidth={stroke}
        />
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
        <Rect
          x={1}
          y={2}
          width={size - 2}
          height={size - 4}
          fill={0x00000000}
          radius={Math.max(2, pixel * 2)}
          stroke={color}
          strokeWidth={stroke}
        />
        <Rect
          x={Math.round(size * 0.62)}
          y={Math.round(size * 0.28)}
          width={dot}
          height={dot}
          fill={color}
          radius={dot}
        />
        <Rect
          x={3}
          y={Math.round(size * 0.67)}
          width={Math.round(size * 0.34)}
          height={2 * pixel}
          fill={color}
        />
        <Rect
          x={Math.round(size * 0.28)}
          y={Math.round(size * 0.56)}
          width={Math.round(size * 0.28)}
          height={2 * pixel}
          fill={color}
        />
        <Rect
          x={Math.round(size * 0.5)}
          y={Math.round(size * 0.68)}
          width={Math.round(size * 0.32)}
          height={2 * pixel}
          fill={color}
        />
      </>
    );
  }
  if (name === "home") {
    return (
      <>
        <Rect
          x={Math.round(size * 0.42)}
          y={1}
          width={Math.round(size * 0.16)}
          height={2 * pixel}
          fill={color}
        />
        <Rect
          x={Math.round(size * 0.28)}
          y={3}
          width={Math.round(size * 0.44)}
          height={2 * pixel}
          fill={color}
        />
        <Rect
          x={Math.round(size * 0.14)}
          y={5}
          width={Math.round(size * 0.72)}
          height={2 * pixel}
          fill={color}
        />
        <Rect
          x={2}
          y={7}
          width={size - 4}
          height={size - 8}
          fill={0x00000000}
          radius={Math.max(2, pixel * 2)}
          stroke={color}
          strokeWidth={stroke}
        />
        <Rect
          x={Math.round(size * 0.43)}
          y={Math.round(size * 0.65)}
          width={Math.max(2, Math.round(size * 0.16))}
          height={Math.round(size * 0.28)}
          fill={color}
          radius={pixel}
        />
      </>
    );
  }
  if (name === "desktop") {
    return (
      <>
        <Rect
          x={1}
          y={2}
          width={size - 2}
          height={Math.round(size * 0.62)}
          fill={0x00000000}
          radius={Math.max(2, pixel * 2)}
          stroke={color}
          strokeWidth={stroke}
        />
        <Rect
          x={Math.round(size * 0.44)}
          y={Math.round(size * 0.66)}
          width={Math.max(2, Math.round(size * 0.12))}
          height={Math.round(size * 0.18)}
          fill={color}
        />
        <Rect
          x={Math.round(size * 0.27)}
          y={size - 3}
          width={Math.round(size * 0.46)}
          height={stroke}
          fill={color}
          radius={pixel}
        />
      </>
    );
  }
  if (name === "downloads") {
    return (
      <>
        <Rect
          x={Math.round(size * 0.45)}
          y={1}
          width={Math.max(2, Math.round(size * 0.1))}
          height={Math.round(size * 0.55)}
          fill={color}
          radius={pixel}
        />
        <Rect
          x={Math.round(size * 0.28)}
          y={Math.round(size * 0.42)}
          width={Math.round(size * 0.44)}
          height={2 * pixel}
          fill={color}
        />
        <Rect
          x={Math.round(size * 0.38)}
          y={Math.round(size * 0.54)}
          width={Math.round(size * 0.24)}
          height={2 * pixel}
          fill={color}
        />
        <Rect
          x={2}
          y={size - 5}
          width={size - 4}
          height={4}
          fill={0x00000000}
          radius={2}
          stroke={color}
          strokeWidth={stroke}
        />
      </>
    );
  }
  if (name === "app") {
    const dot = Math.max(2, Math.round(size * 0.16));
    return (
      <>
        <Rect
          x={1}
          y={1}
          width={size - 2}
          height={size - 2}
          fill={0x00000000}
          radius={Math.max(3, Math.round(size * 0.25))}
          stroke={color}
          strokeWidth={stroke}
        />
        <Rect
          x={Math.round(size * 0.27)}
          y={Math.round(size * 0.27)}
          width={dot}
          height={dot}
          fill={color}
          radius={pixel}
        />
        <Rect
          x={Math.round(size * 0.57)}
          y={Math.round(size * 0.27)}
          width={dot}
          height={dot}
          fill={color}
          radius={pixel}
        />
        <Rect
          x={Math.round(size * 0.27)}
          y={Math.round(size * 0.57)}
          width={dot}
          height={dot}
          fill={color}
          radius={pixel}
        />
        <Rect
          x={Math.round(size * 0.57)}
          y={Math.round(size * 0.57)}
          width={dot}
          height={dot}
          fill={color}
          radius={pixel}
        />
      </>
    );
  }
  if (name === "grid") {
    const cell = Math.max(3, Math.floor((size - 5) / 2));
    return (
      <>
        {[0, 1].flatMap((row) =>
          [0, 1].map((column) => (
            <Rect
              key={`${row}:${column}`}
              x={1 + column * (cell + 3)}
              y={1 + row * (cell + 3)}
              width={cell}
              height={cell}
              fill={color}
              radius={Math.max(1, pixel)}
            />
          )),
        )}
      </>
    );
  }
  if (name === "list") {
    return (
      <>
        {[0, 1, 2].map((row) => (
          <React.Fragment key={row}>
            <Rect
              x={1}
              y={2 + row * Math.round(size * 0.3)}
              width={2 * pixel}
              height={2 * pixel}
              fill={color}
              radius={pixel}
            />
            <Rect
              x={5}
              y={2 + row * Math.round(size * 0.3)}
              width={size - 6}
              height={2 * pixel}
              fill={color}
              radius={pixel}
            />
          </React.Fragment>
        ))}
      </>
    );
  }
  if (name === "trash") {
    return (
      <>
        <Rect
          x={Math.round(size * 0.3)}
          y={1}
          width={Math.round(size * 0.4)}
          height={2 * pixel}
          fill={color}
          radius={pixel}
        />
        <Rect x={1} y={4} width={size - 2} height={2 * pixel} fill={color} radius={pixel} />
        <Rect
          x={3}
          y={6}
          width={size - 6}
          height={size - 7}
          fill={0x00000000}
          radius={2}
          stroke={color}
          strokeWidth={stroke}
        />
        <Rect x={Math.round(size * 0.42)} y={8} width={stroke} height={size - 11} fill={dim} />
        <Rect x={Math.round(size * 0.62)} y={8} width={stroke} height={size - 11} fill={dim} />
      </>
    );
  }
  if (name === "up") {
    return (
      <>
        <Rect
          x={Math.round(size * 0.44)}
          y={3}
          width={Math.max(2, Math.round(size * 0.12))}
          height={size - 5}
          fill={color}
          radius={pixel}
        />
        <Rect
          x={Math.round(size * 0.3)}
          y={3}
          width={Math.round(size * 0.4)}
          height={2 * pixel}
          fill={color}
        />
        <Rect
          x={Math.round(size * 0.4)}
          y={1}
          width={Math.round(size * 0.2)}
          height={2 * pixel}
          fill={color}
        />
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
  if (name === "more") {
    const dot = Math.max(2, Math.round(size / 8));
    return [0.2, 0.5, 0.8].map((position) => (
      <Rect
        key={position}
        x={(size - dot) / 2}
        y={size * position - dot / 2}
        width={dot}
        height={dot}
        radius={dot / 2}
        fill={color}
      />
    ));
  }
  if (name === "music") {
    const left = Math.round(size / 3),
      right = Math.round(size * 0.83);
    const head = Math.max(3, Math.round(size / 4));
    return (
      <>
        <Rect x={left} y={size * 0.2} width={stroke} height={size * 0.57} fill={color} />
        <Rect x={right} y={size * 0.13} width={stroke} height={size * 0.57} fill={color} />
        <Rect x={left} y={size * 0.2} width={right - left + stroke} height={stroke} fill={color} />
        <Rect
          x={left - head + stroke}
          y={size * 0.7}
          width={head}
          height={head}
          radius={head / 2}
          fill={color}
        />
        <Rect
          x={right - head + stroke}
          y={size * 0.63}
          width={head}
          height={head}
          radius={head / 2}
          fill={color}
        />
      </>
    );
  }
  if (name === "plus") {
    const inset = Math.round(size / 5);
    const extent = Math.max(1, size - inset * 2);
    const center = Math.floor((size - pixel) / 2);
    return (
      <>
        <Rect x={inset} y={center} width={extent} height={pixel} fill={color} />
        <Rect x={center} y={inset} width={pixel} height={extent} fill={color} />
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
              <Rect x={offset} y={offset} width={pixel} height={pixel} fill={color} />
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
    const up = name === "chevron-up";
    const dot = Math.max(2, pixel * 2);
    const steps = Math.max(3, Math.floor(size / 4));
    const apexY = up ? 1 : size - dot - 1;
    const centerX = Math.floor((size - dot) / 2);
    return (
      <>
        {Array.from({ length: steps }, (_, index) => {
          const y = apexY + (up ? index * dot : -index * dot);
          return (
            <React.Fragment key={index}>
              <Rect
                x={centerX - index * dot}
                y={y}
                width={dot}
                height={dot}
                fill={color}
                radius={pixel}
              />
              {index > 0 ? (
                <Rect
                  x={centerX + index * dot}
                  y={y}
                  width={dot}
                  height={dot}
                  fill={color}
                  radius={pixel}
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </>
    );
  }
  if (name === "chevron-left" || name === "chevron-right") {
    const left = name === "chevron-left";
    const dot = Math.max(2, pixel * 2);
    const steps = Math.max(3, Math.floor(size / 4));
    const apexX = left ? 1 : size - dot - 1;
    const centerY = Math.floor((size - dot) / 2);
    return (
      <>
        {Array.from({ length: steps }, (_, index) => {
          const x = apexX + (left ? index * dot : -index * dot);
          return (
            <React.Fragment key={index}>
              <Rect
                x={x}
                y={centerY - index * dot}
                width={dot}
                height={dot}
                fill={color}
                radius={pixel}
              />
              {index > 0 ? (
                <Rect
                  x={x}
                  y={centerY + index * dot}
                  width={dot}
                  height={dot}
                  fill={color}
                  radius={pixel}
                />
              ) : null}
            </React.Fragment>
          );
        })}
      </>
    );
  }
  if (name === "remove") {
    return (
      <Rect
        x={2}
        y={Math.floor((size - pixel) / 2)}
        width={size - 4}
        height={pixel}
        fill={color}
        radius={pixel}
      />
    );
  }
  return drawFallback("app", size, color);
}

export function Icon(props: IconProps): ReactNode {
  const palette = useWidgetTheme().foundations.palette;
  const size = props.size ?? 16;
  const color = props.color ?? palette.text;
  const name = String(props.name);
  // Explicit artwork is authoritative. Otherwise every bundled icon uses the
  // same tintable vector family, including application identities and file actions.
  const vector =
    !props.path || props.path.toLowerCase().endsWith(".svg")
      ? tryLoadSvg(name, size, color, props.path)
      : null;
  const bitmap = vector ?? (props.symbolic && !props.path ? null : tryLoad(name, props.path));

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
    <Group x={props.x ?? 0} y={props.y ?? 0} width={size} height={size}>
      {drawFallback(KNOWN.has(name) ? name : "file", size, color)}
    </Group>
  );
}
