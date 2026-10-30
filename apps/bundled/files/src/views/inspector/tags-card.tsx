/**
 * Tags in place: a chip per tag (its colour, a menu on press, × to remove), an "Add tag" chip
 * that turns into a field, and suggestions from what the item is ("+ 2024", "+ Fujifilm").
 */
import React, { useEffect, useState, type ReactNode } from "react";
import { Box, TagChip, layoutTagChips, tagChipHeight } from "@moire/ui";
import { parseTags, tagSuggestions } from "#files/catalog";
import type { Entry } from "#files/filesystem";
import type { InspectorActions } from "#files/inspector-actions";
import type { Preview } from "#files/preview/model";
import { CARD_HEAD, CARD_PAD, Card, cardHeight, px } from "./cards";

export const TAG_ADD_ID = "inspector:tag-add";

export type Chip =
  | { kind: "tag"; label: string }
  | { kind: "add" }
  | { kind: "suggestion"; label: string };

/** The chips for these items: their tags, the add chip, then suggestions (one item only). */
export function tagChips(
  entries: readonly Entry[],
  preview: Preview | null,
  actions: InspectorActions,
): Chip[] {
  const tags = [...new Set(entries.flatMap((entry) => [...actions.tags.of(entry.path)]))];
  const chips: Chip[] = tags.map((label) => ({ kind: "tag", label }));
  if (!actions.tags.ready) return chips;
  chips.push({ kind: "add" });
  if (entries.length === 1)
    for (const label of tagSuggestions({
      preview,
      path: entries[0]!.path,
      existing: tags,
      known: actions.tags.known(),
    }))
      chips.push({ kind: "suggestion", label });
  return chips;
}

/** Suggestion chips draw their own "+ "; the add chip its own label. */
const chipLabel = (chip: Chip) => (chip.kind === "add" ? "Add tag" : chip.label);

function layout(chips: readonly Chip[], width: number, editing: boolean, removable = true) {
  return layoutTagChips(
    chips.map((chip) => ({
      label: chipLabel(chip),
      variant: chip.kind,
      editing: chip.kind === "add" && editing,
      removable: chip.kind === "tag" ? removable : undefined,
    })),
    width,
  );
}

/** The chips' own height (no card), for the columns pane. */
export function tagChipsHeight(chips: readonly Chip[], width: number, editing = false): number {
  return chips.length ? layout(chips, width, editing).height : 0;
}

export function TagChips(props: {
  x?: number;
  y?: number;
  width: number;
  entries: readonly Entry[];
  chips: readonly Chip[];
  actions: InspectorActions;
  editing: boolean;
  onEditing(editing: boolean): void;
}): ReactNode {
  const { actions } = props;
  const paths = props.entries.map((entry) => entry.path);
  const [draft, setDraft] = useState("");
  const key = paths.join("\n");
  useEffect(() => setDraft(""), [key]);
  const removable = actions.tags.ready && !actions.busy;
  const placed = layout(props.chips, props.width, props.editing, removable);
  const stop = () => {
    setDraft("");
    props.onEditing(false);
    actions.onTextFocus(false);
  };
  return (
    <Box x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={placed.height}>
      {props.chips.map((chip, index) => {
        const at = placed.positions[index]!;
        if (chip.kind === "tag")
          return (
            <TagChip
              key={`tag:${chip.label}`}
              x={at.x}
              y={at.y}
              label={chip.label}
              maxWidth={at.width}
              colour={actions.tags.colourOf(chip.label)}
              variant="tag"
              focusId={`inspector:tag:${chip.label}`}
              disabled={!actions.tags.ready || actions.busy}
              onPress={() => actions.tags.menu(chip.label, paths)}
              onRemove={() => actions.tags.remove(paths, [chip.label])}
            />
          );
        if (chip.kind === "add")
          return (
            <TagChip
              key="add"
              x={at.x}
              y={at.y}
              label="Add tag"
              variant="add"
              focusId={TAG_ADD_ID}
              disabled={actions.busy}
              editing={props.editing}
              draft={draft}
              placeholder="Tag name"
              onPress={() => props.onEditing(true)}
              onDraft={setDraft}
              onFocusChange={actions.onTextFocus}
              onSubmit={() => {
                actions.tags.add(paths, parseTags(draft));
                stop();
              }}
              onCancel={stop}
            />
          );
        return (
          <TagChip
            key={`suggestion:${chip.label}`}
            x={at.x}
            y={at.y}
            label={chip.label}
            maxWidth={at.width}
            variant="suggestion"
            focusId={`inspector:suggest:${chip.label}`}
            disabled={actions.busy}
            onPress={() => actions.tags.add(paths, [chip.label])}
          />
        );
      })}
    </Box>
  );
}

export function TagsCard(props: {
  y?: number;
  width: number;
  entries: readonly Entry[];
  chips: readonly Chip[];
  actions: InspectorActions;
  editing: boolean;
  onEditing(editing: boolean): void;
}): ReactNode {
  const { chips, editing } = props;
  const inner = props.width - px(CARD_PAD * 2);
  return (
    <Card
      y={props.y}
      width={props.width}
      height={tagsCardHeight(chips, props.width, editing)}
      title="Tags"
    >
      <TagChips
        x={px(CARD_PAD)}
        y={px(CARD_HEAD)}
        width={inner}
        entries={props.entries}
        chips={chips}
        actions={props.actions}
        editing={editing}
        onEditing={props.onEditing}
      />
    </Card>
  );
}

export const tagsCardHeight = (chips: readonly Chip[], width: number, editing = false) =>
  cardHeight(
    Math.max(tagChipHeight(), tagChipsHeight(chips, width - px(CARD_PAD * 2), editing)) + px(4),
  );
