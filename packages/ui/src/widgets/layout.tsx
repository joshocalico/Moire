/** Renderer-neutral box, flow, and overlay layout primitives. */
import React, {
  Children,
  createContext,
  isValidElement,
  useContext,
  type ReactElement,
  type ReactNode,
} from "react";
import { Group } from "@moire/react-host";
import {
  layoutFlex,
  resolveInsets,
  type FlexChildSpec,
  type Insets,
} from "../layout/yoga.js";
import { useWidgetTheme, type WidgetTheme } from "../widget-theme.js";

export type { Insets } from "../layout/yoga.js";

export type LayoutMetrics = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type IntrinsicSizeProvider = (
  props: Record<string, unknown>,
  theme: WidgetTheme,
) => {
  width?: number;
  height?: number;
};

const intrinsicSizeProviders = new WeakMap<object, IntrinsicSizeProvider>();

/** Register recipe-owned natural size without exposing it as caller arithmetic. */
export function registerIntrinsicSize<P extends object>(
  component: (props: P) => ReactNode,
  provider: (props: P, theme: WidgetTheme) => { width?: number; height?: number },
): void {
  intrinsicSizeProviders.set(component, provider as IntrinsicSizeProvider);
}

const LayoutMetricsContext = createContext<LayoutMetrics | null>(null);

/** The box allocated by the nearest declarative layout parent. */
export function useLayoutMetrics(): LayoutMetrics | null {
  return useContext(LayoutMetricsContext);
}

export type FlexItemProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  flexGrow?: number;
  flexShrink?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  aspectRatio?: number;
  alignSelf?: "start" | "center" | "end" | "stretch";
  margin?: Insets;
};

export type BoxProps = FlexItemProps & {
  children?: ReactNode;
};

export function Box(props: BoxProps): ReactNode {
  const allocated = useLayoutMetrics();
  const width = props.width ?? allocated?.width ?? 0;
  const height = props.height ?? allocated?.height ?? 0;
  return (
    <LayoutMetricsContext.Provider value={{ x: 0, y: 0, width, height }}>
      <Group x={props.x ?? 0} y={props.y ?? 0} width={width} height={height}>
        {props.children}
      </Group>
    </LayoutMetricsContext.Provider>
  );
}

export type InsetProps = FlexItemProps & {
  padding?: Insets;
  children?: ReactNode;
};

/** A border-box boundary whose children receive its padded content box. */
export function Inset(props: InsetProps): ReactNode {
  const allocated = useLayoutMetrics();
  const width = props.width ?? allocated?.width ?? 0;
  const height = props.height ?? allocated?.height ?? 0;
  const padding = resolveInsets(props.padding);
  const contentWidth = Math.max(0, width - padding.left - padding.right);
  const contentHeight = Math.max(0, height - padding.top - padding.bottom);
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={width} height={height}>
      <LayoutMetricsContext.Provider
        value={{ x: 0, y: 0, width: contentWidth, height: contentHeight }}
      >
        <Group
          x={padding.left}
          y={padding.top}
          width={contentWidth}
          height={contentHeight}
        >
          {props.children}
        </Group>
      </LayoutMetricsContext.Provider>
    </Group>
  );
}

/** Familiar alias for Inset when emphasizing spacing rather than the box. */
export const Padding = Inset;

export type SpacerProps = FlexItemProps;

/** Empty flexible space for a Row or Column. */
export function Spacer(_props: SpacerProps): ReactNode {
  return null;
}

export type MeasureProps = FlexItemProps & {
  children: (metrics: LayoutMetrics) => ReactNode;
};

/** Render from the actual box assigned by a layout parent. */
export function Measure(props: MeasureProps): ReactNode {
  const allocated = useLayoutMetrics();
  const metrics: LayoutMetrics = allocated ?? {
    x: props.x ?? 0,
    y: props.y ?? 0,
    width: props.width ?? 0,
    height: props.height ?? 0,
  };
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={metrics.width} height={metrics.height}>
      {props.children(metrics)}
    </Group>
  );
}

function collectFlexChildren(
  children: ReactNode,
  theme: WidgetTheme,
  direction: "row" | "column",
  align: "start" | "center" | "end" | "stretch",
): {
  specs: FlexChildSpec[];
  elements: ReactElement[];
} {
  const specs: FlexChildSpec[] = [];
  const elements: ReactElement[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as FlexItemProps;
    const intrinsic = (typeof child.type === "function" || typeof child.type === "object")
      ? intrinsicSizeProviders.get(child.type as object)?.(
          child.props as Record<string, unknown>,
          theme,
        )
      : undefined;
    const stretchesCrossAxis =
      (props.alignSelf ?? align) === "stretch";
    specs.push({
      // An intrinsic cross-axis size is a measurement hint, not an implicit
      // fixed size. Supplying it to a stretching flow prevents prose and
      // other responsive surfaces from receiving the parent's real width.
      width: props.width ?? (
        direction === "column" && stretchesCrossAxis ? undefined : intrinsic?.width
      ),
      height: props.height ?? (
        direction === "row" && stretchesCrossAxis ? undefined : intrinsic?.height
      ),
      flexGrow: props.flexGrow ?? (child.type === Spacer ? 1 : undefined),
      flexShrink: props.flexShrink,
      minWidth: props.minWidth,
      minHeight: props.minHeight,
      maxWidth: props.maxWidth,
      maxHeight: props.maxHeight,
      aspectRatio: props.aspectRatio,
      alignSelf: props.alignSelf,
      margin: props.margin,
    });
    elements.push(child as ReactElement);
  });
  return { specs, elements };
}

export type RowProps = FlexItemProps & {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  gap?: number;
  padding?: Insets;
  justify?: "start" | "center" | "end" | "space-between" | "space-around";
  align?: "start" | "center" | "end" | "stretch";
  wrap?: boolean;
  children?: ReactNode;
};

function FlexLayout(
  props: RowProps & { direction: "row" | "column" },
): ReactNode {
  const theme = useWidgetTheme();
  const allocated = useLayoutMetrics();
  const width = props.width ?? allocated?.width ?? 0;
  const height = props.height ?? allocated?.height;
  const align = props.align ?? (props.direction === "row" ? "center" : "stretch");
  const { specs, elements } = collectFlexChildren(
    props.children,
    theme,
    props.direction,
    align,
  );
  const laid = layoutFlex(
    {
      direction: props.direction,
      width,
      height,
      gap: props.gap ?? 8,
      padding: props.padding ?? 0,
      justify: props.justify,
      align,
      wrap: props.wrap,
    },
    specs,
  );
  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={laid.container.width}
      height={laid.container.height}
    >
      {elements.map((element, index) => {
        const box = laid.children[index]!;
        return (
          <LayoutMetricsContext.Provider key={element.key ?? index} value={box}>
            <Group x={box.x} y={box.y} width={box.width} height={box.height}>
              {element}
            </Group>
          </LayoutMetricsContext.Provider>
        );
      })}
    </Group>
  );
}

export function Row(props: RowProps): ReactNode {
  return <FlexLayout {...props} direction="row" />;
}

export type ColumnProps = RowProps;

export function Column(props: ColumnProps): ReactNode {
  return <FlexLayout {...props} direction="column" />;
}

/** Application-layout flow that stretches children across by default. */
export function Horizontal(props: RowProps): ReactNode {
  return <FlexLayout {...props} align={props.align ?? "stretch"} direction="row" />;
}

export function Vertical(props: ColumnProps): ReactNode {
  return <FlexLayout {...props} align={props.align ?? "stretch"} direction="column" />;
}

export type StackAlignment = "start" | "center" | "end" | "stretch";

export type StackProps = FlexItemProps & {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  alignX?: StackAlignment;
  alignY?: StackAlignment;
  children?: ReactNode;
};

function alignedOffset(container: number, child: number, align: StackAlignment): number {
  if (align === "center") return Math.round((container - child) / 2);
  if (align === "end") return container - child;
  return 0;
}

/** Overlay children in one measured box with optional optical alignment. */
export function Stack(props: StackProps): ReactNode {
  const allocated = useLayoutMetrics();
  const width = props.width ?? allocated?.width ?? 0;
  const height = props.height ?? allocated?.height ?? 0;
  const alignX = props.alignX ?? "stretch";
  const alignY = props.alignY ?? "stretch";
  const elements = Children.toArray(props.children).filter(isValidElement) as ReactElement[];
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={width} height={height}>
      {elements.map((element, index) => {
        const childProps = element.props as FlexItemProps;
        const childWidth = alignX === "stretch" ? width : Math.min(width, childProps.width ?? width);
        const childHeight = alignY === "stretch" ? height : Math.min(height, childProps.height ?? height);
        const box = {
          x: alignedOffset(width, childWidth, alignX),
          y: alignedOffset(height, childHeight, alignY),
          width: childWidth,
          height: childHeight,
        };
        return (
          <LayoutMetricsContext.Provider key={element.key ?? index} value={box}>
            <Group x={box.x} y={box.y} width={box.width} height={box.height}>
              {element}
            </Group>
          </LayoutMetricsContext.Provider>
        );
      })}
    </Group>
  );
}

export type AlignProps = StackProps;

/** Place content within an allocated box without manual offset arithmetic. */
export function Align(props: AlignProps): ReactNode {
  return <Stack {...props} />;
}

export type CenterProps = Omit<StackProps, "alignX" | "alignY">;

/** Center content on both axes inside an allocated box. */
export function Center(props: CenterProps): ReactNode {
  return <Stack {...props} alignX="center" alignY="center" />;
}
