/** The find (and replace) row under the header bar. */
import React, { type ReactNode } from "react";
import {
  Button,
  Horizontal,
  Icon,
  Label,
  TextField,
  Vertical,
  getUiScaleFactor,
  usePalette,
} from "@moire/ui";
import { ToolButton } from "@moire/app-tools";
import type { FindState } from "#editor/model";

const ROW = 34;
const GAP = 8;
const PAD_X = 12;
const PAD_Y = 8;
const TOOL = 32;
const SUMMARY = 84;
const REPLACE_BUTTON = 84;
const REPLACE_ALL_BUTTON = 104;

export function findBarHeight(mode: FindState["mode"]): number {
  const ui = getUiScaleFactor();
  if (mode === "closed") return 0;
  return (PAD_Y * 2 + ROW + (mode === "replace" ? GAP + ROW : 0)) * ui;
}

export function FindBar(props: {
  width: number;
  find: FindState;
  /** "3 of 12", "No results"… shown inside the search field. */
  summary: string;
  /** Changes whenever the search field should take focus again. */
  focusRequest: number;
  onChange: (find: FindState) => void;
  onNext: () => void;
  onPrevious: () => void;
  onReplace: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const { find } = props;
  const inner = props.width - PAD_X * 2 * ui;
  const tools = 4 * TOOL * ui + 3 * 2 * ui;
  const fieldWidth = Math.max(1, inner - tools - SUMMARY * ui - 2 * GAP * ui);
  const replaceFieldWidth = Math.max(
    1,
    inner - (REPLACE_BUTTON + REPLACE_ALL_BUTTON) * ui - 2 * GAP * ui,
  );
  const disabled = !find.query;
  return (
    <Vertical x={PAD_X * ui} y={PAD_Y * ui} width={inner} gap={GAP * ui}>
      <Horizontal width={inner} height={ROW * ui} gap={GAP * ui} align="center">
        <TextField
          key={props.focusRequest}
          width={fieldWidth}
          height={ROW * ui}
          value={find.query}
          placeholder="Find"
          focusId={`editor:find:${props.focusRequest}`}
          autoFocus
          selectAllOnFocus
          leading={(style) => <Icon name="search" {...style} />}
          onChange={(query) => props.onChange({ ...find, query })}
          onKeyDown={(event) => {
            // Shift+Enter walks back through the matches, as in browsers and GTK editors.
            if (event.code === 28 && event.shiftKey) {
              props.onPrevious();
              return true;
            }
            return false;
          }}
          onSubmit={props.onNext}
          onCancel={props.onClose}
        />
        <Label
          width={SUMMARY * ui}
          text={find.query ? props.summary : ""}
          fontSize={12}
          color={pal.muted}
        />
        <Horizontal width={tools} height={TOOL * ui} gap={2 * ui} align="center">
          <ToolButton
            icon="chevron-up"
            tooltip="Previous match (Shift+Enter)"
            focusId="editor:find-previous"
            disabled={disabled}
            onPress={props.onPrevious}
          />
          <ToolButton
            icon="chevron-down"
            tooltip="Next match (Enter)"
            focusId="editor:find-next"
            disabled={disabled}
            onPress={props.onNext}
          />
          <ToolButton
            icon="search"
            text="Aa"
            tooltip="Match case"
            focusId="editor:find-case"
            selected={find.matchCase}
            onPress={() => props.onChange({ ...find, matchCase: !find.matchCase })}
          />
          <ToolButton
            icon="close"
            tooltip="Close (Escape)"
            focusId="editor:find-close"
            onPress={props.onClose}
          />
        </Horizontal>
      </Horizontal>
      {find.mode === "replace" ? (
        <Horizontal width={inner} height={ROW * ui} gap={GAP * ui} align="center">
          <TextField
            width={replaceFieldWidth}
            height={ROW * ui}
            value={find.replacement}
            placeholder="Replace with"
            focusId="editor:replace"
            onChange={(replacement) => props.onChange({ ...find, replacement })}
            onSubmit={props.onReplace}
            onCancel={props.onClose}
          />
          <Button
            width={REPLACE_BUTTON * ui}
            height={ROW * ui}
            label="Replace"
            focusId="editor:replace-one"
            disabled={disabled}
            onPress={props.onReplace}
          />
          <Button
            width={REPLACE_ALL_BUTTON * ui}
            height={ROW * ui}
            label="Replace All"
            focusId="editor:replace-all"
            disabled={disabled}
            onPress={props.onReplaceAll}
          />
        </Horizontal>
      ) : null}
    </Vertical>
  );
}
