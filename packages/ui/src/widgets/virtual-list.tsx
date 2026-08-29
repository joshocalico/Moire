import React, { useState, type ReactNode } from "react";
import { Group } from "@moire/react-host";
import { ScrollArea } from "./scroll";

export type VirtualListProps<T = unknown> = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  items: readonly T[];
  itemHeight: number;
  renderItem: (item: T, index: number) => ReactNode;
  getKey?: (item: T, index: number) => string | number;
  overscan?: number;
  scrollY?: number;
  onScroll?: (scrollY: number) => void;
  scrollbar?: boolean;
};

/** Fixed-row virtualization composed over the shared ScrollArea viewport. */
export function VirtualList<T>(props: VirtualListProps<T>): ReactNode {
  const [internalScrollY, setInternalScrollY] = useState(0);
  const scrollY = props.scrollY ?? internalScrollY;
  const itemHeight = Math.max(1, props.itemHeight);
  const overscan = Math.max(0, Math.floor(props.overscan ?? 3));
  const contentHeight = Math.max(props.height, props.items.length * itemHeight);
  const maxScroll = Math.max(0, contentHeight - props.height);
  const clampedY = Math.max(0, Math.min(maxScroll, scrollY));
  const first = Math.max(0, Math.floor(clampedY / itemHeight) - overscan);
  const last = Math.min(
    props.items.length,
    Math.ceil((clampedY + props.height) / itemHeight) + overscan,
  );
  const visible = props.items.slice(first, last);

  return (
    <ScrollArea
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      contentHeight={contentHeight}
      scrollY={clampedY}
      onScroll={(next) => {
        if (props.scrollY === undefined) setInternalScrollY(next);
        props.onScroll?.(next);
      }}
      scrollbar={props.scrollbar}
    >
      {visible.map((item, offset) => {
        const index = first + offset;
        return (
          <Group
            key={props.getKey?.(item, index) ?? index}
            x={0}
            y={index * itemHeight}
            width={props.width}
            height={itemHeight}
          >
            {props.renderItem(item, index)}
          </Group>
        );
      })}
    </ScrollArea>
  );
}
