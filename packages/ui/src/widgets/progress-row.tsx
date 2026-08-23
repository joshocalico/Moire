import React, { type ReactNode } from "react";
import { Group, Text, measureTextBounds } from "@moire/react-host";
import { ProgressBar } from "./progress-bar.js";
import { Spinner } from "./feedback.js";
import { Surface } from "./primitives.js";
import { useWidgetTheme } from "../widget-theme.js";

export type ProgressRowProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  title: string;
  detail?: string;
  value?: number;
  status?: string;
  action?: ReactNode;
  actionWidth?: number;
  disabled?: boolean;
};

/** File-operation/task feedback composed from typography, progress, and action slots. */
export function ProgressRow(props: ProgressRowProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const height = props.height ?? 78;
  const actionWidth = props.action ? props.actionWidth ?? 110 : 0;
  const contentWidth = Math.max(80, props.width - 28 - actionWidth);
  const titleBounds = measureTextBounds(props.title, { fontSize: 12, fontWeight: "medium" });
  const statusBounds = props.status
    ? measureTextBounds(props.status, { fontSize: 10, fontFamily: "mono" })
    : null;
  return (
    <Surface
      x={props.x}
      y={props.y}
      width={props.width}
      height={height}
      fill={pal.surface}
      radius={pal.radiusMd}
      stroke={pal.borderSubtle}
      strokeWidth={1}
    >
      <Text
        x={14}
        y={12}
        text={props.title}
        color={props.disabled ? pal.muted : pal.text}
        fontSize={12}
        fontWeight="medium"
      />
      {props.status && statusBounds ? (
        <Text
          x={Math.max(14, 14 + contentWidth - statusBounds.width)}
          y={12 + Math.floor((titleBounds.height - statusBounds.height) / 2)}
          text={props.status}
          color={pal.accent}
          fontSize={10}
          fontFamily="mono"
        />
      ) : null}
      {props.detail ? (
        <Text x={14} y={32} text={props.detail} color={pal.muted} fontSize={10} />
      ) : null}
      {props.value == null ? (
        <Spinner x={14} y={52} size={16} active={!props.disabled} />
      ) : (
        <ProgressBar
          x={14}
          y={56}
          width={contentWidth}
          value={props.value}
          size="small"
        />
      )}
      {props.action ? (
        <Group
          x={props.width - actionWidth - 12}
          y={Math.floor((height - 36) / 2)}
          width={actionWidth}
          height={36}
        >
          {props.action}
        </Group>
      ) : null}
    </Surface>
  );
}
