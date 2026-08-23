/**
 * Desktop icon layer — ~/Desktop entries as GridItem cells over wallpaper.
 */
import React, { type ReactNode } from "react";
import { Group, Rect, type HitPointerEvent } from "@moire/react-host";
import { CollectionItem, GridItem, Icon, themePalette } from "@moire/ui";
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
    return fs
      .readdirSync(dir)
      .filter((name) => !name.startsWith("."))
      .sort((left, right) => left.localeCompare(right));
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

export const ICON_SIZE = 52;
export const DESKTOP_ITEM_W = 112;
export const DESKTOP_ITEM_H = 100;
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
    Math.floor((availH - GRID_MARGIN_Y) / (DESKTOP_ITEM_H + GRID_GAP)),
  );
  const col = Math.floor(index / rows);
  const row = index % rows;
  return {
    x: GRID_MARGIN_X + col * COL_WIDTH,
    y: GRID_MARGIN_Y + row * (DESKTOP_ITEM_H + GRID_GAP),
  };
}

/** Canonical clamped icon position shared by paint, hit-test, and input. */
export function desktopIconPosition(
  name: string,
  index: number,
  layout: DesktopLayout,
  screenW: number,
  screenH: number,
  panelH: number,
): { x: number; y: number } {
  const availH = screenH - panelH;
  const saved = layout[name];
  const fallback = defaultIconPos(index, screenW, availH);
  return {
    x: Math.max(
      0,
      Math.min(saved?.x ?? fallback.x, screenW - DESKTOP_ITEM_W),
    ),
    y: Math.max(
      0,
      Math.min(saved?.y ?? fallback.y, availH - DESKTOP_ITEM_H),
    ),
  };
}

/** Resolve which desktop entry is under (x,y), or null. */
export function hitTestDesktopIcon(
  x: number,
  y: number,
  entries: string[],
  layout: DesktopLayout,
  screenW: number,
  screenH: number,
  panelH: number,
): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const name = entries[i]!;
    const { x: ix, y: iy } = desktopIconPosition(
      name,
      i,
      layout,
      screenW,
      screenH,
      panelH,
    );
    if (
      x >= ix &&
      y >= iy &&
      x < ix + DESKTOP_ITEM_W &&
      y < iy + DESKTOP_ITEM_H
    ) {
      return name;
    }
  }
  return null;
}

export type DesktopIconsProps = {
  screenW: number;
  screenH: number;
  /** Reserved bottom height (panel); icons won't overlap this area. */
  panelH: number;
  entries: string[];
  layout: DesktopLayout;
  selectedNames?: ReadonlySet<string>;
  focusedName?: string | null;
  /** Icon currently hovered by an active drag that would move into it. */
  dropHoverName?: string | null;
  /**
   * A compatible drag is over the desktop generally (no specific folder
   * hovered) — show a whole-area acceptor highlight, so "drop anywhere on
   * the desktop" has the same dragenter feedback as a specific folder.
   */
  dragActive?: boolean;
  onSelect?: (name: string, event?: HitPointerEvent) => void;
  onOpen?: (name: string) => void;
  onContextMenu?: (name: string, event: HitPointerEvent) => void;
};

/** Full-screen desktop icon layer. Render under windows, above wallpaper. */
export function DesktopIcons(props: DesktopIconsProps): ReactNode {
  const pal = themePalette();
  const { entries, layout, screenW, screenH, panelH } = props;
  const availH = screenH - panelH;
  const showAreaHighlight = props.dragActive && !props.dropHoverName;

  if (entries.length === 0 && !showAreaHighlight) return null;

  const dir = desktopDir();

  const icons = entries.map((name, i) => {
    const { x: ix, y: iy } = desktopIconPosition(
      name,
      i,
      layout,
      screenW,
      screenH,
      panelH,
    );

    const filePath = path.join(dir, name);
    const dirEntry = isDirectory(filePath);
    const iconName = dirEntry ? "folder" : "file";

    return (
      <CollectionItem
        key={name}
        x={ix}
        y={iy}
        width={DESKTOP_ITEM_W}
        height={DESKTOP_ITEM_H}
        focusId={`desktop:${filePath}`}
        focused={props.focusedName === name}
        onPress={(event) => props.onSelect?.(name, event)}
        onDoublePress={() => props.onOpen?.(name)}
        onContextMenu={(event) => props.onContextMenu?.(name, event)}
      >
        <GridItem
          width={DESKTOP_ITEM_W}
          height={DESKTOP_ITEM_H}
          label={name}
          iconSize={ICON_SIZE}
          labelScrim
          selected={props.selectedNames?.has(name) === true}
          dropHover={dirEntry && props.dropHoverName === name}
          interactive={false}
          icon={
            <Icon
              name={iconName}
              size={ICON_SIZE}
              color={dirEntry ? pal.accent : pal.text}
            />
          }
        />
      </CollectionItem>
    );
  });

  return (
    <Group x={0} y={0} width={screenW} height={availH}>
      {showAreaHighlight ? (
        <>
          <Rect x={0} y={0} width={screenW} height={3} fill={pal.accent} />
          <Rect
            x={0}
            y={availH - 3}
            width={screenW}
            height={3}
            fill={pal.accent}
          />
          <Rect x={0} y={0} width={3} height={availH} fill={pal.accent} />
          <Rect
            x={screenW - 3}
            y={0}
            width={3}
            height={availH}
            fill={pal.accent}
          />
        </>
      ) : null}
      {icons}
    </Group>
  );
}
