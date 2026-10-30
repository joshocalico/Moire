import React, { type ReactNode } from "react";
import { Group, type HitRegion } from "@moire/react-host";
import {
  Box,
  Column,
  Horizontal,
  Icon,
  IconButton,
  Surface,
  TextBlock,
  applicationIcon,
  measureWrappedText,
  ScrollArea,
  FocusScope,
  getUiScaleFactor,
  Entrance,
  useWidgetTheme,
  OverlayHost,
} from "@moire/ui";
import { panelGeometry } from "@moire/theme";
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
export type PopupAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};
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
/** Placement for the shell popups that rise out of the panel (Quick Settings, notifications, hidden windows). */
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
    // Tooltips inside the popup paint in this host's top layer, above the popup's later rows,
    // and stay above the panel.
    <OverlayHost width={props.screenW} height={geometry.panel.y}>
      <Group width={props.screenW} height={geometry.panel.y} onPress={props.onDismiss} />
      {/* Rises out of the panel it belongs to; reduced motion opens settled. */}
      <Entrance
        x={geometry.x}
        y={geometry.y}
        width={geometry.width}
        height={geometry.height}
        rise={8 * getUiScaleFactor()}
      >
        <Surface
          width={geometry.width}
          height={geometry.height}
          fill={palette.panel}
          radius={16 * getUiScaleFactor()}
          stroke={palette.borderSubtle}
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
      </Entrance>
    </OverlayHost>
  );
}
export type QuickSettingsProps = Omit<
  QuickSettingsContentProps,
  "width" | "onNetworkOpen" | "onAudioOpen" | "onBluetoothOpen" | "onPowerOpen" | "onBatteryOpen"
> &
  Pick<
    QuickSettingsDetailsProps,
    | "onLogout"
    | "onLock"
    | "onPowerAction"
    | "powerConfirm"
    | "onPowerConfirm"
    | "onPowerCancel"
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
  const frameInset = Math.min(16 * getUiScaleFactor(), geometry.height / 2);
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

/** The newest open notice whose app allows banners; the rest wait in the tray. */
export function bannerNotice<Notice extends { closed: boolean; banner?: boolean }>(
  notices: readonly Notice[],
): Notice | null {
  return notices.find((item) => !item.closed && item.banner !== false) ?? null;
}

export function NotificationBanner(props: {
  screenW: number;
  state: DesktopStatusState;
  onDismiss(id: number, revision: number): void;
}): ReactNode {
  const theme = useWidgetTheme();
  if (props.state.kind !== "ready" || props.state.snapshot.doNotDisturb) return null;
  const notice = bannerNotice(props.state.snapshot.notices);
  if (!notice) return null;
  const palette = theme.foundations.palette;
  const ui = getUiScaleFactor();
  const pad = 14 * ui;
  const iconSize = 20 * ui;
  const width = Math.min(360 * ui, Math.max(0, props.screenW - 24 * ui));
  const textWidth = Math.max(0, width - pad * 2 - iconSize - 12 * ui);
  const summaryHeight = notice.summary
    ? measureWrappedText(notice.summary, textWidth, {
        fontSize: 14,
        fontWeight: "medium",
      }).lineHeight
    : 0;
  const body = notice.body
    ? measureWrappedText(notice.body, textWidth, { fontSize: 12 })
    : { lines: [], lineHeight: 0 };
  const bodyHeight = Math.min(2, body.lines.length) * body.lineHeight;
  const headerHeight = 24 * ui;
  const height =
    pad * 2 +
    headerHeight +
    (summaryHeight ? 6 * ui + summaryHeight : 0) +
    (bodyHeight ? 4 * ui + bodyHeight : 0);
  const x = props.screenW - width - 12 * ui;
  return (
    // Keyed per notice, so each new one drops in from the top edge.
    <Entrance
      key={`${notice.id}:${notice.revision}`}
      x={x}
      y={12 * ui}
      width={width}
      height={height}
      rise={-10 * ui}
    >
      <Surface
        width={width}
        height={height}
        fill={palette.panel}
        stroke={palette.borderSubtle}
        strokeWidth={1}
        radius={14 * ui}
        elevation="high"
      >
        <Horizontal x={pad} y={pad} width={width - pad * 2} gap={12 * ui} align="start">
          <Box width={iconSize} height={headerHeight} flexShrink={0}>
            <Icon
              y={(headerHeight - iconSize) / 2}
              symbolic
              name={applicationIcon(notice.appName)}
              size={iconSize}
              color={palette.accent}
            />
          </Box>
          <Column width={textWidth} gap={0}>
            <Horizontal width={textWidth} height={headerHeight} align="center" gap={8 * ui}>
              <TextBlock
                flexGrow={1}
                text={notice.appName || "Application"}
                color={palette.muted}
                fontSize={12}
                overflow="ellipsis"
                maxLines={1}
              />
              <IconButton
                icon={(style) => <Icon name="close" {...style} />}
                variant="ghost"
                size="small"
                tooltip="Dismiss notification"
                focusId={`notice:close:${notice.id}:${notice.revision}`}
                onPress={() => props.onDismiss(notice.id, notice.revision)}
              />
            </Horizontal>
            {summaryHeight ? (
              <Box width={textWidth} height={6 * ui + summaryHeight}>
                <TextBlock
                  y={6 * ui}
                  width={textWidth}
                  text={notice.summary}
                  fontSize={14}
                  fontWeight="medium"
                  overflow="ellipsis"
                  maxLines={1}
                />
              </Box>
            ) : null}
            {bodyHeight ? (
              <Box width={textWidth} height={4 * ui + bodyHeight}>
                <TextBlock
                  y={4 * ui}
                  width={textWidth}
                  text={notice.body}
                  fontSize={12}
                  color={palette.muted}
                  wrap
                  maxLines={2}
                  overflow="ellipsis"
                />
              </Box>
            ) : null}
          </Column>
        </Horizontal>
      </Surface>
    </Entrance>
  );
}
