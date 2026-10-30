/**
 * The sidebar: search at the top, the name card that opens Overview, then the pages in four
 * groups. Below 760px (at the current scale) it is a 64px icon rail with the avatar and a
 * search button. While searching, pages with matches show a count and the rest are dimmed.
 */
import React, { type ReactNode } from "react";
import {
  Avatar,
  Box,
  Icon,
  IconButton,
  NavigationRail,
  Pressable,
  SearchField,
  TextBlock,
  getUiScaleFactor,
  mixColor,
  usePalette,
  type HitKeyEvent,
  type NavigationRailSection,
} from "@moire/ui";
import { GROUPS, PAGES, type SidebarPageId } from "./catalog";

export const SIDEBAR_WIDTH = 248;
export const RAIL_WIDTH = 64;
/** Narrower than this (in unscaled pixels) the sidebar becomes the icon rail. */
export const COLLAPSE_BELOW = 760;

export function sidebarCollapsed(windowWidth: number): boolean {
  return windowWidth / getUiScaleFactor() < COLLAPSE_BELOW;
}

export function sidebarWidth(windowWidth: number): number {
  return (sidebarCollapsed(windowWidth) ? RAIL_WIDTH : SIDEBAR_WIDTH) * getUiScaleFactor();
}

export type SidebarProps = {
  height: number;
  collapsed: boolean;
  selected: SidebarPageId | "overview" | null;
  name: string;
  picture: string | null;
  hostname: string;
  query: string;
  /** Matches per page while searching; null when not searching. */
  counts: Partial<Record<SidebarPageId, number>> | null;
  /** Bumped to move focus into the search field (Ctrl+F). */
  searchFocus: number;
  onQuery(query: string): void;
  onSearchKey(event: HitKeyEvent): boolean;
  onSearchFocus(focused: boolean): void;
  /** The icon rail's search button. */
  onSearchOpen(): void;
  onSelect(page: SidebarPageId | "overview"): void;
};

function sections(counts: SidebarProps["counts"]): NavigationRailSection[] {
  return GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    items: PAGES.filter((page) => page.group === group.id).map((page) => {
      const count = counts?.[page.id];
      return {
        id: page.id,
        label: page.title,
        icon: page.icon,
        tint: page.tint,
        badge: count || undefined,
        dimmed: counts != null && !count,
      };
    }),
  }));
}

function IdentityCard(props: SidebarProps & { width: number }): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const overview = props.selected === "overview";
  const height = 52 * ui;
  return (
    <Box width={props.width} height={height}>
      <Pressable
        width={props.width}
        height={height}
        radius={10 * ui}
        fill={
          overview ? mixColor(pal.panel, pal.accent, 0.22) : mixColor(pal.panel, pal.surface, 0.7)
        }
        hoverFill={overview ? mixColor(pal.panel, pal.accent, 0.26) : pal.hover}
        focusId="sidebar:overview"
        onPress={() => props.onSelect("overview")}
      />
      <Avatar x={8 * ui} y={8 * ui} size={36} name={props.name} image={props.picture} />
      <TextBlock
        x={52 * ui}
        y={8 * ui}
        width={props.width - 60 * ui}
        height={18 * ui}
        text={props.name}
        fontSize={13}
        fontWeight="medium"
        verticalAlign="center"
        overflow="ellipsis"
        maxLines={1}
      />
      <TextBlock
        x={52 * ui}
        y={26 * ui}
        width={props.width - 60 * ui}
        height={16 * ui}
        text={`${props.hostname} · Overview`}
        fontSize={11}
        color={overview ? pal.accentLine : pal.muted}
        verticalAlign="center"
        overflow="ellipsis"
        maxLines={1}
      />
    </Box>
  );
}

export function SettingsSearchField(props: {
  width: number;
  height: number;
  query: string;
  focus: number;
  onQuery(query: string): void;
  onKey(event: HitKeyEvent): boolean;
  onFocus(focused: boolean): void;
}): ReactNode {
  return (
    <SearchField
      key={props.focus}
      width={props.width}
      height={props.height}
      value={props.query}
      placeholder="Search settings"
      focusId="settings:search"
      autoFocus={props.focus > 0}
      onChange={props.onQuery}
      onKeyDown={props.onKey}
      onFocusChange={props.onFocus}
    />
  );
}

export function Sidebar(props: SidebarProps): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const width = (props.collapsed ? RAIL_WIDTH : SIDEBAR_WIDTH) * ui;
  const header = props.collapsed ? (
    <>
      <IconButton
        x={12 * ui}
        y={12 * ui}
        width={40 * ui}
        height={36 * ui}
        variant="ghost"
        tooltip="Search settings · Ctrl+F"
        tooltipPlacement="right"
        focusId="sidebar:search"
        icon={(style) => <Icon name="search" symbolic size={18 * ui} color={style.color} />}
        onPress={props.onSearchOpen}
      />
      <Pressable
        x={10 * ui}
        y={54 * ui}
        width={44 * ui}
        height={40 * ui}
        radius={10 * ui}
        fill={props.selected === "overview" ? mixColor(pal.panel, pal.accent, 0.22) : 0x00000000}
        focusId="sidebar:overview"
        onPress={() => props.onSelect("overview")}
      />
      <Avatar x={16 * ui} y={58 * ui} size={32} name={props.name} image={props.picture} />
    </>
  ) : (
    <>
      <Box x={12 * ui} y={12 * ui} width={width - 24 * ui} height={32 * ui}>
        <SettingsSearchField
          width={width - 24 * ui}
          height={32 * ui}
          query={props.query}
          focus={props.searchFocus}
          onQuery={props.onQuery}
          onKey={props.onSearchKey}
          onFocus={props.onSearchFocus}
        />
      </Box>
      <Box x={12 * ui} y={56 * ui} width={width - 24 * ui} height={52 * ui}>
        <IdentityCard {...props} width={width - 24 * ui} />
      </Box>
    </>
  );
  return (
    <NavigationRail
      height={props.height}
      expanded={!props.collapsed}
      width={RAIL_WIDTH * ui}
      expandedWidth={SIDEBAR_WIDTH * ui}
      density="compact"
      idPrefix="sidebar"
      header={header}
      headerHeight={(props.collapsed ? 102 : 118) * ui}
      sections={sections(props.counts)}
      selectedId={props.selected === "overview" ? null : props.selected}
      onSelect={(item) => props.onSelect(item.id as SidebarPageId)}
    />
  );
}
