import path from "node:path";
import React, { type ReactNode } from "react";
import { Box, Button, ImageWidget, Surface, getUiScaleFactor, usePalette } from "@moire/ui";
import { CenteredMessage, ZoomSurface, type Zoom } from "@moire/app-tools";
import type { DocumentLoad, PageLoad } from "#document-viewer/hooks";

/** The shown page on a bordered sheet under its zoom, or why it isn't shown yet. */
export function PageView(props: {
  width: number;
  height: number;
  file: string;
  document: DocumentLoad;
  page: PageLoad;
  zoom: Zoom;
  onRetry: () => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const error =
    props.document.kind === "error"
      ? props.document.message
      : props.page.kind === "error"
        ? props.page.message
        : null;
  if (error)
    return (
      <CenteredMessage
        width={props.width}
        height={props.height}
        icon="document"
        tone="danger"
        title="This document can't be shown"
        message={error}
        action={
          <Button width={140 * ui} height={36 * ui} label="Try again" onPress={props.onRetry} />
        }
      />
    );
  if (props.page.kind !== "ready")
    return (
      <CenteredMessage
        width={props.width}
        height={props.height}
        icon="document"
        tone="muted"
        title={props.document.kind === "ready" ? "Rendering page…" : "Opening document…"}
        message={path.basename(props.file)}
      />
    );
  const { preview } = props.page;
  return (
    <ZoomSurface
      width={props.width}
      height={props.height}
      zoom={props.zoom}
      wheel="scroll"
      focusId="document:page"
    >
      {(placement) => (
        <Box x={placement.x} y={placement.y} width={placement.width} height={placement.height}>
          <Surface
            x={-1}
            y={-1}
            width={placement.width + 2}
            height={placement.height + 2}
            fill={0xffffffff}
            stroke={pal.borderSubtle}
            strokeWidth={1}
          />
          <ImageWidget
            width={placement.width}
            height={placement.height}
            bitmap={preview.bitmap}
            placeholder={false}
            fit="fill"
          />
        </Box>
      )}
    </ZoomSurface>
  );
}
