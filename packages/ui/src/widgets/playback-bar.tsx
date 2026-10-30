/** Responsive media chrome; every visible transport action has a real callback. */
import React, { type ReactNode } from "react";
import { Group, Rect } from "@moire/react-host";
import { foregroundOn } from "#ui/theme-family-color";
import { getUiScaleFactor } from "#ui/font";
import { useWidgetTheme } from "#ui/widget-theme";
import { Button } from "./button";
import { IconButton } from "./icon-button";
import { ImageWidget } from "./image-widget";
import { Row } from "./layout";
import { Label, Surface } from "./primitives";
import { Slider } from "./slider";

export type PlaybackBarProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  title?: string;
  subtitle?: string;
  artwork?: string;
  status?: string;
  ready: boolean;
  /** Allow reopening a stopped track without enabling seek/volume prematurely. */
  canPlay?: boolean;
  paused: boolean;
  position: number;
  duration: number;
  volume: number;
  onTogglePause: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  onStop?: () => void;
  onSeek: (seconds: number) => void;
  onVolume: (volume: number) => void;
  onQueue?: () => void;
  queueOpen?: boolean;
};
export function formatPlaybackTime(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const hours = Math.floor(total / 3600);
  return `${hours ? `${hours}:` : ""}${hours ? String(Math.floor(total / 60) % 60).padStart(2, "0") : Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
export function playbackBarHeight(width: number): number {
  const ui = getUiScaleFactor();
  return (width >= 900 * ui ? 112 : width >= 650 * ui ? 156 : 190) * ui;
}
export type MediaSymbol = "play" | "pause" | "previous" | "next" | "stop";
function mediaGeometry(kind: MediaSymbol, style: { size: number; color: number }): ReactNode {
  const { size, color } = style;
  if (kind === "pause")
    return (
      <>
        <Rect
          x={size * 0.22}
          y={size * 0.12}
          width={size * 0.2}
          height={size * 0.76}
          fill={color}
          radius={1}
        />
        <Rect
          x={size * 0.58}
          y={size * 0.12}
          width={size * 0.2}
          height={size * 0.76}
          fill={color}
          radius={1}
        />
      </>
    );
  if (kind === "stop")
    return (
      <Rect
        x={size * 0.2}
        y={size * 0.2}
        width={size * 0.6}
        height={size * 0.6}
        fill={color}
        radius={1}
      />
    );
  const triangleHeight = size * (kind === "play" ? 0.68 : 0.76),
    triangleWidth = size * (kind === "play" ? 0.64 : 0.6);
  const top = (size - triangleHeight) / 2;
  const rows = Math.max(8, Math.ceil(triangleHeight)),
    left = kind === "previous";
  return (
    <>
      {Array.from({ length: rows }, (_, row) => {
        const width = triangleWidth * (1 - Math.abs((row + 0.5) / rows - 0.5) * 2);
        return (
          <Rect
            key={row}
            x={left ? size * 0.76 - width : size * 0.24}
            y={top + (row * triangleHeight) / rows}
            width={width}
            height={Math.max(1, Math.ceil(triangleHeight / rows))}
            fill={color}
          />
        );
      })}
      {kind !== "play" ? (
        <Rect
          x={size * (left ? 0.1 : 0.82)}
          y={size * 0.12}
          width={size * 0.1}
          height={size * 0.76}
          fill={color}
        />
      ) : null}
    </>
  );
}
/** A transport symbol (play, pause, …) drawn as geometry, for media controls outside the bar. */
export function MediaGlyph(props: {
  x?: number;
  y?: number;
  kind: MediaSymbol;
  size: number;
  color: number;
}): ReactNode {
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.size} height={props.size}>
      {mediaGeometry(props.kind, { size: props.size, color: props.color })}
    </Group>
  );
}
function mediaSymbol(kind: MediaSymbol, style: { size: number; color: number }): ReactNode {
  // Keep the primary glyph optically large regardless of the theme icon recipe.
  const logicalSize = kind === "play" ? 34 : kind === "pause" ? 32 : 24;
  const size = logicalSize * getUiScaleFactor();
  return (
    <Group x={(style.size - size) / 2} y={(style.size - size) / 2} width={size} height={size}>
      {mediaGeometry(kind, { size, color: style.color })}
    </Group>
  );
}
export function PlaybackBar(props: PlaybackBarProps): ReactNode {
  const ui = getUiScaleFactor();
  const pal = useWidgetTheme().foundations.palette;
  const wide = props.width >= 900 * ui;
  const height = props.height ?? playbackBarHeight(props.width);
  const transportX = wide
    ? Math.max(260 * ui, props.width / 2 - 76 * ui)
    : Math.max(10 * ui, props.width / 2 - 101 * ui);
  const transportY = wide ? 6 * ui : 54 * ui;
  const seekY = wide ? 70 * ui : 114 * ui;
  return (
    <Surface
      x={props.x}
      y={props.y}
      width={props.width}
      height={height}
      fill={pal.panel}
      stroke={pal.border}
      strokeWidth={1}
    >
      {props.artwork ? (
        <ImageWidget
          x={12 * ui}
          y={12 * ui}
          width={52 * ui}
          height={52 * ui}
          src={props.artwork}
          fit="cover"
        />
      ) : null}
      <Label
        x={(props.artwork ? 76 : 14) * ui}
        y={10 * ui}
        width={
          wide
            ? Math.max(0, transportX - (props.artwork ? 96 : 34) * ui)
            : Math.max(0, props.width - (props.artwork ? 176 : 114) * ui)
        }
        height={22 * ui}
        text={props.title ?? "Nothing playing"}
        fontWeight="medium"
        fontSize={14}
        maxLines={1}
        overflow="ellipsis"
      />
      <Label
        x={(props.artwork ? 76 : 14) * ui}
        y={34 * ui}
        width={
          wide
            ? Math.max(0, transportX - (props.artwork ? 96 : 34) * ui)
            : Math.max(0, props.width - (props.artwork ? 176 : 114) * ui)
        }
        height={19 * ui}
        text={props.status || props.subtitle || "Choose a track from your library"}
        color={pal.muted}
        fontSize={11}
        maxLines={1}
        overflow="ellipsis"
      />
      <Group x={transportX} y={transportY} width={202 * ui} height={52 * ui}>
        <IconButton
          x={0}
          y={8 * ui}
          width={36 * ui}
          height={36 * ui}
          variant="ghost"
          icon={(style) => mediaSymbol("previous", style)}
          disabled={!props.onPrevious}
          onPress={props.onPrevious}
          tooltip="Previous track"
          tooltipPlacement="top"
          focusId="playback:previous"
        />
        <Rect
          x={50 * ui}
          width={52 * ui}
          height={52 * ui}
          radius={26 * ui}
          fill={(props.canPlay ?? props.ready) ? pal.accent : pal.border}
        />
        <IconButton
          x={50 * ui}
          width={52 * ui}
          height={52 * ui}
          size="large"
          variant="ghost"
          fill={0x00000000}
          color={foregroundOn((props.canPlay ?? props.ready) ? pal.accent : pal.border)}
          icon={(style) => mediaSymbol(props.paused ? "play" : "pause", style)}
          disabled={!(props.canPlay ?? props.ready)}
          onPress={props.onTogglePause}
          tooltip={props.paused ? "Play" : "Pause"}
          tooltipPlacement="top"
          focusId="playback:pause"
        />
        <IconButton
          x={116 * ui}
          y={8 * ui}
          width={36 * ui}
          height={36 * ui}
          variant="ghost"
          icon={(style) => mediaSymbol("next", style)}
          disabled={!props.onNext}
          onPress={props.onNext}
          tooltip="Next track"
          tooltipPlacement="top"
          focusId="playback:next"
        />
        {props.onStop ? (
          <IconButton
            x={166 * ui}
            y={8 * ui}
            width={36 * ui}
            height={36 * ui}
            variant="ghost"
            icon={(style) => mediaSymbol("stop", style)}
            disabled={!props.ready}
            onPress={props.onStop}
            tooltip="Stop playback"
            tooltipPlacement="top"
            focusId="playback:stop"
          />
        ) : null}
      </Group>
      {props.onQueue ? (
        <Button
          x={props.width - 87 * ui}
          y={10 * ui}
          width={75 * ui}
          size="small"
          label="Queue"
          variant={props.queueOpen ? "primary" : "ghost"}
          onPress={props.onQueue}
          focusId="playback:queue"
        />
      ) : null}
      <Label
        x={12 * ui}
        y={seekY}
        width={48 * ui}
        height={26 * ui}
        fontSize={11}
        text={formatPlaybackTime(props.position)}
        verticalAlign="center"
      />
      <Slider
        x={60 * ui}
        y={seekY}
        width={Math.max(0, props.width - (wide ? 332 : 124) * ui)}
        height={26 * ui}
        value={props.duration > 0 ? props.position / props.duration : 0}
        disabled={!props.ready || props.duration <= 0}
        onChange={(value) => props.onSeek(value * props.duration)}
      />
      <Label
        x={props.width - (wide ? 270 : 58) * ui}
        y={seekY}
        width={48 * ui}
        height={26 * ui}
        fontSize={11}
        text={formatPlaybackTime(props.duration)}
        verticalAlign="center"
      />
      {wide ? (
        <>
          <Label
            x={props.width - 208 * ui}
            y={seekY}
            width={58 * ui}
            height={26 * ui}
            text="Volume"
            fontSize={11}
            verticalAlign="center"
          />
          <Slider
            x={props.width - 142 * ui}
            y={seekY}
            width={126 * ui}
            height={26 * ui}
            value={props.volume / 100}
            disabled={!props.ready}
            onChange={(value) => props.onVolume(value * 100)}
          />
        </>
      ) : (
        <Row
          x={props.width >= 650 * ui ? props.width - 194 * ui : 14 * ui}
          y={props.width >= 650 * ui ? transportY : 150 * ui}
          width={180 * ui}
          height={36 * ui}
          gap={8 * ui}
          align="center"
        >
          <Label width={48 * ui} text="Vol." fontSize={11} />
          <Slider
            width={112 * ui}
            value={props.volume / 100}
            disabled={!props.ready}
            onChange={(value) => props.onVolume(value * 100)}
          />
        </Row>
      )}
    </Surface>
  );
}
