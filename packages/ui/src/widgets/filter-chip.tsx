/** Filter chips: a single chip, and a row of them that wraps or overflows into "More". */
import React, { useId, useRef, useState, type ReactNode } from "react";
import {
  Group,
  measureTextBounds,
  type HitKeyEvent,
  type HitPointerEvent,
  type SceneNode,
} from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { foregroundOn, mixColor } from "#ui/theme-family-color";
import { useWidgetTheme } from "#ui/widget-theme";
import { AnchoredMenu } from "./anchored-menu";
import { Icon, type IconName } from "./icon";
import { registerIntrinsicSize } from "./layout";
import { Pressable } from "./pressable";
import { TextBlock } from "./primitives";

export type FilterChipProps = {
  x?: number;
  y?: number;
  label: string;
  icon?: IconName;
  /** Colour of the leading icon while not selected. */
  tint?: number;
  count?: string | number;
  selected?: boolean;
  disabled?: boolean;
  /** Trailing chevron: the chip opens a menu. */
  disclosure?: boolean;
  focusId?: string;
  autoFocus?: boolean;
  onFocusChange?: (focused: boolean) => void;
  /** Replaces the default Enter/Space activation, e.g. for arrow-key roving in a group. */
  onKeyDown?: (event: HitKeyEvent) => void;
  onPress?: (event?: HitPointerEvent) => void;
};

const CHIP_H = 30;
const PAD_X = 12;
const ICON = 16;
const ICON_GAP = 6;
const COUNT_GAP = 7;
const CHEVRON = 12;
const LABEL_SIZE = 12;
const COUNT_SIZE = 11;

function countText(count: FilterChipProps["count"]): string | null {
  return count === undefined || count === "" ? null : String(count);
}

/** A chip's natural width, scaled, for laying chips out by hand. */
export function filterChipWidth(
  chip: Pick<FilterChipProps, "label" | "icon" | "count" | "selected" | "disclosure">,
): number {
  const ui = getUiScaleFactor();
  const count = countText(chip.count);
  const label = measureTextBounds(chip.label, {
    fontSize: LABEL_SIZE,
    fontWeight: chip.selected ? "medium" : "regular",
  }).width;
  return Math.ceil(
    PAD_X * 2 * ui +
      (chip.icon ? (ICON + ICON_GAP) * ui : 0) +
      label +
      (count ? COUNT_GAP * ui + measureTextBounds(count, { fontSize: COUNT_SIZE }).width : 0) +
      (chip.disclosure ? (ICON_GAP + CHEVRON) * ui : 0),
  );
}

export function filterChipHeight(): number {
  return Math.round(CHIP_H * getUiScaleFactor());
}

/** A pill that toggles a filter, with an optional tinted icon and a count. */
export function FilterChip(props: FilterChipProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const ui = getUiScaleFactor();
  const width = filterChipWidth(props);
  const height = filterChipHeight();
  const count = countText(props.count);
  const fill = props.selected ? pal.accent : pal.surface;
  const ink = props.selected ? foregroundOn(fill) : pal.text;
  const quiet = props.selected ? mixColor(ink, fill, 0.25) : pal.muted;
  const labelWidth = measureTextBounds(props.label, {
    fontSize: LABEL_SIZE,
    fontWeight: props.selected ? "medium" : "regular",
  }).width;
  let x = PAD_X * ui;
  const iconX = x;
  if (props.icon) x += (ICON + ICON_GAP) * ui;
  const labelX = x;
  x += labelWidth;
  const countX = x + COUNT_GAP * ui;
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={width} height={height}>
      <Pressable
        width={width}
        height={height}
        fill={fill}
        hoverFill={props.selected ? fill : mixColor(pal.surface, pal.hover, 0.7)}
        pressedFill={props.selected ? fill : pal.pressed}
        radius={height / 2}
        stroke={props.selected ? undefined : pal.borderSubtle}
        strokeWidth={props.selected ? undefined : 1}
        disabled={props.disabled}
        focusId={props.focusId}
        autoFocus={props.autoFocus}
        onFocusChange={props.onFocusChange}
        onKeyDown={props.onKeyDown}
        onPress={props.onPress}
      />
      {props.icon ? (
        <Icon
          x={iconX}
          y={Math.round((height - ICON * ui) / 2)}
          name={props.icon}
          size={ICON * ui}
          color={props.selected ? ink : (props.tint ?? pal.muted)}
          symbolic
        />
      ) : null}
      <TextBlock
        x={labelX}
        width={Math.ceil(labelWidth) + 1}
        height={height}
        text={props.label}
        color={props.disabled ? pal.muted : ink}
        fontSize={LABEL_SIZE}
        fontWeight={props.selected ? "medium" : "regular"}
        verticalAlign="center"
        maxLines={1}
      />
      {count ? (
        <TextBlock
          x={countX}
          width={Math.max(1, width - countX)}
          height={height}
          text={count}
          color={quiet}
          fontSize={COUNT_SIZE}
          verticalAlign="center"
          maxLines={1}
        />
      ) : null}
      {props.disclosure ? (
        <Icon
          x={width - (PAD_X + CHEVRON) * ui}
          y={Math.round((height - CHEVRON * ui) / 2)}
          name="chevron-down"
          size={CHEVRON * ui}
          color={quiet}
          symbolic
        />
      ) : null}
    </Group>
  );
}

registerIntrinsicSize(FilterChip, (props) => ({
  width: filterChipWidth(props),
  height: filterChipHeight(),
}));

export type ChipGroupItem = {
  id: string;
  label: string;
  icon?: IconName;
  tint?: number;
  count?: string | number;
  disabled?: boolean;
};

export type ChipGroupProps = {
  x?: number;
  y?: number;
  width: number;
  chips: readonly ChipGroupItem[];
  selectedId?: string | null;
  onSelect?: (chip: ChipGroupItem) => void;
  /** Wrap onto further rows instead of overflowing into a "More" chip. */
  wrap?: boolean;
  moreLabel?: string;
};

const GAP = 8;
const MORE_ID = "chip-group:more";

type ChipLayout = {
  placed: { chip: ChipGroupItem; x: number; y: number }[];
  hidden: ChipGroupItem[];
  more: { x: number; y: number; selected: boolean } | null;
  height: number;
};

function moreChip(props: ChipGroupProps, hidden: readonly ChipGroupItem[]) {
  return {
    label: props.moreLabel ?? "More",
    count: hidden.length,
    disclosure: true,
    selected: hidden.some((chip) => chip.id === props.selectedId),
  };
}

/** Where each chip goes: rows when wrapping, else one row ending in "More" when they don't fit. */
function layoutChips(props: ChipGroupProps): ChipLayout {
  const ui = getUiScaleFactor();
  const gap = GAP * ui;
  const rowHeight = filterChipHeight();
  const widths = props.chips.map((chip) =>
    filterChipWidth({ ...chip, selected: chip.id === props.selectedId }),
  );
  if (props.wrap) {
    const placed: ChipLayout["placed"] = [];
    let x = 0,
      y = 0;
    props.chips.forEach((chip, index) => {
      const width = widths[index]!;
      if (x > 0 && x + width > props.width) {
        x = 0;
        y += rowHeight + gap;
      }
      placed.push({ chip, x, y });
      x += width + gap;
    });
    return { placed, hidden: [], more: null, height: props.chips.length ? y + rowHeight : 0 };
  }
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1);
  if (total <= props.width) {
    let x = 0;
    return {
      placed: props.chips.map((chip, index) => {
        const at = { chip, x, y: 0 };
        x += widths[index]! + gap;
        return at;
      }),
      hidden: [],
      more: null,
      height: rowHeight,
    };
  }
  // Reserve room for "More" with the widest count it could show.
  const moreWidth = filterChipWidth(moreChip(props, props.chips)) + gap;
  const placed: ChipLayout["placed"] = [];
  let x = 0,
    index = 0;
  for (; index < props.chips.length; index++) {
    if (x + widths[index]! + moreWidth > props.width) break;
    placed.push({ chip: props.chips[index]!, x, y: 0 });
    x += widths[index]! + gap;
  }
  const hidden = props.chips.slice(index);
  return {
    placed,
    hidden,
    more: { x, y: 0, selected: moreChip(props, hidden).selected },
    height: rowHeight,
  };
}

/**
 * Chips in a row. Arrow keys move between them, Home and End jump to the ends, and Enter or Space
 * presses. Unless `wrap` is set, chips that don't fit go into a "More" menu.
 */
export function ChipGroup(props: ChipGroupProps): ReactNode {
  const generatedId = useId();
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const moreNode = useRef<SceneNode | null>(null);
  const layout = layoutChips(props);
  const ids = [
    ...layout.placed.filter((entry) => !entry.chip.disabled).map((entry) => entry.chip.id),
    ...(layout.more ? [MORE_ID] : []),
  ];
  const focusId = (id: string) => `chips:${generatedId}:${id}`;
  const keyHandler = (id: string, activate: () => void) => (event: HitKeyEvent) => {
    const index = ids.indexOf(id);
    let target: string | undefined;
    if (event.code === 106 || event.key === "ArrowRight" || event.code === 108)
      target = ids[Math.min(ids.length - 1, index + 1)];
    else if (event.code === 105 || event.key === "ArrowLeft" || event.code === 103)
      target = ids[Math.max(0, index - 1)];
    else if (event.code === 102 || event.key === "Home") target = ids[0];
    else if (event.code === 107 || event.key === "End") target = ids.at(-1);
    else if (
      !event.repeat &&
      (event.code === 28 || event.code === 57 || event.key === "Enter" || event.key === " ")
    )
      activate();
    if (target) setFocusTarget(target);
  };
  const trackFocus = (id: string) => (focused: boolean) => {
    if (focused) setFocusTarget(id);
    else setFocusTarget((current) => (current === id ? null : current));
  };
  const more = layout.more ? moreChip(props, layout.hidden) : null;
  const moreWidth = more ? filterChipWidth(more) : 0;
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={layout.height}>
      {layout.placed.map(({ chip, x, y }) => (
        <FilterChip
          key={chip.id}
          x={x}
          y={y}
          label={chip.label}
          icon={chip.icon}
          tint={chip.tint}
          count={chip.count}
          disabled={chip.disabled}
          selected={chip.id === props.selectedId}
          focusId={focusId(chip.id)}
          autoFocus={focusTarget === chip.id}
          onFocusChange={trackFocus(chip.id)}
          onKeyDown={keyHandler(chip.id, () => props.onSelect?.(chip))}
          onPress={() => props.onSelect?.(chip)}
        />
      ))}
      {layout.more && more ? (
        <Group
          ref={moreNode}
          x={layout.more.x}
          y={layout.more.y}
          width={moreWidth}
          height={layout.height}
        >
          <FilterChip
            {...more}
            focusId={focusId(MORE_ID)}
            autoFocus={focusTarget === MORE_ID}
            onFocusChange={trackFocus(MORE_ID)}
            onKeyDown={keyHandler(MORE_ID, () => setMenuOpen(true))}
            onPress={() => setMenuOpen(true)}
          />
          <AnchoredMenu
            open={menuOpen}
            anchor={moreNode.current}
            anchorWidth={moreWidth}
            anchorHeight={layout.height}
            actions={layout.hidden.map((chip) => ({
              id: chip.id,
              label: chip.label,
              icon: chip.icon,
              checked: chip.id === props.selectedId,
              disabled: chip.disabled,
              // The trailing hint slot carries the count, where a chip shows it.
              shortcut: countText(chip.count) ?? undefined,
              onPress: () => props.onSelect?.(chip),
            }))}
            onDismiss={() => setMenuOpen(false)}
          />
        </Group>
      ) : null}
    </Group>
  );
}

registerIntrinsicSize(ChipGroup, (props) => ({
  width: props.width,
  height: layoutChips(props).height,
}));
