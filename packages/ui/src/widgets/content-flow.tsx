/** Natural prose/card flow with a measured scrolling viewport. */
import React, { type ReactNode } from "react";
import { useWidgetTheme } from "#ui/widget-theme";
import {
  Column,
  measureColumnContent,
  registerIntrinsicSize,
  useLayoutMetrics,
  type FlexItemProps,
  type Insets,
} from "./layout";
import { Surface } from "./primitives";
import { ScrollArea, type ScrollAreaProps } from "./scroll";

type FlowContentProps = FlexItemProps & {
  children?: ReactNode;
  gap?: number;
  padding?: Insets;
};
export type ContentCardProps = FlowContentProps & { fill?: number; radius?: number };

/** A themed card whose prose and controls determine its natural height. */
export function ContentCard(props: ContentCardProps): ReactNode {
  const theme = useWidgetTheme(),
    allocated = useLayoutMetrics();
  const width = props.width ?? allocated?.width ?? 0;
  const padding = props.padding ?? theme.foundations.space.md;
  const gap = props.gap ?? theme.foundations.space.sm;
  const natural = measureColumnContent({ width, padding, gap, children: props.children }, theme);
  const height = props.height ?? allocated?.height ?? natural.height;
  return (
    <Surface
      x={props.x}
      y={props.y}
      width={width}
      height={height}
      fill={props.fill ?? theme.foundations.palette.surface}
      radius={props.radius ?? theme.foundations.palette.radiusSm}
    >
      <Column width={width} height={height} padding={padding} gap={gap}>
        {props.children}
      </Column>
    </Surface>
  );
}
registerIntrinsicSize(ContentCard, (props, theme) =>
  measureColumnContent(
    {
      ...props,
      padding: props.padding ?? theme.foundations.space.md,
      gap: props.gap ?? theme.foundations.space.sm,
    },
    theme,
  ),
);

export type ScrollColumnProps = FlowContentProps & {
  /** Override the viewport background, including transparent presentation. */
  fill?: number;
  scrollbar?: boolean;
  smooth?: boolean;
  scrollY?: number;
  onScroll?: ScrollAreaProps["onScroll"];
  /** Optional focus owner for keyboard navigation of passive content. */
  keyboard?: ScrollAreaProps["keyboard"];
};
/** Stack content naturally and own its scroll extent; callers provide a viewport. */
export function ScrollColumn(props: ScrollColumnProps): ReactNode {
  const theme = useWidgetTheme(),
    allocated = useLayoutMetrics();
  const width = props.width ?? allocated?.width ?? 0;
  const height = props.height ?? allocated?.height ?? 0;
  const gap = props.gap ?? theme.foundations.space.md;
  const padding = props.padding ?? 0;
  const natural = measureColumnContent({ width, gap, padding, children: props.children }, theme);
  return (
    <ScrollArea
      x={props.x}
      y={props.y}
      width={width}
      height={height}
      contentHeight={natural.height}
      fill={props.fill}
      scrollbar={props.scrollbar}
      smooth={props.smooth}
      scrollY={props.scrollY}
      onScroll={props.onScroll}
      keyboard={props.keyboard}
    >
      <Column width={width} height={natural.height} gap={gap} padding={padding}>
        {props.children}
      </Column>
    </ScrollArea>
  );
}
registerIntrinsicSize(ScrollColumn, (props) => ({ width: props.width, height: props.height }));
