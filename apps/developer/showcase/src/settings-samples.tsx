/** Previews for the widgets Settings is built from: rows and cards, hero, tiles and pictures. */
import React, { useState, type ReactNode } from "react";
import {
  Avatar,
  Box,
  Button,
  DesktopPreview,
  NavigationRail,
  PageHero,
  PictureOptions,
  SettingsSection,
  SideSheet,
  SignalStrength,
  StatusTile,
  SwatchPicker,
  Toggle,
  getUiScaleFactor,
  settingsSectionHeight,
  type NavigationRailSection,
} from "@moire/ui";

const SETTINGS_SAMPLE_IDS = ["settings-widgets"] as const;
export type SettingsSampleId = (typeof SETTINGS_SAMPLE_IDS)[number];

export function isSettingsSample(id: string): id is SettingsSampleId {
  return (SETTINGS_SAMPLE_IDS as readonly string[]).includes(id);
}

const BLUE = 0xff5aa2f0;
const VIOLET = 0xff8b7cf6;
const PINK = 0xffe86a9b;
const GREEN = 0xff3ecf8e;
const SIDEBAR: NavigationRailSection[] = [
  {
    id: "connections",
    label: "Connections",
    items: [
      { id: "network", label: "Wi‑Fi & Network", icon: "network", tint: BLUE },
      { id: "bluetooth", label: "Bluetooth", icon: "bluetooth", tint: BLUE, badge: 1 },
    ],
  },
  {
    id: "devices",
    label: "Devices",
    items: [
      { id: "displays", label: "Displays", icon: "monitor", tint: VIOLET, dimmed: true },
      { id: "sound", label: "Sound", icon: "volume", tint: PINK },
    ],
  },
];

/** The compact sidebar, a card of rows, a hero, tiles, pictures and the side sheet together. */
export function SettingsSample(props: { width: number }): ReactNode {
  const ui = getUiScaleFactor();
  const [page, setPage] = useState("network");
  const [wifi, setWifi] = useState(true);
  const [panel, setPanel] = useState("islands");
  const [accent, setAccent] = useState("violet");
  const [sheet, setSheet] = useState(false);
  const side = 220 * ui;
  const width = Math.max(320 * ui, Math.min(560 * ui, props.width - side - 24 * ui));
  const x = side + 24 * ui;
  const rows = {
    id: "networks",
    title: "Networks",
    rows: [
      {
        id: "halcyon",
        label: "Halcyon",
        labelTone: "accent" as const,
        description: "Connected · Internet access",
        leading: <SignalStrength x={7 * ui} y={9 * ui} strength={82} />,
        chevron: true,
        onPress: () => setSheet(true),
      },
      {
        id: "bluebird",
        label: "Bluebird",
        description: "WPA2 Personal · hover for Connect",
        leading: <SignalStrength x={7 * ui} y={9 * ui} strength={51} />,
        revealControl: {
          kind: "compact" as const,
          width: 84,
          render: (
            _width: number,
            reveal: { onHoverChange(on: boolean): void; onFocusChange(on: boolean): void },
          ) => (
            <Button
              width={84 * ui}
              label="Connect"
              onHoverChange={reveal.onHoverChange}
              onFocusChange={reveal.onFocusChange}
            />
          ),
        },
      },
    ],
  };
  const heroY = 0;
  const tilesY = heroY + 96 * ui;
  const rowsY = tilesY + 120 * ui;
  const picturesY = rowsY + settingsSectionHeight(rows, width) + 16 * ui;
  const height = picturesY + 200 * ui;
  return (
    <Box width={props.width} height={height}>
      <NavigationRail
        height={height}
        expanded
        density="compact"
        expandedWidth={side}
        sections={SIDEBAR}
        selectedId={page}
        header={<Avatar x={14 * ui} y={14 * ui} name="Ada Lovelace" />}
        headerHeight={64 * ui}
        onSelect={(item) => setPage(item.id)}
      />
      <PageHero
        x={x}
        y={heroY}
        width={width}
        icon="network"
        tint={BLUE}
        title="Wi‑Fi"
        detail={wifi ? "On · connected to Halcyon" : "Off"}
        control={<Toggle on={wifi} onChange={setWifi} />}
      />
      <StatusTile
        x={x}
        y={tilesY}
        width={(width - 12 * ui) / 2}
        icon="battery"
        tint={GREEN}
        title="Battery"
        value="78%"
        progress={0.78}
        detail="3 h 12 min left"
        onPress={() => {}}
      />
      <StatusTile
        x={x + (width + 12 * ui) / 2}
        y={tilesY}
        width={(width - 12 * ui) / 2}
        icon="volume"
        tint={PINK}
        title="Sound"
        value="64%"
        detail="Built-in speakers"
        onPress={() => {}}
      />
      <SettingsSection x={x} y={rowsY} width={width} section={rows} />
      <PictureOptions
        x={x}
        y={picturesY}
        width={width * 0.55}
        height={100 * ui}
        value={panel}
        options={[
          { id: "islands", label: "Floating islands", picture: () => null },
          { id: "full", label: "Full-width bar", picture: () => null },
        ]}
        onChange={setPanel}
      />
      <DesktopPreview
        x={x + width * 0.6}
        y={picturesY}
        width={width * 0.4}
        height={100 * ui}
        wallpaper={{ kind: "colors", colors: [0xff1d2b4a, 0xff6a4fb0, 0xffe58f6a] }}
        panel={panel === "islands" ? "islands" : "full-width"}
        iconsOnly={false}
        desktopIcons
      />
      <SwatchPicker
        x={x}
        y={picturesY + 120 * ui}
        value={accent}
        swatches={[
          { id: "violet", color: VIOLET, label: "Violet" },
          { id: "blue", color: BLUE, label: "Blue" },
          { id: "green", color: GREEN, label: "Green" },
          { id: "pink", color: PINK, label: "Pink" },
        ]}
        onChange={setAccent}
      />
      <SideSheet
        open={sheet}
        viewportWidth={props.width}
        viewportHeight={height}
        title="Halcyon"
        subtitle="Connected · internet access"
        onClose={() => setSheet(false)}
      >
        {(size) => (
          <SettingsSection
            x={16 * ui}
            width={size.width - 32 * ui}
            section={{
              id: "details",
              rows: [
                { id: "security", label: "Security", value: "WPA2 Personal" },
                { id: "signal", label: "Signal", value: "82%" },
              ],
            }}
          />
        )}
      </SideSheet>
    </Box>
  );
}
