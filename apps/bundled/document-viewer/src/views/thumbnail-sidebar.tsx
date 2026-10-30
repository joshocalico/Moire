import React, { useEffect, useState, type ReactNode } from "react";
import {
  Box,
  ImageWidget,
  Pressable,
  Separator,
  Surface,
  TextBlock,
  VirtualList,
  getUiScaleFactor,
  usePalette,
} from "@moire/ui";
import { pageAspect, type DocumentInfo, type ThumbnailStore } from "#document-viewer/backend";
import { useThumbnail } from "#document-viewer/hooks";

/** Sidebar width at UI scale 1. */
export const SIDEBAR_WIDTH = 160;
const THUMB_WIDTH = 96;
const LABEL_HEIGHT = 18;
const ITEM_PADDING = 10;

function thumbnailSize(aspect: number): { width: number; height: number } {
  const width = THUMB_WIDTH * getUiScaleFactor();
  return { width, height: Math.round(width * Math.min(1.6, Math.max(0.4, aspect))) };
}

/** The long edge thumbnails are drawn at, so they can be rendered at exactly that size. */
export function thumbnailPixels(info: DocumentInfo | null): number {
  const size = thumbnailSize(info ? pageAspect(info) : 1);
  return Math.round(Math.max(size.width, size.height));
}

/** Every page as a thumbnail; the shown page is marked and kept in view. */
export function ThumbnailSidebar(props: {
  height: number;
  pages: number;
  page: number;
  /** Page height over width, from the document's first page. */
  aspect: number;
  store: ThumbnailStore | null;
  onGo: (page: number) => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const width = SIDEBAR_WIDTH * ui;
  const thumbW = THUMB_WIDTH * ui;
  const thumbH = Math.round(thumbW * Math.min(1.6, Math.max(0.4, props.aspect)));
  const itemH = thumbH + (LABEL_HEIGHT + ITEM_PADDING * 2 + 4) * ui;
  const [scrollY, setScrollY] = useState(0);
  // Keep the shown page in view when it changes by keyboard or the page field.
  useEffect(() => {
    const top = (props.page - 1) * itemH;
    setScrollY((current) =>
      top < current
        ? top
        : top + itemH > current + props.height
          ? top + itemH - props.height
          : current,
    );
  }, [props.page, itemH, props.height]);
  const pages = Array.from({ length: props.pages }, (_, index) => index + 1);
  return (
    <Surface width={width} height={props.height} fill={pal.panel}>
      <VirtualList
        width={width - 1}
        height={props.height}
        items={pages}
        itemHeight={itemH}
        overscan={2}
        scrollY={scrollY}
        onScroll={setScrollY}
        renderItem={(page) => (
          <Thumbnail
            store={props.store}
            page={page}
            width={width - 1}
            height={itemH}
            thumbW={thumbW}
            thumbH={thumbH}
            selected={page === props.page}
            onPress={() => props.onGo(page)}
          />
        )}
      />
      <Separator x={width - 1} width={1} height={props.height} color={pal.borderSubtle} />
    </Surface>
  );
}

function Thumbnail(props: {
  store: ThumbnailStore | null;
  page: number;
  width: number;
  height: number;
  thumbW: number;
  thumbH: number;
  selected: boolean;
  onPress: () => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const thumbnail = useThumbnail(props.store, props.page);
  const x = (props.width - props.thumbW) / 2;
  const y = ITEM_PADDING * ui;
  const ring = 3 * ui;
  return (
    <Pressable
      width={props.width}
      height={props.height}
      fill={0x00000000}
      hoverFill={pal.hover}
      pressedFill={pal.pressed}
      focusId={`document:thumbnail:${props.page}`}
      onPress={props.onPress}
    >
      {props.selected ? (
        <Surface
          x={x - ring}
          y={y - ring}
          width={props.thumbW + ring * 2}
          height={props.thumbH + ring * 2}
          radius={4 * ui}
          fill={pal.accent}
        />
      ) : null}
      <Surface
        x={x}
        y={y}
        width={props.thumbW}
        height={props.thumbH}
        fill={0xffffffff}
        stroke={pal.borderSubtle}
        strokeWidth={1}
      >
        {thumbnail && thumbnail !== "error" ? (
          <ImageWidget
            width={props.thumbW}
            height={props.thumbH}
            bitmap={thumbnail.bitmap}
            placeholder={false}
            fit="contain"
          />
        ) : null}
      </Surface>
      <Box x={0} y={y + props.thumbH + 4 * ui} width={props.width} height={LABEL_HEIGHT * ui}>
        <TextBlock
          width={props.width}
          height={LABEL_HEIGHT * ui}
          text={thumbnail === "error" ? `${props.page} · unreadable` : String(props.page)}
          color={props.selected ? pal.text : pal.muted}
          fontSize={11}
          fontWeight={props.selected ? "medium" : "regular"}
          horizontalAlign="center"
          verticalAlign="center"
        />
      </Box>
    </Pressable>
  );
}
