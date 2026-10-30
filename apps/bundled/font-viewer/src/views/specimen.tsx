import path from "node:path";
import React, { useEffect, useState, type ReactNode } from "react";
import { ImageWidget, ScrollArea, TextBlock, getUiScaleFactor, usePalette } from "@moire/ui";
import { Card, CenteredMessage, errorText } from "@moire/app-tools";
import { fontSpecimen, type FontSpecimen } from "#font-viewer/backend";
import type { Face } from "#font-viewer/model";

/** The face's sample sentence at several sizes and the characters it covers. */
export function Specimen(props: {
  file: string;
  width: number;
  height: number;
  color: number;
  onFace: (face: Face) => void;
  onError: (message: string) => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const [specimen, setSpecimen] = useState<FontSpecimen | null>(null),
    [error, setError] = useState("");
  const outer = 16 * ui;
  const cardW = Math.max(1, props.width - outer * 2);
  // Re-render on 32px width steps so resizing does not start a raster per frame.
  const canvas = Math.min(4096, Math.max(160, Math.floor((cardW - 28 * ui) / 32) * 32));
  useEffect(() => {
    let alive = true,
      loaded: FontSpecimen | null = null;
    const controller = new AbortController();
    setError("");
    void fontSpecimen(
      props.file,
      { width: canvas, color: props.color & 0xffffff, scale: ui },
      controller.signal,
    ).then(
      (value) => {
        loaded = value;
        if (alive) {
          setSpecimen(value);
          props.onFace({ family: value.family, style: value.style });
        } else void dispose(value);
      },
      (reason) => {
        if (alive) {
          setError(errorText(reason));
          props.onError(errorText(reason));
        }
      },
    );
    return () => {
      alive = false;
      controller.abort();
      if (loaded) void dispose(loaded);
    };
  }, [props.file, props.color, canvas, ui]);
  if (!specimen)
    return error ? (
      <CenteredMessage
        width={props.width}
        height={props.height}
        icon="font"
        tone="danger"
        title="This font can't be shown"
        message={error}
      />
    ) : (
      <CenteredMessage
        width={props.width}
        height={props.height}
        icon="font"
        tone="muted"
        title="Rendering specimen…"
        message={path.basename(props.file)}
      />
    );
  const headerH = 58 * ui;
  const sizesH = 38 * ui + specimen.sizes.height + 14 * ui;
  const glyphsH = 38 * ui + specimen.glyphs.height + 14 * ui;
  const gap = 12 * ui;
  const contentH = outer + headerH + sizesH + gap + glyphsH + outer;
  const format = path.extname(props.file).slice(1).toUpperCase();
  return (
    <ScrollArea
      width={props.width}
      height={props.height}
      contentHeight={Math.max(props.height, contentH)}
      keyboard={{ focusId: "font:specimen" }}
    >
      <TextBlock
        x={outer + 4 * ui}
        y={outer}
        width={cardW - 8 * ui}
        height={30 * ui}
        text={specimen.family}
        fontSize={20}
        fontWeight="medium"
        maxLines={1}
        overflow="ellipsis"
      />
      <TextBlock
        x={outer + 4 * ui}
        y={outer + 30 * ui}
        width={cardW - 8 * ui}
        height={20 * ui}
        text={`${specimen.style} · ${specimen.glyphCount.toLocaleString("en")} glyphs · ${format}`}
        color={pal.muted}
        fontSize={12}
        maxLines={1}
        overflow="ellipsis"
      />
      <Card x={outer} y={outer + headerH} width={cardW} height={sizesH} title="Sizes">
        <ImageWidget
          width={specimen.sizes.width}
          height={specimen.sizes.height}
          bitmap={specimen.sizes.bitmap}
          placeholder={false}
          fit="fill"
        />
      </Card>
      <Card
        x={outer}
        y={outer + headerH + sizesH + gap}
        width={cardW}
        height={glyphsH}
        title="Characters"
      >
        <ImageWidget
          width={specimen.glyphs.width}
          height={specimen.glyphs.height}
          bitmap={specimen.glyphs.bitmap}
          placeholder={false}
          fit="fill"
        />
      </Card>
    </ScrollArea>
  );
}
async function dispose(specimen: FontSpecimen): Promise<void> {
  await Promise.all([specimen.sizes.dispose(), specimen.glyphs.dispose()]);
}
