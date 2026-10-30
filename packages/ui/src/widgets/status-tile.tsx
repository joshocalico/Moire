/**
 * A pressable summary of one part of the system: what it is, its state in a word or two, and a
 * detail line, progress bar or small inline control. Pressing it opens the part's page.
 */
import React, { type ReactNode } from "react";
import { Group } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { useWidgetTheme } from "#ui/widget-theme";
import { Icon, type IconName } from "./icon";
import { IconTile } from "./icon-tile";
import { registerIntrinsicSize } from "./layout";
import { Pressable } from "./pressable";
import { Surface, TextBlock } from "./primitives";
import { ProgressBar } from "./progress-bar";

export type StatusTileProps = {
  x?: number;
  y?: number;
  width: number;
  icon: IconName;
  tint?: number;
  title: string;
  value: string;
  detail?: string;
  /** 0..1: a bar under the value, with the detail beneath it. */
  progress?: number;
  /** A small control under the value (a volume slider), given its width and height. */
  control?: (size: { width: number; height: number }) => ReactNode;
  onPress?: () => void;
  focusId?: string;
};

const HEIGHT = 108;
const PAD = 14;

/** Every tile's height, scaled, so a grid of them can be laid out. */
export function statusTileHeight(): number {
  return HEIGHT * getUiScaleFactor();
}

export function StatusTile(props: StatusTileProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const ui = getUiScaleFactor();
  const height = HEIGHT * ui;
  const pad = PAD * ui;
  const inner = Math.max(1, props.width - pad * 2);
  const radius = 12 * ui;
  const detail = (y: number) =>
    props.detail ? (
      <TextBlock
        x={pad}
        y={y}
        width={inner}
        height={16 * ui}
        text={props.detail}
        fontSize={11}
        color={pal.muted}
        verticalAlign="center"
        overflow="ellipsis"
        maxLines={1}
      />
    ) : null;
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={height}>
      <Surface
        width={props.width}
        height={height}
        radius={radius}
        fill={pal.surface}
        stroke={pal.borderSubtle}
        strokeWidth={1}
      />
      <Pressable
        width={props.width}
        height={height}
        radius={radius}
        fill={0x00000000}
        focusId={props.focusId}
        disabled={!props.onPress}
        onPress={props.onPress}
      />
      <IconTile x={pad} y={pad} size={30} icon={props.icon} tint={props.tint} />
      <TextBlock
        x={52 * ui}
        y={pad}
        width={Math.max(1, props.width - 52 * ui - 34 * ui)}
        height={30 * ui}
        text={props.title}
        fontSize={12}
        color={pal.muted}
        verticalAlign="center"
        overflow="ellipsis"
        maxLines={1}
      />
      {props.onPress ? (
        <Icon
          x={props.width - 26 * ui}
          y={22 * ui}
          name="chevron-right"
          size={14 * ui}
          color={pal.muted}
          symbolic
        />
      ) : null}
      <TextBlock
        x={pad}
        y={52 * ui}
        width={inner}
        height={22 * ui}
        text={props.value}
        fontSize={16}
        fontWeight="medium"
        verticalAlign="center"
        overflow="ellipsis"
        maxLines={1}
      />
      {props.control ? (
        <Group x={pad} y={78 * ui} width={inner} height={20 * ui}>
          {props.control({ width: inner, height: 20 * ui })}
        </Group>
      ) : props.progress != null ? (
        <>
          <ProgressBar
            x={pad}
            y={80 * ui}
            width={inner}
            height={6 * ui}
            value={Math.max(0, Math.min(1, props.progress))}
          />
          {detail(88 * ui)}
        </>
      ) : (
        detail(76 * ui)
      )}
    </Group>
  );
}

registerIntrinsicSize(StatusTile, (props) => ({
  width: props.width,
  height: HEIGHT * getUiScaleFactor(),
}));
