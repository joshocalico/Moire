import React, { type ReactNode } from "react";
import { Group, type HitRegion } from "@moire/react-host";
import {
  Button,
  Label,
  Surface,
  ScrollArea,
  FocusScope,
  getUiScaleFactor,
  useWidgetTheme,
} from "@moire/ui";
import { panelGeometry, themePalette } from "@moire/theme";
import type {
  DesktopStatusState,
  DesktopStatusClient,
} from "@moire/system-management/desktop-status";
import {
  QuickSettingsContent,
  measureQuickSettingsContent,
  type QuickSettingsContentProps,
} from "./QuickSettingsContent";
import {
  QuickSettingsDetails,
  measureQuickSettingsDetails,
  type QuickSettingsDetailsView,
  type QuickSettingsDetailsProps,
} from "./QuickSettingsDetails";
import { bluetoothInteractionScope, activeBluetoothTrust } from "./BluetoothDetailsContent";

export type DesktopControlActions = Pick<
  DesktopStatusClient,
  | "setVolume"
  | "setMute"
  | "setDoNotDisturb"
  | "dismiss"
  | "dismissMany"
  | "invokeAction"
  | "refreshWifi"
  | "connectWifi"
  | "cancelWifi"
  | "refreshBluetooth"
  | "setBluetoothConnected"
> &
  Partial<
    Pick<
      DesktopStatusClient,
      | "startBluetoothDiscovery"
      | "stopBluetoothDiscovery"
      | "beginBluetoothPair"
      | "cancelBluetoothPair"
      | "respondBluetoothPrompt"
      | "respondBluetoothInput"
      | "requestBluetoothTrust"
      | "confirmBluetoothTrust"
      | "cancelBluetoothTrust"
    >
  >;
export type PopupAnchor = { x: number; y: number; width: number; height: number };
export const QUICK_SETTINGS_SCOPE = "quick-settings";
export const NOTIFICATIONS_SCOPE = "notifications";
export function scrollQuickControlIntoView(scrollY: number, hit: HitRegion): number {
  if (!hit.pointerClip) return scrollY;
  const top = hit.pointerClip.y,
    bottom = top + hit.pointerClip.height;
  if (hit.y < top) return Math.max(0, scrollY + hit.y - top);
  if (hit.y + hit.height > bottom) return scrollY + hit.y + hit.height - bottom;
  return scrollY;
}
/** Shared static shell popup. Motion admission remains the existing renderer's responsibility. */
export function desktopPopupGeometry(
  screenW: number,
  screenH: number,
  anchor: PopupAnchor,
  naturalHeight: number,
) {
  const ui = getUiScaleFactor(),
    margin = 12 * ui;
  const panel = panelGeometry(screenW, screenH);
  const width = Math.max(0, Math.min(420 * ui, screenW - margin * 2));
  const height = Math.max(0, Math.min(Math.ceil(naturalHeight), panel.y - margin - 8 * ui));
  const x = Math.max(margin, Math.min(screenW - width - margin, anchor.x + anchor.width - width));
  const y = Math.max(margin, panel.y - height - 8 * ui);
  return { x, y, width, height, panel };
}
export function DesktopPopup(props: {
  screenW: number;
  screenH: number;
  anchor: PopupAnchor;
  naturalHeight: number;
  scope: string;
  onDismiss(): void;
  children: ReactNode;
}) {
  const theme = useWidgetTheme(),
    palette = theme.foundations.palette;
  const geometry = desktopPopupGeometry(
    props.screenW,
    props.screenH,
    props.anchor,
    props.naturalHeight,
  );
  return (
    <Group width={props.screenW} height={props.screenH}>
      <Group width={props.screenW} height={geometry.panel.y} onPress={props.onDismiss} />
      <Surface
        x={geometry.x}
        y={geometry.y}
        width={geometry.width}
        height={geometry.height}
        fill={palette.panel}
        radius={12 * getUiScaleFactor()}
        stroke={palette.accentLine}
        strokeWidth={1}
        elevation="high"
        clip
        onPress={() => {}}
      >
        <FocusScope
          id={props.scope}
          width={geometry.width}
          height={geometry.height}
          trap
          onEscape={props.onDismiss}
        >
          {props.children}
        </FocusScope>
      </Surface>
    </Group>
  );
}
export type QuickSettingsProps = Omit<
  QuickSettingsContentProps,
  "width" | "onNetworkOpen" | "onAudioOpen" | "onBluetoothOpen" | "onPowerOpen" | "onBatteryOpen"
> &
  Pick<
    QuickSettingsDetailsProps,
    | "onLogout"
    | "wifiSelection"
    | "wifiPassword"
    | "onWifiSelect"
    | "onWifiPasswordChange"
    | "onWifiConnect"
    | "onWifiCancel"
    | "onWifiRefresh"
    | "onWifiSelectionCancel"
    | "onBluetoothChange"
    | "onBluetoothRefresh"
    | "onBluetoothDiscoveryStart"
    | "onBluetoothDiscoveryStop"
    | "onBluetoothPair"
    | "onBluetoothPairCancel"
    | "onBluetoothPromptResponse"
    | "onBluetoothInputResponse"
    | "onBluetoothTrustRequest"
    | "onBluetoothTrustConfirm"
    | "onBluetoothTrustCancel"
  > & {
    open: boolean;
    screenW: number;
    screenH: number;
    anchor: PopupAnchor;
    view: "main" | QuickSettingsDetailsView;
    onViewChange(view: "main" | QuickSettingsDetailsView): void;
    scrollY: number;
    onScroll(value: number): void;
    onDismiss(): void;
  };
/** Main and disclosure views occupy one content-sized popup; notifications have a separate tray. */
export function QuickSettings(props: QuickSettingsProps): ReactNode {
  const theme = useWidgetTheme();
  if (!props.open) return null;
  const width = desktopPopupGeometry(props.screenW, props.screenH, props.anchor, 0).width;
  const contentProps: QuickSettingsContentProps = {
    ...props,
    width,
    onNetworkOpen: () => props.onViewChange("network"),
    onAudioOpen: () => props.onViewChange("audio"),
    onBluetoothOpen: () => props.onViewChange("bluetooth"),
    onPowerOpen: () => props.onViewChange("power"),
    onBatteryOpen: () => props.onViewChange("battery"),
  };
  const detailsProps = {
    ...props,
    width,
    view: props.view === "main" ? ("network" as const) : props.view,
    onBack: () => props.onViewChange("main"),
  };
  const natural =
    props.view === "main"
      ? measureQuickSettingsContent(contentProps, theme).height
      : measureQuickSettingsDetails(detailsProps, theme).height;
  const geometry = desktopPopupGeometry(props.screenW, props.screenH, props.anchor, natural);
  // Keep the scroll rail and clipped text inside the rounded frame's straight
  // edges. Translate the content back so its measured allocation is unchanged.
  const frameInset = Math.min(12 * getUiScaleFactor(), geometry.height / 2);
  const bluetooth = props.state.kind === "ready" ? props.state.snapshot.bluetooth : undefined;
  const interactionScope =
    props.view === "bluetooth" && props.state.kind === "ready"
      ? bluetoothInteractionScope(bluetooth)
      : null;
  const trust = activeBluetoothTrust(bluetooth);
  const cancelInteraction = trust
    ? () => props.onBluetoothTrustCancel?.(trust.challengeId)
    : props.onBluetoothPairCancel;
  const viewport = (
    <ScrollArea
      key={interactionScope ?? QUICK_SETTINGS_SCOPE}
      y={frameInset}
      width={width}
      height={Math.max(0, geometry.height - frameInset * 2)}
      fill={0x00000000}
      contentHeight={Math.max(0, natural - frameInset * 2)}
      smooth={false}
      scrollY={props.scrollY}
      onScroll={props.onScroll}
    >
      <Group y={-frameInset} width={width} height={natural}>
        {props.view === "main" ? (
          <QuickSettingsContent {...contentProps} />
        ) : (
          <QuickSettingsDetails {...detailsProps} />
        )}
      </Group>
    </ScrollArea>
  );
  return (
    <DesktopPopup
      screenW={props.screenW}
      screenH={props.screenH}
      anchor={props.anchor}
      naturalHeight={natural}
      scope={QUICK_SETTINGS_SCOPE}
      onDismiss={props.onDismiss}
    >
      {interactionScope ? (
        <FocusScope
          id={interactionScope}
          width={width}
          height={geometry.height}
          trap
          onEscape={cancelInteraction}
        >
          {viewport}
        </FocusScope>
      ) : (
        viewport
      )}
    </DesktopPopup>
  );
}

export function NotificationBanner(props: {
  screenW: number;
  state: DesktopStatusState;
  onDismiss(id: number, revision: number): void;
}): ReactNode {
  if (props.state.kind !== "ready" || props.state.snapshot.doNotDisturb) return null;
  const notice = props.state.snapshot.notices.find((item) => !item.closed);
  if (!notice) return null;
  const width = Math.min(360, Math.max(0, props.screenW - 24));
  const palette = themePalette();
  return (
    <Surface
      x={props.screenW - width - 12}
      y={12}
      width={width}
      height={132}
      fill={palette.panel}
      stroke={palette.borderSubtle}
      strokeWidth={1}
      radius={palette.radiusLg}
      elevation="high"
    >
      <Label
        x={16}
        y={12}
        width={width - 90}
        height={18}
        text={notice.appName || "Application"}
        color={palette.muted}
        fontSize={11}
        overflow="ellipsis"
      />
      <Label
        x={16}
        y={38}
        width={width - 32}
        height={22}
        text={notice.summary}
        fontSize={14}
        overflow="ellipsis"
      />
      <Label
        x={16}
        y={68}
        width={width - 32}
        height={48}
        text={notice.body}
        fontSize={12}
        wrap
        overflow="ellipsis"
      />
      <Button
        x={width - 74}
        y={8}
        width={62}
        height={28}
        label="Close"
        focusId={`notice:close:${notice.id}:${notice.revision}`}
        onPress={() => props.onDismiss(notice.id, notice.revision)}
      />
    </Surface>
  );
}
