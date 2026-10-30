/** The Recent page: files grouped Today, Yesterday, This week and Earlier, as rows. */
import path from "node:path";
import React from "react";
import { TextBlock, getUiScaleFactor, type HitPointerEvent, type HoverAction } from "@moire/ui";
import type { RecentFile } from "@moire/file-operations";
import { formatBytes, formatRecent, tidyPath } from "#files/format";
import { groupRecent } from "#files/search/recent";
import { FileRow, ROW_PITCH } from "./file-row";
import type { PageBlock } from "./page-scroller";

const HEADING = 36;
const recentFocusId = (file: string) => `recent:${file}`;

export function recentBlocks(options: {
  files: readonly RecentFile[];
  home: string;
  now: number;
  focusKey: string | null;
  onFocus(file: RecentFile): void;
  onOpen(file: RecentFile): void;
  onShow(file: RecentFile): void;
  onContextMenu(file: RecentFile, event: HitPointerEvent): void;
}): PageBlock[] {
  const ui = getUiScaleFactor();
  const blocks: PageBlock[] = [];
  for (const group of groupRecent(options.files, options.now)) {
    blocks.push({
      key: `group:${group.id}`,
      height: Math.round(HEADING * ui),
      render: (width) => (
        <TextBlock
          width={width}
          height={Math.round(HEADING * ui)}
          text={group.label}
          fontSize={13}
          fontWeight="medium"
          verticalAlign="center"
        />
      ),
    });
    for (const file of group.items) {
      const actions: HoverAction[] = [
        { id: "open", label: "Open", icon: "forward", onPress: () => options.onOpen(file) },
        {
          id: "show",
          label: "Show in Folder",
          icon: "folder",
          onPress: () => options.onShow(file),
        },
      ];
      blocks.push({
        key: file.path,
        height: Math.round(ROW_PITCH * ui),
        keys: [file.path],
        render: (width) => (
          <FileRow
            width={width}
            entry={{ ...file, isDir: false }}
            caption={`${tidyPath(path.dirname(file.path), options.home)} · ${formatBytes(file.size)}`}
            trailing={formatRecent(file.usedAt, options.now)}
            actions={actions}
            selected={false}
            highlighted={options.focusKey === file.path}
            interaction={{
              focusId: recentFocusId(file.path),
              onFocusChange: (focused) => focused && options.onFocus(file),
              onDoublePress: () => options.onOpen(file),
              onContextMenu: (event) => options.onContextMenu(file, event),
            }}
          />
        ),
      });
    }
  }
  return blocks;
}
