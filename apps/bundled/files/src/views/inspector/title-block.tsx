/**
 * The item's name (renamed in place with the pencil or F2), "kind · size · modified", and the
 * action row: Open, Open With ▾ (folders: Open in New Tab) and ⋯, the item's own menu.
 */
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Box,
  Button,
  IconButton,
  TextBlock,
  TextField,
  getUiScaleFactor,
  measureWrappedText,
  usePalette,
} from "@moire/ui";
import type { Entry } from "#files/filesystem";
import type { InspectorActions } from "#files/inspector-actions";
import { glyph, px } from "./cards";

const NAME = 26;
const CAPTION = 18;
const ACTION_Y = 54;
const ACTION = 32;
export const TITLE_BLOCK = 88;
export const RENAME_FIELD_ID = "inspector:rename";

const buttonWidth = (label: string, extra: number) =>
  Math.ceil(
    measureWrappedText(label, 600 * getUiScaleFactor(), { fontSize: 13, fontWeight: "medium" })
      .width,
  ) + px(extra);

/** The row's natural width: Open, the secondary action and ⋯ side by side. */
export function actionRowWidth(entries: readonly Entry[], inTrash: boolean): number {
  const first = entries[0]!;
  const primary = inTrash ? "Restore" : entries.length > 1 ? "Open all" : "Open";
  const secondary = first.isDir && entries.length === 1 ? "Open in New Tab" : "Open With";
  return (
    buttonWidth(primary, 36) +
    px(8) +
    buttonWidth(secondary, first.isDir ? 36 : 56) +
    px(8) +
    px(ACTION)
  );
}

/** Open, the secondary action, and ⋯ on one line, as wide as the labels need. */
export function ActionRow(props: {
  x?: number;
  y?: number;
  width: number;
  entries: readonly Entry[];
  actions: InspectorActions;
  /** The Open button's focus id ("columns:open" in the columns pane). */
  openFocusId?: string;
}): ReactNode {
  const { actions, entries } = props;
  const first = entries[0]!;
  const multi = entries.length > 1;
  const folder = !multi && first.isDir;
  const extension = (entry: Entry) => entry.name.slice(entry.name.lastIndexOf(".") + 1);
  // Open With makes sense for one file, or files that are all the same type.
  const openWith =
    !actions.inTrash &&
    !folder &&
    entries.every((entry) => !entry.isDir && extension(entry) === extension(first));
  const primary = actions.inTrash ? "Restore" : multi ? "Open all" : "Open";
  const secondary = folder ? "Open in New Tab" : openWith ? "Open With" : null;
  const primaryWidth = buttonWidth(primary, 36);
  const secondaryWidth = secondary ? buttonWidth(secondary, openWith ? 56 : 36) : 0;
  const more = px(ACTION);
  // Narrow panes keep Open and ⋯; the secondary goes when it would crowd them.
  const showSecondary =
    secondary && primaryWidth + px(8) + secondaryWidth + px(8) + more <= props.width;
  return (
    <Box x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={px(ACTION)}>
      <Button
        width={primaryWidth}
        height={px(ACTION)}
        variant="primary"
        label={primary}
        focusId={props.openFocusId ?? "inspector:open"}
        disabled={actions.inTrash && actions.busy}
        onPress={() => (actions.inTrash ? actions.restore(entries) : actions.open(entries))}
      />
      {showSecondary ? (
        <Button
          x={primaryWidth + px(8)}
          width={secondaryWidth}
          height={px(ACTION)}
          variant="secondary"
          label={secondary}
          focusId={folder ? "inspector:new-tab" : "inspector:open-with"}
          trailingIcon={openWith ? glyph("chevron-down", 14) : undefined}
          onPress={(event) =>
            folder
              ? actions.openInNewTab(first.path)
              : actions.openWithMenu(first, event ? { x: event.x, y: event.y } : null)
          }
        />
      ) : null}
      <IconButton
        x={props.width - more}
        width={more}
        height={px(ACTION)}
        variant="ghost"
        focusId="inspector:more"
        tooltip="More actions"
        icon={glyph("more")}
        onPress={(event) => actions.moreMenu(entries, event ? { x: event.x, y: event.y } : null)}
      />
    </Box>
  );
}

export function TitleBlock(props: {
  y?: number;
  width: number;
  entries: readonly Entry[];
  title: string;
  caption: string;
  actions: InspectorActions;
  /** Moves on each F2 while the pane is open: start renaming. */
  renameRequest?: number;
}): ReactNode {
  const pal = usePalette();
  const { actions, entries } = props;
  const single = entries.length === 1 ? entries[0]! : null;
  const canRename = !!single && !actions.inTrash;
  const [editing, setEditing] = useState<{ path: string; draft: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const renaming = editing && single && editing.path === single.path ? editing : null;
  const start = () => {
    if (!single || !canRename) return;
    setError(null);
    setEditing({ path: single.path, draft: single.name });
  };
  const stop = () => {
    setEditing(null);
    actions.onTextFocus(false);
  };
  const lastRequest = useRef(props.renameRequest ?? 0);
  useEffect(() => {
    if ((props.renameRequest ?? 0) === lastRequest.current) return;
    lastRequest.current = props.renameRequest ?? 0;
    start();
    // Only a new request starts renaming.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.renameRequest]);
  useEffect(() => setError(null), [single?.path]);
  const submit = async () => {
    if (!single || !renaming) return;
    const problem = await actions.rename(single, renaming.draft);
    if (problem) setError(problem);
    else stop();
  };
  return (
    <Box y={props.y ?? 0} width={props.width} height={px(TITLE_BLOCK)}>
      {renaming ? (
        <TextField
          width={props.width}
          height={px(NAME + 4)}
          size="small"
          value={renaming.draft}
          focusId={RENAME_FIELD_ID}
          autoFocus
          selectAllOnFocus
          invalid={!!error}
          onChange={(draft) => {
            setError(null);
            setEditing({ path: renaming.path, draft });
          }}
          onFocusChange={actions.onTextFocus}
          onSubmit={() => void submit()}
          onCancel={stop}
        />
      ) : (
        <>
          <TextBlock
            width={props.width - (canRename ? px(34) : 0)}
            height={px(NAME)}
            text={props.title}
            fontSize={18}
            fontWeight="medium"
            verticalAlign="center"
            maxLines={1}
            overflow="ellipsis"
          />
          {canRename ? (
            <IconButton
              x={props.width - px(28)}
              y={px(1)}
              width={px(26)}
              height={px(26)}
              variant="ghost"
              focusId="inspector:rename-button"
              tooltip="Rename · F2"
              disabled={actions.busy}
              icon={glyph("editor", 14)}
              onPress={start}
            />
          ) : null}
        </>
      )}
      <TextBlock
        y={px(NAME + 2)}
        width={props.width}
        height={px(CAPTION)}
        text={error ?? (renaming ? "Enter to rename · Escape to cancel" : props.caption)}
        color={error ? pal.danger : pal.muted}
        fontSize={12}
        verticalAlign="center"
        maxLines={1}
        overflow="ellipsis"
      />
      <ActionRow y={px(ACTION_Y)} width={props.width} entries={entries} actions={actions} />
    </Box>
  );
}
