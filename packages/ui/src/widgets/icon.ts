/**
 * Icon — geometric icon set using Rect primitives (v1, no PNG required).
 * Supported names: folder | file | image | app | trash | home |
 *                  desktop | downloads | up | grid | list
 */
import { createElement, type ReactNode } from "react";
import { Group, Rect } from "@moire/react-host";
import { themePalette } from "../theme.js";

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
  color?: number;
};

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

export function Icon(props: IconProps): ReactNode {
  const pal = themePalette();
  const size = props.size ?? 16;
  const color = props.color ?? pal.text;
  const s = size;
  const p = Math.max(1, Math.round(s / 16)); // 1 logical pixel at 16-unit size

  const parts = drawIcon(props.name as IconName, s, color, p);

  return createElement(
    Group,
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: s,
      height: s,
    },
    ...parts,
  );
}

function drawIcon(
  name: IconName,
  s: number,
  color: number,
  p: number,
): ReactNode[] {
  const accent = color;
  const dim = (color & 0xffffff) | 0x99000000; // same hue, ~60% alpha

  switch (name) {
    case "folder": {
      // Folder body (bottom rect) + tab (small top-left rect)
      const tabW = Math.round(s * 0.45);
      const tabH = Math.round(s * 0.18);
      const bodyY = tabH - p;
      const bodyH = s - bodyY;
      return [
        r(0, bodyY, s, bodyH, accent, 0),
        r(0, 0, tabW, tabH + p, accent, 1),
      ];
    }

    case "file": {
      // Rectangle with folded top-right corner
      const fold = Math.round(s * 0.3);
      return [
        r(0, 0, s - fold, s, accent, 0),
        r(s - fold, fold, fold, s - fold, accent, 1),
        // fold triangle approximation: small bright square at corner
        r(s - fold, 0, fold, fold, dim, 2),
      ];
    }

    case "image": {
      // Frame + sun (circle approx) + mountain
      const border = p * 2;
      return [
        r(0, 0, s, s, dim, 0), // frame
        r(border, border, s - border * 2, s - border * 2, 0x00000000, 1), // inner clear (transparent)
        // sun
        r(Math.round(s * 0.6), Math.round(s * 0.2), Math.round(s * 0.2), Math.round(s * 0.2), accent, 2),
        // mountain
        r(0, Math.round(s * 0.55), s, Math.round(s * 0.35), accent, 3),
        // Re-render frame border on top
        r(0, 0, s, border, dim, 4),
        r(0, 0, border, s, dim, 5),
        r(s - border, 0, border, s, dim, 6),
        r(0, s - border, s, border, dim, 7),
      ];
    }

    case "app": {
      // Rounded square (approximated with rects)
      const r2 = Math.max(2, Math.round(s * 0.18));
      return [
        r(r2, 0, s - r2 * 2, s, accent, 0),
        r(0, r2, r2, s - r2 * 2, accent, 1),
        r(s - r2, r2, r2, s - r2 * 2, accent, 2),
      ];
    }

    case "trash": {
      // Lid + body
      const lidH = Math.round(s * 0.18);
      const bodyY = lidH + p;
      const bodyH = s - bodyY;
      return [
        r(0, 0, s, lidH, accent, 0), // lid
        r(p * 2, bodyY, s - p * 4, bodyH, accent, 1), // body
        // vertical lines inside body
        r(Math.round(s * 0.35), bodyY + p * 2, p, bodyH - p * 4, dim, 2),
        r(Math.round(s * 0.55), bodyY + p * 2, p, bodyH - p * 4, dim, 3),
      ];
    }

    case "home": {
      // Roof (chevron approx) + door
      const roofH = Math.round(s * 0.5);
      const wallY = roofH - p;
      const wallH = s - wallY;
      const doorW = Math.round(s * 0.35);
      const doorH = Math.round(s * 0.45);
      const doorX = Math.floor((s - doorW) / 2);
      return [
        r(0, roofH - p, s, wallH, accent, 0), // wall
        r(Math.floor(s / 2) - p, 0, p * 2, roofH, accent, 1), // center spike of roof
        r(0, Math.round(s * 0.2), Math.floor(s / 2), roofH - Math.round(s * 0.2), accent, 2),
        r(Math.ceil(s / 2), Math.round(s * 0.2), Math.floor(s / 2), roofH - Math.round(s * 0.2), accent, 3),
        r(doorX, s - doorH, doorW, doorH, dim, 4), // door
      ];
    }

    case "desktop": {
      // Monitor outline + stand
      const monH = Math.round(s * 0.65);
      const standW = Math.round(s * 0.35);
      const standH = Math.round(s * 0.22);
      const baseH = p * 2;
      return [
        r(0, 0, s, monH, accent, 0), // monitor
        r(p * 2, p * 2, s - p * 4, monH - p * 4, dim, 1), // screen
        r(Math.floor((s - standW) / 2), monH, standW, standH, accent, 2),
        r(Math.floor((s - standW * 1.5) / 2), monH + standH, Math.round(standW * 1.5), baseH, accent, 3),
      ];
    }

    case "downloads": {
      // Arrow pointing down + tray
      const arrowW = Math.round(s * 0.4);
      const arrowH = Math.round(s * 0.55);
      const stemH = Math.round(arrowH * 0.55);
      const stemW = Math.round(arrowW * 0.5);
      const stemX = Math.floor((s - stemW) / 2);
      const headY = stemH;
      const trayH = p * 2;
      return [
        r(stemX, 0, stemW, stemH, accent, 0), // stem
        r(Math.floor((s - arrowW) / 2), headY, arrowW, arrowH - stemH, accent, 1), // arrowhead
        r(0, s - trayH, s, trayH, accent, 2), // tray
      ];
    }

    case "up": {
      // Arrow pointing up
      const arrowW = Math.round(s * 0.7);
      const arrowH = Math.round(s * 0.5);
      const stemW = Math.round(arrowW * 0.4);
      const stemX = Math.floor((s - stemW) / 2);
      const stemY = Math.round(s * 0.4);
      return [
        r(stemX, stemY, stemW, s - stemY, accent, 0), // stem
        r(Math.floor((s - arrowW) / 2), Math.round(s * 0.15), arrowW, arrowH, accent, 1), // head
      ];
    }

    case "grid": {
      // 2×2 grid of squares
      const cell = Math.round(s * 0.42);
      const gap = s - cell * 2;
      return [
        r(0, 0, cell, cell, accent, 0),
        r(cell + gap, 0, cell, cell, accent, 1),
        r(0, cell + gap, cell, cell, accent, 2),
        r(cell + gap, cell + gap, cell, cell, accent, 3),
      ];
    }

    case "list": {
      // Three horizontal bars
      const barH = Math.max(p, Math.round(s * 0.14));
      const gap = Math.round((s - barH * 3) / 2);
      return [
        r(0, 0, s, barH, accent, 0),
        r(0, barH + gap, s, barH, accent, 1),
        r(0, barH * 2 + gap * 2, s, barH, accent, 2),
      ];
    }

    default:
      // Unknown icon: filled square placeholder
      return [r(0, 0, s, s, color, 0)];
  }
}
