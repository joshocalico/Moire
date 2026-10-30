/**
 * The page's title block. Full: the path line, a large title with its subtitle and an optional
 * capacity bar. Collapsed (after scrolling, or in short windows): "Title · in Home / Work" on
 * one line. Both carry the same controls at the end of the title row.
 */
import React, { type ReactNode } from "react";
import {
  Box,
  Button,
  Icon,
  IconButton,
  IconSegmentedControl,
  ProgressBar,
  TextBlock,
  getUiScaleFactor,
  measureWrappedText,
  usePalette,
  type HitPointerEvent,
} from "@moire/ui";
import type { SortField, ViewMode } from "#files/filesystem";
import { SORT_LABELS } from "#files/menus";

const CONTROL = 32;
const GAP = 8;
const CAPACITY_WIDTH = 120;
export const FULL_HEADER_HEIGHT = 80;
export const COLLAPSED_HEADER_HEIGHT = 40;
/** Narrower than this, the title steps down a size and sort folds to an icon button. */
const NARROW = 800;

const VIEWS = [
  { id: "list", icon: "list", label: "List · Ctrl+1" },
  { id: "grid", icon: "grid", label: "Grid · Ctrl+2" },
  { id: "columns", icon: "columns", label: "Columns · Ctrl+3" },
] as const;

export type HeaderControls = {
  sort?: { field: SortField; descending: boolean; onMenu(event?: HitPointerEvent): void };
  view?: { value: ViewMode; onChange(view: ViewMode): void };
  /** A page's own action: Empty Trash, Eject. */
  action?: { label: string; danger?: boolean; disabled?: boolean; onPress(): void };
};

function sortLabel(sort: NonNullable<HeaderControls["sort"]>): string {
  return `${SORT_LABELS[sort.field]} ${sort.descending ? "↓" : "↑"}`;
}

function textWidth(text: string, fontSize: number, fontWeight?: "medium") {
  return Math.ceil(measureWrappedText(text, 10000, { fontSize, fontWeight }).width);
}

/** The controls at the end of the title row, laid out right to left; returns their width too. */
function layoutControls(controls: HeaderControls, width: number) {
  const ui = getUiScaleFactor();
  const height = Math.round(CONTROL * ui);
  const gap = Math.round(GAP * ui);
  const parts: { width: number; node: (x: number, y: number) => ReactNode }[] = [];
  if (controls.action) {
    const action = controls.action;
    const actionWidth = textWidth(action.label, 12, "medium") + Math.round(28 * ui);
    parts.push({
      width: actionWidth,
      node: (x, y) => (
        <Button
          key="action"
          x={x}
          y={y}
          width={actionWidth}
          height={height}
          size="small"
          variant={action.danger ? "danger" : "secondary"}
          label={action.label}
          focusId="files:page-action"
          disabled={action.disabled}
          onPress={action.onPress}
        />
      ),
    });
  }
  if (controls.sort && width < NARROW * ui) {
    // Sort stays reachable in narrow pages (and beside a docked inspector), as an icon.
    const sort = controls.sort;
    parts.push({
      width: height,
      node: (x, y) => (
        <IconButton
          key="sort"
          x={x}
          y={y}
          width={height}
          height={height}
          variant="ghost"
          focusId="files:sort"
          tooltip={`Sort: ${sortLabel(sort)}`}
          icon={(style) => <Icon name="sort" size={style.size} color={style.color} symbolic />}
          onPress={sort.onMenu}
        />
      ),
    });
  } else if (controls.sort) {
    const sort = controls.sort;
    const label = sortLabel(sort);
    const sortWidth = textWidth(label, 12) + Math.round(46 * ui);
    parts.push({
      width: sortWidth,
      node: (x, y) => (
        <Button
          key="sort"
          x={x}
          y={y}
          width={sortWidth}
          height={height}
          size="small"
          variant="ghost"
          label={label}
          focusId="files:sort"
          trailingIcon={(style) => (
            <Icon name="chevron-down" size={Math.round(12 * ui)} color={style.color} symbolic />
          )}
          onPress={sort.onMenu}
        />
      ),
    });
  }
  if (controls.view) {
    const view = controls.view;
    const segment = Math.round(32 * ui);
    const viewWidth = VIEWS.length * segment + Math.round(4 * ui);
    parts.push({
      width: viewWidth,
      node: (x, y) => (
        <IconSegmentedControl
          key="view"
          x={x}
          y={y}
          height={height}
          segmentWidth={segment}
          options={VIEWS}
          value={view.value}
          tooltipPlacement="bottom"
          onChange={(value) => view.onChange(value as ViewMode)}
        />
      ),
    });
  }
  const total =
    parts.reduce((sum, part) => sum + part.width, 0) + gap * Math.max(0, parts.length - 1);
  // Placed from the end: the view toggle sits flush right, the sort button before it.
  const render = (y: number) => {
    let x = width;
    return [...parts].reverse().map((part) => {
      x -= part.width;
      const node = part.node(x, y);
      x -= gap;
      return node;
    });
  };
  return { width: total, render, height };
}

/** The path line at a height: 20px as segments, a 32px field while editing. */
export type PathLineSlot = (width: number, height: number) => ReactNode;

const FIELD = 32;

export function FullHeader(props: {
  width: number;
  pathLine: PathLineSlot;
  /** The path field replaces the title while it is open. */
  pathEditing: boolean;
  title: string;
  subtitle: string;
  /** Used share of a volume, drawn as a thin bar after the subtitle. */
  capacity?: number | null;
  controls: HeaderControls;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const px = (value: number) => Math.round(value * ui);
  const controls = layoutControls(props.controls, props.width);
  const titleWidth = Math.max(1, props.width - controls.width - px(16));
  const subtitleWidth = Math.min(
    textWidth(props.subtitle, 12),
    props.width - (props.capacity != null ? px(CAPACITY_WIDTH + 16) : 0),
  );
  return (
    <Box width={props.width} height={px(FULL_HEADER_HEIGHT)}>
      {props.pathEditing ? (
        <Box y={px(21)} width={titleWidth} height={px(FIELD)}>
          {props.pathLine(titleWidth, px(FIELD))}
        </Box>
      ) : (
        <>
          <Box y={px(1)} width={titleWidth} height={px(20)}>
            {props.pathLine(titleWidth, px(20))}
          </Box>
          <TextBlock
            y={px(20)}
            width={titleWidth}
            height={px(34)}
            text={props.title}
            fontSize={props.width < NARROW * ui ? 22 : 26}
            fontWeight="medium"
            verticalAlign="center"
            overflow="ellipsis"
            maxLines={1}
          />
        </>
      )}
      {controls.render(px(21))}
      <TextBlock
        y={px(54)}
        width={Math.max(1, subtitleWidth)}
        height={px(18)}
        text={props.subtitle}
        color={pal.muted}
        fontSize={12}
        verticalAlign="center"
        overflow="ellipsis"
        maxLines={1}
      />
      {props.capacity != null ? (
        <ProgressBar
          x={subtitleWidth + px(16)}
          y={px(61)}
          width={px(CAPACITY_WIDTH)}
          height={px(4)}
          value={props.capacity}
        />
      ) : null}
    </Box>
  );
}

export function CollapsedHeader(props: {
  width: number;
  pathLine: PathLineSlot;
  pathEditing: boolean;
  title: string;
  /** "in Home / Work", or the subtitle where there is no path. */
  detail: string;
  controls: HeaderControls;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const px = (value: number) => Math.round(value * ui);
  const controls = layoutControls(props.controls, props.width);
  const room = Math.max(1, props.width - controls.width - px(16));
  const titleWidth = Math.min(textWidth(props.title, 17, "medium") + 2, room);
  const detailX = titleWidth + px(14);
  if (props.pathEditing)
    return (
      <Box width={props.width} height={px(COLLAPSED_HEADER_HEIGHT)}>
        <Box y={px(4)} width={room} height={px(FIELD)}>
          {props.pathLine(room, px(FIELD))}
        </Box>
        {controls.render(px(4))}
      </Box>
    );
  return (
    <Box width={props.width} height={px(COLLAPSED_HEADER_HEIGHT)}>
      <TextBlock
        y={px(4)}
        width={titleWidth}
        height={px(32)}
        text={props.title}
        fontSize={17}
        fontWeight="medium"
        verticalAlign="center"
        overflow="ellipsis"
        maxLines={1}
      />
      {room - detailX > px(40) ? (
        <TextBlock
          x={detailX}
          y={px(4)}
          width={room - detailX}
          height={px(32)}
          text={props.detail}
          color={pal.muted}
          fontSize={12}
          verticalAlign="center"
          overflow="ellipsis"
          maxLines={1}
        />
      ) : null}
      {controls.render(px(4))}
    </Box>
  );
}
