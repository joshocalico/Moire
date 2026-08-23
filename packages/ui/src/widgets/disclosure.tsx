import React, { type ReactNode } from "react";
import { Icon } from "./icon.js";
import { Box, Horizontal, Inset, Measure, Vertical, registerIntrinsicSize } from "./layout.js";
import { Pressable } from "./pressable.js";
import { Separator, Surface, TextBlock } from "./primitives.js";
import { useWidgetTheme } from "../widget-theme.js";

export type DisclosureProps = {
  x?: number;
  y?: number;
  width: number;
  title: string;
  description?: string;
  expanded: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  headerHeight?: number;
  contentHeight: number;
  disabled?: boolean;
  children?: ReactNode;
};

/** Controlled collapsible section with a single semantic header target. */
export function Disclosure(props: DisclosureProps): ReactNode {
  const theme = useWidgetTheme();
  const pal = theme.foundations.palette;
  const headerHeight = props.headerHeight ?? (props.description ? 52 : 40);
  const height = headerHeight + (props.expanded ? props.contentHeight : 0);
  return (
    <Surface
      x={props.x}
      y={props.y}
      width={props.width}
      height={height}
      fill={pal.surface}
      radius={theme.foundations.radii.medium}
      stroke={pal.borderSubtle}
      strokeWidth={theme.foundations.borders.control}
      elevation="low"
      clip
    >
      <Vertical width={props.width} height={height} gap={0}>
        <Box height={headerHeight}>
          <Pressable
            width={props.width}
            height={headerHeight}
            disabled={props.disabled}
            radius={theme.foundations.radii.medium}
            focusable={Boolean(props.onExpandedChange)}
            onPress={() => props.onExpandedChange?.(!props.expanded)}
          />
          <Inset width={props.width} height={headerHeight} padding={{ horizontal: 14 }}>
            <Horizontal gap={10} align="center">
              <Box width={14} height={14}>
                <Icon name={props.expanded ? "chevron-down" : "chevron-right"} size={14} color={pal.accent} symbolic />
              </Box>
              <Vertical flexGrow={1} gap={2} justify="center">
                <TextBlock height={16} text={props.title} color={props.disabled ? pal.muted : pal.text} fontSize={12} fontWeight="medium" verticalAlign="center" overflow="ellipsis" maxLines={1} />
                {props.description ? <TextBlock height={14} text={props.description} color={pal.muted} fontSize={10} verticalAlign="center" overflow="ellipsis" maxLines={1} /> : null}
              </Vertical>
            </Horizontal>
          </Inset>
        </Box>
        {props.expanded ? (
          <Vertical height={props.contentHeight} gap={0}>
            <Measure height={1}>{({ width }) => <Separator width={width} color={pal.borderSubtle} />}</Measure>
            <Box flexGrow={1}>{props.children}</Box>
          </Vertical>
        ) : null}
      </Vertical>
    </Surface>
  );
}

registerIntrinsicSize(Disclosure, (props) => {
  const headerHeight = props.headerHeight ?? (props.description ? 52 : 40);
  return {
    width: props.width,
    height: headerHeight + (props.expanded ? props.contentHeight : 0),
  };
});
