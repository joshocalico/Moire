/** Hidden task entries use current metadata. The shell owns capture/retirement and actual activation. */
import React, { useState, type ReactNode } from "react";
import {
  Column,
  Horizontal,
  TextBlock,
  IconButton,
  Icon,
  CollectionList,
  CollectionRow,
  applicationIcon,
  Pressable,
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
};
const taskKey = (task: TaskWindowInfo) => `${task.clientId}:${task.surfaceId}`;
function header(width: number, onDismiss: () => void): ReactNode {
  const ui = getUiScaleFactor();
  return (
    <Horizontal width={width} gap={8 * ui} align="center">
      <TextBlock flexGrow={1} text="Windows" fontSize={18} fontWeight="medium" />
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
  return {
    padding,
    gap,
    headerHeight,
    rowHeight,
    height: padding * 2 + headerHeight + gap + Math.max(rowHeight, tasks.length * rowHeight),
  };
}
/** Static popup over the shared virtual collection, with keyboard/scroll reveal and immediate row activation. */
export function TaskOverflow(props: TaskOverflowProps): ReactNode {
  const theme = useWidgetTheme();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  if (!props.open) return null;
  const width = desktopPopupGeometry(props.screenW, props.screenH, props.anchor, 0).width;
  const metrics = measureTaskOverflow(width, props.tasks, theme);
  const geometry = desktopPopupGeometry(props.screenW, props.screenH, props.anchor, metrics.height);
  const inner = Math.max(0, width - metrics.padding * 2);
  const selected = props.tasks.some((task) => taskKey(task) === selectedKey)
    ? selectedKey
    : props.tasks[0]
      ? taskKey(props.tasks[0])
      : null;
  const listHeight = Math.max(
    1,
    geometry.height - metrics.padding * 2 - metrics.headerHeight - metrics.gap,
  );
  return (
    <DesktopPopup {...props} naturalHeight={metrics.height} scope={TASK_WINDOWS_SCOPE}>
      <Column width={width} height={geometry.height} padding={metrics.padding} gap={metrics.gap}>
        {header(inner, props.onDismiss)}
        <CollectionList
          width={inner}
          height={listHeight}
          items={props.tasks}
          getKey={taskKey}
          rowHeight={metrics.rowHeight}
          selectedKey={selected}
          onSelect={(task) => setSelectedKey(taskKey(task))}
          onActivate={props.onTaskPress}
          focusId={`${TASK_WINDOWS_SCOPE}:list`}
          autoFocus
          emptyMessage="No hidden windows"
          renderItem={(task, row) => (
            <Pressable
              width={row.width}
              height={row.height}
              focusable={false}
              focusId={`${TASK_WINDOWS_SCOPE}:row:${taskKey(task)}`}
              fill={0x00000000}
              hoverFill={theme.foundations.palette.hover}
              onPress={() => props.onTaskPress(task)}
            >
              <CollectionRow
                {...row}
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
          )}
        />
      </Column>
    </DesktopPopup>
  );
}
