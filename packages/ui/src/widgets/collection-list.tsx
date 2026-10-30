/** A single keyboard owner over a virtual collection; rows own their presentation. */
import React, { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Group, Rect, type HitKeyEvent, type HitPointerEvent } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { useWidgetTheme } from "#ui/widget-theme";
import { Label, FocusRing } from "./primitives";
import { ListItem } from "./list";
import { VirtualList } from "./virtual-list";

export type CollectionRowProps = {
  width: number;
  height?: number;
  title: string;
  subtitle?: string;
  preview?: string;
  metadata?: string;
  leading?: ReactNode;
  selected?: boolean;
};

/** Shared metadata/preview hierarchy for notes, music and file-like collections. */
export function CollectionRow(props: CollectionRowProps): ReactNode {
  const ui = getUiScaleFactor();
  const pal = useWidgetTheme().foundations.palette;
  const height = props.height ?? (props.preview ? 88 : props.subtitle ? 64 : 44) * ui;
  const metadataWidth = props.metadata ? Math.min(100 * ui, props.width * 0.28) : 0;
  return (
    <Group width={props.width} height={height} clip>
      <ListItem
        width={props.width}
        height={height}
        title=""
        selected={props.selected}
        interactive={false}
      />
      {props.leading ? (
        <Group x={12 * ui} y={(height - 40 * ui) / 2} width={40 * ui} height={40 * ui}>
          {props.leading}
        </Group>
      ) : null}
      <Label
        x={(props.leading ? 64 : 14) * ui}
        y={props.preview ? 10 * ui : props.subtitle ? 12 * ui : (height - 22 * ui) / 2}
        width={Math.max(0, props.width - (props.leading ? 78 : 28) * ui - metadataWidth)}
        height={22 * ui}
        text={props.title}
        fontSize={14}
        fontWeight="medium"
        maxLines={1}
        overflow="ellipsis"
      />
      {props.subtitle ? (
        <Label
          x={(props.leading ? 64 : 14) * ui}
          y={(props.preview ? 34 : 36) * ui}
          width={Math.max(0, props.width - (props.leading ? 78 : 28) * ui)}
          height={19 * ui}
          text={props.subtitle}
          color={pal.muted}
          fontSize={11}
          maxLines={1}
          overflow="ellipsis"
        />
      ) : null}
      {props.preview ? (
        <Label
          x={14 * ui}
          y={57 * ui}
          width={Math.max(0, props.width - 28 * ui)}
          height={20 * ui}
          text={props.preview}
          color={pal.muted}
          fontSize={12}
          maxLines={1}
          overflow="ellipsis"
        />
      ) : null}
      {props.metadata ? (
        <Label
          x={props.width - metadataWidth - 12 * ui}
          y={12 * ui}
          width={metadataWidth}
          height={22 * ui}
          text={props.metadata}
          color={pal.muted}
          fontSize={11}
          horizontalAlign="end"
          maxLines={1}
          overflow="ellipsis"
        />
      ) : null}
    </Group>
  );
}

export type CollectionListProps<T> = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  items: readonly T[];
  getKey: (item: T) => string;
  selectedKey?: string | null;
  /** `source` tells a pointer press (which may open the item) from arrow-key browsing. */
  onSelect: (item: T, source: "pointer" | "keyboard") => void;
  onActivate?: (item: T) => void;
  /** Delete (or Backspace) on the selected item, e.g. close a listed window. */
  onDelete?: (item: T) => void;
  onContextMenu?: (item: T, event: HitPointerEvent) => void;
  renderItem: (item: T, state: { selected: boolean; width: number; height: number }) => ReactNode;
  rowHeight?: number;
  focusId?: string;
  autoFocus?: boolean;
  emptyMessage?: string;
};
export function CollectionList<T>(props: CollectionListProps<T>): ReactNode {
  const generatedId = useId();
  const ui = getUiScaleFactor();
  const [scroll, setScroll] = useState(0);
  const [focused, setFocused] = useState(false);
  const lastPress = useRef<{ key: string; at: number } | null>(null);
  const rowHeight = props.rowHeight ?? 64 * ui;
  const selectedIndex = props.items.findIndex((item) => props.getKey(item) === props.selectedKey);
  const maxScroll = Math.max(0, props.items.length * rowHeight - props.height);
  const scrollY = Math.max(0, Math.min(maxScroll, scroll));
  const reveal = (index: number) =>
    setScroll((old) =>
      Math.max(
        0,
        Math.min(
          maxScroll,
          index * rowHeight < old
            ? index * rowHeight
            : (index + 1) * rowHeight > old + props.height
              ? (index + 1) * rowHeight - props.height
              : old,
        ),
      ),
    );
  useEffect(() => {
    if (selectedIndex >= 0) reveal(selectedIndex);
  }, [selectedIndex, props.height, rowHeight]);
  const select = (index: number) => {
    const item = props.items[index];
    if (!item) return;
    props.onSelect(item, "keyboard");
    reveal(index);
  };
  const atPointer = (event: HitPointerEvent) =>
    props.items[Math.floor((event.localY + scrollY) / rowHeight)];
  const keyDown = (event: HitKeyEvent) => {
    if (event.repeat && event.key === "Enter") return;
    if (event.key === "ArrowDown" || event.code === 108)
      select(Math.min(props.items.length - 1, selectedIndex + 1));
    else if (event.key === "ArrowUp" || event.code === 103) select(Math.max(0, selectedIndex - 1));
    else if (event.key === "Home" || event.code === 102) select(0);
    else if (event.key === "End" || event.code === 107) select(props.items.length - 1);
    else if (event.key === "Enter" || event.code === 28) {
      const item = props.items[selectedIndex];
      if (item) props.onActivate?.(item);
    } else if (event.key === "Delete" || event.code === 111 || event.code === 14) {
      const item = props.items[selectedIndex];
      if (item) props.onDelete?.(item);
    }
  };
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height} clip>
      <Rect
        width={props.width}
        height={props.height}
        fill={0x00000000}
        focusable
        focusId={props.focusId ?? `collection-list:${generatedId}`}
        autoFocus={props.autoFocus}
        onFocusChange={setFocused}
        onKeyDown={keyDown}
        onPress={(event) => {
          if (!event) return;
          const item = atPointer(event);
          if (!item) return;
          const key = props.getKey(item),
            now = Date.now();
          props.onSelect(item, "pointer");
          if (lastPress.current?.key === key && now - lastPress.current.at < 400) {
            lastPress.current = null;
            props.onActivate?.(item);
          } else lastPress.current = { key, at: now };
        }}
        onContextMenu={
          props.onContextMenu
            ? (event) => {
                const item = atPointer(event);
                if (item) {
                  props.onSelect(item, "pointer");
                  props.onContextMenu?.(item, event);
                }
              }
            : undefined
        }
      />
      <VirtualList
        width={props.width}
        height={props.height}
        items={props.items}
        getKey={props.getKey}
        itemHeight={rowHeight}
        scrollY={scrollY}
        onScroll={setScroll}
        renderItem={(item) =>
          props.renderItem(item, {
            selected: props.getKey(item) === props.selectedKey,
            width: props.width,
            height: rowHeight,
          })
        }
      />
      {!props.items.length ? (
        <Label
          x={14 * ui}
          y={16 * ui}
          width={Math.max(0, props.width - 28 * ui)}
          text={props.emptyMessage ?? "No items"}
          wrap
        />
      ) : null}
      {focused ? <FocusRing width={props.width} height={props.height} /> : null}
    </Group>
  );
}
