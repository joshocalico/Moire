/** Renderer-neutral flex layout wrappers backed by Yoga measurement. */
import React, {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { Group } from "@moire/react-host";
import { layoutFlex, type FlexChildSpec } from "../layout/yoga.js";

export type BoxProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  flexGrow?: number;
  flexShrink?: number;
  minWidth?: number;
  minHeight?: number;
  children?: ReactNode;
};

export function Box(props: BoxProps): ReactNode {
  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width ?? 0}
      height={props.height ?? 0}
    >
      {props.children}
    </Group>
  );
}

type FlexItemProps = {
  width?: number;
  height?: number;
  flexGrow?: number;
  flexShrink?: number;
  minWidth?: number;
  minHeight?: number;
};

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
    });
    elements.push(child as ReactElement);
  });
  return { specs, elements };
}

export type RowProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  gap?: number;
  padding?: number;
  justify?: "start" | "center" | "end" | "space-between" | "space-around";
  align?: "start" | "center" | "end" | "stretch";
  flexGrow?: number;
  flexShrink?: number;
  minWidth?: number;
  minHeight?: number;
  children?: ReactNode;
};

function FlexLayout(
  props: RowProps & { direction: "row" | "column" },
): ReactNode {
  const { specs, elements } = collectFlexChildren(props.children);
  const laid = layoutFlex(
    {
      direction: props.direction,
      width: props.width,
      height: props.height,
      gap: props.gap ?? 8,
      padding: props.padding ?? 0,
      justify: props.justify,
      align: props.align ?? (props.direction === "row" ? "center" : "stretch"),
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
          <Group
            key={element.key ?? index}
            x={box.x}
            y={box.y}
            width={box.width}
            height={box.height}
          >
            {element}
          </Group>
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
