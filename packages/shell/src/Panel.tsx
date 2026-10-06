import React, { type ReactNode } from "react";
import { Group, Rect, Text, measureText, measureTextBounds } from "@moire/react-host";
import { themePalette, getTheme, panelGeometry, hexToArgb } from "@moire/theme";
import { Button, Icon, Label, Pressable, applicationIcon } from "./widgets";
import type { TaskWindowInfo } from "./ssd";
import type {
  DesktopStatusState,
  DesktopCapabilities,
} from "@moire/system-management/desktop-status";
import { Tooltip } from "@moire/ui";
import { networkPresentation, type NetworkPresentation } from "./network-presentation";

import { batteryPresentation } from "./battery-presentation";

export type PanelProps = {
  screenW: number;
  screenH: number;
  clock?: string;
  onLauncherClick?: () => void;
  tasks?: TaskWindowInfo[];
  onTaskPress?: (task: TaskWindowInfo) => void;
  onControlsClick?: () => void;
  notificationCount?: number;
  onNotificationsClick?: () => void;
  status?: DesktopStatusState;
  cachedCapabilities?: DesktopCapabilities;
  cachedNetworkPresentation?: NetworkPresentation;
  onTaskOverflowClick?: (anchor: PanelAnchorBounds, hiddenTasks: readonly TaskWindowInfo[]) => void;
};

/** Default metric; live chrome reads themePalette().panelHeight. */
export const PANEL_H = 48;

export type PanelAnchorBounds = { x: number; y: number; width: number; height: number };

/** One geometry authority for painted controls and popup anchors (absolute output coordinates). */
export function panelStatusGeometry(
  props: Pick<
    PanelProps,
    | "screenW"
    | "screenH"
    | "clock"
    | "onControlsClick"
    | "onNotificationsClick"
    | "notificationCount"
    | "onTaskOverflowClick"
    | "status"
    | "cachedCapabilities"
  > & { taskCount?: number },
) {
  const panel = panelGeometry(props.screenW, props.screenH);
  const compact = panel.width < 560;
  const margin = Math.min(8, panel.width / 4);
  const launcherX = compact ? margin : 92;
  const launcherW = compact ? Math.min(64, panel.width / 4) : 72;
  const taskX = compact ? launcherX + launcherW + 8 : 172;
  const taskH = Math.min(32, panel.height);
  const y = panel.y + Math.floor((panel.height - taskH) / 2);
  const gap = 6;
  const clockNatural = measureTextBounds(props.clock ?? "", { fontSize: 12 }).width + 20;
  const clockPreferredW = Math.min(
    clockNatural,
    compact ? Math.max(0, panel.width * 0.23) : panel.width,
  );
  const count =
    props.notificationCount && props.notificationCount > 0 ? String(props.notificationCount) : "";
  const notificationsW = props.onNotificationsClick
    ? Math.min(34 + measureTextBounds(count, { fontSize: 11 }).width, Math.max(0, panel.width / 3))
    : 0;
  const taskCount = props.taskCount ?? 0;
  const overflowW =
    props.onTaskOverflowClick && taskCount > 0
      ? Math.max(32, measureTextBounds(`+${taskCount}`, { fontSize: 11 }).width + 12)
      : 0;
  const capabilities =
    props.status?.kind === "ready" ? props.status.snapshot.capabilities : props.cachedCapabilities;
  const battery = batteryPresentation(
    props.status?.kind === "ready" ? props.status.snapshot.battery : undefined,
    capabilities?.battery,
  );
  const iconCount = 1 + (capabilities?.audio ? 1 : 0) + (battery.supported ? 1 : 0);
  const controlsNaturalW = 18 + iconCount * 18 + (iconCount - 1) * 8;
  // The mandatory Network control stays readable even when overflow/counts crowd a compact panel.
  // Clock text yields first; its existing fitTitle path handles the remaining allocation.
  const clockBudget = Math.max(
    0,
    panel.width -
      margin -
      taskX -
      notificationsW -
      (overflowW ? overflowW + gap : 0) -
      gap * ((props.onControlsClick ? 1 : 0) + (props.onNotificationsClick ? 1 : 0)) -
      (props.onControlsClick ? 36 : 0),
  );
  const clockW = compact ? Math.min(clockPreferredW, clockBudget) : clockPreferredW;
  const available = Math.max(
    0,
    panel.width -
      margin -
      taskX -
      clockW -
      notificationsW -
      (overflowW ? overflowW + gap : 0) -
      gap * ((props.onControlsClick ? 1 : 0) + (props.onNotificationsClick ? 1 : 0)),
  );
  const controlsW = props.onControlsClick ? Math.min(controlsNaturalW, available) : 0;
  let right = panel.x + panel.width - margin;
  const clock = { x: right - clockW, y: panel.y, width: clockW, height: panel.height };
  right = clock.x;
  const notifications = props.onNotificationsClick
    ? { x: right - gap - notificationsW, y, width: notificationsW, height: taskH }
    : null;
  if (notifications) right = notifications.x;
  const controls = props.onControlsClick
    ? { x: right - gap - controlsW, y, width: controlsW, height: taskH }
    : null;
  if (controls) right = controls.x;
  const taskAreaW = Math.max(0, right - gap - panel.x - taskX);
  const capacity = Math.max(0, Math.floor((taskAreaW + gap) / (30 + gap)));
  const hidden = !!props.onTaskOverflowClick && taskCount > capacity;
  const visibleTaskCount = hidden
    ? Math.max(0, Math.floor((taskAreaW - overflowW) / (30 + gap)))
    : Math.min(taskCount, capacity);
  const overflow = hidden
    ? { x: panel.x + taskX + taskAreaW - overflowW, y, width: overflowW, height: taskH }
    : null;
  return {
    panel,
    clock,
    controls,
    notifications,
    compact,
    launcherX,
    launcherW,
    taskX,
    taskAreaW,
    taskH,
    overflow,
    visibleTaskCount,
  };
}

/** Bottom panel — task activation, distinct system controls, notification bell and clock. */
export function Panel(props: PanelProps): ReactNode {
  const pal = themePalette();
  const family = getTheme().family;
  const geometry = panelStatusGeometry({ ...props, taskCount: props.tasks?.length ?? 0 });
  const { x: panelX, y, width: panelW, height: panelH, radius } = geometry.panel;
  const { taskX, taskAreaW, taskH } = geometry;
  const clock = props.clock ?? "";
  const brandSize = 20;
  const allTasks = props.tasks ?? [];
  const taskGap = 6;
  const tasks = allTasks.slice(0, geometry.visibleTaskCount);
  const hiddenTasks = allTasks.slice(geometry.visibleTaskCount);
  const paintedTaskAreaW = Math.max(
    0,
    taskAreaW - (geometry.overflow ? geometry.overflow.width + taskGap : 0),
  );
  const taskW =
    tasks.length > 0
      ? Math.min(180, Math.floor((paintedTaskAreaW - taskGap * (tasks.length - 1)) / tasks.length))
      : 0;
  const taskY = Math.floor((panelH - taskH) / 2);
  const taskTextH = measureTextBounds("Mg", { fontSize: 12 }).height;
  // The compositor supplies a live blurred backdrop; keep this tint translucent.
  const panelFill = hexToArgb(getTheme().tokens.panel, 0xa0);
  return (
    <Group x={panelX} y={y} width={panelW} height={panelH}>
      <Rect
        x={0}
        y={0}
        width={panelW}
        height={panelH}
        fill={panelFill}
        radius={radius}
        stroke={pal.rimLight}
        strokeWidth={1}
      />
      {!geometry.compact ? (
        <Label
          x={18}
          y={Math.floor((panelH - brandSize) / 2) - 1}
          text={family === "moire" || !family ? "moire" : "Moire"}
          color={pal.text}
          fontSize={brandSize}
          fontWeight="medium"
        />
      ) : null}
      {geometry.compact ? (
        <Pressable
          x={geometry.launcherX}
          y={Math.floor((panelH - 30) / 2)}
          width={geometry.launcherW}
          height={30}
          fill={0x00000000}
          hoverFill={pal.hover}
          radius={pal.radiusSm}
          focusId="apps:panel"
          onPress={props.onLauncherClick}
        >
          <Text
            x={Math.max(
              0,
              (geometry.launcherW -
                measureTextBounds("Apps", { fontSize: 13, fontWeight: "medium" }).width) /
                2,
            )}
            y={Math.floor(
              (30 - measureTextBounds("Apps", { fontSize: 13, fontWeight: "medium" }).height) / 2,
            )}
            text="Apps"
            fontSize={13}
            fontWeight="medium"
            color={pal.text}
          />
        </Pressable>
      ) : (
        <Button
          x={geometry.launcherX}
          y={Math.floor((panelH - 30) / 2)}
          width={geometry.launcherW}
          height={30}
          label="Apps"
          variant="ghost"
          fontSize={13}
          onPress={props.onLauncherClick}
        />
      )}
      {tasks.map((task, index) => {
        const x = taskX + index * (taskW + taskGap);
        const showLabel = taskW >= 86;
        const iconSize = 20;
        const iconX = showLabel ? 8 : Math.floor((taskW - iconSize) / 2);
        const label = truncate(task.title || task.appId || "Window", 22);
        return (
          <Pressable
            key={`${task.clientId}:${task.surfaceId}`}
            x={x}
            y={taskY}
            width={taskW}
            height={taskH}
            fill={task.focused ? pal.selection : task.minimized ? 0x00000000 : pal.surface}
            radius={family === "gnomish" ? 12 : pal.radiusSm}
            stroke={task.focused ? pal.accentLine : pal.borderSubtle}
            strokeWidth={1}
            indicatorColor={task.focused ? pal.accentLine : undefined}
            onPress={() => props.onTaskPress?.(task)}
          >
            <Icon
              x={iconX}
              y={Math.floor((taskH - iconSize) / 2)}
              name={applicationIcon(task.appId || task.title)}
              symbolic={!task.iconPath}
              path={task.iconPath}
              size={iconSize}
              color={task.minimized ? pal.muted : pal.text}
            />
            {showLabel ? (
              <Text
                x={36}
                y={Math.floor((taskH - taskTextH) / 2)}
                text={fitTitle(label, Math.max(0, taskW - 44))}
                color={task.minimized ? pal.muted : pal.text}
                fontSize={12}
              />
            ) : null}
            {task.minimized ? (
              <Rect
                x={8}
                y={taskH - 3}
                width={Math.max(8, taskW - 16)}
                height={1}
                fill={pal.muted}
              />
            ) : null}
          </Pressable>
        );
      })}
      {geometry.overflow ? (
        <Group
          x={geometry.overflow.x - panelX}
          y={geometry.overflow.y - y}
          width={geometry.overflow.width}
          height={taskH}
        >
          <Tooltip
            width={geometry.overflow.width}
            height={taskH}
            label={`${hiddenTasks.length} hidden windows`}
          >
            <Pressable
              width={geometry.overflow.width}
              height={taskH}
              fill={pal.surface}
              hoverFill={pal.hover}
              radius={pal.radiusSm}
              focusId="panel:windows"
              onPress={() => props.onTaskOverflowClick?.(geometry.overflow!, hiddenTasks)}
            >
              <Text
                x={
                  (geometry.overflow.width -
                    measureTextBounds(`+${hiddenTasks.length}`, { fontSize: 11 }).width) /
                  2
                }
                y={(taskH - measureTextBounds("Mg", { fontSize: 11 }).height) / 2}
                text={`+${hiddenTasks.length}`}
                fontSize={11}
                color={pal.text}
              />
            </Pressable>
          </Tooltip>
        </Group>
      ) : null}
      {geometry.controls ? (
        <Pressable
          x={geometry.controls.x - panelX}
          y={geometry.controls.y - y}
          width={geometry.controls.width}
          height={geometry.controls.height}
          fill={pal.surface}
          hoverFill={pal.hover}
          radius={pal.radiusSm}
          focusId="panel:controls"
          onPress={props.onControlsClick}
        >
          {(() => {
            const snapshot = props.status?.kind === "ready" ? props.status.snapshot : null;
            const audio = snapshot?.audio;
            const capabilities = snapshot?.capabilities ?? props.cachedCapabilities;
            const battery = batteryPresentation(snapshot?.battery, capabilities?.battery);
            const network = snapshot
              ? networkPresentation(snapshot.network, snapshot.wifi)
              : (props.cachedNetworkPresentation ?? networkPresentation([]));
            const names = [
              network.icon,
              ...(capabilities?.audio
                ? [audio?.kind === "ready" && audio.muted ? "volume-muted" : "volume"]
                : []),
              ...(battery.supported ? [battery.icon] : []),
            ].slice(0, Math.max(1, Math.floor((geometry.controls.width - 12) / 22)));
            const size = Math.min(
              18,
              Math.max(
                0,
                names.length === 1
                  ? geometry.controls.width - 4
                  : (geometry.controls.width - 12) / names.length - 4,
              ),
            );
            const step = size + 4;
            const start = (geometry.controls.width - (names.length * step - 4)) / 2;
            return names.map((name, index) => (
              <Icon
                key={`${name}:${index}`}
                name={name}
                x={start + index * step}
                y={(geometry.controls!.height - size) / 2}
                size={size}
                color={
                  name === network.icon
                    ? snapshot?.network.some((entry) => entry.addresses.length > 0)
                      ? pal.accentLine
                      : pal.muted
                    : name === battery.icon && battery.supported
                      ? battery.tone === "warning"
                        ? pal.danger
                        : battery.tone === "accent"
                          ? pal.accentLine
                          : battery.available
                            ? pal.text
                            : pal.muted
                      : audio?.kind !== "ready"
                        ? pal.muted
                        : pal.text
                }
                symbolic
              />
            ));
          })()}
        </Pressable>
      ) : null}
      {geometry.notifications ? (
        <Pressable
          x={geometry.notifications.x - panelX}
          y={geometry.notifications.y - y}
          width={geometry.notifications.width}
          height={geometry.notifications.height}
          fill={0x00000000}
          hoverFill={pal.hover}
          radius={pal.radiusSm}
          focusId="panel:notifications"
          onPress={props.onNotificationsClick}
        >
          <Icon name="bell" x={6} y={(taskH - 18) / 2} size={18} color={pal.text} symbolic />
          {props.notificationCount && props.notificationCount > 0 ? (
            <Text
              x={28}
              y={(taskH - measureTextBounds("Mg", { fontSize: 11 }).height) / 2}
              text={String(props.notificationCount)}
              fontSize={11}
              color={pal.text}
            />
          ) : null}
        </Pressable>
      ) : null}
      <Text
        x={geometry.clock.x - panelX}
        y={Math.floor((panelH - 12) / 2)}
        text={fitTitle(clock, Math.max(0, geometry.clock.width - 4))}
        color={pal.muted}
        fontSize={12}
      />
    </Group>
  );
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function fitTitle(title: string, width: number): string {
  if (measureText(title, 12 / 14) <= width) return title;
  let result = title;
  while (result.length && measureText(`${result}…`, 12 / 14) > width) result = result.slice(0, -1);
  return result ? `${result}…` : "";
}
