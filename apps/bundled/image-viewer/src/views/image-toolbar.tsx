import React, { type ReactNode } from "react";
import { getUiScaleFactor } from "@moire/ui";
import {
  ToolButton,
  ToolReadout,
  ToolRow,
  ToolSeparator,
  ZoomControls,
  type Zoom,
} from "@moire/app-tools";

/** Previous/next in the folder, zoom and rotation. */
export function ImageToolbar(props: {
  width: number;
  zoom: Zoom;
  ready: boolean;
  position: { index: number; total: number } | null;
  onStep: (delta: 1 | -1) => void;
  onRotate: (by: 1 | -1) => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const { position } = props;
  return (
    <ToolRow width={props.width}>
      <ToolButton
        icon="chevron-left"
        tooltip="Previous image (←)"
        focusId="image:previous"
        disabled={!position || position.index <= 0}
        onPress={() => props.onStep(-1)}
      />
      <ToolReadout
        width={64 * ui}
        text={position ? `${position.index + 1} of ${position.total}` : "—"}
      />
      <ToolButton
        icon="chevron-right"
        tooltip="Next image (→)"
        focusId="image:next"
        disabled={!position || position.index >= position.total - 1}
        onPress={() => props.onStep(1)}
      />
      <ToolSeparator />
      <ZoomControls zoom={props.zoom} idPrefix="image" disabled={!props.ready} />
      <ToolSeparator />
      <ToolButton
        icon="rotate-left"
        tooltip="Rotate left"
        focusId="image:rotate-left"
        disabled={!props.ready}
        onPress={() => props.onRotate(-1)}
      />
      <ToolButton
        icon="rotate-right"
        tooltip="Rotate right"
        focusId="image:rotate-right"
        disabled={!props.ready}
        onPress={() => props.onRotate(1)}
      />
    </ToolRow>
  );
}
