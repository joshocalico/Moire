/** The image being edited, and the drag surface over it for cropping and drawing. */
import React, { type ReactNode } from "react";
import { PointerArea, Surface, usePalette, type ImageData } from "@moire/ui";
import type { Point } from "#screenshot/image";
import { gestureBounds, type Gesture, type Tool } from "#screenshot/model";

type Placement = {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
};

/** Where an image sits when fitted (contained and centred) into `box`. */
export function placeImage(
  box: { x: number; y: number; width: number; height: number },
  image: ImageData,
): Placement {
  const scale = Math.min(box.width / image.width, box.height / image.height);
  const width = image.width * scale,
    height = image.height * scale;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
    scale,
  };
}

/** Input over the fitted image; reports points both in view and in image pixels. */
export function CanvasOverlay(props: {
  placement: Placement;
  image: ImageData;
  tool: Tool;
  gesture: Gesture | null;
  busy: boolean;
  onFocus: (focused: boolean) => void;
  onBegin: (local: Point, at: Point) => void;
  onMove: (local: Point, at: Point) => void;
  onEnd: (local: Point, at: Point) => void;
  onUndo: () => void;
}): ReactNode {
  const pal = usePalette();
  const { placement, image } = props;
  const toImage = (x: number, y: number): Point => ({
    x: Math.max(0, Math.min(image.width - 1, x / placement.scale)),
    y: Math.max(0, Math.min(image.height - 1, y / placement.scale)),
  });
  const box = props.gesture && props.tool !== "pen" ? gestureBounds(props.gesture) : null;
  return (
    <Surface
      x={placement.x}
      y={placement.y}
      width={placement.width}
      height={placement.height}
      fill={0x00000000}
      clip
    >
      <PointerArea
        width={placement.width}
        height={placement.height}
        focusable
        focusId="screenshot-canvas"
        onFocusChange={props.onFocus}
        onKeyDown={(event) => {
          if (event.ctrlKey && event.code === 44) {
            props.onUndo();
            return true;
          }
          return false;
        }}
        onPointerDown={(event) => {
          if (props.busy) return;
          props.onBegin({ x: event.localX, y: event.localY }, toImage(event.localX, event.localY));
        }}
        onPointerMove={(event) =>
          props.onMove({ x: event.localX, y: event.localY }, toImage(event.localX, event.localY))
        }
        onPointerUp={(event) =>
          props.onEnd({ x: event.localX, y: event.localY }, toImage(event.localX, event.localY))
        }
      />
      {box ? (
        <Surface
          x={box.x * placement.scale}
          y={box.y * placement.scale}
          width={box.width * placement.scale}
          height={box.height * placement.scale}
          fill={0x22000000}
          stroke={pal.accent}
          strokeWidth={2}
        />
      ) : null}
    </Surface>
  );
}
