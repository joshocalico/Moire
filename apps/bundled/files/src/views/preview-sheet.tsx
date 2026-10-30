/**
 * Space's preview: the item large (see `PreviewStage` for what each kind shows) with its details.
 * Left/Right and Up/Down page through the items around it; Escape or Space closes.
 */
import React, { type ReactNode } from "react";
import {
  Box,
  Button,
  FocusScope,
  IconButton,
  Icon,
  ModalBarrier,
  PointerArea,
  Surface,
  TextBlock,
  getUiScaleFactor,
  usePalette,
  type HitKeyEvent,
} from "@moire/ui";
import path from "node:path";
import type { Entry } from "#files/filesystem";
import { formatDay, tidyPath } from "#files/format";
import { entryCaption } from "#files/kind-style";
import { previewFacts, previewKindFor } from "#files/preview/model";
import { useAudioPlayback } from "#files/preview/use-audio-playback";
import { usePreview } from "#files/preview/use-preview";
import { PreviewStage } from "./preview-stage";

const MAX_WIDTH = 760;
const MAX_HEIGHT = 560;
const DETAILS_WIDTH = 240;
export const PREVIEW_FOCUS_ID = "files:preview";

export function PreviewSheet(props: {
  width: number;
  height: number;
  entries: readonly Entry[];
  index: number;
  home: string;
  refresh: number;
  onIndex(index: number): void;
  onOpen(entry: Entry): void;
  onClose(): void;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const px = (value: number) => Math.round(value * ui);
  const entry = props.entries[props.index] ?? null;
  const preview = usePreview(entry, props.refresh);
  const playback = useAudioPlayback(entry && previewKindFor(entry) === "audio" ? entry.path : null);
  if (!entry) return null;
  const width = Math.min(props.width - px(32), px(MAX_WIDTH));
  const height = Math.min(props.height - px(32), px(MAX_HEIGHT));
  const x = Math.round((props.width - width) / 2);
  const y = Math.round((props.height - height) / 2);
  const side = width >= px(560);
  const detailsWidth = side ? px(DETAILS_WIDTH) : width - px(32);
  const stage = {
    width: side ? width - detailsWidth - px(48) : width - px(32),
    height: side ? height - px(72) : Math.round((height - px(72)) * 0.55),
  };
  const page = (delta: number) => {
    const next = props.index + delta;
    if (next >= 0 && next < props.entries.length) props.onIndex(next);
  };
  const onKey = (event: HitKeyEvent) => {
    if (event.key === " " || event.code === 57) props.onClose();
    else if (
      event.key === "ArrowLeft" ||
      event.code === 105 ||
      event.key === "ArrowUp" ||
      event.code === 103
    )
      page(-1);
    else if (
      event.key === "ArrowRight" ||
      event.code === 106 ||
      event.key === "ArrowDown" ||
      event.code === 108
    )
      page(1);
    else if (event.key === "Enter" || event.code === 28) props.onOpen(entry);
    else return false;
    return true;
  };
  const details: Array<readonly [string, string]> = [
    ["Kind", entryCaption(entry)],
    ["Modified", formatDay(entry.modified)],
    ["Where", tidyPath(path.dirname(entry.path), props.home)],
    ...previewFacts(preview),
  ];
  const stageNode = (
    <PreviewStage
      subject={entry}
      preview={preview}
      width={stage.width}
      height={stage.height}
      playback={preview?.kind === "audio" ? playback : undefined}
    />
  );
  const detailsX = side ? width - detailsWidth - px(16) : px(16);
  const detailsY = side ? px(56) : px(56) + stage.height + px(16);
  return (
    <>
      <ModalBarrier width={props.width} height={props.height} visible onDismiss={props.onClose} />
      <FocusScope x={x} y={y} width={width} height={height} trap onEscape={props.onClose}>
        <Surface
          width={width}
          height={height}
          fill={pal.panel}
          radius={px(14)}
          stroke={pal.border}
          strokeWidth={1}
          elevation="high"
        >
          <PointerArea
            width={width}
            height={height}
            focusable
            autoFocus
            focusId={PREVIEW_FOCUS_ID}
            onKeyDown={onKey}
          />
          <TextBlock
            x={px(16)}
            y={px(12)}
            width={width - px(150)}
            height={px(32)}
            text={entry.name}
            fontSize={16}
            fontWeight="medium"
            verticalAlign="center"
            overflow="ellipsis"
            maxLines={1}
          />
          <TextBlock
            x={width - px(150)}
            y={px(12)}
            width={px(56)}
            height={px(32)}
            text={`${props.index + 1} of ${props.entries.length}`}
            color={pal.muted}
            fontSize={11}
            horizontalAlign="end"
            verticalAlign="center"
            maxLines={1}
          />
          <Box x={width - px(84)} y={px(12)} width={px(68)} height={px(32)}>
            <IconButton
              width={px(32)}
              height={px(32)}
              variant="ghost"
              tooltip="Previous · Left"
              disabled={props.index === 0}
              icon={(style) => (
                <Icon name="chevron-left" size={Math.round(16 * ui)} color={style.color} symbolic />
              )}
              onPress={() => page(-1)}
            />
            <IconButton
              x={px(36)}
              width={px(32)}
              height={px(32)}
              variant="ghost"
              tooltip="Next · Right"
              disabled={props.index >= props.entries.length - 1}
              icon={(style) => (
                <Icon
                  name="chevron-right"
                  size={Math.round(16 * ui)}
                  color={style.color}
                  symbolic
                />
              )}
              onPress={() => page(1)}
            />
          </Box>
          <Box x={px(16)} y={px(56)} width={stage.width} height={stage.height}>
            {stageNode}
          </Box>
          {details
            .slice(0, Math.max(0, Math.floor((height - px(56) - detailsY) / px(40))))
            .map(([key, value], index) => (
              <Box
                key={key}
                x={detailsX}
                y={detailsY + index * px(40)}
                width={detailsWidth}
                height={px(36)}
              >
                <TextBlock
                  width={detailsWidth}
                  height={px(16)}
                  text={key}
                  color={pal.muted}
                  fontSize={11}
                  verticalAlign="center"
                  maxLines={1}
                />
                <TextBlock
                  y={px(16)}
                  width={detailsWidth}
                  height={px(18)}
                  text={value}
                  fontSize={12}
                  verticalAlign="center"
                  overflow="ellipsis"
                  maxLines={1}
                />
              </Box>
            ))}
          <Button
            x={detailsX}
            y={height - px(48)}
            width={side ? detailsWidth : px(120)}
            height={px(32)}
            variant="primary"
            label="Open"
            focusId="preview:open"
            onPress={() => props.onOpen(entry)}
          />
        </Surface>
      </FocusScope>
    </>
  );
}
