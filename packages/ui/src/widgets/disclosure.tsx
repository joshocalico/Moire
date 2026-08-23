import React, { type ReactNode } from "react";
import { Group, Text, measureTextBounds } from "@moire/react-host";
import { Pressable } from "./pressable.js";
import { Separator, Surface } from "./primitives.js";
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
  const pal = useWidgetTheme().foundations.palette;
  const headerHeight = props.headerHeight ?? (props.description ? 52 : 40);
  const height = headerHeight + (props.expanded ? props.contentHeight : 0);
  const title = measureTextBounds(props.title, { fontSize: 12, fontWeight: "medium" });
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
      clip
    >
      <Pressable
        width={props.width}
        height={headerHeight}
        disabled={props.disabled}
        radius={pal.radiusMd}
        onPress={() => props.onExpandedChange?.(!props.expanded)}
      />
      <Text
        x={14}
        y={Math.floor((headerHeight - title.height) / 2) - (props.description ? 7 : 0)}
        text={props.expanded ? "▾" : "›"}
        color={pal.accent}
        fontSize={12}
      />
      <Text
        x={36}
        y={props.description ? 10 : Math.floor((headerHeight - title.height) / 2)}
        text={props.title}
        color={props.disabled ? pal.muted : pal.text}
        fontSize={12}
        fontWeight="medium"
      />
      {props.description ? (
        <Text
          x={36}
          y={30}
          text={props.description}
          color={pal.muted}
          fontSize={10}
        />
      ) : null}
      {props.expanded ? (
        <Group
          y={headerHeight}
          width={props.width}
          height={props.contentHeight}
          clip
        >
          <Separator width={props.width} color={pal.borderSubtle} />
          {props.children}
        </Group>
      ) : null}
    </Surface>
  );
}
