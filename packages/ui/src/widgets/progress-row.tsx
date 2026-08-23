import React, { type ReactNode } from "react";
import { measureTextBounds } from "@moire/react-host";
import { ProgressBar } from "./progress-bar.js";
import { Spinner } from "./feedback.js";
import { TextBlock, Surface } from "./primitives.js";
import { Align, Box, Horizontal, Inset, Measure, Vertical } from "./layout.js";
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
  const theme = useWidgetTheme();
  const pal = theme.foundations.palette;
  const height = props.height ?? 78;
  const actionWidth = props.action ? props.actionWidth ?? 110 : 0;
  const statusBounds = props.status
    ? measureTextBounds(props.status, { fontSize: 10, fontFamily: "mono" })
    : null;
  const progressHeight = theme.recipes.progressBar.small.metrics.height;
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
      <Inset
        width={props.width}
        height={height}
        padding={{ top: 10, right: 12, bottom: 10, left: 14 }}
      >
        <Horizontal gap={12} align="stretch">
          <Vertical flexGrow={1} justify="space-between" gap={2}>
            <Horizontal height={16} gap={8} align="center">
              <TextBlock
                flexGrow={1}
                height={16}
                text={props.title}
                color={props.disabled ? pal.muted : pal.text}
                fontSize={12}
                fontWeight="medium"
                verticalAlign="center"
                overflow="ellipsis"
                maxLines={1}
              />
              {props.status && statusBounds ? (
                <TextBlock
                  width={statusBounds.width}
                  height={16}
                  text={props.status}
                  color={pal.accent}
                  fontSize={10}
                  fontFamily="mono"
                  verticalAlign="center"
                  horizontalAlign="end"
                  overflow="ellipsis"
                  maxLines={1}
                />
              ) : null}
            </Horizontal>
            {props.detail ? (
              <TextBlock
                height={14}
                text={props.detail}
                color={pal.muted}
                fontSize={10}
                verticalAlign="center"
                overflow="ellipsis"
                maxLines={1}
              />
            ) : null}
            {props.value == null ? (
              <Align height={16} alignX="start" alignY="center">
                <Box width={16} height={16}>
                  <Spinner size={16} active={!props.disabled} />
                </Box>
              </Align>
            ) : (
              <Align height={16} alignY="center">
                <Measure height={progressHeight}>{({ width }) => (
                  <ProgressBar
                    width={width}
                    height={progressHeight}
                    value={props.value!}
                    size="small"
                  />
                )}</Measure>
              </Align>
            )}
          </Vertical>
          {props.action ? (
            <Align width={actionWidth} alignX="stretch" alignY="center">
              {props.action}
            </Align>
          ) : null}
        </Horizontal>
      </Inset>
    </Surface>
  );
}
