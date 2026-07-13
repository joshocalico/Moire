/**
 * Desktop icon layer — ~/Desktop entries as GridItem cells over wallpaper.
 */
import { createElement, type ReactNode } from "react";
import { Group } from "@moire/react-host";
import { GridItem, Icon, themePalette } from "@moire/ui";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type DesktopLayout = Record<string, { x: number; y: number }>;

export function desktopDir(): string {
  return path.join(os.homedir(), "Desktop");
}

export function desktopLayoutPath(): string {
  const base =
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(base, "moire", "desktop-layout.json");
}

export function loadDesktopLayout(): DesktopLayout {
  try {
    return JSON.parse(
      fs.readFileSync(desktopLayoutPath(), "utf8"),
    ) as DesktopLayout;
  } catch {
    return {};
  }
}

export function saveDesktopLayout(layout: DesktopLayout): void {
  const p = desktopLayoutPath();
  fs.mkdirSync(path.dirname(p), { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, JSON.stringify(layout, null, 2) + "\n", "utf8");
}

export function listDesktopEntries(): string[] {
  const dir = desktopDir();
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // ignore
  }
  try {
    return fs.readdirSync(dir).filter((n) => !n.startsWith("."));
  } catch {
    return [];
  }
}

function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

const ICON_SIZE = 52;
const ITEM_W = 112;
const ITEM_H = 100;
const GRID_MARGIN_X = 28;
const GRID_MARGIN_Y = 28;
const GRID_GAP = 16;
const COL_WIDTH = 128;

function defaultIconPos(
  index: number,
  _screenW: number,
  availH: number,
): { x: number; y: number } {
  const rows = Math.max(
    1,
    Math.floor((availH - GRID_MARGIN_Y) / (ITEM_H + GRID_GAP)),
  );
  const col = Math.floor(index / rows);
  const row = index % rows;
  return {
    x: GRID_MARGIN_X + col * COL_WIDTH,
    y: GRID_MARGIN_Y + row * (ITEM_H + GRID_GAP),
  };
}

export type DesktopIconsProps = {
  screenW: number;
  screenH: number;
  /** Reserved bottom height (panel); icons won't overlap this area. */
  panelH: number;
  entries: string[];
  layout: DesktopLayout;
  selectedName?: string;
  onSelect?: (name: string) => void;
  onOpen?: (name: string) => void;
};

/** Full-screen desktop icon layer. Render under windows, above wallpaper. */
export function DesktopIcons(props: DesktopIconsProps): ReactNode {
  const pal = themePalette();
  const { entries, layout, screenW, screenH, panelH } = props;
  const availH = screenH - panelH;

  if (entries.length === 0) return null;

  const dir = desktopDir();

  const icons = entries.map((name, i) => {
    const saved = layout[name];
    const fallback = defaultIconPos(i, screenW, availH);
    const rawX = saved?.x ?? fallback.x;
    const rawY = saved?.y ?? fallback.y;
    const ix = Math.max(0, Math.min(rawX, screenW - ITEM_W));
    const iy = Math.max(0, Math.min(rawY, availH - ITEM_H));

    const filePath = path.join(dir, name);
    const dirEntry = isDirectory(filePath);
    const iconName = dirEntry ? "folder" : "file";

    return createElement(GridItem, {
      key: name,
      x: ix,
      y: iy,
      width: ITEM_W,
      height: ITEM_H,
      label: name,
      iconSize: ICON_SIZE,
      labelScrim: true,
      selected: props.selectedName === name,
      icon: createElement(Icon, {
        name: iconName,
        size: ICON_SIZE,
        color: dirEntry ? pal.accent : pal.text,
      }),
      onPress: () => props.onSelect?.(name),
      onDoublePress: () => props.onOpen?.(name),
    });
  });

  return createElement(
    Group,
    { x: 0, y: 0, width: screenW, height: availH },
    ...icons,
  );
}
