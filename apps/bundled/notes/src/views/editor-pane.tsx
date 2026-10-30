import React, { type ReactNode } from "react";
import {
  Button,
  DocumentEditor,
  Icon,
  IconButton,
  Label,
  Row,
  Surface,
  TextField,
  getUiScaleFactor,
  usePalette,
  type DocumentValue,
  type HitPointerEvent,
  type WindowSize,
} from "@moire/ui";
import type { Note } from "#notes/store";
import { wordCount } from "#notes/model";

const SIDE = 24;
const TITLE_TOP = 64;
const TITLE_HEIGHT = 42;
const BODY_TOP = 150;

/** The open note: breadcrumb, Save and actions, title, and the rich text editor. */
export function EditorPane(
  props: WindowSize & {
    note: Note | undefined;
    /** Where the note lives, e.g. "Moire"; also the breadcrumb root. */
    notebook: string;
    /** Shown in place of the breadcrumb and the editor when no note is open. */
    viewTitle: string;
    emptyMessage: string;
    renaming: boolean;
    onRename: (renaming: boolean) => void;
    onTitle: (title: string) => void;
    onBody: (document: DocumentValue) => void;
    onSave: () => void;
    onActions: (event: HitPointerEvent | undefined) => void;
  },
): ReactNode {
  const pal = usePalette(),
    ui = getUiScaleFactor();
  const { note } = props;
  const inner = Math.max(1, props.width - 2 * SIDE * ui);
  const title = note ? note.title || "Untitled note" : "";
  return (
    <Surface width={props.width} height={props.height} fill={pal.bg} clip>
      <Row
        x={18 * ui}
        y={12 * ui}
        width={Math.max(1, props.width - 36 * ui)}
        height={32 * ui}
        gap={4 * ui}
        align="center"
      >
        <Label
          text={note ? `${props.notebook} / ${title}` : props.viewTitle}
          fontSize={11}
          color={pal.muted}
          flexGrow={1}
          maxLines={1}
          overflow="ellipsis"
        />
        <Button
          label="Save"
          size="small"
          variant="ghost"
          focusId="notes:save"
          onPress={props.onSave}
        />
        <IconButton
          width={30 * ui}
          height={30 * ui}
          tooltip="Note actions"
          focusId="notes:more"
          icon={<Icon symbolic name="more" size={18} color={pal.muted} />}
          onPress={props.onActions}
        />
      </Row>
      {note ? (
        <>
          {props.renaming ? (
            <TextField
              x={SIDE * ui}
              y={TITLE_TOP * ui}
              width={inner}
              height={TITLE_HEIGHT * ui}
              value={note.title}
              onChange={props.onTitle}
              autoFocus
              selectAllOnFocus
              placeholder="Note title"
              onSubmit={() => props.onRename(false)}
              onCancel={() => props.onRename(false)}
            />
          ) : (
            <Surface
              x={SIDE * ui}
              y={TITLE_TOP * ui}
              width={inner}
              height={TITLE_HEIGHT * ui}
              fill={pal.bg}
              onPress={() => props.onRename(true)}
            >
              <Label
                width={inner}
                height={TITLE_HEIGHT * ui}
                text={title}
                fontSize={28}
                fontWeight="medium"
                fontFamily="serif"
                maxLines={1}
                overflow="ellipsis"
              />
            </Surface>
          )}
          <Label
            x={SIDE * ui}
            y={112 * ui}
            width={inner}
            height={24 * ui}
            text={`${props.notebook} · Edited ${new Date(note.updatedAt).toLocaleDateString()}`}
            fontSize={11}
            color={pal.muted}
            maxLines={1}
            overflow="ellipsis"
          />
          <DocumentEditor
            key={note.id}
            x={10 * ui}
            y={BODY_TOP * ui}
            width={Math.max(1, props.width - 20 * ui)}
            height={Math.max(1, props.height - 190 * ui)}
            value={{ text: note.body, runs: note.runs }}
            onChange={props.onBody}
            autoFocus
            focusId={`note:${note.id}`}
            fontSize={16}
            padding={14 * ui}
            placeholder="Write a note…"
          />
          <Label
            x={SIDE * ui}
            y={props.height - 30 * ui}
            width={inner}
            height={22 * ui}
            text={`${wordCount(note.body)} words · Ctrl+B bold · Ctrl+U underline`}
            fontSize={10}
            color={pal.muted}
            maxLines={1}
            overflow="ellipsis"
          />
        </>
      ) : (
        <Label
          x={SIDE * ui}
          y={TITLE_TOP * ui}
          width={inner}
          height={110 * ui}
          text={props.emptyMessage}
          fontSize={20}
          wrap
          color={pal.muted}
        />
      )}
    </Surface>
  );
}
