import React, { type ReactNode } from "react";
import { Rect } from "@moire/react-host";
import {
  Box,
  Button,
  Column,
  ContentCard,
  Horizontal,
  Icon,
  IconButton,
  Slider,
  Pressable,
  ProgressBar,
  TextBlock,
  Vertical,
  getUiScaleFactor,
  getWidgetTheme,
  measureColumnContent,
  measureWrappedText,
  registerIntrinsicSize,
  resolveStatefulStyle,
  useWidgetTheme,
  type WidgetTheme,
} from "@moire/ui";
import type {
  DesktopCapabilities,
  DesktopStatusState,
} from "@moire/system-management/desktop-status";
import type { WifiAccessPoint } from "@moire/system-management/network-status";
import { WIFI_UNAVAILABLE } from "@moire/system-management/network-status";
import { NetworkDetailsContent } from "./NetworkDetailsContent";
import {
  networkPresentation,
  unavailableNetworkPresentation,
  type NetworkPresentation,
} from "./network-presentation";

import {
  BLUETOOTH_UNAVAILABLE,
  type BluetoothDevice,
  type BluetoothId,
  type BluetoothNearbyDevice,
} from "@moire/system-management/bluetooth-status";
import { BluetoothDetailsContent, bluetoothInteractionScope } from "./BluetoothDetailsContent";

import { batteryPresentation } from "./battery-presentation";

export type QuickSettingsDetailsView = "network" | "audio" | "bluetooth" | "power" | "battery";
export type QuickSettingsDetailsProps = {
  /** Content allocation only; the shell owns the single panel frame/anchor/scroll viewport. */
  width: number;
  state: DesktopStatusState;
  cachedCapabilities?: DesktopCapabilities;
  cachedNetworkPresentation?: NetworkPresentation;
  view: QuickSettingsDetailsView;
  wifiSelection?: WifiAccessPoint;
  wifiPassword?: string;
  onWifiSelect?: (ap: WifiAccessPoint) => void;
  onWifiPasswordChange?: (value: string) => void;
  onWifiConnect?: () => void;
  onWifiCancel?: () => void;
  onWifiRefresh?: () => void;
  onWifiSelectionCancel?: () => void;
  onBluetoothChange?: (device: BluetoothDevice, connected: boolean) => void;
  onBluetoothRefresh?: () => void;
  onBluetoothDiscoveryStart?: (adapterId: BluetoothId) => void;
  onBluetoothDiscoveryStop?: () => void;
  onBluetoothPair?: (device: BluetoothNearbyDevice) => void;
  onBluetoothPairCancel?: () => void;
  onBluetoothPromptResponse?: (promptId: BluetoothId, accepted: boolean) => void;
  onBluetoothInputResponse?: (promptId: BluetoothId, value: string) => void;
  onBluetoothTrustRequest?: (device: BluetoothDevice, trusted: boolean) => void;
  onBluetoothTrustConfirm?: (challengeId: BluetoothId) => void;
  onBluetoothTrustCancel?: (challengeId: BluetoothId) => void;
  busy?: boolean;
  error?: string;
  onLogout?: () => void;
  onBack(): void;
  onSettings?: () => void;
  onVolumeChange?: (value: number) => void;
  onVolumeStart?: () => void;
  onVolumeCommit?: (value: number) => void;
  onVolumeCancel?: () => void;
  onMuteChange?: (muted: boolean) => void;
  /** Owner supplies the complete request/pending caption, separate from observed facts. */
  volumeDraft?: { value: number; caption: string };
};

function content(props: QuickSettingsDetailsProps, theme: WidgetTheme): ReactNode {
  const ui = getUiScaleFactor();
  const palette = theme.foundations.palette;
  const padding = 18 * ui,
    gap = 12 * ui;
  const width = Math.max(0, props.width - padding * 2);
  const snapshot = props.state.kind === "ready" ? props.state.snapshot : null;
  const capabilities = snapshot?.capabilities ?? props.cachedCapabilities;
  const networkInfo = snapshot
    ? networkPresentation(snapshot.network, snapshot.wifi)
    : unavailableNetworkPresentation(props.cachedNetworkPresentation);
  const battery = batteryPresentation(snapshot?.battery, capabilities?.battery);
  const audio = snapshot?.audio;
  const bluetoothPromptActive =
    props.view === "bluetooth" && !!bluetoothInteractionScope(snapshot?.bluetooth);
  const actualAudio = audio?.kind === "ready" ? audio : null;
  const updating = props.busy || snapshot?.updating === true;
  const audioEnabled =
    capabilities?.audio === true && !!actualAudio && !updating && !!props.onVolumeChange;
  const captionHeight = measureWrappedText("Mg\nMg", width, { fontSize: 11 }).height;
  const iconWidth = 30 * ui;
  const icon = (name: string, color = palette.muted) => (
    <Box width={iconWidth} height={24 * ui} flexShrink={0}>
      <Icon name={name} size={24 * ui} color={color} symbolic />
    </Box>
  );
  const divider = (key: string) => (
    <Box key={key} width={width} height={ui}>
      <Rect width={width} height={ui} fill={palette.borderSubtle} />
    </Box>
  );
  const message = (text: string, color = palette.muted) => (
    <TextBlock width={width} text={text} fontSize={11} color={color} wrap />
  );
  const row = (key: string, name: string, title: string, detail: string, selected = false) => {
    const inset = selected ? 10 * ui : 0;
    const rowWidth = Math.max(0, width - inset * 2);
    const checkWidth = selected ? 20 * ui : 0;
    const textWidth = Math.max(0, rowWidth - iconWidth - (selected ? 20 : 10) * ui - checkWidth);
    const children = (
      <Horizontal width={rowWidth} gap={10 * ui} align="center">
        {icon(name, selected ? palette.accentLine : palette.muted)}
        <Vertical width={textWidth} gap={4 * ui}>
          <TextBlock width={textWidth} text={title} fontSize={14} wrap />
          <TextBlock width={textWidth} text={detail} fontSize={11} color={palette.muted} wrap />
        </Vertical>
        {selected ? (
          <Box width={20 * ui} height={20 * ui} flexShrink={0}>
            <Icon name="check-circle" size={20 * ui} color={palette.accentLine} />
          </Box>
        ) : null}
      </Horizontal>
    );
    return selected ? (
      <ContentCard key={key} width={width} padding={inset} gap={0} fill={palette.selection}>
        {children}
      </ContentCard>
    ) : (
      <Column key={key} width={width}>
        {children}
      </Column>
    );
  };
  const title = {
    network: props.wifiSelection ? "Wi-Fi" : networkInfo.label,
    audio: "Audio output",
    bluetooth: "Bluetooth",
    power: "Power",
    battery: battery.title,
  }[props.view];
  const header = (
    <Horizontal key="header" width={width} gap={10 * ui} align="center">
      <Box width={32 * ui} height={32 * ui} flexShrink={0}>
        <IconButton
          width={32 * ui}
          height={32 * ui}
          variant="ghost"
          focusId="quick:details:back"
          tooltip="Back to quick settings"
          icon={(style) => <Icon name="back" size={style.size} color={style.color} />}
          onPress={
            props.view === "network" && props.wifiSelection
              ? (props.onWifiSelectionCancel ?? props.onBack)
              : props.onBack
          }
        />
      </Box>
      <TextBlock
        width={Math.max(0, width - 42 * ui)}
        text={title}
        fontSize={20}
        fontWeight="medium"
        wrap
      />
    </Horizontal>
  );
  const powerRows: readonly (readonly [string, string])[] = [
    ["lock", "Lock"],
    ["logout", "Log out"],
    ["moon", "Suspend"],
    ["restart", "Restart"],
    ["power", "Shut down"],
  ];
  let body: ReactNode;
  switch (props.view) {
    case "network":
      body = (
        <NetworkDetailsContent
          width={width}
          wifi={snapshot?.wifi ?? WIFI_UNAVAILABLE}
          busy={props.busy}
          addresses={snapshot?.network ?? []}
          wifiSelection={props.wifiSelection}
          wifiPassword={props.wifiPassword}
          onWifiSelect={props.onWifiSelect}
          onWifiPasswordChange={props.onWifiPasswordChange}
          onWifiConnect={props.onWifiConnect}
          onWifiCancel={props.onWifiCancel}
          onWifiRefresh={props.onWifiRefresh}
          onWifiSelectionCancel={props.onWifiSelectionCancel}
        />
      );
      break;
    case "audio": {
      if (!capabilities?.audio) {
        body = message("Audio controls unavailable");
        break;
      }
      const observed = actualAudio
        ? `${Math.round(actualAudio.volume * 100)}%${actualAudio.muted ? " · Muted" : ""}`
        : "Unavailable";
      const unavailable =
        audio && audio.kind !== "ready"
          ? audio.message
          : props.state.kind !== "ready"
            ? props.state.message
            : "Sound unavailable";
      body = (
        <Column width={width} gap={gap}>
          {actualAudio
            ? row("current-output", "headphones", actualAudio.name, "Current output", true)
            : row("unavailable-output", "headphones", "Audio output unavailable", unavailable)}
          {message("Output selection unavailable")}
          {divider("before-volume")}
          <Horizontal width={width} gap={10 * ui} align="center">
            <TextBlock
              width={Math.max(0, width - 60 * ui)}
              text="Output volume"
              fontSize={14}
              wrap
            />
            <Box width={50 * ui} height={32 * ui} flexShrink={0}>
              <IconButton
                width={32 * ui}
                height={32 * ui}
                variant="ghost"
                focusId="quick:details:mute"
                tooltip={actualAudio?.muted ? "Unmute output" : "Mute output"}
                icon={(style) => (
                  <Icon
                    name={actualAudio?.muted ? "volume-muted" : "volume"}
                    size={style.size}
                    color={style.color}
                  />
                )}
                disabled={!actualAudio || updating || !props.onMuteChange}
                onPress={() => {
                  if (actualAudio) props.onMuteChange?.(!actualAudio.muted);
                }}
              />
            </Box>
          </Horizontal>
          <Slider
            width={width}
            height={28 * ui}
            value={Math.max(0, Math.min(1, props.volumeDraft?.value ?? actualAudio?.volume ?? 0))}
            step={0.01}
            focusId="quick:details:volume"
            disabled={!audioEnabled}
            onChange={props.onVolumeChange}
            onInteractionStart={props.onVolumeStart}
            onCommit={props.onVolumeCommit}
            onCancel={props.onVolumeCancel}
          />
          {message(`Observed volume: ${observed}`)}
          <TextBlock
            width={width}
            height={captionHeight}
            text={props.volumeDraft?.caption ?? ""}
            fontSize={11}
            color={palette.accentLine}
            wrap
            maxLines={2}
            overflow="ellipsis"
          />
          {actualAudio && actualAudio.volume > 1
            ? message("Observed above 100%; slider is limited to 100%.")
            : null}
        </Column>
      );
      break;
    }
    case "bluetooth":
      body = (
        <BluetoothDetailsContent
          width={width}
          bluetooth={snapshot?.bluetooth ?? BLUETOOTH_UNAVAILABLE}
          onBluetoothDiscoveryStart={props.onBluetoothDiscoveryStart}
          onBluetoothDiscoveryStop={props.onBluetoothDiscoveryStop}
          onBluetoothPair={props.onBluetoothPair}
          onBluetoothPairCancel={props.onBluetoothPairCancel}
          onBluetoothPromptResponse={props.onBluetoothPromptResponse}
          onBluetoothInputResponse={props.onBluetoothInputResponse}
          onBluetoothTrustRequest={props.onBluetoothTrustRequest}
          onBluetoothTrustConfirm={props.onBluetoothTrustConfirm}
          onBluetoothTrustCancel={props.onBluetoothTrustCancel}
          busy={updating}
          onBluetoothChange={props.onBluetoothChange}
          onBluetoothRefresh={props.onBluetoothRefresh}
        />
      );
      break;
    case "battery":
      body = battery.available ? (
        <Column width={width} gap={gap}>
          <ContentCard width={width} padding={12 * ui} gap={10 * ui}>
            <Horizontal width={Math.max(0, width - 24 * ui)} gap={10 * ui} align="center">
              {icon(battery.icon, battery.tone === "warning" ? palette.danger : palette.accentLine)}
              <TextBlock
                width={Math.max(0, width - 24 * ui - iconWidth - 10 * ui)}
                text={`${battery.percentage}%`}
                fontSize={28}
                fontWeight="medium"
              />
            </Horizontal>
            <ProgressBar
              width={Math.max(0, width - 24 * ui)}
              value={(battery.percentage ?? 0) / 100}
            />
            <TextBlock
              width={Math.max(0, width - 24 * ui)}
              text={battery.charge}
              fontSize={14}
              wrap
            />
            <TextBlock
              width={Math.max(0, width - 24 * ui)}
              text={battery.power ?? ""}
              fontSize={11}
              color={palette.muted}
              wrap
            />
            {battery.estimate ? (
              <TextBlock
                width={Math.max(0, width - 24 * ui)}
                text={battery.estimate}
                fontSize={11}
                color={palette.muted}
                wrap
              />
            ) : null}
          </ContentCard>
          {battery.warning
            ? message(battery.warning, battery.tone === "warning" ? palette.danger : palette.muted)
            : null}
        </Column>
      ) : (
        <Column width={width} gap={gap}>
          {message(battery.summary)}
          {message(battery.charge)}
        </Column>
      );
      break;
    case "power":
      if (props.onLogout) {
        body = (
          <Column width={width} gap={gap}>
            <Button width={width} label="Log out" focusId="quick:logout" onPress={props.onLogout} />
            {message("Close this desktop and return to sign in.")}
            {message("Lock, suspend, restart and shutdown are unavailable.")}
          </Column>
        );
        break;
      }
      if (!capabilities?.power) {
        body = message("Power controls unavailable");
        break;
      }
      body = (
        <Column width={width} gap={gap}>
          {powerRows.map(([name, label], index) => (
            <Column key={name} width={width} gap={gap}>
              {index ? divider(`power-divider:${name}`) : null}
              {row(`power:${name}`, name, label, "Unavailable")}
            </Column>
          ))}
          {message("Power and session actions are unavailable.")}
        </Column>
      );
      break;
    default: {
      const exhaustive: never = props.view;
      throw new Error(`Unknown details view: ${exhaustive}`);
    }
  }
  const footerInset = 8 * ui;
  const footerWidth = Math.max(0, width - footerInset * 2);
  const footerTree = (
    <Horizontal width={footerWidth} gap={10 * ui} align="center">
      {icon("settings")}
      <TextBlock
        width={Math.max(0, footerWidth - iconWidth - 36 * ui)}
        text="Settings"
        fontSize={14}
        wrap
      />
      <Box width={16 * ui} height={16 * ui} flexShrink={0}>
        <Icon name="chevron-right" size={16 * ui} color={palette.muted} />
      </Box>
    </Horizontal>
  );
  const footerLayout = { width, padding: footerInset, gap: 0, children: footerTree };
  const footerHeight = measureColumnContent(footerLayout, theme).height;
  const footerStyle = theme.recipes.button.ghost.medium.root;
  return (
    <Column width={props.width} padding={padding} gap={gap}>
      {header}
      {divider("after-header")}
      {body}
      {!bluetoothPromptActive ? divider("before-settings") : null}
      {!bluetoothPromptActive ? (
        <Box width={width} height={footerHeight}>
          <Pressable
            width={width}
            height={footerHeight}
            fill={0x00000000}
            hoverFill={resolveStatefulStyle(footerStyle, "hover").fill}
            pressedFill={resolveStatefulStyle(footerStyle, "pressed").fill}
            radius={palette.radiusSm}
            focusId="quick:details:settings"
            disabled={!props.onSettings}
            onPress={props.onSettings}
          >
            <Column {...footerLayout} />
          </Pressable>
        </Box>
      ) : null}
      {props.error
        ? message(props.error, palette.danger)
        : updating && !(props.view === "audio" && props.volumeDraft)
          ? message("Updating; waiting for actual status…")
          : null}
    </Column>
  );
}

export function measureQuickSettingsDetails(
  props: QuickSettingsDetailsProps,
  theme = getWidgetTheme(),
) {
  return measureColumnContent({ width: props.width, children: content(props, theme) }, theme);
}

/** One alternate content tree. Parent shell retains its anchor, focus scope and viewport. */
export function QuickSettingsDetails(props: QuickSettingsDetailsProps): ReactNode {
  return content(props, useWidgetTheme());
}
registerIntrinsicSize(QuickSettingsDetails, (props, theme) =>
  measureQuickSettingsDetails(props, theme),
);
