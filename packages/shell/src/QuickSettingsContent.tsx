import React, { type ReactNode } from "react";
import {
  Box,
  Column,
  Horizontal,
  Vertical,
  Icon,
  IconButton,
  Pressable,
  Slider,
  TextBlock,
  getUiScaleFactor,
  getWidgetTheme,
  useWidgetTheme,
  measureColumnContent,
  measureWrappedText,
  registerIntrinsicSize,
  resolveStatefulStyle,
  type WidgetTheme,
} from "@moire/ui";
import { Group, Rect } from "@moire/react-host";
import type {
  DesktopCapabilities,
  DesktopStatusState,
} from "@moire/system-management/desktop-status";
import {
  networkPresentation,
  unavailableNetworkPresentation,
  type NetworkPresentation,
} from "./network-presentation";

import { bluetoothSummary } from "./BluetoothDetailsContent";

import { batteryPresentation } from "./battery-presentation";

export type QuickSettingsContentProps = {
  /** Actual content allocation. The owner supplies the popup frame and scroll viewport. */
  width: number;
  state: DesktopStatusState;
  cachedCapabilities?: DesktopCapabilities;
  cachedNetworkPresentation?: NetworkPresentation;
  busy?: boolean;
  error?: string;
  onNetworkOpen?: () => void;
  onAudioOpen?: () => void;
  onBluetoothOpen?: () => void;
  onPowerOpen?: () => void;
  onLogout?: () => void;
  onLock?: () => void;
  /** logind's allowed power actions (from the compositor; the lock screen reads the same). */
  sessionPower?: Readonly<{ suspend: boolean; reboot: boolean; powerOff: boolean }>;
  onBatteryOpen?: () => void;
  /** Requested draft only; onVolumeCommit is the boundary for expensive backend writes. */
  onVolumeChange?: (value: number) => void;
  onVolumeStart?: () => void;
  onVolumeCommit?: (value: number) => void;
  onVolumeCancel?: () => void;
  /** Requested/updating thumb, kept separate from the observed percentage. */
  volumeDraft?: { value: number; caption: string };
  onMuteChange?: (muted: boolean) => void;
  onDoNotDisturbChange?: (enabled: boolean) => void;
  /** Open Settings, at `link` (`page#setting`) when given; the main view opens Overview. */
  onSettings?: (link?: string) => void;
};

/** Accent wash for active tiles: the accent hue at low alpha over the popup surface. */
function accentWash(accent: number, alpha = 0x33): number {
  return ((accent & 0x00ffffff) | (alpha << 24)) >>> 0;
}

function content(props: QuickSettingsContentProps, theme: WidgetTheme): ReactNode {
  const ui = getUiScaleFactor();
  const palette = theme.foundations.palette;
  const padding = 16 * ui,
    gap = 12 * ui;
  const width = Math.max(0, props.width - padding * 2);
  const iconSize = 20 * ui,
    iconSlot = 28 * ui;
  const state = props.state.kind === "ready" ? props.state.snapshot : null;
  const capabilities = state?.capabilities ?? props.cachedCapabilities;
  const networkInfo = state
    ? networkPresentation(state.network, state.wifi)
    : unavailableNetworkPresentation(props.cachedNetworkPresentation);
  const battery = batteryPresentation(state?.battery, capabilities?.battery);
  const audio = state?.audio;
  const updating = props.busy || state?.updating === true;
  const readyAudio = audio?.kind === "ready" ? audio : null;
  const audioEnabled = capabilities?.audio === true && !!readyAudio && !updating;
  const root = theme.recipes.button.ghost.medium.root;
  const hoverFill = resolveStatefulStyle(root, "hover").fill;
  const pressedFill = resolveStatefulStyle(root, "pressed").fill;
  const radius = 12 * ui;

  const icon = (name: string, color = palette.muted, size = iconSize) => (
    <Box width={iconSlot} height={size} flexShrink={0}>
      <Icon name={name} size={size} color={color} symbolic />
    </Box>
  );
  const separator = (key: string) => (
    <Box key={key} width={width} height={ui}>
      <Rect width={width} height={ui} fill={palette.borderSubtle} />
    </Box>
  );

  // Tiles: the quick actions, two per row. Each is one press target; an active tile carries
  // the accent so on/connected states read at a glance.
  const columns = width >= 300 * ui ? 2 : 1;
  const tileGap = 8 * ui;
  const tileWidth = Math.floor((width - tileGap * (columns - 1)) / columns);
  const tileHeight = 64 * ui;
  const tile = (
    key: string,
    name: string,
    title: string,
    detail: string,
    options: { active?: boolean; onPress?: () => void; focusId?: string; disclosure?: boolean },
  ) => {
    const active = options.active === true;
    const chevron = options.disclosure === true && !!options.onPress;
    // The label takes what the padding, icon, gaps and chevron leave. The chevron glyph has
    // its own blank margin, so a slightly smaller right padding gives it the same visible inset
    // as the icon has on the left while leaving the detail room for two lines.
    const padding = 12 * ui,
      chevronPadding = 8 * ui,
      gap = 8 * ui,
      chevronSize = 12 * ui;
    const labelWidth = Math.max(
      0,
      tileWidth -
        padding -
        (chevron ? chevronPadding + gap + chevronSize : padding) -
        iconSlot -
        gap,
    );
    return (
      <Box key={key} width={tileWidth} height={tileHeight}>
        <Pressable
          width={tileWidth}
          height={tileHeight}
          fill={active ? accentWash(palette.accent) : palette.surface}
          hoverFill={active ? accentWash(palette.accent, 0x48) : hoverFill}
          pressedFill={active ? accentWash(palette.accent, 0x5c) : pressedFill}
          radius={radius}
          focusId={options.focusId ?? `quick:${key}`}
          disabled={!options.onPress}
          onPress={options.onPress}
        >
          <Horizontal
            width={tileWidth}
            height={tileHeight}
            gap={gap}
            align="center"
            padding={{ left: padding, right: chevron ? chevronPadding : padding }}
          >
            {icon(
              name,
              active ? palette.accentLine : options.onPress ? palette.text : palette.muted,
              22 * ui,
            )}
            <Vertical width={labelWidth} gap={3 * ui}>
              <TextBlock
                width={labelWidth}
                text={title}
                fontSize={13}
                fontWeight="medium"
                overflow="ellipsis"
                maxLines={1}
              />
              <TextBlock
                width={labelWidth}
                text={detail}
                fontSize={11}
                color={palette.muted}
                wrap
                overflow="ellipsis"
                maxLines={2}
              />
            </Vertical>
            {chevron ? (
              <Box width={chevronSize} height={chevronSize} flexShrink={0}>
                <Icon name="chevron-right" size={chevronSize} color={palette.muted} />
              </Box>
            ) : null}
          </Horizontal>
        </Pressable>
      </Box>
    );
  };
  const tiles: ReactNode[] = [];
  tiles.push(
    tile("network", networkInfo.icon, networkInfo.label, networkInfo.detail, {
      active: state?.wifi.kind === "ready" && state.wifi.connection.kind === "active",
      onPress: props.onNetworkOpen,
      disclosure: true,
    }),
  );
  if (capabilities?.bluetooth) {
    const summary = bluetoothSummary(state?.bluetooth);
    tiles.push(
      tile("bluetooth", "bluetooth", "Bluetooth", summary, {
        active: /connected/i.test(summary) && !/not connected|unavailable/i.test(summary),
        onPress: props.onBluetoothOpen,
        disclosure: true,
      }),
    );
  }
  if (capabilities?.notifications) {
    const available = !!state?.notificationsAvailable && !updating && !!props.onDoNotDisturbChange;
    const on = state?.doNotDisturb ?? false;
    tiles.push(
      tile(
        "dnd",
        "moon",
        "Do not disturb",
        !state?.notificationsAvailable
          ? "Unavailable"
          : on
            ? state.doNotDisturbScheduled
              ? "Scheduled"
              : "On"
            : "Off",
        {
          active: on,
          onPress: available ? () => props.onDoNotDisturbChange?.(!on) : undefined,
        },
      ),
    );
  }
  const tileRows: ReactNode[] = [];
  for (let index = 0; index < tiles.length; index += columns)
    tileRows.push(
      <Horizontal key={`tiles:${index}`} width={width} height={tileHeight} gap={tileGap}>
        {tiles.slice(index, index + columns)}
      </Horizontal>,
    );
  const tileGrid = (
    <Vertical key="tiles" width={width} gap={tileGap}>
      {tileRows}
    </Vertical>
  );

  // Header: title, with the battery as a compact chip when present.
  const chipWidth = 84 * ui,
    chipHeight = 30 * ui;
  const heading = (
    <Horizontal key="heading" width={width} height={chipHeight} gap={8 * ui} align="center">
      <TextBlock
        flexGrow={1}
        text="Quick settings"
        fontSize={17}
        fontWeight="medium"
        overflow="ellipsis"
        maxLines={1}
      />
      {battery.supported ? (
        <Box width={chipWidth} height={chipHeight} flexShrink={0}>
          <Pressable
            width={chipWidth}
            height={chipHeight}
            fill={palette.surface}
            hoverFill={hoverFill}
            pressedFill={pressedFill}
            radius={chipHeight / 2}
            focusId="quick:battery"
            disabled={!props.onBatteryOpen}
            onPress={props.onBatteryOpen}
          >
            <Horizontal
              width={chipWidth}
              height={chipHeight}
              gap={6 * ui}
              align="center"
              padding={{ left: 10 * ui, right: 10 * ui }}
            >
              <Box width={16 * ui} height={16 * ui} flexShrink={0}>
                <Icon
                  name={battery.icon}
                  size={16 * ui}
                  color={battery.warning ? palette.danger : palette.text}
                  symbolic
                />
              </Box>
              <TextBlock
                flexGrow={1}
                text={battery.percentage === null ? battery.title : `${battery.percentage}%`}
                fontSize={12}
                overflow="ellipsis"
                maxLines={1}
              />
            </Horizontal>
          </Pressable>
        </Box>
      ) : null}
    </Horizontal>
  );

  const cardInset = 12 * ui;
  const sliderWidth = Math.max(0, width - cardInset * 2);
  const sliderText = Math.max(0, sliderWidth - iconSlot - 12 * ui);
  // Sliders: icon (mute for volume), label and value, then the slider at the text column.
  const slider = (
    key: string,
    leading: ReactNode,
    title: string,
    value: string,
    control: ReactNode,
    notes: ReactNode[] = [],
  ) => (
    <Horizontal key={key} width={sliderWidth} gap={12 * ui} align="start">
      {leading}
      <Vertical width={sliderText} gap={6 * ui}>
        <Horizontal width={sliderText} gap={8 * ui} align="center">
          <TextBlock
            flexGrow={1}
            text={title}
            fontSize={13}
            fontWeight="medium"
            overflow="ellipsis"
            maxLines={1}
          />
          <TextBlock text={value} fontSize={12} color={palette.muted} />
        </Horizontal>
        {control}
        {notes}
      </Vertical>
    </Horizontal>
  );
  // The device slot is narrow; a status message wraps beneath the volume instead.
  const soundDetail = readyAudio ? readyAudio.name : "Unavailable";
  const soundStatus = readyAudio
    ? undefined
    : ((audio && audio.kind !== "ready" ? audio.message : undefined) ??
      (props.state.kind !== "ready" ? props.state.message : "Sound unavailable"));
  const percent = readyAudio
    ? `${Math.round(readyAudio.volume * 100)}%${readyAudio.muted ? " · Muted" : ""}`
    : "Unavailable";
  const note = (key: string, text: string) => (
    <TextBlock
      key={key}
      width={sliderText}
      text={text}
      fontSize={11}
      color={palette.muted}
      wrap
      maxLines={2}
      overflow="ellipsis"
    />
  );
  const volumeNotes: ReactNode[] = [];
  if (readyAudio && readyAudio.volume > 1)
    volumeNotes.push(note("above", "Observed above 100%; slider is limited to 100%."));
  if (soundStatus) volumeNotes.push(note("status", soundStatus));
  const volume = slider(
    "volume",
    <Box width={iconSlot} height={iconSlot} flexShrink={0}>
      <IconButton
        width={iconSlot}
        height={iconSlot}
        variant="ghost"
        focusId="quick:mute"
        tooltip={readyAudio?.muted ? "Unmute output" : "Mute output"}
        icon={
          <Icon
            name={readyAudio?.muted ? "volume-muted" : "volume"}
            size={iconSize}
            color={audioEnabled ? palette.text : palette.muted}
          />
        }
        disabled={!audioEnabled || !props.onMuteChange}
        onPress={() => {
          if (readyAudio) props.onMuteChange?.(!readyAudio.muted);
        }}
      />
    </Box>,
    "Volume",
    // A pending drag reports in the value slot, so the panel never changes height mid-drag.
    props.volumeDraft?.caption || percent,
    <Slider
      size="large"
      width={sliderText}
      height={24 * ui}
      value={Math.min(1, Math.max(0, props.volumeDraft?.value ?? readyAudio?.volume ?? 0))}
      step={0.01}
      disabled={!audioEnabled || !props.onVolumeChange}
      onChange={props.onVolumeChange}
      onInteractionStart={props.onVolumeStart}
      onCommit={props.onVolumeCommit}
      onCancel={props.onVolumeCancel}
    />,
    volumeNotes,
  );
  // The output device: a quiet disclosure under the volume, aligned to the text column.
  const outputHeight = 36 * ui;
  // The device name takes what the label, icon and chevron leave, ellipsizing inside the card.
  const outputLabelWidth = measureWrappedText("Audio output", sliderWidth, { fontSize: 12 }).width;
  const outputNameWidth = Math.max(
    0,
    sliderWidth - iconSlot - outputLabelWidth - (props.onAudioOpen ? 14 * ui : 0) - 36 * ui,
  );
  const output = (
    <Box key="audio" width={sliderWidth} height={outputHeight}>
      <Pressable
        width={sliderWidth}
        height={outputHeight}
        fill={0x00000000}
        hoverFill={hoverFill}
        pressedFill={pressedFill}
        radius={8 * ui}
        focusId="quick:audio"
        disabled={!props.onAudioOpen}
        onPress={props.onAudioOpen}
      >
        <Horizontal width={sliderWidth} height={outputHeight} gap={12 * ui} align="center">
          {icon("headphones", palette.muted, 18 * ui)}
          <TextBlock text="Audio output" fontSize={12} color={palette.muted} />
          <TextBlock
            width={outputNameWidth}
            text={soundDetail}
            fontSize={12}
            overflow="ellipsis"
            maxLines={1}
            horizontalAlign="end"
          />
          {props.onAudioOpen ? (
            <Box width={14 * ui} height={14 * ui} flexShrink={0}>
              <Icon name="chevron-right" size={14 * ui} color={palette.muted} />
            </Box>
          ) : null}
        </Horizontal>
      </Pressable>
    </Box>
  );
  const brightness = slider(
    "brightness",
    <Box width={iconSlot} height={iconSlot} flexShrink={0}>
      <Icon
        x={(iconSlot - iconSize) / 2}
        y={(iconSlot - iconSize) / 2}
        name="brightness"
        size={iconSize}
        color={palette.muted}
        symbolic
      />
    </Box>,
    "Brightness",
    "Unavailable",
    <Slider size="large" width={sliderText} height={24 * ui} value={0} disabled />,
  );

  // Footer: Settings, with session/power actions beside it.
  const sessionPower = props.sessionPower;
  const powerAvailable = !!(
    capabilities?.power ||
    props.onLogout ||
    props.onLock ||
    sessionPower?.suspend ||
    sessionPower?.reboot ||
    sessionPower?.powerOff
  );
  const footerHeight = 40 * ui;
  const settingsWidth = Math.max(0, width - (powerAvailable ? footerHeight + 8 * ui : 0));
  const footer = (
    <Horizontal key="footer" width={width} height={footerHeight} gap={8 * ui} align="center">
      <Pressable
        width={settingsWidth}
        height={footerHeight}
        fill={0x00000000}
        radius={10 * ui}
        hoverFill={hoverFill}
        pressedFill={pressedFill}
        focusId="quick:settings"
        disabled={!props.onSettings}
        onPress={() => props.onSettings?.()}
      >
        <Horizontal width={settingsWidth} height={footerHeight} gap={12 * ui} align="center">
          {icon("settings", palette.text)}
          <TextBlock flexGrow={1} text="Settings" fontSize={13} overflow="ellipsis" maxLines={1} />
        </Horizontal>
      </Pressable>
      {powerAvailable ? (
        <IconButton
          width={footerHeight}
          height={footerHeight}
          variant="ghost"
          disabled={!props.onPowerOpen}
          focusId="quick:power"
          onPress={props.onPowerOpen}
          tooltip={
            props.onLogout
              ? "Log out and power"
              : props.onLock
                ? "Lock and power"
                : sessionPower?.suspend || sessionPower?.reboot || sessionPower?.powerOff
                  ? "Power"
                  : "Power actions unavailable; show details"
          }
          icon={<Icon name="power" size={20 * ui} color={palette.text} />}
        />
      ) : null}
    </Horizontal>
  );

  const message =
    props.error || (updating && !props.volumeDraft ? "Updating; waiting for actual status…" : "");
  const sliders: ReactNode[] = [];
  if (capabilities?.audio) sliders.push(volume, output);
  if (capabilities?.brightness) sliders.push(brightness);
  const sections: ReactNode[] = [tileGrid];
  if (sliders.length) {
    // The sliders sit together on one card, inset to the tiles' rhythm.
    const inset = cardInset;
    const inner = (
      <Vertical width={width - inset * 2} gap={8 * ui}>
        {sliders}
      </Vertical>
    );
    const cardHeight =
      measureColumnContent({ width: width - inset * 2, children: inner }, theme).height + inset * 2;
    sections.push(
      <Box key="sliders" width={width} height={cardHeight}>
        <Rect width={width} height={cardHeight} fill={palette.surface} radius={radius} />
        <Group x={inset} y={inset} width={width - inset * 2} height={cardHeight - inset * 2}>
          {inner}
        </Group>
      </Box>,
    );
  }
  sections.push(footer);
  return (
    <Column width={props.width} padding={padding} gap={gap}>
      {heading}
      {sections.map((section, index) => (
        <Vertical key={`section:${index}`} width={width} gap={gap}>
          {index && index === sections.length - 1 ? separator(`separator:${index}`) : null}
          {section}
        </Vertical>
      ))}
      {message ? (
        <TextBlock
          width={width}
          text={message}
          fontSize={11}
          color={props.error ? palette.danger : palette.muted}
          wrap
        />
      ) : null}
    </Column>
  );
}

/** Natural extent from the exact rendered tree, independent of any screen/anchor coordinates. */
export function measureQuickSettingsContent(
  props: QuickSettingsContentProps,
  theme = getWidgetTheme(),
) {
  return measureColumnContent({ width: props.width, children: content(props, theme) }, theme);
}

/** Main quick settings only. Notification history/bell and detail subpanels have separate owners. */
export function QuickSettingsContent(props: QuickSettingsContentProps): ReactNode {
  return content(props, useWidgetTheme());
}
registerIntrinsicSize(QuickSettingsContent, (props, theme) =>
  measureQuickSettingsContent(props, theme),
);
