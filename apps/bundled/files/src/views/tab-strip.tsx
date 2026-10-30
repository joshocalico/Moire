/** Folder tabs as compact pills under the top bar; Files shows the strip only with two or more. */
import React, { type ReactNode } from "react";
import { Box, Icon, Tabs, getUiScaleFactor, type HitPointerEvent } from "@moire/ui";

const TAB_HEIGHT = 32;
const TAB_WIDTH = 200;

type StripTab = { id: string; label: string; trash: boolean; dropData?: string };

export function TabStrip(props: {
  width: number;
  height: number;
  tabs: readonly StripTab[];
  active: number;
  disabled: boolean;
  onChange(index: number): void;
  onClose(index: number): void;
  onAdd(): void;
  onContextMenu(index: number, event: HitPointerEvent): void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const height = Math.round(TAB_HEIGHT * ui);
  // Pills keep a natural width; the strip never stretches two tabs across a wide window.
  const width = Math.min(props.width, Math.round((props.tabs.length * TAB_WIDTH + 40) * ui));
  return (
    <Box width={props.width} height={props.height}>
      <Tabs
        y={Math.round((props.height - height) / 2)}
        width={width}
        height={height}
        variant="titlebar"
        disabled={props.disabled}
        tabs={props.tabs.map((tab) => ({
          id: tab.id,
          label: tab.label,
          leading: (
            <Icon symbolic name={tab.trash ? "trash" : "folder"} size={Math.round(16 * ui)} />
          ),
          closable: true,
          dropData: tab.dropData,
        }))}
        active={props.active}
        onChange={props.onChange}
        onClose={props.onClose}
        onAdd={props.onAdd}
        onContextMenu={props.onContextMenu}
      />
    </Box>
  );
}
