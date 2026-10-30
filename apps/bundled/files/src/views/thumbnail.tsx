/**
 * A file's picture: its thumbnail (photos, video frames, album art, a PDF's first page, a font's
 * "Aa") once the workers have made it, and until then — or for files without one — a tinted tile
 * with its kind's icon.
 */
import React, { type ReactNode } from "react";
import { Icon, ImageWidget, Surface, mixColor, usePalette } from "@moire/ui";
import { entryKind, kindIcon, kindTint } from "#files/kind-style";
import { previewKindFor, type PreviewSubject } from "#files/preview/model";
import { useThumbnail } from "#files/preview/use-thumbnail";

export type ThumbnailEntry = PreviewSubject;

export function Thumbnail(props: {
  entry: ThumbnailEntry;
  width: number;
  height?: number;
  radius: number;
  /** The icon's share of the tile's shorter side. */
  iconScale?: number;
  /** The tile sits on this colour; the page background by default. */
  backdrop?: number;
  /**
   * "contain" shows the whole picture (previews); "cover" fills the tile. Tiles default to cover,
   * except pages (PDFs), whose shape is the point and whose middle is mostly blank paper.
   */
  fit?: "contain" | "cover";
  /** A PDF's page to show, from 1. */
  page?: number;
}): ReactNode {
  const pal = usePalette();
  const height = props.height ?? props.width;
  const kind = entryKind(props.entry);
  const page = previewKindFor(props.entry) === "pdf";
  const fit = props.fit ?? (page ? "contain" : "cover");
  const picture = useThumbnail(props.entry, { width: props.width, height, fit, page: props.page });
  const tint = kindTint(kind, pal);
  const tile = mixColor(props.backdrop ?? pal.bg, tint, 0.16);
  if (picture)
    return (
      <Surface
        width={props.width}
        height={height}
        radius={props.radius}
        fill={fit === "cover" ? pal.surface : props.fit ? 0x00000000 : tile}
        clip
      >
        <ImageWidget
          width={props.width}
          height={height}
          bitmap={picture}
          fit="contain"
          placeholder={false}
        />
      </Surface>
    );
  const icon = Math.round(Math.min(props.width, height) * (props.iconScale ?? 0.5));
  return (
    <Surface width={props.width} height={height} radius={props.radius} fill={tile}>
      <Icon
        x={Math.round((props.width - icon) / 2)}
        y={Math.round((height - icon) / 2)}
        name={kindIcon(kind)}
        size={icon}
        color={tint}
        symbolic
      />
    </Surface>
  );
}
