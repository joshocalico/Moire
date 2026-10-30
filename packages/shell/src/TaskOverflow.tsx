/** Hidden task entries use current metadata. The shell owns capture/retirement and actual activation. */
import React, { useState, type ReactNode } from "react";
import {
  Box,
  Button,
  Column,
  Horizontal,
  TextBlock,
  IconButton,
  Icon,
  CollectionList,
  CollectionRow,
  applicationIcon,
  Pressable,
  Tooltip,
  getUiScaleFactor,
  measureColumnContent,
  useWidgetTheme,
  type WidgetTheme,
} from "@moire/ui";
import { DesktopPopup, desktopPopupGeometry, type PopupAnchor } from "./QuickSettings";
import type { TaskWindowInfo } from "./ssd";

export const TASK_WINDOWS_SCOPE = "task-windows";
export type TaskOverflowProps = {
  open: boolean;
  screenW: number;
  screenH: number;
  anchor: PopupAnchor;
  tasks: readonly TaskWindowInfo[];
  onTaskPress(task: TaskWindowInfo): void;
  onDismiss(): void;
  /** Heading: the app's name for one app's windows, "Windows" for hidden ones. */
  title?: string;
  /** Close one window from its row. */
  onTaskClose?(task: TaskWindowInfo): void;
  /** Close every listed window. */
  onCloseAll?(): void;
};
const taskKey = (task: TaskWindowInfo) => `${task.clientId}:${task.surfaceId}`;
function header(width: number, onDismiss: () => void, title = "Windows"): ReactNode {
  const ui = getUiScaleFactor();
  return (
    <Horizontal width={width} gap={8 * ui} align="center">
      <TextBlock flexGrow={1} text={title} fontSize={18} fontWeight="medium" />
      <IconButton
        width={30 * ui}
        height={30 * ui}
        icon={<Icon name="close" size={16 * ui} />}
        variant="ghost"
        tooltip="Close window list"
        focusId={`${TASK_WINDOWS_SCOPE}:close`}
        onPress={onDismiss}
      />
    </Horizontal>
  );
}
export function measureTaskOverflow(
  width: number,
  tasks: readonly TaskWindowInfo[],
  theme: WidgetTheme,
  closeAll = false,
) {
  const ui = getUiScaleFactor(),
    padding = 12 * ui,
    gap = 8 * ui;
  const headerHeight = measureColumnContent(
    {
      width: Math.max(0, width - padding * 2),
      children: header(Math.max(0, width - padding * 2), () => {}),
    },
    theme,
  ).height;
  const rowHeight = 64 * ui;
  const footerHeight = closeAll ? 36 * ui + gap : 0;
  return {
    padding,
    gap,
    headerHeight,
    rowHeight,
    footerHeight,
    height:
      padding * 2 +
      headerHeight +
      gap +
      Math.max(rowHeight, tasks.length * rowHeight) +
      footerHeight,
  };
}
/** Static popup over the shared virtual collection, with keyboard/scroll reveal and immediate row activation. */
export function TaskOverflow(props: TaskOverflowProps): ReactNode {
  const theme = useWidgetTheme();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  if (!props.open) return null;
  const width = desktopPopupGeometry(props.screenW, props.screenH, props.anchor, 0).width;
  const closeAll = !!props.onCloseAll && props.tasks.length > 1;
  const metrics = measureTaskOverflow(width, props.tasks, theme, closeAll);
  const geometry = desktopPopupGeometry(props.screenW, props.screenH, props.anchor, metrics.height);
  const inner = Math.max(0, width - metrics.padding * 2);
  const selected = props.tasks.some((task) => taskKey(task) === selectedKey)
    ? selectedKey
    : props.tasks[0]
      ? taskKey(props.tasks[0])
      : null;
  const listHeight = Math.max(
    1,
    geometry.height -
      metrics.padding * 2 -
      metrics.headerHeight -
      metrics.gap -
      metrics.footerHeight,
  );
  const ui = getUiScaleFactor();
  const closeSize = 30 * ui;
  return (
    <DesktopPopup {...props} naturalHeight={metrics.height} scope={TASK_WINDOWS_SCOPE}>
      <Column width={width} height={geometry.height} padding={metrics.padding} gap={metrics.gap}>
        {header(inner, props.onDismiss, props.title)}
        <CollectionList
          width={inner}
          height={listHeight}
          items={props.tasks}
          getKey={taskKey}
          rowHeight={metrics.rowHeight}
          selectedKey={selected}
          onSelect={(task) => setSelectedKey(taskKey(task))}
          onActivate={props.onTaskPress}
          onDelete={props.onTaskClose}
          focusId={`${TASK_WINDOWS_SCOPE}:list`}
          autoFocus
          emptyMessage="No hidden windows"
          renderItem={(task, row) => (
            <Horizontal width={row.width} height={row.height} gap={4 * ui} align="center">
              <Pressable
                width={props.onTaskClose ? row.width - closeSize - 4 * ui : row.width}
                height={row.height}
                focusable={false}
                focusId={`${TASK_WINDOWS_SCOPE}:row:${taskKey(task)}`}
                fill={0x00000000}
                hoverFill={theme.foundations.palette.hover}
                onPress={() => props.onTaskPress(task)}
              >
                <CollectionRow
                  {...row}
                  width={props.onTaskClose ? row.width - closeSize - 4 * ui : row.width}
                  title={task.title || task.appId || "Window"}
                  subtitle={`${task.appId || "Application"}${task.minimized ? " · Minimized" : ""}`}
                  leading={
                    <Icon
                      name={applicationIcon(task.appId || task.title)}
                      path={task.iconPath}
                      symbolic={!task.iconPath}
                      size={28 * getUiScaleFactor()}
                    />
                  }
                />
              </Pressable>
              {props.onTaskClose ? (
                // Pointer-only: keyboard users close the selected window with Delete.
                <Tooltip width={closeSize} height={closeSize} label="Close window" placement="top">
                  <Pressable
                    width={closeSize}
                    height={closeSize}
                    focusable={false}
                    fill={0x00000000}
                    hoverFill={theme.foundations.palette.hover}
                    radius={closeSize / 2}
                    onPress={() => props.onTaskClose?.(task)}
                  >
                    <Icon
                      x={(closeSize - 14 * ui) / 2}
                      y={(closeSize - 14 * ui) / 2}
                      name="close"
                      size={14 * ui}
                      color={theme.foundations.palette.muted}
                      symbolic
                    />
                  </Pressable>
                </Tooltip>
              ) : null}
            </Horizontal>
          )}
        />
        {closeAll ? (
          <Horizontal width={inner} height={36 * ui} align="center">
            <Box flexGrow={1} height={1} />
            <Button
              height={32 * ui}
              variant="secondary"
              label={`Close all ${props.tasks.length} windows`}
              focusId={`${TASK_WINDOWS_SCOPE}:close-all`}
              onPress={props.onCloseAll}
            />
          </Horizontal>
        ) : null}
      </Column>
    </DesktopPopup>
  );
}
