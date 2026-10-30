/**
 * The inspector's cards: a rounded `surface` panel with a muted heading, and the simple ones
 * built on it (facts, Location, Opens with, Apply to all). Tags and Sharing have their own files.
 */
import path from "node:path";
import React, { type ReactNode } from "react";
import {
  Box,
  Breadcrumbs,
  Button,
  Icon,
  IconButton,
  PropertyList,
  Select,
  Surface,
  TextBlock,
  getUiScaleFactor,
  propertyListHeight,
  usePalette,
  type IconName,
} from "@moire/ui";
import type { Entry } from "#files/filesystem";
import type { InspectorActions } from "#files/inspector-actions";
import { breadcrumbSegments } from "#files/model";
import type { FileAssociation } from "#files/use-launcher";
import type { Row } from "./model";

export const CARD_HEAD = 32;
export const CARD_PAD = 12;
const CARD_RADIUS = 10;
const CARD_FOOT = 8;
const LOCATION_ROW = 30;
const SELECT_HEIGHT = 32;
const HINT_HEIGHT = 20;
const BULK_ROW = 38;
const BULK_HEIGHT = 32;

export const px = (value: number) => Math.round(value * getUiScaleFactor());

/** A symbolic icon in a control's ink, for IconButton and Button slots. */
export const glyph =
  (name: IconName, size = 16) =>
  (style: { color: number }) => <Icon name={name} size={px(size)} color={style.color} symbolic />;

export function Card(props: {
  y?: number;
  width: number;
  height: number;
  title: string;
  children?: ReactNode;
}): ReactNode {
  const pal = usePalette();
  return (
    <Box y={props.y ?? 0} width={props.width} height={props.height}>
      <Surface
        width={props.width}
        height={props.height}
        fill={pal.surface}
        radius={px(CARD_RADIUS)}
        stroke={pal.borderSubtle}
        strokeWidth={1}
      >
        <TextBlock
          x={px(CARD_PAD)}
          y={px(8)}
          width={props.width - px(CARD_PAD * 2)}
          height={px(20)}
          text={props.title}
          color={pal.muted}
          fontSize={12}
          fontWeight="medium"
          verticalAlign="center"
          maxLines={1}
        />
        {props.children}
      </Surface>
    </Box>
  );
}

/** A card's height around `content` pixels of body. */
export const cardHeight = (content: number) => px(CARD_HEAD + CARD_FOOT) + content;

/** Label and value rows, compact, in a card. */
export function FactsCard(props: {
  y?: number;
  width: number;
  title: string;
  rows: readonly Row[];
}): ReactNode {
  const inner = props.width - px(CARD_PAD * 2);
  const body = propertyListHeight(props.rows.length, "compact");
  return (
    <Card y={props.y} width={props.width} height={factsCardHeight(props.rows)} title={props.title}>
      <PropertyList
        x={px(CARD_PAD)}
        y={px(CARD_HEAD)}
        width={inner}
        height={body}
        density="compact"
        scroll={false}
        sections={[
          {
            id: props.title,
            items: props.rows.map((row) => ({
              id: row.label,
              label: row.label,
              value: row.value,
              tone: row.accent ? ("accent" as const) : undefined,
            })),
          },
        ]}
      />
    </Card>
  );
}
export const factsCardHeight = (rows: readonly Row[]) =>
  cardHeight(propertyListHeight(rows.length, "compact"));

/** Where the item is: its folders (each opens), Show in folder and Copy path. */
export function LocationCard(props: {
  y?: number;
  width: number;
  entries: readonly Entry[];
  trashDirectory?: string;
  actions: InspectorActions;
}): ReactNode {
  const first = props.entries[0]!;
  const folder = path.dirname(first.path);
  const segments = breadcrumbSegments(folder, props.actions.home, props.trashDirectory ?? "");
  const button = px(LOCATION_ROW);
  return (
    <Card y={props.y} width={props.width} height={locationCardHeight()} title="Location">
      <Breadcrumbs
        x={px(6)}
        y={px(CARD_HEAD)}
        width={props.width - px(CARD_PAD) - button * 2 - px(12)}
        height={button}
        size="small"
        segments={segments}
        onNavigate={props.actions.navigate}
      />
      {props.entries.length === 1 && !props.actions.inTrash ? (
        <IconButton
          x={props.width - px(CARD_PAD) - button * 2 - px(4)}
          y={px(CARD_HEAD)}
          width={button}
          height={button}
          variant="ghost"
          focusId="inspector:show-in-folder"
          tooltip="Show in folder"
          icon={glyph("folder", 14)}
          onPress={() => props.actions.showInFolder(first)}
        />
      ) : null}
      <IconButton
        x={props.width - px(CARD_PAD) - button}
        y={px(CARD_HEAD)}
        width={button}
        height={button}
        variant="ghost"
        focusId="inspector:copy-path"
        tooltip={props.entries.length === 1 ? "Copy path" : "Copy paths"}
        icon={glyph("copy", 14)}
        onPress={() => props.actions.copyPath(props.entries)}
      />
    </Card>
  );
}
export const locationCardHeight = () => cardHeight(px(LOCATION_ROW + 4));

/** The application every file of this type opens in; changing it rewrites mimeapps.list. */
export function OpensWithCard(props: {
  y?: number;
  width: number;
  association: FileAssociation;
  viewport: { width: number; height: number };
  actions: InspectorActions;
}): ReactNode {
  const pal = usePalette();
  const inner = props.width - px(CARD_PAD * 2);
  const { association } = props;
  const hint = association.applications.length
    ? `Default for every ${association.extension || association.mime} file`
    : "No installed application opens this type";
  return (
    <Card y={props.y} width={props.width} height={opensWithCardHeight()} title="Opens with">
      <Select
        x={px(CARD_PAD)}
        y={px(CARD_HEAD)}
        width={inner}
        height={px(SELECT_HEIGHT)}
        size="small"
        viewportWidth={props.viewport.width}
        viewportHeight={props.viewport.height}
        options={association.applications.map((application) => ({
          id: application.id,
          label: application.name,
        }))}
        value={association.defaultId}
        placeholder="Choose an application"
        disabled={!association.applications.length || props.actions.busy}
        onChange={(id) => {
          if (id !== association.defaultId) props.actions.setDefault(association, id);
        }}
      />
      <TextBlock
        x={px(CARD_PAD)}
        y={px(CARD_HEAD + SELECT_HEIGHT + 4)}
        width={inner}
        height={px(HINT_HEIGHT)}
        text={hint}
        color={pal.muted}
        fontSize={11}
        verticalAlign="center"
        maxLines={1}
        overflow="ellipsis"
      />
    </Card>
  );
}
export const opensWithCardHeight = () => cardHeight(px(SELECT_HEIGHT + 4 + HINT_HEIGHT + 4));

const BULK: ReadonlyArray<{ id: string; label: string; icon: IconName }> = [
  { id: "compress", label: "Compress", icon: "archive" },
  { id: "move", label: "Move to…", icon: "folder" },
  { id: "copy", label: "Copy to…", icon: "copy" },
  { id: "rename", label: "Rename…", icon: "editor" },
];

/** Bulk actions for a selection. */
export function ApplyCard(props: {
  y?: number;
  width: number;
  entries: readonly Entry[];
  actions: InspectorActions;
}): ReactNode {
  const { actions, entries } = props;
  const inner = props.width - px(CARD_PAD * 2);
  const half = Math.floor((inner - px(8)) / 2);
  const run: Record<string, () => void> = {
    compress: () => actions.compress(entries),
    move: () => actions.moveTo(entries),
    copy: () => actions.copyTo(entries),
    rename: () => actions.batchRename(entries),
  };
  return (
    <Card
      y={props.y}
      width={props.width}
      height={applyCardHeight()}
      title={`Apply to all ${entries.length}`}
    >
      {BULK.map((item, index) => (
        <Button
          key={item.id}
          x={px(CARD_PAD) + (index % 2) * (half + px(8))}
          y={px(CARD_HEAD) + Math.floor(index / 2) * px(BULK_ROW)}
          width={half}
          height={px(BULK_HEIGHT)}
          size="small"
          variant="secondary"
          label={item.label}
          focusId={`inspector:bulk:${item.id}`}
          disabled={actions.busy || actions.inTrash}
          leadingIcon={glyph(item.icon, 14)}
          onPress={run[item.id]}
        />
      ))}
    </Card>
  );
}
export const applyCardHeight = () => cardHeight(px(BULK_ROW + BULK_HEIGHT));
