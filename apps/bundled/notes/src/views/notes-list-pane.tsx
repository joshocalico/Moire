import React, { type ReactNode } from "react";
import {
  Button,
  CollectionList,
  CollectionRow,
  Label,
  Row,
  SearchField,
  Surface,
  getUiScaleFactor,
  usePalette,
  type WindowSize,
} from "@moire/ui";
import type { Note, Notebook } from "#notes/store";
import { matchCount, notebookTitle, noteCount } from "#notes/model";

const LIST_TOP = 152;
const ROW_HEIGHT = 94;

/** The notes in the current view: title, search, New note and the list itself. */
export function NotesListPane(
  props: WindowSize & {
    book: Notebook;
    title: string;
    notes: readonly Note[];
    query: string;
    selected: string | null;
    onQuery: (query: string) => void;
    onNewNote: () => void;
    onSelect: (note: Note) => void;
    onOpen: (note: Note) => void;
  },
): ReactNode {
  const pal = usePalette(),
    ui = getUiScaleFactor();
  return (
    <Surface width={props.width} height={props.height} fill={pal.panel} clip>
      <Label
        x={16 * ui}
        y={18 * ui}
        width={props.width - 32 * ui}
        height={28 * ui}
        text={props.title}
        fontSize={18}
        fontWeight="medium"
        maxLines={1}
        overflow="ellipsis"
      />
      <SearchField
        x={14 * ui}
        y={58 * ui}
        width={Math.max(1, props.width - 28 * ui)}
        value={props.query}
        onChange={props.onQuery}
        placeholder="Search notes"
      />
      <Row
        x={14 * ui}
        y={104 * ui}
        width={props.width - 28 * ui}
        height={36 * ui}
        align="center"
        gap={8 * ui}
      >
        <Label
          flexGrow={1}
          text={props.query ? matchCount(props.notes.length) : noteCount(props.notes.length)}
          fontSize={11}
          color={pal.muted}
        />
        <Button label="New note" focusId="notes:new" variant="primary" onPress={props.onNewNote} />
      </Row>
      <CollectionList
        x={0}
        y={LIST_TOP * ui}
        width={props.width}
        height={Math.max(0, props.height - LIST_TOP * ui)}
        items={props.notes}
        getKey={(note) => note.id}
        selectedKey={props.selected}
        onSelect={props.onSelect}
        onActivate={props.onOpen}
        rowHeight={ROW_HEIGHT * ui}
        focusId="notes:collection"
        emptyMessage={
          props.query ? "No notes match your search." : "Create a note in this notebook."
        }
        renderItem={(note, state) => (
          <CollectionRow
            {...state}
            title={note.title || "Untitled note"}
            subtitle={note.pinned ? "Pinned" : notebookTitle(props.book, note.notebookId)}
            preview={note.body.replace(/\s+/g, " ") || "An empty page, ready for an idea."}
            metadata={new Date(note.updatedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
          />
        )}
      />
    </Surface>
  );
}
