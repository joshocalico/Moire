/** Icon navigation rail that can widen into a labelled sidebar. */
import React, { useId, useState, type ReactNode } from "react";
import { Group, Rect, type HitKeyEvent, type HitPointerEvent } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { colorWithAlpha, mixColor } from "#ui/theme-family-color";
import { useWidgetTheme } from "#ui/widget-theme";
import { CountBubble, countBubbleWidth } from "./count-bubble";
import { DndFeedback } from "./dnd";
import { Icon, type IconName } from "./icon";
import { IconButton } from "./icon-button";
import { registerIntrinsicSize } from "./layout";
import { Pressable } from "./pressable";
import { TextBlock } from "./primitives";
import { ScrollArea } from "./scroll";
import { Tooltip } from "./tooltip";

export type NavigationRailItem = {
  id: string;
  label: string;
  icon: IconName;
  /** Icon colour when not selected; the theme's muted colour by default. */
  tint?: number;
  /** A count or short status shown on the item, e.g. unread or Trash items. */
  badge?: string | number;
  /** Drawn faded but still selectable, e.g. a page with no search matches. */
  dimmed?: boolean;
  disabled?: boolean;
  /** Accept drops onto this item; exposed through `hitTestDropData`, highlighted while hovered. */
  dropData?: unknown;
  /** A secondary action (eject a drive) shown while the item is hovered or focused. */
  action?: NavigationRailAction;
};

export type NavigationRailAction = {
  icon: IconName;
  /** Tooltip. */
  label: string;
  disabled?: boolean;
  onPress: () => void;
};

export type NavigationRailSection = {
  id: string;
  /** Shown above the section in expanded mode; collapsed sections are divided by a line. */
  label?: string;
  items: readonly NavigationRailItem[];
  /** "end" sections sit at the foot of the rail, above the footer (drives, settings). */
  placement?: "start" | "end";
};

export type NavigationRailProps = {
  x?: number;
  y?: number;
  height: number;
  sections: readonly NavigationRailSection[];
  selectedId?: string | null;
  /** Show labels beside the icons, as a sidebar. */
  expanded?: boolean;
  /** Width when collapsed; 64 by default. */
  width?: number;
  /** Width when expanded; 200 by default. */
  expandedWidth?: number;
  /**
   * `compact` packs many places into the height: 28px labelled rows (32px on the icon rail),
   * 16px icons and tighter section labels, as in Settings' sidebar.
   */
  density?: "regular" | "compact";
  /** Top slot, e.g. an app badge that toggles `expanded`. */
  header?: ReactNode;
  headerHeight?: number;
  footer?: ReactNode;
  footerHeight?: number;
  /** Focus ids become `<idPrefix>:<item id>`, for hosts and tests that address items. */
  idPrefix?: string;
  onSelect?: (item: NavigationRailItem) => void;
  /** Secondary click on an item. */
  onContextMenu?: (item: NavigationRailItem, event: HitPointerEvent) => void;
};

const RAIL_W = 64;
const EXPANDED_W = 200;
const HEADER_H = 60;
const FOOTER_H = 56;
const ACTION = 24;
const COMPACT_ACTION = 18;

/** Item geometry for a density, unscaled. */
type RailMetrics = {
  /** Item height on the icon rail and when expanded. */
  item: number;
  expandedItem: number;
  /** Square the icon is centred in, and the start of an expanded label. */
  iconBox: number;
  icon: number;
  gap: number;
  /** Gap after each labelled section when expanded. */
  sectionGap: number;
  dividerGap: number;
  sectionLabel: number;
  /** Side inset of expanded items. */
  inset: number;
  radius: number;
  badge: number;
  badgeFont: number;
};

const REGULAR: RailMetrics = {
  item: 40,
  expandedItem: 40,
  iconBox: 40,
  icon: 18,
  gap: 8,
  sectionGap: 0,
  dividerGap: 8,
  sectionLabel: 24,
  inset: 12,
  radius: 12,
  badge: 16,
  badgeFont: 9,
};

const COMPACT: RailMetrics = {
  item: 30,
  expandedItem: 26,
  iconBox: 36,
  icon: 16,
  gap: 2,
  sectionGap: 4,
  dividerGap: 8,
  sectionLabel: 22,
  inset: 8,
  radius: 8,
  badge: 18,
  badgeFont: 11,
};

const railMetrics = (density: NavigationRailProps["density"]) =>
  density === "compact" ? COMPACT : REGULAR;

/** The rail's width for a set of props, scaled. */
function railWidth(props: Pick<NavigationRailProps, "expanded" | "width" | "expandedWidth">) {
  const ui = getUiScaleFactor();
  return props.expanded ? (props.expandedWidth ?? EXPANDED_W * ui) : (props.width ?? RAIL_W * ui);
}

type Placed =
  | { item: NavigationRailItem; y: number }
  | { divider: string; y: number; label?: string };

/** Items and dividers of one group of sections, top to bottom, and the group's height. */
function placeSections(
  sections: readonly NavigationRailSection[],
  expanded: boolean,
  ui: number,
  m: RailMetrics,
): { placed: Placed[]; height: number } {
  const placed: Placed[] = [];
  const item = expanded ? m.expandedItem : m.item;
  let y = 0;
  sections.forEach((section, index) => {
    // Items step by item + gap, so `y` here sits a gap below the previous item: a divider
    // drawn at `y` is centred between the sections.
    if (expanded && section.label) {
      if (index > 0) y += m.sectionGap * ui;
      placed.push({ divider: section.id, y, label: section.label });
      y += m.sectionLabel * ui;
    } else if (index > 0) {
      placed.push({ divider: section.id, y });
      y += m.dividerGap * ui;
    }
    for (const entry of section.items) {
      placed.push({ item: entry, y });
      y += (item + m.gap) * ui;
    }
  });
  return { placed, height: y };
}

type RailButtonProps = {
  item: NavigationRailItem;
  focusId: string;
  width: number;
  metrics: RailMetrics;
  expanded: boolean;
  selected: boolean;
  autoFocus: boolean;
  onFocus: (focused: boolean) => void;
  onKeyDown: (event: HitKeyEvent) => void;
  onSelect?: (item: NavigationRailItem) => void;
  onContextMenu?: (item: NavigationRailItem, event: HitPointerEvent) => void;
};

function RailButton(props: RailButtonProps): ReactNode {
  const theme = useWidgetTheme();
  const pal = theme.foundations.palette;
  const ui = getUiScaleFactor();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dropHover, setDropHover] = useState(false);
  const [actionHovered, setActionHovered] = useState(false);
  const [actionFocused, setActionFocused] = useState(false);
  const { item } = props;
  const m = props.metrics;
  const compact = m === COMPACT;
  const size = (props.expanded ? m.expandedItem : m.item) * ui;
  const iconBox = props.expanded ? m.iconBox * ui : props.width;
  const icon = m.icon * ui;
  const faded = item.disabled || item.dimmed;
  const iconColor = faded
    ? colorWithAlpha(pal.muted, 0x88)
    : props.selected
      ? pal.accentLine
      : hovered
        ? pal.text
        : (item.tint ?? pal.muted);
  const badge = item.badge === undefined ? null : String(item.badge);
  const badgeSize = (props.expanded ? m.badge : 16) * ui;
  const badgeFont = props.expanded ? m.badgeFont : 9;
  const badgeWidth = badge ? countBubbleWidth(badge, badgeSize, badgeFont) : 0;
  // Expanded, the action sits at the row's end; on the icon rail it is a small corner button.
  const action = item.action;
  const showAction = !!action && (hovered || focused || actionHovered || actionFocused);
  const actionSize = (props.expanded ? ACTION : COMPACT_ACTION) * ui;
  const actionX = props.expanded
    ? props.width - actionSize - 8 * ui
    : props.width - actionSize + 4 * ui;
  const actionY = props.expanded ? Math.round((size - actionSize) / 2) : -4 * ui;
  return (
    <Group width={props.width} height={size}>
      <Pressable
        width={props.width}
        height={size}
        fill={props.selected ? pal.selection : 0x00000000}
        hoverFill={props.selected ? pal.selection : pal.hover}
        radius={m.radius * ui}
        disabled={item.disabled}
        focusable
        focusId={props.focusId}
        autoFocus={props.autoFocus}
        onFocusChange={(next) => {
          setFocused(next);
          props.onFocus(next);
        }}
        onHoverChange={setHovered}
        onKeyDown={props.onKeyDown}
        onPress={() => props.onSelect?.(item)}
        onContextMenu={
          props.onContextMenu ? (event) => props.onContextMenu?.(item, event) : undefined
        }
      />
      <Icon
        x={Math.round((iconBox - icon) / 2)}
        y={Math.round((size - icon) / 2)}
        name={item.icon}
        size={icon}
        color={iconColor}
        symbolic
      />
      {props.expanded ? (
        <TextBlock
          x={iconBox + (compact ? -2 : 2) * ui}
          width={Math.max(
            1,
            props.width -
              iconBox -
              2 * ui -
              (badge ? badgeWidth + 10 * ui : 8 * ui) -
              (showAction ? actionSize + 8 * ui : 0),
          )}
          height={size}
          text={item.label}
          color={
            faded
              ? colorWithAlpha(pal.muted, item.disabled ? 0xff : 0x99)
              : compact && props.selected
                ? pal.accentLine
                : pal.text
          }
          fontSize={13}
          fontWeight={props.selected ? "medium" : "regular"}
          verticalAlign="center"
          overflow="ellipsis"
          maxLines={1}
        />
      ) : null}
      {badge && !showAction ? (
        <CountBubble
          x={
            props.expanded
              ? props.width - badgeWidth - (compact ? 6 : 10) * ui
              : props.width - badgeWidth + 4 * ui
          }
          y={props.expanded ? Math.round((size - badgeSize) / 2) : -4 * ui}
          text={badge}
          size={badgeSize}
          fontSize={badgeFont}
          fill={compact && props.expanded ? mixColor(pal.panel, pal.accent, 0.3) : undefined}
        />
      ) : null}
      {item.dropData !== undefined ? (
        <Rect
          width={props.width}
          height={size}
          fill={0x00000000}
          data={item.dropData}
          onDropHoverChange={setDropHover}
        />
      ) : null}
      {dropHover ? <DndFeedback width={props.width} height={size} kind="drop-target" /> : null}
      {action && showAction ? (
        <IconButton
          x={actionX}
          y={actionY}
          width={actionSize}
          height={actionSize}
          variant={props.expanded ? "ghost" : "standard"}
          size="small"
          tooltip={action.label}
          disabled={action.disabled || item.disabled}
          focusId={`${props.focusId}:action`}
          icon={(style) => (
            <Icon
              name={action.icon}
              size={Math.round(actionSize * 0.6)}
              color={style.color}
              symbolic
            />
          )}
          onHoverChange={setActionHovered}
          onFocusChange={setActionFocused}
          onPress={action.onPress}
        />
      ) : null}
      {props.expanded ? null : (
        <Tooltip
          width={props.width}
          height={size}
          label={item.label}
          placement="right"
          open={hovered || focused}
          disabled={item.disabled}
        />
      )}
    </Group>
  );
}

/**
 * Places as icons with tooltips, or with labels when `expanded`. Arrow keys move between items,
 * Home and End jump to the ends, and Enter or Space selects.
 */
export function NavigationRail(props: NavigationRailProps): ReactNode {
  const theme = useWidgetTheme();
  const pal = theme.foundations.palette;
  const ui = getUiScaleFactor();
  const generatedId = useId();
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const expanded = !!props.expanded;
  const m = railMetrics(props.density);
  const width = railWidth(props);
  const headerHeight = props.header ? (props.headerHeight ?? HEADER_H * ui) : 8 * ui;
  const footerHeight = props.footer ? (props.footerHeight ?? FOOTER_H * ui) : 0;
  const inset = m.inset * ui;
  const itemHeight = (expanded ? m.expandedItem : m.item) * ui;
  // The icon rail's buttons are 40px wide in either density.
  const itemWidth = expanded ? width - inset * 2 : 40 * ui;
  const itemX = expanded ? inset : Math.round((width - 40 * ui) / 2);
  const start = placeSections(
    props.sections.filter((section) => section.placement !== "end"),
    expanded,
    ui,
    m,
  );
  const end = placeSections(
    props.sections.filter((section) => section.placement === "end"),
    expanded,
    ui,
    m,
  );
  const endHeight = end.height > 0 ? end.height + m.dividerGap * ui : 0;
  const listHeight = Math.max(1, props.height - headerHeight - footerHeight - endHeight);
  const ordered = [...start.placed, ...end.placed].flatMap((entry) =>
    "item" in entry && !entry.item.disabled ? [entry.item] : [],
  );
  const focusId = (item: NavigationRailItem) =>
    `${props.idPrefix ?? `rail:${generatedId}`}:${item.id}`;

  const handleKey = (event: HitKeyEvent, item: NavigationRailItem) => {
    const index = ordered.findIndex((candidate) => candidate.id === item.id);
    let target: NavigationRailItem | undefined;
    if (event.code === 108 || event.key === "ArrowDown")
      target = ordered[(index + 1) % ordered.length];
    else if (event.code === 103 || event.key === "ArrowUp")
      target = ordered[(index - 1 + ordered.length) % ordered.length];
    else if (event.code === 102 || event.key === "Home") target = ordered[0];
    else if (event.code === 107 || event.key === "End") target = ordered.at(-1);
    else if (
      !event.repeat &&
      (event.code === 28 || event.code === 57 || event.key === "Enter" || event.key === " ")
    ) {
      props.onSelect?.(item);
      return;
    }
    if (target) setFocusTarget(target.id);
  };

  const render = (placed: Placed[]) =>
    placed.map((entry) =>
      "item" in entry ? (
        <Group key={entry.item.id} x={itemX} y={entry.y} width={itemWidth} height={itemHeight}>
          <RailButton
            item={entry.item}
            focusId={focusId(entry.item)}
            width={itemWidth}
            metrics={m}
            expanded={expanded}
            selected={props.selectedId === entry.item.id}
            autoFocus={focusTarget === entry.item.id}
            onFocus={(next) => {
              if (next) setFocusTarget(entry.item.id);
              else setFocusTarget((current) => (current === entry.item.id ? null : current));
            }}
            onKeyDown={(event) => handleKey(event, entry.item)}
            onSelect={props.onSelect}
            onContextMenu={props.onContextMenu}
          />
        </Group>
      ) : entry.label ? (
        <TextBlock
          key={entry.divider}
          x={itemX + (m === COMPACT ? 12 : 4) * ui}
          y={entry.y}
          width={Math.max(1, itemWidth - 8 * ui)}
          height={m.sectionLabel * ui}
          text={entry.label}
          color={pal.muted}
          fontSize={11}
          fontWeight="medium"
          verticalAlign="center"
          overflow="ellipsis"
          maxLines={1}
        />
      ) : (
        <Rect
          key={entry.divider}
          x={itemX + 4 * ui}
          y={entry.y}
          width={Math.max(1, itemWidth - 8 * ui)}
          height={1}
          fill={pal.borderSubtle}
        />
      ),
    );

  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={width} height={props.height}>
      <Rect width={width} height={props.height} fill={pal.panel} />
      <Rect x={width - 1} width={1} height={props.height} fill={pal.borderSubtle} />
      {props.header ? (
        <Group width={width} height={headerHeight}>
          {props.header}
        </Group>
      ) : null}
      <ScrollArea
        y={headerHeight}
        width={width - 1}
        height={listHeight}
        contentHeight={Math.max(listHeight, start.height)}
        scrollbar={false}
        fill={0x00000000}
      >
        <Group width={width - 1} height={Math.max(listHeight, start.height)}>
          {render(start.placed)}
        </Group>
      </ScrollArea>
      {end.height > 0 ? (
        <Group y={headerHeight + listHeight} width={width} height={endHeight}>
          <Rect
            x={itemX + 4 * ui}
            y={Math.round(m.dividerGap * ui * 0.5)}
            width={Math.max(1, itemWidth - 8 * ui)}
            height={1}
            fill={pal.borderSubtle}
          />
          <Group y={m.dividerGap * ui} width={width} height={end.height}>
            {render(end.placed)}
          </Group>
        </Group>
      ) : null}
      {props.footer ? (
        <Group y={props.height - footerHeight} width={width} height={footerHeight}>
          {props.footer}
        </Group>
      ) : null}
    </Group>
  );
}

registerIntrinsicSize(NavigationRail, (props) => ({
  width: railWidth(props),
  height: props.height,
}));
