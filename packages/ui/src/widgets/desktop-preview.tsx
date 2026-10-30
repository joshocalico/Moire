/**
 * A miniature desktop drawn from a palette, a wallpaper and the panel's shape: wallpaper,
 * desktop icons, one window and the panel along the bottom. Settings shows the person's
 * choices on it as they make them.
 */
import React, { type ReactNode } from "react";
import { Group, Rect } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { colorWithAlpha, mixColor } from "#ui/theme-family-color";
import { useWidgetTheme } from "#ui/widget-theme";
import { ImageWidget } from "./image-widget";
import { registerIntrinsicSize } from "./layout";
import { Surface } from "./primitives";

export type DesktopPreviewWallpaper =
  /** A vertical blend from the first colour through the optional middle one to the last. */
  { kind: "colors"; colors: readonly [number, number, number] } | { kind: "image"; path: string };

/** The parts of a palette the preview draws with; the current theme's palette by default. */
export type DesktopPreviewPalette = {
  bg: number;
  panel: number;
  titlebar: number;
  accent: number;
  muted: number;
  border: number;
};

export type DesktopPreviewProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  wallpaper: DesktopPreviewWallpaper;
  panel: "islands" | "full-width";
  /** Window buttons show only their icons. */
  iconsOnly: boolean;
  desktopIcons: boolean;
  palette?: DesktopPreviewPalette;
};

const BANDS = 32;

/** A vertical blend drawn as bands, which the software renderer paints cheaply. */
export function ColorBands(props: {
  width: number;
  height: number;
  colors: readonly [number, number, number];
}): ReactNode {
  const [from, mid, to] = props.colors;
  return (
    <>
      {Array.from({ length: BANDS }, (_, index) => {
        const t = index / (BANDS - 1);
        const color = t < 0.5 ? mixColor(from, mid, t * 2) : mixColor(mid, to, (t - 0.5) * 2);
        return (
          <Rect
            key={index}
            y={Math.floor((index * props.height) / BANDS)}
            width={props.width}
            height={Math.ceil(props.height / BANDS) + 1}
            fill={color}
          />
        );
      })}
    </>
  );
}

export function DesktopPreview(props: DesktopPreviewProps): ReactNode {
  const theme = useWidgetTheme().foundations.palette;
  const pal = props.palette ?? theme;
  const ui = getUiScaleFactor();
  const { width: w, height: h } = props;
  const r = (value: number) => Math.round(value);
  const panelH = Math.max(10 * ui, r(h * 0.085));
  const islands = props.panel === "islands";
  const panelY = h - panelH - (islands ? 6 * ui : 0);
  const panelFill = colorWithAlpha(pal.panel, 0xeb);
  const taskW = props.iconsOnly ? panelH - 6 * ui : r(w * 0.075);
  const tasksW = taskW * 3 + 14 * ui;
  const tasks = (
    <>
      {[0, 1, 2].map((index) => (
        <Rect
          key={index}
          x={3 * ui + index * (taskW + 4 * ui)}
          y={3 * ui}
          width={taskW}
          height={panelH - 6 * ui}
          radius={3 * ui}
          fill={index === 0 ? pal.accent : colorWithAlpha(pal.muted, 0x59)}
        />
      ))}
    </>
  );
  const pill = (x: number, width: number) => (
    <Rect x={x} y={panelY} width={width} height={panelH} radius={panelH / 2} fill={panelFill} />
  );
  const windowW = r(w * 0.56);
  const windowH = r(h * 0.52);
  return (
    <Surface x={props.x} y={props.y} width={w} height={h} radius={10 * ui} fill={pal.bg} clip>
      {props.wallpaper.kind === "colors" ? (
        <ColorBands width={w} height={h} colors={props.wallpaper.colors} />
      ) : (
        <ImageWidget width={w} height={h} src={props.wallpaper.path} fit="cover" />
      )}
      {props.desktopIcons
        ? [0, 1, 2].map((index) => (
            <Rect
              key={index}
              x={10 * ui}
              y={10 * ui + index * r(h * 0.13)}
              width={r(h * 0.08)}
              height={r(h * 0.08)}
              radius={3 * ui}
              fill={colorWithAlpha(0xffffffff, 0x8c)}
            />
          ))
        : null}
      <Surface
        x={r(w * 0.2)}
        y={r(h * 0.14)}
        width={windowW}
        height={windowH}
        radius={6 * ui}
        fill={pal.bg}
        stroke={pal.border}
        strokeWidth={1}
        clip
      >
        <Rect width={windowW} height={r(h * 0.09)} fill={pal.titlebar} />
        <Rect
          x={8 * ui}
          y={r(h * 0.13)}
          width={r(w * 0.12)}
          height={r(h * 0.33)}
          radius={3 * ui}
          fill={pal.panel}
        />
        <Rect
          x={r(w * 0.16)}
          y={r(h * 0.13)}
          width={r(w * 0.34)}
          height={r(h * 0.06)}
          radius={2 * ui}
          fill={colorWithAlpha(pal.muted, 0x4d)}
        />
        <Rect
          x={r(w * 0.16)}
          y={r(h * 0.22)}
          width={r(w * 0.24)}
          height={r(h * 0.06)}
          radius={2 * ui}
          fill={colorWithAlpha(pal.muted, 0x33)}
        />
        <Rect
          x={r(w * 0.16)}
          y={r(h * 0.34)}
          width={r(w * 0.1)}
          height={r(h * 0.075)}
          radius={3 * ui}
          fill={pal.accent}
        />
      </Surface>
      {islands ? (
        <>
          {pill(6 * ui, r(w * 0.12))}
          <Group x={r((w - tasksW) / 2)} y={panelY} width={tasksW} height={panelH}>
            <Rect width={tasksW} height={panelH} radius={panelH / 2} fill={panelFill} />
            {tasks}
          </Group>
          {pill(w - 6 * ui - r(w * 0.16), r(w * 0.16))}
        </>
      ) : (
        <Group y={h - panelH} width={w} height={panelH}>
          <Rect width={w} height={panelH} fill={panelFill} />
          <Rect
            x={8 * ui}
            y={3 * ui}
            width={r(w * 0.07)}
            height={panelH - 6 * ui}
            radius={3 * ui}
            fill={colorWithAlpha(pal.muted, 0x80)}
          />
          <Group x={r((w - tasksW) / 2)} width={tasksW} height={panelH}>
            {tasks}
          </Group>
          <Rect
            x={w - 8 * ui - r(w * 0.1)}
            y={3 * ui}
            width={r(w * 0.1)}
            height={panelH - 6 * ui}
            radius={3 * ui}
            fill={colorWithAlpha(pal.muted, 0x80)}
          />
        </Group>
      )}
    </Surface>
  );
}

registerIntrinsicSize(DesktopPreview, (props) => ({ width: props.width, height: props.height }));
