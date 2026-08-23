import React, { type ReactNode } from "react";
import { Group, Rect, Text, type HitKeyEvent } from "@moire/react-host";
import { Pressable } from "./pressable.js";
import { ScrollArea } from "./scroll.js";
import { useWidgetTheme } from "../widget-theme.js";

export type PropertyListItem = {
  id: string;
  label: string;
  value: ReactNode;
  description?: string;
  disabled?: boolean;
  onPress?: () => void;
};

export type PropertyListSection = {
  id: string;
  label?: string;
  items: readonly PropertyListItem[];
};

export type PropertyListProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  sections: readonly PropertyListSection[];
  labelWidth?: number;
  rowHeight?: number;
  descriptionRowHeight?: number;
  selectedId?: string | null;
  onSelect?: (item: PropertyListItem) => void;
  striped?: boolean;
  scrollbar?: boolean;
  emptyState?: ReactNode;
};

const SECTION_HEIGHT = 30;

function isTextValue(value: ReactNode): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

/** Sectioned key-value presentation for inspectors, metadata, and settings. */
export function PropertyList(props: PropertyListProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const pad = 12;
  const labelWidth = Math.max(72, Math.min(props.width - 96, props.labelWidth ?? Math.round(props.width * 0.38)));
  const rowHeight = Math.max(30, props.rowHeight ?? 42);
  const descriptionRowHeight = Math.max(rowHeight, props.descriptionRowHeight ?? 58);
  const hasItems = props.sections.some((section) => section.items.length > 0);
  const contentHeight = props.sections.reduce((height, section) =>
    height + (section.label ? SECTION_HEIGHT : 0) + section.items.reduce(
      (sum, item) => sum + (item.description ? descriptionRowHeight : rowHeight),
      0,
    ), 0);
  let cursorY = 0;
  let rowIndex = 0;
  const activate = (item: PropertyListItem) => {
    props.onSelect?.(item);
    item.onPress?.();
  };
  const handleKey = (item: PropertyListItem, event: HitKeyEvent) => {
    if (event.repeat) return;
    if (event.key === "Enter" || event.key === " " || event.code === 28 || event.code === 57) {
      activate(item);
    }
  };

  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height}>
      {!hasItems && props.emptyState ? props.emptyState : null}
      {hasItems ? (
        <ScrollArea
          width={props.width}
          height={props.height}
          contentHeight={Math.max(props.height, contentHeight)}
          scrollbar={props.scrollbar}
        >
          {props.sections.map((section) => {
            const sectionY = cursorY;
            if (section.label) cursorY += SECTION_HEIGHT;
            const rows = section.items.map((item) => {
              const height = item.description ? descriptionRowHeight : rowHeight;
              const y = cursorY;
              const selected = item.id === props.selectedId;
              const striped = props.striped && rowIndex % 2 === 1;
              rowIndex += 1;
              cursorY += height;
              const valueX = labelWidth + pad * 2;
              const valueWidth = Math.max(1, props.width - valueX - pad);
              return (
                <Group key={item.id} x={0} y={y - sectionY} width={props.width} height={height}>
                  {striped || selected ? (
                    <Rect
                      width={props.width}
                      height={height}
                      fill={selected ? ((pal.accent & 0x00ffffff) | 0x22000000) >>> 0 : pal.panel}
                    />
                  ) : null}
                  {item.onPress || props.onSelect ? (
                    <Pressable
                      width={props.width}
                      height={height}
                      fill={0x00000000}
                      focusable
                      focusId={`property:${item.id}`}
                      disabled={item.disabled}
                      onPress={() => activate(item)}
                      onKeyDown={(event) => handleKey(item, event)}
                    />
                  ) : null}
                  <Text
                    x={pad}
                    y={item.description ? 10 : Math.floor((height - 15) / 2)}
                    text={item.label}
                    color={item.disabled ? pal.muted : pal.text}
                    fontSize={12}
                    fontWeight="medium"
                  />
                  {item.description ? (
                    <Text
                      x={pad}
                      y={30}
                      text={item.description}
                      color={pal.muted}
                      fontSize={10}
                    />
                  ) : null}
                  <Group
                    x={valueX}
                    y={0}
                    width={valueWidth}
                    height={height}
                    clip
                  >
                    {isTextValue(item.value) ? (
                      <Text
                        y={Math.floor((height - 15) / 2)}
                        text={typeof item.value === "boolean" ? (item.value ? "Yes" : "No") : String(item.value)}
                        color={item.disabled ? pal.muted : pal.text}
                        fontSize={12}
                      />
                    ) : item.value}
                  </Group>
                  <Rect x={pad} y={height - 1} width={props.width - pad * 2} height={1} fill={pal.border} />
                </Group>
              );
            });
            const sectionHeight = cursorY - sectionY;
            return (
              <Group key={section.id} x={0} y={sectionY} width={props.width} height={sectionHeight}>
                {section.label ? (
                  <Text
                    x={pad}
                    y={9}
                    text={section.label.toUpperCase()}
                    color={pal.accent}
                    fontSize={10}
                    fontWeight="medium"
                  />
                ) : null}
                {rows}
              </Group>
            );
          })}
        </ScrollArea>
      ) : null}
    </Group>
  );
}
