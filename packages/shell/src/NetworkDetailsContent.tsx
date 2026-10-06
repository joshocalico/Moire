import React, { type ReactNode } from "react";
import {
  Box,
  Button,
  Column,
  ContentCard,
  Horizontal,
  Icon,
  Pressable,
  TextBlock,
  TextField,
  Vertical,
  getUiScaleFactor,
  getWidgetTheme,
  measureColumnContent,
  registerIntrinsicSize,
  resolveStatefulStyle,
  useWidgetTheme,
  type WidgetTheme,
} from "@moire/ui";
import type { DesktopNetwork } from "@moire/system-management/desktop-status";
import {
  isValidWpaPsk,
  type DesktopWifi,
  type WifiAccessPoint,
} from "@moire/system-management/network-status";
import { connectivityLabel } from "./network-presentation";

export type NetworkDetailsContentProps = {
  width: number;
  busy?: boolean;
  wifi: DesktopWifi;
  addresses: readonly DesktopNetwork[];
  wifiSelection?: WifiAccessPoint;
  wifiPassword?: string;
  onWifiSelect?: (ap: WifiAccessPoint) => void;
  onWifiPasswordChange?: (value: string) => void;
  onWifiConnect?: () => void;
  onWifiCancel?: () => void;
  onWifiRefresh?: () => void;
  onWifiSelectionCancel?: () => void;
};

function content(props: NetworkDetailsContentProps, theme: WidgetTheme): ReactNode {
  const ui = getUiScaleFactor(),
    palette = theme.foundations.palette,
    width = props.width;
  const gap = 12 * ui,
    iconSlot = 28 * ui;
  const wifi = props.wifi;
  const ready = wifi.kind === "ready" ? wifi : null;
  const operation = ready?.operation;
  const pending = operation?.kind === "connecting" || operation?.kind === "cancelling";
  const uncertain = operation?.kind === "unknown";
  const label = (text: string, color = palette.muted, size = 11) => (
    <TextBlock width={width} text={text} fontSize={size} color={color} wrap />
  );
  const row = (ap: WifiAccessPoint, interactive: boolean) => {
    const inset = 10 * ui,
      inner = Math.max(0, width - inset * 2);
    const lockWidth = ap.security === "open" ? 0 : 18 * ui;
    const trailingWidth = ap.connected || interactive ? 20 * ui : 0;
    const rowGap = (lockWidth ? 2 : 1) * 10 * ui + (trailingWidth ? 10 * ui : 0);
    const textWidth = Math.max(0, inner - iconSlot - lockWidth - trailingWidth - rowGap);
    const detail = `${ap.connected ? "Current connection · " : ""}${ap.security === "open" ? "Open network" : ap.security === "wpa-psk" ? "Secured network" : "Unsupported security"} · ${ap.strength}% signal`;
    const tree = (
      <Horizontal width={inner} gap={10 * ui} align="center">
        <Box width={iconSlot} height={24 * ui} flexShrink={0}>
          <Icon
            name="network"
            size={24 * ui}
            color={ap.connected ? palette.accentLine : palette.muted}
          />
        </Box>
        <Vertical width={textWidth} gap={3 * ui}>
          <TextBlock width={textWidth} text={ap.ssid || "Hidden network"} fontSize={14} wrap />
          <TextBlock width={textWidth} text={detail} fontSize={11} color={palette.muted} wrap />
        </Vertical>
        {lockWidth ? (
          <Box width={lockWidth} height={18 * ui} flexShrink={0}>
            <Icon name="lock" size={18 * ui} color={palette.muted} />
          </Box>
        ) : null}
        <Box width={trailingWidth} height={20 * ui} flexShrink={0}>
          {ap.connected ? (
            <Icon name="check-circle" size={20 * ui} color={palette.accentLine} />
          ) : interactive ? (
            <Icon name="chevron-right" size={16 * ui} color={palette.muted} />
          ) : null}
        </Box>
      </Horizontal>
    );
    const layout = { width, padding: inset, gap: 0, children: tree };
    const height = measureColumnContent(layout, theme).height;
    return (
      <Box key={ap.id} width={width} height={height}>
        <Pressable
          width={width}
          height={height}
          radius={palette.radiusSm}
          fill={ap.connected ? palette.selection : 0x00000000}
          hoverFill={resolveStatefulStyle(theme.recipes.button.ghost.medium.root, "hover").fill}
          focusId={`quick:wifi:ap:${ap.id}`}
          disabled={!interactive}
          onPress={() => props.onWifiSelect?.(ap)}
        >
          <Column {...layout} />
        </Pressable>
      </Box>
    );
  };
  const status = ready ? (
    <Column width={width} gap={4 * ui}>
      {label(connectivityLabel(ready.connectivity), palette.text, 13)}
      {ready.connection.kind === "active"
        ? label(
            `${ready.connection.transport === "wired" ? "Wired" : ready.connection.transport === "wifi" ? "Wi-Fi" : "Network"}: ${ready.connection.name}`,
          )
        : label("No active connection")}
      {ready.policy === "readonly" ? label("System policy allows network status only") : null}
      {!ready.hardwareEnabled
        ? label("Wi-Fi is blocked by hardware")
        : !ready.enabled
          ? label("Wi-Fi is off")
          : null}
    </Column>
  ) : (
    label(wifi.kind === "ready" ? "" : wifi.message)
  );
  const operationNotice =
    operation && operation.kind !== "idle"
      ? label(
          operation.kind === "connecting"
            ? `Connecting to ${operation.ssid}…`
            : operation.kind === "cancelling"
              ? `Cancelling connection to ${operation.ssid}…`
              : operation.message,
          operation.kind === "error" ? palette.danger : palette.muted,
        )
      : null;
  const selection = props.wifiSelection;
  const selected = ready?.accessPoints.find((ap) => ap.id === selection?.id);
  let body: ReactNode;
  if (selection) {
    const allowed =
      !!ready &&
      !!selected &&
      ready.policy === "interactive" &&
      ready.canConnect &&
      ready.enabled &&
      ready.hardwareEnabled &&
      !selected.connected &&
      selected.security !== "unsupported";
    const password = props.wifiPassword ?? "";
    const validPassword = selected?.security !== "wpa-psk" || isValidWpaPsk(password);
    const connect = () => {
      if (allowed && validPassword && !pending && !uncertain && !props.busy)
        props.onWifiConnect?.();
    };
    body = (
      <Column width={width} gap={gap}>
        {selected ? row(selected, false) : label("This network is no longer available.")}
        {selected?.security === "unsupported"
          ? label(
              "This security type is not supported. Open and WPA personal networks are supported.",
            )
          : null}
        {selected?.connected ? label("This is the current connection.") : null}
        {allowed && selected?.security === "wpa-psk" ? (
          <Column width={width} gap={8 * ui}>
            {label("Enter the network password", palette.text, 14)}
            {label("Password")}
            <TextField
              height={40 * ui}
              width={width}
              password
              value={password}
              placeholder="Password"
              disabled={pending || uncertain || props.busy}
              invalid={operation?.kind === "error"}
              onChange={props.onWifiPasswordChange}
              onSubmit={connect}
              onCancel={pending ? undefined : props.onWifiSelectionCancel}
            />
            {label("8–63 printable ASCII characters, or a 64-digit hexadecimal key")}
          </Column>
        ) : allowed && selected?.security === "open" ? (
          label("This network does not require a password.")
        ) : null}
        {operationNotice}
        <Horizontal width={width} height={36 * ui} gap={10 * ui}>
          <Button
            width={Math.max(0, (width - 10 * ui) / 2)}
            height={36 * ui}
            label="Cancel"
            focusId="quick:wifi:selection-cancel"
            disabled={
              pending &&
              !(operation?.kind === "connecting" && operation.cancellable && props.onWifiCancel)
            }
            onPress={pending ? props.onWifiCancel : props.onWifiSelectionCancel}
          />
          <Button
            width={Math.max(0, (width - 10 * ui) / 2)}
            height={36 * ui}
            label={
              operation?.kind === "cancelling" ? "Cancelling…" : pending ? "Connecting…" : "Connect"
            }
            variant="primary"
            focusId="quick:wifi:connect"
            disabled={
              !allowed ||
              !validPassword ||
              pending ||
              uncertain ||
              props.busy ||
              !props.onWifiConnect
            }
            onPress={connect}
          />
        </Horizontal>
      </Column>
    );
  } else {
    body = (
      <Column width={width} gap={gap}>
        {operationNotice}
        {operation?.kind === "connecting" && operation.cancellable && props.onWifiCancel ? (
          <Button
            width={width}
            label="Cancel connection"
            focusId="quick:wifi:cancel"
            onPress={props.onWifiCancel}
          />
        ) : null}
        {ready?.enabled && ready.hardwareEnabled ? (
          <Column width={width} gap={3 * ui}>
            {label("AVAILABLE NETWORKS")}
            {ready.accessPoints.length
              ? ready.accessPoints.map((ap) =>
                  row(
                    ap,
                    !pending &&
                      !uncertain &&
                      !props.busy &&
                      ready.policy === "interactive" &&
                      ready.canConnect &&
                      !ap.connected &&
                      ap.security !== "unsupported" &&
                      !!props.onWifiSelect,
                  ),
                )
              : label("No networks observed")}
          </Column>
        ) : null}
        <Button
          width={width}
          label={
            ready?.canScan && ready.policy === "interactive" ? "Refresh networks" : "Refresh status"
          }
          focusId="quick:wifi:refresh"
          disabled={pending || props.busy || !props.onWifiRefresh}
          onPress={props.onWifiRefresh}
        />
      </Column>
    );
  }
  return (
    <Column width={width} gap={gap}>
      {status}
      {body}
      <ContentCard width={width} padding={10 * ui} gap={6 * ui}>
        <TextBlock text="LOCAL ADDRESSES" fontSize={10} color={palette.muted} />
        {props.addresses.length ? (
          props.addresses.map((entry) => (
            <TextBlock
              key={entry.name}
              width={Math.max(0, width - 20 * ui)}
              text={`${entry.name}: ${entry.addresses.join(", ") || "No local address"}`}
              fontSize={11}
              color={palette.muted}
              wrap
            />
          ))
        ) : (
          <TextBlock text="No local address observed" fontSize={11} color={palette.muted} wrap />
        )}
      </ContentCard>
    </Column>
  );
}
export function NetworkDetailsContent(props: NetworkDetailsContentProps): ReactNode {
  return content(props, useWidgetTheme());
}
export function measureNetworkDetailsContent(
  props: NetworkDetailsContentProps,
  theme: WidgetTheme = getWidgetTheme(),
) {
  return measureColumnContent({ width: props.width, children: content(props, theme) }, theme);
}
registerIntrinsicSize(NetworkDetailsContent, (props, theme) =>
  measureNetworkDetailsContent(props, theme),
);
