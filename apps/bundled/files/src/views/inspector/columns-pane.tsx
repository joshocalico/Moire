/**
 * The pane after the last column: the inspector's parts laid out wide and without scrolling.
 * The hero (at most 40% of the height), the name and caption with Open, Open With ▾ and ⋯,
 * the facts in two columns (label over value; one column when narrow), and the tags. A PDF
 * fills any room left with its opening words.
 */
import React, { useState, type ReactNode } from "react";
import { Box, Separator, Surface, TextBlock, usePalette } from "@moire/ui";
import type { Entry } from "#files/filesystem";
import type { InspectorActions } from "#files/inspector-actions";
import { entryCaption } from "#files/kind-style";
import { usePreview } from "#files/preview/use-preview";
import { PreviewStage } from "#files/views/preview-stage";
import { px } from "./cards";
import { InspectorHero, heroHeight } from "./hero";
import { historyRows, infoRows } from "./model";
import { TagChips, tagChips, tagChipsHeight } from "./tags-card";
import { ActionRow, actionRowWidth } from "./title-block";
import { useItemFacts } from "./use-item-facts";

const PAD = 16;
const HERO_SHARE = 0.4;
const NAME = 24;
const CAPTION = 18;
const ACTION = 32;
const CELL = 40;
const COLUMN_GAP = 16;
/** Narrower than this, facts take one column. */
const TWO_COLUMNS = 400;
const WORDS_MIN = 80;

export const COLUMNS_OPEN_ID = "columns:open";

export function ColumnsPreviewPane(props: {
  width: number;
  height: number;
  entry: Entry | null;
  refresh: number;
  actions: InspectorActions;
}): ReactNode {
  const pal = usePalette();
  const preview = usePreview(props.entry, props.refresh);
  const entries = props.entry ? [props.entry] : [];
  const facts = useItemFacts(entries, props.refresh, props.actions.applicationName);
  const [tagEditing, setTagEditing] = useState(false);
  if (!props.entry) return <Surface width={props.width} height={props.height} fill={pal.panel} />;
  const entry = props.entry;
  const inner = Math.max(1, props.width - px(PAD * 2));
  const hero = {
    entry,
    preview,
    width: inner,
    compact: true,
    maxHeight: Math.round(props.height * HERO_SHARE),
  };
  const heroH = heroHeight(hero);
  // The actions share the name's line when both fit; otherwise they go under it.
  const actionsWidth = actionRowWidth(entries, props.actions.inTrash);
  const sideBySide = inner - actionsWidth >= px(140);
  const titleY = px(PAD) + heroH + px(16);
  const titleH = sideBySide ? px(NAME + CAPTION + 6) : px(NAME + CAPTION + 10 + ACTION);
  const factsY = titleY + titleH + px(10);
  const rows = [
    ...infoRows(entry, preview, props.actions.home).filter((row) => row.label !== "Kind"),
    ...historyRows(facts?.stats[0] ?? null, entry, facts?.lastOpened.get(entry.path) ?? null),
  ];
  const columns = inner >= px(TWO_COLUMNS) ? 2 : 1;
  const columnWidth = Math.floor((inner - px(COLUMN_GAP) * (columns - 1)) / columns);
  const chips = tagChips(entries, preview, props.actions);
  const chipsH = tagChipsHeight(chips, inner, tagEditing);
  // No scrolling: facts that don't fit above the tags are left out, from the end.
  const room = props.height - factsY - (chipsH ? chipsH + px(12) : 0) - px(PAD);
  const perColumn = Math.max(
    0,
    Math.min(Math.ceil(rows.length / columns), Math.floor(room / px(CELL))),
  );
  const shown = rows.slice(0, perColumn * columns);
  const tagsY = factsY + perColumn * px(CELL) + px(8);
  const wordsY = tagsY + (chipsH ? chipsH + px(16) : 0);
  const words =
    preview?.kind === "pdf" && preview.excerpt && props.height - wordsY - px(PAD) > px(WORDS_MIN)
      ? preview.excerpt
      : null;
  return (
    <Surface width={props.width} height={props.height} fill={pal.panel}>
      <Box x={px(PAD)} y={px(PAD)} width={inner} height={heroH}>
        <InspectorHero {...hero} actions={props.actions} />
      </Box>
      <Box x={px(PAD)} y={titleY} width={inner} height={titleH}>
        <TextBlock
          width={sideBySide ? inner - actionsWidth - px(12) : inner}
          height={px(NAME)}
          text={entry.name}
          fontSize={16}
          fontWeight="medium"
          verticalAlign="center"
          maxLines={1}
          overflow="ellipsis"
        />
        <TextBlock
          y={px(NAME)}
          width={sideBySide ? inner - actionsWidth - px(12) : inner}
          height={px(CAPTION)}
          text={entryCaption(entry)}
          color={pal.muted}
          fontSize={12}
          verticalAlign="center"
          maxLines={1}
          overflow="ellipsis"
        />
        <ActionRow
          x={sideBySide ? inner - actionsWidth : 0}
          y={sideBySide ? px(6) : px(NAME + CAPTION + 10)}
          width={sideBySide ? actionsWidth : inner}
          entries={entries}
          actions={props.actions}
          openFocusId={COLUMNS_OPEN_ID}
        />
      </Box>
      <Separator x={px(PAD)} y={factsY - px(8)} width={inner} height={1} />
      {shown.map((row, index) => {
        const column = Math.floor(index / perColumn);
        const line = index % perColumn;
        return (
          <Box
            key={row.label}
            x={px(PAD) + column * (columnWidth + px(COLUMN_GAP))}
            y={factsY + line * px(CELL)}
            width={columnWidth}
            height={px(CELL)}
          >
            <TextBlock
              width={columnWidth}
              height={px(16)}
              text={row.label}
              color={pal.muted}
              fontSize={11}
              verticalAlign="center"
              maxLines={1}
            />
            <TextBlock
              y={px(16)}
              width={columnWidth}
              height={px(20)}
              text={row.value}
              color={row.accent ? pal.accentLine : pal.text}
              fontSize={12}
              verticalAlign="center"
              maxLines={1}
              overflow="ellipsis"
            />
          </Box>
        );
      })}
      {chipsH ? (
        <TagChips
          x={px(PAD)}
          y={tagsY}
          width={inner}
          entries={entries}
          chips={chips}
          actions={props.actions}
          editing={tagEditing}
          onEditing={setTagEditing}
        />
      ) : null}
      {words ? (
        <Box x={px(PAD)} y={wordsY} width={inner} height={props.height - wordsY - px(PAD)}>
          <TextBlock
            width={inner}
            height={px(18)}
            text="Opening words"
            color={pal.muted}
            fontSize={11}
            verticalAlign="center"
          />
          <Box y={px(22)} width={inner} height={props.height - wordsY - px(PAD + 22)}>
            <PreviewStage
              subject={entry}
              preview={{ kind: "document", excerpt: words }}
              width={inner}
              height={props.height - wordsY - px(PAD + 22)}
            />
          </Box>
        </Box>
      ) : null}
    </Surface>
  );
}
