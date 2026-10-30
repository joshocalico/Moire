/** Floating bar of actions for the current selection. */
import React, { useRef, useState, type ReactNode } from "react";
import { Group, measureTextBounds, type SceneNode } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { useWidgetTheme } from "#ui/widget-theme";
import { AnchoredMenu } from "./anchored-menu";
import { Button } from "./button";
import { CountBubble, countBubbleWidth } from "./count-bubble";
import { Entrance } from "./entrance";
import { Icon, type IconName } from "./icon";
import { IconButton } from "./icon-button";
import { registerIntrinsicSize } from "./layout";
import { Surface, TextBlock } from "./primitives";

export type SelectionBarAction = {
  id: string;
  label: string;
  icon: IconName;
  tone?: "danger";
  disabled?: boolean;
  onPress?: () => void;
};

export type SelectionBarProps = {
  x?: number;
  y?: number;
  /** Room available; the bar takes what it needs, up to `maxWidth`, centred in it. */
  width: number;
  maxWidth?: number;
  count: number;
  /** After the count, e.g. "selected · 4.4 MB". */
  detail?: string;
  /** In order of importance: the first is emphasised, and the last ones move to ⋯ first. */
  actions: readonly SelectionBarAction[];
  onAction?: (action: SelectionBarAction) => void;
  moreLabel?: string;
};

const BAR_H = 44;
const PAD = 6;
const BUBBLE = 28;
const BUBBLE_TEXT = 13;
const ACTION_H = 32;
const ACTION_GAP = 4;
const ACTION_ICON = 14;
const ACTION_ICON_GAP = 6;
const ACTION_PAD_X = 12;
const LABEL_SIZE = 12;
const DETAIL_SIZE = 12;
const MIN_DETAIL = 72;
const MAX_WIDTH = 640;

/** The bar's height, for padding the content it floats over so the last rows stay reachable. */
export function selectionBarHeight(): number {
  return Math.round(BAR_H * getUiScaleFactor());
}

function actionWidth(action: SelectionBarAction, ui: number): number {
  const label = measureTextBounds(action.label, { fontSize: LABEL_SIZE, fontWeight: "medium" });
  return Math.ceil(label.width + (ACTION_PAD_X * 2 + ACTION_ICON + ACTION_ICON_GAP) * ui);
}

type BarLayout = {
  width: number;
  bubbleWidth: number;
  detailWidth: number;
  shown: { action: SelectionBarAction; width: number }[];
  hidden: SelectionBarAction[];
};

/** Which actions fit beside the count and detail; the rest go to ⋯. */
function layoutBar(props: SelectionBarProps): BarLayout {
  const ui = getUiScaleFactor();
  const maxWidth = Math.min(props.width, props.maxWidth ?? MAX_WIDTH * ui);
  const bubbleWidth = countBubbleWidth(String(props.count), BUBBLE * ui, BUBBLE_TEXT);
  const fixed = bubbleWidth + (PAD + 2 + 8 + 8 + PAD) * ui;
  const detail = props.detail
    ? Math.ceil(measureTextBounds(props.detail, { fontSize: DETAIL_SIZE }).width)
    : 0;
  const widths = props.actions.map((action) => actionWidth(action, ui) + ACTION_GAP * ui);
  const all = widths.reduce((sum, width) => sum + width, 0);
  if (fixed + detail + all <= maxWidth) {
    return {
      width: fixed + detail + all,
      bubbleWidth,
      detailWidth: detail,
      shown: props.actions.map((action, index) => ({ action, width: widths[index]! })),
      hidden: [],
    };
  }
  const more = (ACTION_H + ACTION_GAP) * ui;
  const room = maxWidth - fixed - Math.min(detail, MIN_DETAIL * ui) - more;
  let used = 0,
    count = 0;
  while (count < props.actions.length && used + widths[count]! <= room) used += widths[count++]!;
  const detailWidth = Math.max(0, Math.min(detail, maxWidth - fixed - used - more));
  return {
    width: fixed + detailWidth + used + more,
    bubbleWidth,
    detailWidth,
    shown: props.actions
      .slice(0, count)
      .map((action, index) => ({ action, width: widths[index]! })),
    hidden: props.actions.slice(count),
  };
}

/**
 * Count, detail and actions for a selection, rising into place when it appears (settled at once
 * with reduced motion). Actions that don't fit the width move into a ⋯ menu.
 */
export function SelectionBar(props: SelectionBarProps): ReactNode {
  const theme = useWidgetTheme();
  const pal = theme.foundations.palette;
  const ui = getUiScaleFactor();
  const [menuOpen, setMenuOpen] = useState(false);
  const moreNode = useRef<SceneNode | null>(null);
  const layout = layoutBar(props);
  const height = selectionBarHeight();
  const actionH = ACTION_H * ui;
  const actionY = Math.round((height - actionH) / 2);
  const bubble = BUBBLE * ui;
  const run = (action: SelectionBarAction) => {
    action.onPress?.();
    props.onAction?.(action);
  };
  let x = (PAD + 2 + 8) * ui + layout.bubbleWidth;
  const detailX = x;
  x += layout.detailWidth + 8 * ui;
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={height}>
      <Entrance
        x={Math.round((props.width - layout.width) / 2)}
        width={layout.width}
        height={height}
        rise={10 * ui}
      >
        <Surface
          width={layout.width}
          height={height}
          fill={pal.overlay}
          radius={12 * ui}
          stroke={pal.border}
          strokeWidth={theme.foundations.borders.hairline}
          elevation="medium"
        >
          <CountBubble
            x={(PAD + 2) * ui}
            y={Math.round((height - bubble) / 2)}
            text={String(props.count)}
            size={bubble}
            fontSize={BUBBLE_TEXT}
          />
          {layout.detailWidth > 0 && props.detail ? (
            <TextBlock
              x={detailX}
              width={layout.detailWidth}
              height={height}
              text={props.detail}
              color={pal.muted}
              fontSize={DETAIL_SIZE}
              verticalAlign="center"
              overflow="ellipsis"
              maxLines={1}
            />
          ) : null}
          {layout.shown.map(({ action, width }, index) => {
            const at = x;
            x += width;
            return (
              <Button
                key={action.id}
                x={at}
                y={actionY}
                width={width - ACTION_GAP * ui}
                height={actionH}
                size="small"
                variant={index === 0 ? "secondary" : "ghost"}
                color={action.tone === "danger" ? pal.danger : undefined}
                label={action.label}
                disabled={action.disabled}
                leadingIcon={(style) => (
                  <Icon name={action.icon} size={style.size} color={style.color} symbolic />
                )}
                onPress={() => run(action)}
              />
            );
          })}
          {layout.hidden.length ? (
            <Group ref={moreNode} x={x} y={actionY} width={actionH} height={actionH}>
              <IconButton
                width={actionH}
                height={actionH}
                variant="ghost"
                tooltip={props.moreLabel ?? "More actions"}
                tooltipPlacement="top"
                icon={(style) => <Icon name="more" size={16 * ui} color={style.color} symbolic />}
                onPress={() => setMenuOpen(true)}
              />
              <AnchoredMenu
                open={menuOpen}
                anchor={moreNode.current}
                anchorWidth={actionH}
                anchorHeight={actionH}
                align="end"
                side="above"
                actions={layout.hidden.map((action) => ({
                  id: action.id,
                  label: action.label,
                  icon: action.icon,
                  danger: action.tone === "danger",
                  disabled: action.disabled,
                  onPress: () => run(action),
                }))}
                onDismiss={() => setMenuOpen(false)}
              />
            </Group>
          ) : null}
        </Surface>
      </Entrance>
    </Group>
  );
}

registerIntrinsicSize(SelectionBar, (props) => ({
  width: props.width,
  height: selectionBarHeight(),
}));
