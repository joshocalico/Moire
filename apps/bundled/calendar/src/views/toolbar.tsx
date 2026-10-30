/** The tool row: step back and forward, the visible month or week, and the view switch. */
import React, { type ReactNode } from "react";
import { ToolRow } from "@moire/app-tools";
import { Button, Icon, IconButton, Label, SegmentedControl, getUiScaleFactor } from "@moire/ui";
import type { ViewMode } from "#calendar/model";

const VIEW_OPTIONS = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
] as const;

export function CalendarToolbar(props: {
  width: number;
  mode: ViewMode;
  title: string;
  onStep: (offset: number) => void;
  onMode: (mode: ViewMode) => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const button = 32 * ui,
    switchW = 150 * ui;
  const unit = props.mode === "month" ? "month" : "week";
  const titleW = Math.max(1, props.width - 20 * ui - button * 2 - switchW - 24 * ui);
  const step = (offset: number, label: string, icon: "chevron-left" | "chevron-right") => (
    <IconButton
      width={button}
      height={button}
      variant="ghost"
      tooltip={`${label} ${unit} (Alt+${offset < 0 ? "Left" : "Right"})`}
      focusId={offset < 0 ? "calendar:previous" : "calendar:next"}
      icon={<Icon name={icon} size={16 * ui} symbolic />}
      onPress={() => props.onStep(offset)}
    />
  );
  return (
    <ToolRow
      width={props.width}
      end={
        <SegmentedControl
          width={switchW}
          size="small"
          options={VIEW_OPTIONS}
          value={props.mode}
          onChange={(mode) => props.onMode(mode as ViewMode)}
        />
      }
    >
      {step(-1, "Previous", "chevron-left")}
      {step(1, "Next", "chevron-right")}
      <Label
        width={titleW}
        height={button}
        text={props.title}
        fontSize={17}
        fontWeight="medium"
        verticalAlign="center"
        maxLines={1}
        overflow="ellipsis"
      />
    </ToolRow>
  );
}

/**
 * The header bar's actions. A plain function rather than a component: the header bar measures
 * its direct children, and a wrapper component would measure as empty.
 */
export function headerActions(props: {
  compact: boolean;
  canCreate: boolean;
  onToday: () => void;
  onNew: () => void;
  onMore: (at: { x: number; y: number } | null) => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  return (
    <>
      <Button label="Today" variant="ghost" onPress={props.onToday} />
      <Button
        label="New event"
        variant="primary"
        leadingIcon={
          props.compact ? undefined : (style) => <Icon name="plus" {...style} symbolic />
        }
        disabled={!props.canCreate}
        onPress={props.onNew}
      />
      <IconButton
        width={32 * ui}
        height={32 * ui}
        variant="ghost"
        tooltip="More"
        focusId="calendar:more"
        icon={<Icon name="more" size={18 * ui} symbolic />}
        onPress={(event) => props.onMore(event ? { x: event.x, y: event.y } : null)}
      />
    </>
  );
}
