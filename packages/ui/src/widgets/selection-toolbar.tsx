import React, { type ReactNode } from "react";
import { Group, Rect, Text, measureTextBounds } from "@moire/react-host";
import { Pressable } from "./pressable";
import { getUiScaleFactor } from "#ui/font";
import { useWidgetTheme } from "#ui/widget-theme";
import type { DocumentRect } from "./document-layout";

export type SelectionToolbarAction = {
  id: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onInvoke: () => void;
};
export type SelectionToolbarProps = {
  anchor: DocumentRect | null;
  width: number;
  height: number;
  actions: readonly SelectionToolbarAction[];
  scale?: number;
  gap?: number;
};
/** Clamp the floating tool to the owning pane and prefer the space above the selection. */
export function placeSelectionToolbar(
  anchor: DocumentRect,
  viewport: { width: number; height: number },
  size: { width: number; height: number },
  gap = 8,
): { x: number; y: number } {
  const margin = Math.max(
    0,
    Math.min(gap, (viewport.width - size.width) / 2, (viewport.height - size.height) / 2),
  );
  const x = Math.max(
    margin,
    Math.min(viewport.width - size.width - margin, anchor.x + anchor.width / 2 - size.width / 2),
  );
  const above = anchor.y - size.height - gap;
  const preferred = above >= margin ? above : anchor.y + anchor.height + gap;
  return { x, y: Math.max(margin, Math.min(viewport.height - size.height - margin, preferred)) };
}
/** Shared measured allocation lets an editor reserve the actual floating toolbar height. */
export function layoutSelectionToolbar(
  actions: readonly Pick<SelectionToolbarAction, "label">[],
  viewport: { width: number; height: number },
  scale = getUiScaleFactor(),
): { width: number; height: number; positions: Array<{ x: number; y: number; width: number }> } {
  const fontSize = 12,
    rowHeight = 26 * scale,
    padding = 5 * scale,
    gap = 3 * scale;
  const widths = actions.map((action) =>
    Math.max(
      30 * scale,
      measureTextBounds(action.label, { fontSize, fontWeight: "medium" }).width + 18 * scale,
    ),
  );
  const available = Math.max(1, viewport.width - 16 * scale);
  const positions: { x: number; y: number; width: number }[] = [];
  let x = padding,
    y = padding,
    right = padding;
  for (const naturalWidth of widths) {
    const actionWidth = Math.min(naturalWidth, Math.max(1, available - padding * 2));
    if (x > padding && x + actionWidth + padding > available) {
      x = padding;
      y += rowHeight + gap;
    }
    positions.push({ x, y, width: actionWidth });
    right = Math.max(right, x + actionWidth);
    x += actionWidth + gap;
  }
  const width = Math.min(available, right + padding),
    height = Math.min(viewport.height, y + rowHeight + padding);
  return { width, height, positions };
}
export function SelectionToolbar(props: SelectionToolbarProps): ReactNode {
  const theme = useWidgetTheme(),
    pal = theme.foundations.palette;
  if (!props.anchor || props.actions.length === 0) return null;
  const scale = props.scale ?? getUiScaleFactor(),
    fontSize = 12,
    rowHeight = 26 * scale;
  const { width, height, positions } = layoutSelectionToolbar(props.actions, props, scale);
  const position = placeSelectionToolbar(
    props.anchor,
    props,
    { width, height },
    props.gap ?? 8 * scale,
  );
  return (
    <Group {...position} width={width} height={height}>
      <Rect
        width={width}
        height={height}
        fill={pal.panel}
        radius={pal.radiusMd}
        stroke={pal.border}
        strokeWidth={1}
        shadow={{ offsetX: 0, offsetY: 3 * scale, blurRadius: 8 * scale, color: 0x50000000 }}
      />
      <Group width={width} height={height} clip>
        {props.actions.map((action, index) => {
          const slot = positions[index]!;
          return (
            <Pressable
              key={action.id}
              x={slot.x}
              y={slot.y}
              width={slot.width}
              height={rowHeight}
              radius={pal.radiusSm}
              fill={action.active ? pal.selection : 0x00000000}
              disabled={action.disabled}
              focusable={false}
              focusId={`selection-action:${action.id}`}
              onPress={action.onInvoke}
            >
              <Text
                x={9 * scale}
                y={5 * scale}
                text={action.label}
                fontSize={fontSize}
                fontWeight="medium"
                color={action.disabled ? pal.muted : action.active ? pal.accent : pal.text}
              />
            </Pressable>
          );
        })}
      </Group>
    </Group>
  );
}
