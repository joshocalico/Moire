/** A row's trailing slot: quiet text normally, the row's actions while it is hovered or focused. */
import React, { useState, type ReactNode } from "react";
import { Group, type HitPointerEvent } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { useWidgetTheme } from "#ui/widget-theme";
import { Icon, type IconName } from "./icon";
import { IconButton } from "./icon-button";
import { registerIntrinsicSize } from "./layout";
import { TextBlock } from "./primitives";

export type HoverAction = {
  id: string;
  /** Tooltip. */
  label: string;
  icon: IconName;
  tone?: "danger";
  disabled?: boolean;
  /** For hosts and tests that address one row's action. */
  focusId?: string;
  onPress?: (event?: HitPointerEvent) => void;
};

export type HoverActionsProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  /** The row is hovered or holds focus. */
  active: boolean;
  /** Shown while inactive, end-aligned, e.g. a date. */
  trailing?: string;
  actions: readonly HoverAction[];
  onAction?: (action: HoverAction, event?: HitPointerEvent) => void;
  /** The pointer is over one of the actions, which takes hover from the row beneath. */
  onHoverChange?: (hovered: boolean) => void;
  /** Side of each button; 32 by default (never taller than the slot). */
  buttonSize?: number;
};

const BUTTON = 32;
const GAP = 4;

/** Width the actions need, for sizing the slot. */
export function hoverActionsWidth(count: number, buttonSize?: number): number {
  const ui = getUiScaleFactor();
  const size = buttonSize ?? BUTTON * ui;
  return count * size + Math.max(0, count - 1) * GAP * ui;
}

/**
 * The actions stay up while the pointer or keyboard focus is on one of them, even though that
 * moves hover and focus off the row, so Tab can reach them and the pointer can press them.
 */
export function HoverActions(props: HoverActionsProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const ui = getUiScaleFactor();
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const shown = props.active || hovered !== null || focused !== null;
  const size = Math.min(props.height, props.buttonSize ?? BUTTON * ui);
  const gap = GAP * ui;
  const start = props.width - hoverActionsWidth(props.actions.length, size);
  const track =
    (set: typeof setHovered, id: string, notify?: (on: boolean) => void) => (on: boolean) => {
      set((current) => (on ? id : current === id ? null : current));
      notify?.(on);
    };
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height}>
      {shown ? (
        props.actions.map((action, index) => (
          <IconButton
            key={action.id}
            x={start + index * (size + gap)}
            y={Math.round((props.height - size) / 2)}
            width={size}
            height={size}
            variant="ghost"
            size="small"
            tooltip={action.label}
            focusId={action.focusId}
            disabled={action.disabled}
            color={action.tone === "danger" ? pal.danger : undefined}
            icon={(style) => (
              <Icon name={action.icon} size={16 * ui} color={style.color} symbolic />
            )}
            onHoverChange={track(setHovered, action.id, props.onHoverChange)}
            onFocusChange={track(setFocused, action.id)}
            onPress={(event) => {
              action.onPress?.(event);
              props.onAction?.(action, event);
            }}
          />
        ))
      ) : props.trailing ? (
        <TextBlock
          width={props.width}
          height={props.height}
          text={props.trailing}
          color={pal.muted}
          fontSize={12}
          horizontalAlign="end"
          verticalAlign="center"
          overflow="ellipsis"
          maxLines={1}
        />
      ) : null}
    </Group>
  );
}

registerIntrinsicSize(HoverActions, (props) => ({ width: props.width, height: props.height }));
