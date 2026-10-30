/** The window menu's Keyboard Shortcuts: what each key does, as a side sheet. */
import React, { type ReactNode } from "react";
import { Box, ScrollColumn, Sheet, TextBlock, getUiScaleFactor, usePalette } from "@moire/ui";

const SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ["Arrows", "Move through folders and files"],
  ["Enter", "Open"],
  ["Space", "Preview"],
  ["Typing", "Search this folder"],
  ["Ctrl+F", "Focus search"],
  ["Ctrl+L", "Edit the path"],
  ["Ctrl+1 / 2 / 3", "List, grid, columns"],
  ["Alt+Left / Right / Up", "Back, forward, parent folder"],
  ["Ctrl+T / Ctrl+W", "New tab, close tab"],
  ["Ctrl+Tab", "Next tab"],
  ["F2", "Rename"],
  ["Delete", "Move to Trash"],
  ["Shift+Delete", "Delete permanently"],
  ["Ctrl+Shift+N", "New folder"],
  ["Ctrl+C / X / V", "Copy, cut, paste"],
  ["Ctrl+Z", "Undo"],
  ["Alt+Enter", "Properties"],
  ["Ctrl+H", "Show hidden files"],
  ["Ctrl+B", "Show or hide the sidebar's labels"],
  ["Ctrl+Alt+1–9", "Go to a place in the sidebar"],
];

export function ShortcutsSheet(props: {
  width: number;
  height: number;
  onDismiss(): void;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const width = Math.min(props.width - Math.round(32 * ui), Math.round(420 * ui));
  const inner = width - Math.round(48 * ui);
  const row = Math.round(28 * ui);
  const keys = Math.round(150 * ui);
  return (
    <Sheet
      open
      viewportWidth={props.width}
      viewportHeight={props.height}
      width={width}
      title="Keyboard Shortcuts"
      onDismiss={props.onDismiss}
    >
      <ScrollColumn width={inner} height={Math.max(1, props.height - Math.round(120 * ui))} gap={0}>
        {SHORTCUTS.map(([keyText, action]) => (
          <Box key={keyText} width={inner} height={row}>
            <TextBlock
              width={keys}
              height={row}
              text={keyText}
              fontSize={12}
              fontWeight="medium"
              verticalAlign="center"
              maxLines={1}
              overflow="ellipsis"
            />
            <TextBlock
              x={keys}
              width={Math.max(1, inner - keys)}
              height={row}
              text={action}
              color={pal.muted}
              fontSize={12}
              verticalAlign="center"
              maxLines={1}
              overflow="ellipsis"
            />
          </Box>
        ))}
      </ScrollColumn>
    </Sheet>
  );
}
