/**
 * Overview, opened from the name card at the top of the sidebar: how the system is (a tile per
 * part with a backend), quick switches, and the settings changed recently with Undo.
 */
import React, { type ReactNode } from "react";
import {
  Box,
  Button,
  FilterChip,
  StatusTile,
  TextBlock,
  filterChipHeight,
  filterChipWidth,
  getUiScaleFactor,
  statusTileHeight,
  type IconName,
  type SettingRowSpec,
} from "@moire/ui";
import { formatBytes, formatTimeAgo } from "@moire/app-tools";
import { batterySupported } from "@moire/system-management/battery-status";
import { bluetoothSupported } from "@moire/system-management/bluetooth-status";
import { hasWifiAdapter } from "@moire/system-management/network-status";
import { pageInfo, type Route, type SidebarPageId } from "#settings/catalog";
import type { PageContext } from "#settings/context";
import type { PageContent } from "#settings/model";
import { formatCount } from "#settings/search-model";
import { bluetoothTile } from "./bluetooth-model";
import { wifiTile, wiredTile } from "./network-model";
import { batteryDetail, batteryPercent } from "./power-model";
import { setDoNotDisturb } from "./notifications";
import { volumePercent, VolumeSlider } from "./sound";

const TILE_GAP = 12;
const MAX_TILES = 6;
const RECENT = 5;

type Tile = {
  id: string;
  page: SidebarPageId;
  anchor?: string;
  icon: IconName;
  title: string;
  value: string;
  detail?: string;
  progress?: number;
  control?: (size: { width: number; height: number }) => ReactNode;
};

/** Tiles for the parts of the system that have a backend now, in a fixed order. */
export function overviewTiles(context: PageContext): Tile[] {
  const snapshot = context.desktop.snapshot;
  const tiles: Tile[] = [];
  const tint = (page: SidebarPageId) => ({ page, icon: pageInfo(page).icon as IconName });
  if (snapshot?.wifi.kind === "ready")
    tiles.push(
      hasWifiAdapter(snapshot.wifi)
        ? { id: "wifi", ...tint("network"), title: "Wi‑Fi", ...wifiTile(snapshot.wifi) }
        : {
            id: "network",
            page: "network",
            icon: "ethernet",
            title: "Network",
            ...wiredTile(snapshot.wifi, snapshot.network),
          },
    );
  if (snapshot && bluetoothSupported(snapshot.bluetooth))
    tiles.push({
      id: "bluetooth",
      ...tint("bluetooth"),
      title: "Bluetooth",
      ...bluetoothTile(snapshot.bluetooth),
    });
  if (snapshot?.battery.kind === "ready" && batterySupported(snapshot.battery))
    tiles.push({
      id: "battery",
      ...tint("power"),
      title: "Battery",
      value: batteryPercent(snapshot.battery),
      progress: snapshot.battery.percentage / 100,
      detail: batteryDetail(snapshot.battery),
    });
  if (snapshot?.audio.kind === "ready") {
    const audio = snapshot.audio;
    tiles.push({
      id: "sound",
      ...tint("sound"),
      title: "Sound",
      value: audio.muted ? "Muted" : volumePercent(audio.volume),
      control: (size) => (
        <VolumeSlider context={context} audio={audio} width={size.width} height={size.height} />
      ),
    });
  }
  const space = context.storage.space;
  if (space) {
    const drives = context.storage.volumes.filter((volume) => volume.mount.kind === "mounted");
    tiles.push({
      id: "storage",
      ...tint("storage"),
      title: "Storage",
      value: `${formatBytes(space.freeBytes)} free`,
      progress: space.totalBytes ? 1 - space.freeBytes / space.totalBytes : 0,
      detail: [
        `of ${formatBytes(space.totalBytes)}`,
        ...drives.map((volume) =>
          volume.sizeBytes != null
            ? `${volume.label} ${formatBytes(volume.sizeBytes)}`
            : volume.label,
        ),
      ].join(" · "),
    });
  }
  // There is no update source yet; the file index takes the Updates tile's place.
  const summary = context.search.summary;
  if (summary.tone !== "warning" || summary.counts)
    tiles.push({
      id: "index",
      ...tint("privacy"),
      title: "File search",
      value: summary.title,
      progress: summary.progress ?? undefined,
      detail: summary.counts
        ? `${formatCount(summary.counts.files)} files indexed`
        : summary.detail,
    });
  if (context.display.available && context.display.outputs.length)
    tiles.push({
      id: "displays",
      ...tint("displays"),
      title: "Displays",
      value:
        context.display.outputs.length === 1
          ? context.display.outputs[0]!.model || context.display.name
          : `${context.display.outputs.length} displays`,
      detail: context.display.mode.replace(/^(\d+)x(\d+)@.*/, "$1 × $2"),
    });
  return tiles.slice(0, MAX_TILES);
}

type Chip = { id: string; label: string; icon: IconName; on: boolean; onPress: () => void };

function quickToggles(context: PageContext): Chip[] {
  const { values } = context.prefs;
  const snapshot = context.desktop.snapshot;
  return [
    {
      id: "dark",
      label: "Dark style",
      icon: "moon",
      on: values.dark,
      onPress: () =>
        context.prefs.set(
          { dark: !values.dark },
          {
            label: `Color scheme set to ${values.dark ? "Light" : "Dark"}`,
            page: "appearance",
          },
        ),
    },
    ...(snapshot?.notificationsAvailable
      ? [
          {
            id: "dnd",
            label: "Do not disturb",
            icon: "bell" as const,
            on: snapshot.doNotDisturb,
            onPress: () => setDoNotDisturb(context, !snapshot.doNotDisturb),
          },
        ]
      : []),
    {
      id: "motion",
      label: "Reduce motion",
      icon: "restart",
      on: values.reducedMotion,
      onPress: () => context.prefs.setReducedMotion(!values.reducedMotion, "accessibility"),
    },
    {
      id: "icons",
      label: "Desktop icons",
      icon: "desktop",
      on: values.showDesktopIcons,
      onPress: () =>
        context.prefs.set(
          { showDesktopIcons: !values.showDesktopIcons },
          {
            label: values.showDesktopIcons ? "Desktop icons hidden" : "Desktop icons shown",
            page: "desktop",
          },
        ),
    },
    {
      id: "panel",
      label: "Full-width panel",
      icon: "panel",
      on: values.panelFullWidth,
      onPress: () =>
        context.prefs.set(
          { panelFullWidth: !values.panelFullWidth },
          {
            label: values.panelFullWidth
              ? "Panel set to floating islands"
              : "Panel set to a full-width bar",
            page: "appearance",
          },
        ),
    },
  ];
}

/** Chips placed left to right, wrapping, with the height they take. */
function placeChips(chips: readonly Chip[], width: number) {
  const ui = getUiScaleFactor();
  let x = 0;
  let y = 0;
  const placed = chips.map((chip) => {
    const chipWidth = filterChipWidth({ label: chip.label, icon: chip.icon, selected: chip.on });
    if (x > 0 && x + chipWidth > width) {
      x = 0;
      y += filterChipHeight() + 8 * ui;
    }
    const at = { chip, x, y };
    x += chipWidth + 8 * ui;
    return at;
  });
  return { placed, height: y + filterChipHeight() };
}

function columns(width: number): number {
  return width >= 600 * getUiScaleFactor() ? 3 : 2;
}

/** The tiles and quick switches above the journal. */
function overviewHeight(context: PageContext, width: number): number {
  const ui = getUiScaleFactor();
  const tiles = overviewTiles(context).length;
  const rows = Math.ceil(tiles / columns(width));
  const tilesH = rows ? rows * statusTileHeight() + (rows - 1) * TILE_GAP * ui + 18 * ui : 0;
  return tilesH + 28 * ui + placeChips(quickToggles(context), width).height + 4 * ui;
}

function OverviewTop(props: { context: PageContext; width: number }): ReactNode {
  const { context, width } = props;
  const ui = getUiScaleFactor();
  const tiles = overviewTiles(context);
  const cols = columns(width);
  const gap = TILE_GAP * ui;
  const tileW = Math.floor((width - gap * (cols - 1)) / cols);
  const rows = Math.ceil(tiles.length / cols);
  const chipsY = rows ? rows * statusTileHeight() + (rows - 1) * gap + 18 * ui : 0;
  const chips = placeChips(quickToggles(context), width);
  const open = (tile: Tile) =>
    context.go({ kind: "page", id: tile.page, anchor: tile.anchor } satisfies Route);
  return (
    <Box width={width} height={overviewHeight(context, width)}>
      {tiles.map((tile, index) => (
        <StatusTile
          key={tile.id}
          x={(index % cols) * (tileW + gap)}
          y={Math.floor(index / cols) * (statusTileHeight() + gap)}
          width={tileW}
          icon={tile.icon}
          tint={pageInfo(tile.page).tint}
          title={tile.title}
          value={tile.value}
          detail={tile.detail}
          progress={tile.progress}
          control={tile.control}
          focusId={`overview:${tile.id}`}
          onPress={() => open(tile)}
        />
      ))}
      <TextBlock
        x={4 * ui}
        y={chipsY}
        width={width}
        height={20 * ui}
        text="Quick toggles"
        fontSize={12}
        fontWeight="medium"
        color={context.palette.muted}
        verticalAlign="center"
      />
      {chips.placed.map(({ chip, x, y }) => (
        <FilterChip
          key={chip.id}
          x={x}
          y={chipsY + 28 * ui + y}
          label={chip.label}
          icon={chip.icon}
          selected={chip.on}
          focusId={`overview:toggle:${chip.id}`}
          onPress={chip.onPress}
        />
      ))}
    </Box>
  );
}

function recentRows(context: PageContext): SettingRowSpec[] {
  const ui = getUiScaleFactor();
  const entries = context.journal.entries.slice(0, RECENT);
  if (!entries.length)
    return [
      {
        id: "recent:none",
        label: "Nothing changed yet",
        description: "Changes you make in Settings show here, with Undo",
      },
    ];
  return entries.map((entry, index) => ({
    id: `recent:${entry.id}`,
    label: entry.label,
    description: `${pageInfo(entry.page).title} · ${formatTimeAgo(entry.at)}`,
    icon: pageInfo(entry.page).icon,
    tint: pageInfo(entry.page).tint,
    control: {
      kind: "compact",
      width: 72,
      render: () => (
        <Button
          width={72 * ui}
          height={30 * ui}
          label="Undo"
          variant="ghost"
          focusId={index === 0 ? "overview:undo" : `overview:undo:${entry.id}`}
          onPress={() => context.undo(entry)}
        />
      ),
    },
  }));
}

export function overviewPage(context: PageContext): PageContent {
  const { system } = context;
  const build = system.build ? `Moire ${system.build}` : "Moire";
  return {
    summary: `${build} on ${system.systemShort} · ${system.user.name}${system.user.administrator ? ", administrator" : ""}`,
    hero: {
      kind: "custom",
      height: overviewHeight(context, context.columnWidth) / getUiScaleFactor(),
      render: (width) => <OverviewTop context={context} width={width} />,
    },
    banners: context.journal.error
      ? [
          {
            id: "journal",
            title: "Recent changes aren't being saved",
            message: context.journal.error,
            tone: "warning",
          },
        ]
      : undefined,
    sections: [{ id: "overview.recent", title: "Recently changed", rows: recentRows(context) }],
  };
}
