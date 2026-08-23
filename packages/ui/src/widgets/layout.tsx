/** Renderer-neutral flex layout wrappers backed by Yoga measurement. */
import React, {
  Children,
  createContext,
  isValidElement,
  useContext,
  type ReactElement,
  type ReactNode,
} from "react";
import { Group } from "@moire/react-host";
import { layoutFlex, type FlexChildSpec } from "../layout/yoga.js";

export type LayoutMetrics = {
  x: number;
  y: number;
  width: number;
  height: number;
};

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
  margin?: number;
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

export type MeasureProps = FlexItemProps & {
  children: (metrics: LayoutMetrics) => ReactNode;
};

/** Render from the actual box assigned by Yoga (or explicit fallback size). */
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

function collectFlexChildren(children: ReactNode): {
  specs: FlexChildSpec[];
  elements: ReactElement[];
} {
  const specs: FlexChildSpec[] = [];
  const elements: ReactElement[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as FlexItemProps;
    specs.push({
      width: props.width,
      height: props.height,
      flexGrow: props.flexGrow,
      flexShrink: props.flexShrink,
      minWidth: props.minWidth,
      minHeight: props.minHeight,
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
  padding?: number;
  justify?: "start" | "center" | "end" | "space-between" | "space-around";
  align?: "start" | "center" | "end" | "stretch";
  wrap?: boolean;
  children?: ReactNode;
};

function FlexLayout(
  props: RowProps & { direction: "row" | "column" },
): ReactNode {
  const allocated = useLayoutMetrics();
  const width = props.width ?? allocated?.width ?? 0;
  const height = props.height ?? allocated?.height;
  const { specs, elements } = collectFlexChildren(props.children);
  const laid = layoutFlex(
    {
      direction: props.direction,
      width,
      height,
      gap: props.gap ?? 8,
      padding: props.padding ?? 0,
      justify: props.justify,
      align: props.align ?? (props.direction === "row" ? "center" : "stretch"),
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

/** Readable flow aliases; both remain Yoga-backed. */
export const Horizontal = Row;
export const Vertical = Column;

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
