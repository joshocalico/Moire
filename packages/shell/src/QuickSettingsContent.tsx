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
  Toggle,
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
import { Rect } from "@moire/react-host";
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
  onSettings?: () => void;
};

function content(props: QuickSettingsContentProps, theme: WidgetTheme): ReactNode {
  const ui = getUiScaleFactor();
  const palette = theme.foundations.palette;
  const padding = 18 * ui,
    gap = 10 * ui;
  const width = Math.max(0, props.width - padding * 2);
  const iconSize = 24 * ui,
    iconSlot = 32 * ui;
  const textWidth = Math.max(0, width - iconSlot - 12 * ui);
  const captionHeight = measureWrappedText("Mg", textWidth, { fontSize: 10 }).lineHeight * 2;
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

  const icon = (name: string, color = palette.muted) => (
    <Box width={iconSlot} height={iconSize} flexShrink={0}>
      <Icon name={name} size={iconSize} color={color} symbolic />
    </Box>
  );
  const separator = (key: string) => (
    <Box key={key} width={width} height={ui}>
      <Rect width={width} height={ui} fill={palette.borderSubtle} />
    </Box>
  );
  const label = (value: string, fontSize = 14, color = palette.text) => (
    <TextBlock text={value} fontSize={fontSize} color={color} overflow="ellipsis" maxLines={1} />
  );
  const disclosure = (
    key: string,
    name: string,
    title: string,
    detail: string,
    callback?: () => void,
  ) => {
    const labelWidth = Math.max(0, textWidth - 28 * ui);
    const caption = measureWrappedText(detail, labelWidth, { fontSize: 11 });
    const captionHeight = Math.min(2, caption.lines.length) * caption.lineHeight;
    const text = (
      <Vertical width={labelWidth} gap={4 * ui}>
        <TextBlock width={labelWidth} text={title} fontSize={14} overflow="ellipsis" maxLines={1} />
        <TextBlock
          width={labelWidth}
          height={captionHeight}
          text={detail}
          fontSize={11}
          color={palette.muted}
          wrap
          maxLines={2}
          overflow="ellipsis"
        />
      </Vertical>
    );
    const measured = measureColumnContent({ width: labelWidth, children: text }, theme);
    // Measurement uses the same nested flow tree, including wrapped caption height.
    const height = Math.max(44 * ui, measured.height + 8 * ui);
    return (
      <Box key={key} width={width} height={height}>
        <Pressable
          width={width}
          height={height}
          fill={0x00000000}
          hoverFill={resolveStatefulStyle(root, "hover").fill}
          pressedFill={resolveStatefulStyle(root, "pressed").fill}
          radius={palette.radiusSm}
          focusId={`quick:${key}`}
          disabled={!callback}
          onPress={callback}
        >
          <Horizontal width={width} height={height} gap={12 * ui} align="center">
            {icon(name, callback ? palette.accentLine : palette.muted)}
            {text}
            {callback ? (
              <Box width={16 * ui} height={16 * ui} flexShrink={0}>
                <Icon name="chevron-right" size={16 * ui} color={palette.muted} />
              </Box>
            ) : null}
          </Horizontal>
        </Pressable>
      </Box>
    );
  };
  const heading = (
    <Vertical key="heading" width={width} gap={4 * ui}>
      <TextBlock width={width} text="Quick settings" fontSize={21} fontWeight="medium" wrap />
      {battery.supported
        ? disclosure(
            "battery",
            battery.icon,
            battery.title,
            `${battery.summary}${battery.warning ? ` · ${battery.warning}` : ""}`,
            props.onBatteryOpen,
          )
        : null}
    </Vertical>
  );
  const networkDetail = networkInfo.detail;
  const network = disclosure(
    "network",
    networkInfo.icon,
    networkInfo.label,
    networkDetail,
    props.onNetworkOpen,
  );
  const soundDetail = readyAudio
    ? readyAudio.name
    : ((audio && audio.kind !== "ready" ? audio.message : undefined) ??
      (props.state.kind !== "ready" ? props.state.message : "Sound unavailable"));
  const percent = readyAudio
    ? `${Math.round(readyAudio.volume * 100)}%${readyAudio.muted ? " · Muted" : ""}`
    : "Unavailable";
  const volume = (
    <Horizontal key="volume" width={width} gap={12 * ui} align="start">
      <Box width={iconSlot} height={34 * ui} flexShrink={0}>
        <IconButton
          width={iconSlot}
          height={34 * ui}
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
      </Box>
      <Vertical width={textWidth} gap={4 * ui}>
        <Horizontal width={textWidth} gap={8 * ui} align="center">
          <TextBlock flexGrow={1} text="Volume" fontSize={14} overflow="ellipsis" maxLines={1} />
          <TextBlock text={percent} fontSize={12} color={palette.muted} />
        </Horizontal>
        <Slider
          size="large"
          width={textWidth}
          height={28 * ui}
          value={Math.min(1, Math.max(0, props.volumeDraft?.value ?? readyAudio?.volume ?? 0))}
          step={0.01}
          disabled={!audioEnabled || !props.onVolumeChange}
          onChange={props.onVolumeChange}
          onInteractionStart={props.onVolumeStart}
          onCommit={props.onVolumeCommit}
          onCancel={props.onVolumeCancel}
        />
        <TextBlock
          width={textWidth}
          height={captionHeight}
          text={props.volumeDraft?.caption ?? ""}
          fontSize={10}
          color={palette.muted}
          wrap
          maxLines={2}
          overflow="ellipsis"
        />
        {readyAudio && readyAudio.volume > 1 ? (
          <TextBlock
            width={textWidth}
            text="Observed above 100%; slider is limited to 100%."
            fontSize={10}
            color={palette.muted}
            wrap
          />
        ) : null}
      </Vertical>
    </Horizontal>
  );
  const output = disclosure("audio", "headphones", "Audio output", soundDetail, props.onAudioOpen);
  const brightness = (
    <Horizontal key="brightness" width={width} gap={12 * ui} align="start">
      {icon("brightness")}
      <Vertical width={textWidth} gap={4 * ui}>
        <Horizontal width={textWidth} gap={8 * ui} align="center">
          <TextBlock
            flexGrow={1}
            text="Brightness"
            fontSize={14}
            overflow="ellipsis"
            maxLines={1}
          />
          {label("Unavailable", 11, palette.muted)}
        </Horizontal>
        <Slider size="large" width={textWidth} height={28 * ui} value={0} disabled />
      </Vertical>
    </Horizontal>
  );
  const bluetooth = disclosure(
    "bluetooth",
    "bluetooth",
    "Bluetooth",
    bluetoothSummary(state?.bluetooth),
    props.onBluetoothOpen,
  );
  const dnd = (
    <Horizontal key="dnd" width={width} gap={12 * ui} align="center">
      {icon("moon", palette.accentLine)}
      <Vertical
        width={Math.max(0, textWidth - theme.recipes.toggle.medium.metrics.trackWidth - 8 * ui)}
        gap={3 * ui}
      >
        <TextBlock text="Do not disturb" fontSize={14} wrap />
        {!state?.notificationsAvailable ? label("Unavailable", 11, palette.muted) : null}
      </Vertical>
      <Toggle
        on={state?.doNotDisturb ?? false}
        disabled={!state?.notificationsAvailable || updating || !props.onDoNotDisturbChange}
        onChange={props.onDoNotDisturbChange}
      />
    </Horizontal>
  );
  const footer = (
    <Horizontal key="footer" width={width} gap={8 * ui} align="center">
      <Pressable
        width={Math.max(0, width - (capabilities?.power || props.onLogout ? 40 * ui : 0))}
        height={40 * ui}
        fill={0x00000000}
        radius={palette.radiusSm}
        hoverFill={resolveStatefulStyle(root, "hover").fill}
        focusId="quick:settings"
        disabled={!props.onSettings}
        onPress={props.onSettings}
      >
        <Horizontal
          width={Math.max(0, width - (capabilities?.power || props.onLogout ? 40 * ui : 0))}
          height={40 * ui}
          gap={12 * ui}
          align="center"
        >
          {icon("settings")}
          <TextBlock flexGrow={1} text="Settings" fontSize={14} overflow="ellipsis" maxLines={1} />
        </Horizontal>
      </Pressable>
      {capabilities?.power || props.onLogout ? (
        <IconButton
          width={32 * ui}
          height={32 * ui}
          variant="ghost"
          disabled={!props.onPowerOpen}
          focusId="quick:power"
          onPress={props.onPowerOpen}
          tooltip={props.onLogout ? "Session actions" : "Power actions unavailable; show details"}
          icon={<Icon name="power" size={20 * ui} color={palette.muted} />}
        />
      ) : null}
    </Horizontal>
  );
  const message =
    props.error || (updating && !props.volumeDraft ? "Updating; waiting for actual status…" : "");
  const groups: ReactNode[] = [network];
  if (capabilities?.audio)
    groups.push(
      <Vertical key="sound" width={width} gap={gap}>
        {volume}
        {output}
      </Vertical>,
    );
  if (capabilities?.brightness) groups.push(brightness);
  if (capabilities?.bluetooth || capabilities?.notifications)
    groups.push(
      <Vertical key="policy" width={width} gap={gap}>
        {capabilities?.bluetooth ? bluetooth : null}
        {capabilities?.notifications ? dnd : null}
      </Vertical>,
    );
  groups.push(footer);
  return (
    <Column width={props.width} padding={padding} gap={gap}>
      {heading}
      {groups.map((group, index) => (
        <Vertical key={`group:${index}`} width={width} gap={gap}>
          {index ? separator(`separator:${index}`) : null}
          {group}
        </Vertical>
      ))}
      {capabilities?.power || props.onLogout ? (
        <TextBlock
          width={width}
          text={
            props.onLogout ? "Log out is available in session actions" : "Power actions unavailable"
          }
          fontSize={10}
          color={palette.muted}
        />
      ) : null}
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
