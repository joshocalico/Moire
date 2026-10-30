/** The chip drawn under the pointer while a drag leaves this client. */
import React, { type ReactNode } from "react";
import { Group, Rect, Text, createShellRoot, renderShell } from "@moire/react-host";
import { themePalette } from "#ui/theme";
import type { DragPreviewSpec } from "#ui/widgets/dnd";
import { Icon } from "#ui/widgets/icon";
import { GridItem } from "#ui/widgets/grid";
import { ListItem } from "#ui/widgets/list";

export type DragIconProps = {
  label: string;
  width: number;
  height: number;
  icon?: DragPreviewSpec["icon"];
};

export function DragIcon({ label, width, height, icon }: DragIconProps): ReactNode {
  if (icon) {
    // Mirror the source item's shape, slightly translucent so the drop target shows through.
    const listLike = width > height * 2;
    const iconSize = listLike
      ? Math.max(16, Math.min(24, height - 12))
      : Math.max(24, Math.min(56, height - 38));
    const glyph = <Icon name={icon.name} size={iconSize} color={icon.color} />;
    return (
      <Group x={0} y={0} width={width} height={height} opacity={0.68}>
        {listLike ? (
          <ListItem
            width={width}
            height={height}
            title={label}
            selected
            interactive={false}
            leading={glyph}
          />
        ) : (
          <GridItem
            width={width}
            height={height}
            label={label}
            iconSize={iconSize}
            selected
            interactive={false}
            icon={glyph}
          />
        )}
      </Group>
    );
  }
  const palette = themePalette();
  const text = label.length > 26 ? label.slice(0, 25) + "…" : label;
  return (
    <Group x={0} y={0} width={width} height={height}>
      <Rect width={width} height={height} fill={(palette.surface & 0x00ffffff) | 0xf2000000} />
      <Rect width={width} height={1} fill={palette.rimLight} />
      <Rect width={3} height={height} fill={palette.accentLine} />
      <Text x={12} y={11} text={text} color={palette.text} fontSize={13} />
    </Group>
  );
}

/** Mount a drag chip in its own root, ready to rasterize. */
export function createDragIconRoot(props: DragIconProps) {
  const root = createShellRoot();
  renderShell(root, <DragIcon {...props} />);
  return root;
}
