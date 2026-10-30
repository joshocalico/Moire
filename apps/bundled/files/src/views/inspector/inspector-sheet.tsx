/**
 * The Properties pane's body: the hero for the item's kind, its name and actions, then cards
 * (Information, Tags, Location, Sharing & permissions, Opens with, History) in one scrolling
 * column. Several items get fanned thumbnails, a Selection card and bulk actions instead; with
 * nothing selected it describes the folder being shown.
 */
import fs from "node:fs";
import path from "node:path";
import React, { Fragment, useEffect, useState, type ReactNode } from "react";
import { Box, ScrollArea, Surface, usePalette } from "@moire/ui";
import type { Entry } from "#files/filesystem";
import type { InspectorActions } from "#files/inspector-actions";
import { usePreview } from "#files/preview/use-preview";
import {
  ApplyCard,
  FactsCard,
  LocationCard,
  OpensWithCard,
  applyCardHeight,
  factsCardHeight,
  locationCardHeight,
  opensWithCardHeight,
  px,
} from "./cards";
import { InspectorHero, heroHeight } from "./hero";
import {
  historyRows,
  infoRows,
  itemCaption,
  kindBreakdown,
  selectionRows,
  selectionTitle,
  totalBytes,
} from "./model";
import { MultiHero, multiHeroHeight } from "./multi-hero";
import { SharingCard, sharingCardHeight } from "./sharing-card";
import { TagsCard, tagChips, tagsCardHeight } from "./tags-card";
import { TITLE_BLOCK, TitleBlock } from "./title-block";
import { useItemFacts } from "./use-item-facts";
import { formatBytes } from "#files/format";

const PAD = 16;
const TOP = 4;
const GAP = 12;
const BOTTOM = 20;

type Block = { key: string; height: number; render(y: number): ReactNode };

export type InspectorSheetProps = {
  width: number;
  height: number;
  entries: readonly Entry[];
  cwd: string;
  trashDirectory: string;
  refresh: number;
  actions: InspectorActions;
  viewport: { width: number; height: number };
  renameRequest?: number;
};

/** The shown folder as an item, for when nothing is selected. */
function useFolderEntry(cwd: string, refresh: number): Entry {
  const [modified, setModified] = useState(0);
  useEffect(() => {
    let alive = true;
    void fs.promises.stat(cwd).then(
      (stat) => alive && setModified(stat.mtimeMs),
      () => {
        // A folder that went away keeps its last listing.
      },
    );
    return () => {
      alive = false;
    };
  }, [cwd, refresh]);
  return { name: path.basename(cwd) || cwd, path: cwd, isDir: true, size: 0, modified };
}

export function InspectorSheet(props: InspectorSheetProps): ReactNode {
  const pal = usePalette();
  const { actions } = props;
  const folder = useFolderEntry(props.cwd, props.refresh);
  const entries = props.entries.length ? props.entries : [folder];
  const single = entries.length === 1 ? entries[0]! : null;
  const preview = usePreview(single, props.refresh);
  const facts = useItemFacts(entries, props.refresh, actions.applicationName);
  const key = entries.map((entry) => entry.path).join("\n");
  const [scroll, setScroll] = useState({ key, y: 0 });
  const [tagEditing, setTagEditing] = useState(false);
  useEffect(() => setTagEditing(false), [key]);
  const inner = Math.max(1, props.width - px(PAD * 2));
  const chips = tagChips(entries, preview, actions);
  const blocks: Block[] = [];
  const add = (key: string, height: number, render: (y: number) => ReactNode) =>
    blocks.push({ key, height, render });

  if (single) {
    const hero = { entry: single, preview, width: inner };
    add("hero", heroHeight(hero), (y) => (
      <Box y={y} width={inner} height={heroHeight(hero)}>
        <InspectorHero {...hero} actions={actions} />
      </Box>
    ));
    add("title", px(TITLE_BLOCK), (y) => (
      <TitleBlock
        y={y}
        width={inner}
        entries={entries}
        title={props.entries.length || props.cwd !== props.trashDirectory ? single.name : "Trash"}
        caption={itemCaption(single)}
        actions={actions}
        renameRequest={props.entries.length ? props.renameRequest : undefined}
      />
    ));
    const info = infoRows(single, preview, actions.home);
    add("info", factsCardHeight(info), (y) => (
      <FactsCard y={y} width={inner} title="Information" rows={info} />
    ));
  } else {
    add("hero", multiHeroHeight(), (y) => (
      <Box y={y} width={inner} height={multiHeroHeight()}>
        <MultiHero entries={entries} width={inner} />
      </Box>
    ));
    add("title", px(TITLE_BLOCK), (y) => (
      <TitleBlock
        y={y}
        width={inner}
        entries={entries}
        title={selectionTitle(entries)}
        caption={[formatBytes(totalBytes(entries)), kindBreakdown(entries)].join(" · ")}
        actions={actions}
      />
    ));
    const rows = selectionRows(entries, facts?.stats ?? [], actions.home, facts?.currentUid ?? -1);
    add("selection", factsCardHeight(rows), (y) => (
      <FactsCard y={y} width={inner} title="Selection" rows={rows} />
    ));
  }
  if (chips.length && props.entries.length)
    add("tags", tagsCardHeight(chips, inner, tagEditing), (y) => (
      <TagsCard
        y={y}
        width={inner}
        entries={entries}
        chips={chips}
        actions={actions}
        editing={tagEditing}
        onEditing={setTagEditing}
      />
    ));
  if (single) {
    add("location", locationCardHeight(), (y) => (
      <LocationCard
        y={y}
        width={inner}
        entries={entries}
        trashDirectory={props.trashDirectory}
        actions={actions}
      />
    ));
    const stat = facts?.stats[0];
    if (stat && facts && !actions.inTrash)
      add("sharing", sharingCardHeight(stat.isDir), (y) => (
        <SharingCard
          y={y}
          width={inner}
          stat={stat}
          owner={facts.owner}
          group={facts.group}
          currentUid={facts.currentUid}
          actions={actions}
        />
      ));
    const association = single.isDir || actions.inTrash ? null : actions.association(single.path);
    if (association)
      add("opens-with", opensWithCardHeight(), (y) => (
        <OpensWithCard
          y={y}
          width={inner}
          association={association}
          viewport={props.viewport}
          actions={actions}
        />
      ));
    const history = historyRows(stat ?? null, single, facts?.lastOpened.get(single.path) ?? null);
    add("history", factsCardHeight(history), (y) => (
      <FactsCard y={y} width={inner} title="History" rows={history} />
    ));
  } else {
    add("location", locationCardHeight(), (y) => (
      <LocationCard y={y} width={inner} entries={entries} actions={actions} />
    ));
    if (!actions.inTrash)
      add("apply", applyCardHeight(), (y) => (
        <ApplyCard y={y} width={inner} entries={entries} actions={actions} />
      ));
  }

  let y = 0;
  const placed = blocks.map((block) => {
    const at = y;
    y += block.height + px(GAP);
    return <Fragment key={block.key}>{block.render(at)}</Fragment>;
  });
  const content = y - px(GAP) + px(TOP + BOTTOM);
  return (
    <Surface width={props.width} height={props.height} fill={pal.panel}>
      <ScrollArea
        width={props.width}
        height={props.height}
        contentHeight={content}
        scrollY={scroll.key === key ? scroll.y : 0}
        onScroll={(next) => setScroll({ key, y: next })}
        fill={0x00000000}
      >
        <Box x={px(PAD)} y={px(TOP)} width={inner} height={content}>
          {placed}
        </Box>
      </ScrollArea>
    </Surface>
  );
}
