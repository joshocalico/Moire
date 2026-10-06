import React, { type ReactNode } from "react";
import { Group, Rect, type HitKeyEvent } from "@moire/react-host";
import { Pressable } from "./pressable";
import { ScrollArea } from "./scroll";
import { Align, Horizontal, Inset, Vertical } from "./layout";
import { TextBlock } from "./primitives";
import { useWidgetTheme } from "#ui/widget-theme";

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
  /** Stack labels above values in narrow inspectors and settings windows. */
  stacked?: boolean;
};

const SECTION_HEIGHT = 30;

function isTextValue(value: ReactNode): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

type PropertyRowProps = {
  item: PropertyListItem;
  width: number;
  height: number;
  labelWidth: number;
  selected: boolean;
  striped: boolean;
  interactive: boolean;
  onActivate: (item: PropertyListItem) => void;
  stacked: boolean;
};

function PropertyRow(props: PropertyRowProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const pad = 12;
  const label = (
    <Vertical
      width={props.stacked ? props.width - pad * 2 : props.labelWidth}
      height={props.stacked ? (props.item.description ? 36 : 18) : undefined}
      justify="center"
      gap={2}
    >
      <TextBlock
        height={18}
        text={props.item.label}
        color={props.item.disabled ? pal.muted : pal.text}
        fontSize={13}
        fontWeight="medium"
        verticalAlign="center"
        overflow="ellipsis"
        maxLines={1}
      />
      {props.item.description ? (
        <TextBlock
          height={16}
          text={props.item.description}
          color={pal.muted}
          fontSize={11}
          verticalAlign="center"
          overflow="ellipsis"
          maxLines={1}
        />
      ) : null}
    </Vertical>
  );
  const value = isTextValue(props.item.value) ? (
    <TextBlock
      height={18}
      text={
        typeof props.item.value === "boolean"
          ? props.item.value
            ? "Yes"
            : "No"
          : String(props.item.value)
      }
      color={props.item.disabled ? pal.muted : pal.text}
      fontSize={13}
      verticalAlign="center"
      overflow="ellipsis"
      maxLines={1}
    />
  ) : (
    props.item.value
  );
  const handleKey = (event: HitKeyEvent) => {
    if (event.repeat) return;
    if (event.key === "Enter" || event.key === " " || event.code === 28 || event.code === 57) {
      props.onActivate(props.item);
    }
  };
  return (
    <Group width={props.width} height={props.height}>
      {props.striped || props.selected ? (
        <Rect
          width={props.width}
          height={props.height}
          fill={props.selected ? ((pal.accent & 0x00ffffff) | 0x22000000) >>> 0 : pal.panel}
        />
      ) : null}
      {props.interactive ? (
        <Pressable
          width={props.width}
          height={props.height}
          fill={0x00000000}
          focusable
          focusId={`property:${props.item.id}`}
          disabled={props.item.disabled}
          onPress={() => props.onActivate(props.item)}
          onKeyDown={handleKey}
        />
      ) : null}
      <Inset width={props.width} height={props.height} padding={{ horizontal: pad }}>
        {props.stacked ? (
          <Vertical gap={6} justify="center" align="stretch">
            {label}
            {value}
          </Vertical>
        ) : (
          <Horizontal gap={pad} align="stretch">
            {label}
            <Align flexGrow={1} alignX="stretch" alignY="center">
              {value}
            </Align>
          </Horizontal>
        )}
      </Inset>
      <Rect
        x={pad}
        y={props.height - 1}
        width={props.width - pad * 2}
        height={1}
        fill={pal.borderSubtle}
      />
    </Group>
  );
}

/** Sectioned key-value presentation for inspectors, metadata, and settings. */
export function PropertyList(props: PropertyListProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const stacked = props.stacked ?? props.width < 420;
  const labelWidth = Math.max(
    72,
    Math.min(props.width - 96, props.labelWidth ?? Math.round(props.width * 0.38)),
  );
  const rowHeight = Math.max(stacked ? 66 : 30, props.rowHeight ?? 42);
  const descriptionRowHeight = Math.max(stacked ? 88 : rowHeight, props.descriptionRowHeight ?? 58);
  const hasItems = props.sections.some((section) => section.items.length > 0);
  const contentHeight = props.sections.reduce(
    (height, section) =>
      height +
      (section.label ? SECTION_HEIGHT : 0) +
      section.items.reduce(
        (sum, item) => sum + (item.description ? descriptionRowHeight : rowHeight),
        0,
      ),
    0,
  );
  const activate = (item: PropertyListItem) => {
    props.onSelect?.(item);
    item.onPress?.();
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
          <Vertical width={props.width} height={Math.max(props.height, contentHeight)} gap={0}>
            {props.sections.map((section, sectionIndex) => {
              const sectionHeight =
                (section.label ? SECTION_HEIGHT : 0) +
                section.items.reduce(
                  (sum, item) => sum + (item.description ? descriptionRowHeight : rowHeight),
                  0,
                );
              const rowsBefore = props.sections
                .slice(0, sectionIndex)
                .reduce((count, prior) => count + prior.items.length, 0);
              return (
                <Vertical key={section.id} height={sectionHeight} gap={0}>
                  {section.label ? (
                    <Inset height={SECTION_HEIGHT} padding={{ horizontal: 12 }}>
                      <TextBlock
                        text={section.label}
                        color={pal.muted}
                        fontSize={12}
                        fontWeight="medium"
                        verticalAlign="center"
                        overflow="ellipsis"
                        maxLines={1}
                      />
                    </Inset>
                  ) : null}
                  {section.items.map((item, itemIndex) => (
                    <PropertyRow
                      key={item.id}
                      item={item}
                      width={props.width}
                      height={item.description ? descriptionRowHeight : rowHeight}
                      labelWidth={labelWidth}
                      selected={item.id === props.selectedId}
                      striped={Boolean(props.striped && (rowsBefore + itemIndex) % 2 === 1)}
                      interactive={Boolean(item.onPress || props.onSelect)}
                      stacked={stacked}
                      onActivate={activate}
                    />
                  ))}
                </Vertical>
              );
            })}
          </Vertical>
        </ScrollArea>
      ) : null}
    </Group>
  );
}
