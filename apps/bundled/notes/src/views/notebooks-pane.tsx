import React, { type ReactNode } from "react";
import {
  Button,
  Label,
  NavigationSidebar,
  Surface,
  TextField,
  getUiScaleFactor,
  usePalette,
  type WindowSize,
} from "@moire/ui";
import type { Notebook } from "#notes/store";
import { noteCount, viewKey } from "#notes/model";

/** The sidebar: All/Pinned views, the notebooks, and naming a new notebook. */
export function NotebooksPane(
  props: WindowSize & {
    book: Notebook;
    selectedKey: string;
    /** The name being typed for a new notebook, or null when not naming one. */
    draftName: string | null;
    onSelect: (key: string) => void;
    onDraftName: (name: string | null) => void;
    onCreate: () => void;
  },
): ReactNode {
  const pal = usePalette(),
    ui = getUiScaleFactor();
  const { book } = props;
  return (
    <Surface width={props.width} height={props.height} fill={pal.panel} clip>
      <Label
        x={18 * ui}
        y={18 * ui}
        width={props.width - 36 * ui}
        height={30 * ui}
        text="Your notebooks"
        fontSize={16}
        fontWeight="medium"
      />
      <NavigationSidebar
        y={58 * ui}
        width={props.width}
        height={Math.max(0, props.height - 124 * ui)}
        selectedId={props.selectedKey}
        labelCase="preserve"
        sections={[
          {
            id: "views",
            items: [
              { id: "all", label: "All notes", subtitle: noteCount(book.notes.length) },
              {
                id: "pinned",
                label: "Pinned notes",
                subtitle: `${book.notes.filter((note) => note.pinned).length} pinned`,
              },
            ],
          },
          {
            id: "notebooks",
            label: "Notebooks",
            items: book.notebooks.map((notebook) => ({
              id: viewKey({ kind: "notebook", id: notebook.id }),
              label: notebook.title,
              subtitle: noteCount(
                book.notes.filter((note) => note.notebookId === notebook.id).length,
              ),
            })),
          },
        ]}
        onSelect={(item) => props.onSelect(item.id)}
      />
      {props.draftName === null ? (
        <Button
          x={12 * ui}
          y={props.height - 52 * ui}
          label="New notebook"
          focusId="notes:new-notebook"
          variant="ghost"
          onPress={() => props.onDraftName("")}
        />
      ) : (
        <TextField
          x={12 * ui}
          y={props.height - 52 * ui}
          width={Math.max(1, props.width - 24 * ui)}
          value={props.draftName}
          onChange={props.onDraftName}
          autoFocus
          placeholder="Name, then Enter"
          onSubmit={props.onCreate}
          onCancel={() => props.onDraftName(null)}
        />
      )}
    </Surface>
  );
}
