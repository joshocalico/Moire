import React, { type ReactNode } from "react";
import { Group, Rect, type HitKeyEvent } from "@moire/react-host";
import { Pressable } from "./pressable";
import { ScrollArea } from "./scroll";
import { Align, Horizontal, Inset, Vertical } from "./layout";
import { TextBlock } from "./primitives";
import { useWidgetTheme } from "#ui/widget-theme";
import { getUiScaleFactor } from "#ui/font";

export type PropertyListItem = {
  id: string;
  label: string;
  value: ReactNode;
  description?: string;
  disabled?: boolean;
  /** "accent" draws a text value in the accent colour, e.g. a link-like "Image Viewer · 2 h ago". */
  tone?: "accent";
  onPress?: () => void;
};

/**
 * "regular": 42px rows with medium labels, separators and padding. "compact": 24px rows, muted
 * 12px labels in a 96px column, no stripes, separators, padding or stacking, to sit in a card.
 */
export type PropertyListDensity = "regular" | "compact";

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
  density?: PropertyListDensity;
  /** Scroll when the rows outgrow the height (default true); false lays them out in place. */
  scroll?: boolean;
};

const SECTION_HEIGHT = 30;
const PAD = 12;
const ROW_HEIGHT = 42;
const COMPACT_ROW_HEIGHT = 24;
const COMPACT_LABEL_WIDTH = 96;
const STACK_BELOW = 420;

/** Height of `items` rows without descriptions or section labels, scaled. */
export function propertyListHeight(
  items: number,
  density: PropertyListDensity = "compact",
): number {
  const row = density === "compact" ? COMPACT_ROW_HEIGHT : ROW_HEIGHT;
  return items * Math.round(row * getUiScaleFactor());
}

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
  compact: boolean;
};

function PropertyRow(props: PropertyRowProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const ui = getUiScaleFactor();
  const compact = props.compact;
  const pad = compact ? 0 : PAD * ui;
  const textHeight = Math.round((compact ? 16 : 18) * ui);
  const label = (
    <Vertical
      width={props.stacked ? props.width - pad * 2 : props.labelWidth}
      height={props.stacked ? Math.round((props.item.description ? 36 : 18) * ui) : undefined}
      justify="center"
      gap={2 * ui}
    >
      <TextBlock
        height={textHeight}
        text={props.item.label}
        color={props.item.disabled || compact ? pal.muted : pal.text}
        fontSize={compact ? 12 : 13}
        fontWeight={compact ? "regular" : "medium"}
        verticalAlign="center"
        overflow="ellipsis"
        maxLines={1}
      />
      {props.item.description ? (
        <TextBlock
          height={Math.round(16 * ui)}
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
      height={textHeight}
      text={
        typeof props.item.value === "boolean"
          ? props.item.value
            ? "Yes"
            : "No"
          : String(props.item.value)
      }
      color={
        props.item.disabled ? pal.muted : props.item.tone === "accent" ? pal.accentLine : pal.text
      }
      fontSize={compact ? 12 : 13}
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
          <Vertical gap={6 * ui} justify="center" align="stretch">
            {label}
            {value}
          </Vertical>
        ) : (
          <Horizontal gap={compact ? 0 : pad} align="stretch">
            {label}
            <Align flexGrow={1} alignX="stretch" alignY="center">
              {value}
            </Align>
          </Horizontal>
        )}
      </Inset>
      {compact ? null : (
        <Rect
          x={pad}
          y={props.height - 1}
          width={props.width - pad * 2}
          height={1}
          fill={pal.borderSubtle}
        />
      )}
    </Group>
  );
}

/** Sectioned key-value presentation for inspectors, metadata, and settings. */
export function PropertyList(props: PropertyListProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const ui = getUiScaleFactor();
  const compact = props.density === "compact";
  const labelRowHeight = Math.round(SECTION_HEIGHT * ui);
  const stacked = !compact && (props.stacked ?? props.width < STACK_BELOW * ui);
  const labelWidth = compact
    ? Math.min(props.width, props.labelWidth ?? Math.round(COMPACT_LABEL_WIDTH * ui))
    : Math.max(
        72 * ui,
        Math.min(props.width - 96 * ui, props.labelWidth ?? Math.round(props.width * 0.38)),
      );
  const rowHeight = compact
    ? (props.rowHeight ?? Math.round(COMPACT_ROW_HEIGHT * ui))
    : Math.max(
        Math.round((stacked ? 66 : 30) * ui),
        props.rowHeight ?? Math.round(ROW_HEIGHT * ui),
      );
  const descriptionRowHeight = compact
    ? (props.descriptionRowHeight ?? Math.round(40 * ui))
    : Math.max(
        stacked ? Math.round(88 * ui) : rowHeight,
        props.descriptionRowHeight ?? Math.round(58 * ui),
      );
  const hasItems = props.sections.some((section) => section.items.length > 0);
  const contentHeight = props.sections.reduce(
    (height, section) =>
      height +
      (section.label ? labelRowHeight : 0) +
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

  const rows = (
    <Vertical width={props.width} height={Math.max(props.height, contentHeight)} gap={0}>
      {props.sections.map((section, sectionIndex) => {
        const sectionHeight =
          (section.label ? labelRowHeight : 0) +
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
              <Inset height={labelRowHeight} padding={{ horizontal: compact ? 0 : PAD * ui }}>
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
                striped={Boolean(!compact && props.striped && (rowsBefore + itemIndex) % 2 === 1)}
                interactive={Boolean(item.onPress || props.onSelect)}
                stacked={stacked}
                compact={compact}
                onActivate={activate}
              />
            ))}
          </Vertical>
        );
      })}
    </Vertical>
  );

  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height}>
      {!hasItems && props.emptyState ? props.emptyState : null}
      {hasItems && props.scroll === false ? rows : null}
      {hasItems && props.scroll !== false ? (
        <ScrollArea
          width={props.width}
          height={props.height}
          contentHeight={Math.max(props.height, contentHeight)}
          scrollbar={props.scrollbar}
        >
          {rows}
        </ScrollArea>
      ) : null}
    </Group>
  );
}
