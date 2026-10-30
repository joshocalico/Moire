import path from "node:path";
import React, { type ReactNode } from "react";
import { Button, ImageWidget, getUiScaleFactor } from "@moire/ui";
import { CenteredMessage, ZoomSurface, type Preview, type Zoom } from "@moire/app-tools";
import type { ImageLoad } from "#image-viewer/hooks";

/** The open image under its zoom, or why it isn't shown yet. */
export function ImageBody(props: {
  width: number;
  height: number;
  file: string;
  load: ImageLoad;
  /** The image decoded at its shown size, drawn instead of the full decode when present. */
  scaled: Preview | null;
  zoom: Zoom;
  onRetry: () => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const { load } = props;
  if (load.kind === "ready")
    return (
      <ZoomSurface
        width={props.width}
        height={props.height}
        zoom={props.zoom}
        focusId="image:canvas"
      >
        {(placement) => (
          <ImageWidget
            x={placement.x}
            y={placement.y}
            width={placement.width}
            height={placement.height}
            bitmap={(props.scaled ?? load.preview).bitmap}
            placeholder={false}
            fit="fill"
          />
        )}
      </ZoomSurface>
    );
  if (load.kind === "error")
    return (
      <CenteredMessage
        width={props.width}
        height={props.height}
        icon="image"
        tone="danger"
        title="This image can't be shown"
        message={load.message}
        action={
          <Button width={140 * ui} height={36 * ui} label="Try again" onPress={props.onRetry} />
        }
      />
    );
  return (
    <CenteredMessage
      width={props.width}
      height={props.height}
      icon="image"
      tone="muted"
      title="Opening image…"
      message={path.basename(props.file)}
    />
  );
}
