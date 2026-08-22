import React, { type ReactNode } from "react";
import {
  Group,
  Rect,
  Text,
  measureText,
  measureTextBounds,
} from "@moire/react-host";
import { themePalette } from "@moire/theme";
import { Button, Icon, Label, Pressable } from "./widgets.js";
import type { TaskWindowInfo } from "./ssd.js";

export type PanelProps = {
  screenW: number;
  screenH: number;
  clock?: string;
  onLauncherClick?: () => void;
  tasks?: TaskWindowInfo[];
  onTaskPress?: (task: TaskWindowInfo) => void;
};

/** Default metric; live chrome reads themePalette().panelHeight. */
export const PANEL_H = 48;

/** Bottom panel — brand hero + quiet Apps + clock. */
export function Panel(props: PanelProps): ReactNode {
  const pal = themePalette();
  const panelH = Math.max(pal.panelHeight, 46);
  const y = props.screenH - panelH;
  const clock = props.clock ?? "";
  const clockW = measureText(clock) + 20;
  const brandSize = 26;
  const tasks = props.tasks ?? [];
  const taskX = 196;
  const taskGap = 6;
  const taskAreaW = Math.max(0, props.screenW - taskX - clockW - 16);
  const taskW =
    tasks.length > 0
      ? Math.max(
          30,
          Math.min(
            180,
            Math.floor((taskAreaW - taskGap * (tasks.length - 1)) / tasks.length),
          ),
        )
      : 0;
  const taskH = 32;
  const taskY = Math.floor((panelH - taskH) / 2);
  const taskTextH = measureTextBounds("Mg", { fontSize: 12 }).height;
  // Translucent ink panel over wallpaper
  const panelFill = (pal.panel & 0x00ffffff) | 0xb0000000;
  return (
    <Group x={0} y={y} width={props.screenW} height={panelH}>
      <Rect
        x={0}
        y={0}
        width={props.screenW}
        height={panelH}
        fill={panelFill}
      />
      <Rect
        x={0}
        y={0}
        width={props.screenW}
        height={1}
        fill={pal.rimLight}
      />
      <Rect
        x={0}
        y={panelH - 1}
        width={props.screenW}
        height={1}
        fill={pal.rimShade}
      />
      <Label
        x={18}
        y={Math.floor((panelH - brandSize) / 2) - 1}
        text="Moire"
        color={pal.text}
        fontSize={brandSize}
        fontWeight="medium"
      />
      <Button
        x={112}
        y={Math.floor((panelH - 30) / 2)}
        width={72}
        height={30}
        label="Apps"
        variant="ghost"
        fontSize={13}
        onPress={props.onLauncherClick}
      />
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
            fill={
              task.focused
                ? pal.selection
                : task.minimized
                  ? 0x00000000
                  : pal.surface
            }
            radius={pal.radiusSm}
            stroke={task.focused ? pal.accentLine : pal.borderSubtle}
            strokeWidth={task.focused ? 2 : 1}
            indicatorColor={task.focused ? pal.accentLine : undefined}
            onPress={() => props.onTaskPress?.(task)}
          >
            <Icon
              x={iconX}
              y={Math.floor((taskH - iconSize) / 2)}
              name={
                /files?|folder/i.test(`${task.appId} ${task.title}`)
                  ? "folder"
                  : "app"
              }
              path={task.iconPath}
              size={iconSize}
              color={task.minimized ? pal.muted : pal.text}
            />
            {showLabel ? (
              <Text
                x={36}
                y={Math.floor((taskH - taskTextH) / 2)}
                text={label}
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
      <Text
        x={props.screenW - clockW}
        y={Math.floor((panelH - 12) / 2)}
        text={clock}
        color={pal.muted}
        fontSize={12}
      />
    </Group>
  );
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
