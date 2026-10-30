/**
 * A folder at a glance: a mosaic of the first pictures inside (or its first entries), how many
 * items and folders, the total, and its bytes by kind as a stacked bar with a legend.
 */
import React, { type ReactNode } from "react";
import {
  Box,
  StackedBar,
  Surface,
  TextBlock,
  measureWrappedText,
  stackedBarHeight,
  usePalette,
} from "@moire/ui";
import type { FileKind } from "@moire/file-operations";
import type { Entry } from "#files/filesystem";
import { countLabel, formatBytes } from "#files/format";
import { kindTint } from "#files/kind-style";
import type { Preview, PreviewSubject } from "#files/preview/model";
import { PreviewStage } from "#files/views/preview-stage";
import { Thumbnail } from "#files/views/thumbnail";
import { px } from "./cards";
import { KIND_PLURAL } from "./model";

const MOSAIC = 120;
const GAP = 4;
const COUNTS = 18;

type Folder = Extract<Preview, { kind: "folder" }>;

export const folderHeroHeight = (_preview: Folder) =>
  px(MOSAIC + 10 + COUNTS + 6) + stackedBarHeight(true);

type Cell = { x: number; y: number; w: number; h: number };

/** One big picture beside smaller ones, for up to four. */
function mosaicCells(count: number, width: number, height: number): Cell[] {
  const gap = px(GAP);
  if (count <= 1) return [{ x: 0, y: 0, w: width, h: height }];
  const big = Math.round((width - gap) / 2);
  const rest = width - big - gap;
  if (count === 2)
    return [
      { x: 0, y: 0, w: big, h: height },
      { x: big + gap, y: 0, w: rest, h: height },
    ];
  const half = Math.round((height - gap) / 2);
  const lower = height - half - gap;
  if (count === 3)
    return [
      { x: 0, y: 0, w: big, h: height },
      { x: big + gap, y: 0, w: rest, h: half },
      { x: big + gap, y: half + gap, w: rest, h: lower },
    ];
  const small = Math.round((rest - gap) / 2);
  return [
    { x: 0, y: 0, w: big, h: height },
    { x: big + gap, y: 0, w: rest, h: half },
    { x: big + gap, y: half + gap, w: small, h: lower },
    { x: big + gap * 2 + small, y: half + gap, w: rest - small - gap, h: lower },
  ];
}

export function FolderHero(props: {
  entry: Entry;
  preview: Folder;
  width: number;
  height: number;
}): ReactNode {
  const pal = usePalette();
  const { preview, width } = props;
  const mosaic = px(MOSAIC);
  const pictures: readonly PreviewSubject[] = preview.pictures.slice(0, 4);
  const cells = mosaicCells(pictures.length, width, mosaic);
  const size = preview.size;
  const kinds = Object.entries(size.byKind ?? {})
    .filter((pair): pair is [FileKind, number] => (pair[1] ?? 0) > 0)
    .sort((a, b) => b[1] - a[1]);
  const counts = [
    countLabel(preview.items),
    countLabel(preview.folders, "folder"),
    preview.hidden ? `${preview.hidden} hidden` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const total =
    size.state === "measuring" && !size.files
      ? "Measuring…"
      : `${size.state === "partial" ? "At least " : ""}${formatBytes(size.bytes)}`;
  // The counts give way (ellipsis) to the total at the right.
  const totalWidth = Math.ceil(
    measureWrappedText(total, width, { fontSize: 12, fontWeight: "medium" }).width,
  );
  return (
    <Box width={width} height={props.height}>
      {pictures.length ? (
        <Surface width={width} height={mosaic} radius={px(10)} fill={pal.bg} clip>
          {pictures.map((picture, index) => {
            const cell = cells[index]!;
            return (
              <Box key={picture.path} x={cell.x} y={cell.y} width={cell.w} height={cell.h}>
                <Thumbnail entry={picture} width={cell.w} height={cell.h} radius={0} fit="cover" />
              </Box>
            );
          })}
        </Surface>
      ) : (
        <PreviewStage subject={props.entry} preview={preview} width={width} height={mosaic} />
      )}
      <TextBlock
        y={mosaic + px(10)}
        width={Math.max(1, width - totalWidth - px(12))}
        height={px(COUNTS)}
        text={counts}
        fontSize={12}
        verticalAlign="center"
        maxLines={1}
        overflow="ellipsis"
      />
      <TextBlock
        y={mosaic + px(10)}
        width={width}
        height={px(COUNTS)}
        text={total}
        fontSize={12}
        fontWeight="medium"
        horizontalAlign="end"
        verticalAlign="center"
        maxLines={1}
      />
      <StackedBar
        y={mosaic + px(10 + COUNTS + 6)}
        width={width}
        segments={kinds.map(([kind, bytes]) => ({
          id: kind,
          label: KIND_PLURAL[kind],
          detail: formatBytes(bytes),
          value: bytes,
          colour: kindTint(kind, pal),
        }))}
      />
    </Box>
  );
}
