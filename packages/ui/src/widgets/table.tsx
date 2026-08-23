import React, { type ReactNode } from "react";
import { Group, Rect, Text, measureTextBounds } from "@moire/react-host";
import { CollectionItem } from "./interaction.js";
import { Pressable } from "./pressable.js";
import { Separator, Surface } from "./primitives.js";
import { VirtualList } from "./virtual-list.js";
import { useWidgetTheme } from "../widget-theme.js";

export type TableSortDirection = "ascending" | "descending";
export type TableSort = {
  columnId: string;
  direction: TableSortDirection;
};

export type TableColumn<T> = {
  id: string;
  label: string;
  width?: number;
  minWidth?: number;
  align?: "left" | "right";
  sortable?: boolean;
  getValue?: (item: T) => string | number;
  renderCell?: (item: T, index: number, width: number) => ReactNode;
};

export type TableProps<T = unknown> = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  columns: readonly TableColumn<T>[];
  rows: readonly T[];
  getRowKey: (row: T, index: number) => string;
  selectedKey?: string | null;
  onSelect?: (row: T, index: number) => void;
  onActivate?: (row: T, index: number) => void;
  sort?: TableSort | null;
  onSortChange?: (sort: TableSort) => void;
  headerHeight?: number;
  rowHeight?: number;
  striped?: boolean;
  emptyState?: ReactNode;
};

type ResolvedColumn<T> = TableColumn<T> & { x: number; resolvedWidth: number };

function resolveColumns<T>(
  columns: readonly TableColumn<T>[],
  width: number,
): ResolvedColumn<T>[] {
  const fixed = columns.reduce((sum, column) => sum + (column.width ?? 0), 0);
  const flexible = columns.filter((column) => column.width == null);
  const flexibleWidth = flexible.length > 0
    ? Math.max(1, (width - fixed) / flexible.length)
    : 0;
  let x = 0;
  return columns.map((column) => {
    const resolvedWidth = Math.max(
      column.minWidth ?? 48,
      column.width ?? flexibleWidth,
    );
    const resolved = { ...column, x, resolvedWidth };
    x += resolvedWidth;
    return resolved;
  });
}

function compareValues(a: string | number, b: string | number): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/** Sortable virtualized data table with keyed row selection. */
export function Table<T,>(props: TableProps<T>): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const headerHeight = props.headerHeight ?? 34;
  const rowHeight = props.rowHeight ?? 38;
  const bodyHeight = Math.max(1, props.height - headerHeight);
  const columns = resolveColumns(props.columns, props.width);
  const rows = [...props.rows];
  if (props.sort) {
    const column = props.columns.find((entry) => entry.id === props.sort?.columnId);
    if (column?.getValue) {
      const direction = props.sort.direction === "ascending" ? 1 : -1;
      rows.sort((a, b) => direction * compareValues(column.getValue!(a), column.getValue!(b)));
    }
  }

  return (
    <Surface
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      fill={pal.surface}
      radius={pal.radiusMd}
      stroke={pal.borderSubtle}
      strokeWidth={1}
      clip
    >
      <Surface width={props.width} height={headerHeight} fill={pal.panel}>
        {columns.map((column) => {
          const active = props.sort?.columnId === column.id;
          const arrow = active
            ? props.sort?.direction === "ascending" ? "↑" : "↓"
            : "";
          return (
            <Group
              key={column.id}
              x={column.x}
              width={column.resolvedWidth}
              height={headerHeight}
              clip
            >
              <Pressable
                width={column.resolvedWidth}
                height={headerHeight}
                disabled={!column.sortable}
                onPress={() => {
                  if (!column.sortable) return;
                  props.onSortChange?.({
                    columnId: column.id,
                    direction:
                      active && props.sort?.direction === "ascending"
                        ? "descending"
                        : "ascending",
                  });
                }}
              />
              <Text
                x={10}
                y={Math.floor((headerHeight - measureTextBounds("Mg", { fontSize: 11 }).height) / 2)}
                text={`${column.label}${arrow ? `  ${arrow}` : ""}`}
                color={active ? pal.accent : pal.muted}
                fontSize={11}
                fontWeight="medium"
              />
              {column.x > 0 ? (
                <Separator x={0} width={1} height={headerHeight} color={pal.borderSubtle} />
              ) : null}
            </Group>
          );
        })}
      </Surface>
      <Separator y={headerHeight - 1} width={props.width} color={pal.border} />
      {rows.length === 0 && props.emptyState ? (
        <Group y={headerHeight} width={props.width} height={bodyHeight}>
          {props.emptyState}
        </Group>
      ) : (
        <VirtualList
          y={headerHeight}
          width={props.width}
          height={bodyHeight}
          items={rows}
          itemHeight={rowHeight}
          getKey={props.getRowKey}
          renderItem={(row, index) => {
            const key = props.getRowKey(row, index);
            const selected = key === props.selectedKey;
            return (
              <Group width={props.width} height={rowHeight}>
                {props.striped && index % 2 === 1 ? (
                  <Rect width={props.width} height={rowHeight} fill={pal.panel} />
                ) : null}
                {selected ? (
                  <Rect width={props.width} height={rowHeight} fill={pal.selection} />
                ) : null}
                <CollectionItem
                  width={props.width}
                  height={rowHeight}
                  focusId={`table-row:${key}`}
                  onPress={() => props.onSelect?.(row, index)}
                  onDoublePress={() => props.onActivate?.(row, index)}
                />
                {columns.map((column) => {
                  const value = column.getValue?.(row);
                  const text = value == null ? "" : String(value);
                  const bounds = measureTextBounds(text, { fontSize: 12 });
                  const textX = column.align === "right"
                    ? Math.max(8, column.resolvedWidth - bounds.width - 10)
                    : 10;
                  return (
                    <Group
                      key={column.id}
                      x={column.x}
                      width={column.resolvedWidth}
                      height={rowHeight}
                      clip
                    >
                      {column.renderCell?.(row, index, column.resolvedWidth) ?? (
                        <Text
                          x={textX}
                          y={Math.floor((rowHeight - bounds.height) / 2)}
                          text={text}
                          color={pal.text}
                          fontSize={12}
                        />
                      )}
                    </Group>
                  );
                })}
                <Separator y={rowHeight - 1} width={props.width} color={pal.borderSubtle} />
              </Group>
            );
          }}
        />
      )}
    </Surface>
  );
}
