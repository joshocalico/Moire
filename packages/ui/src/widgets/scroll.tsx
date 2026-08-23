/** Clipped vertical viewport with wheel, track, and captured thumb scrolling. */
import React, { useRef, useState, type ReactNode } from "react";
import { Group, Rect, type HitPointerEvent } from "@moire/react-host";
import {
  resolveStatefulStyle,
  useWidgetTheme,
  type ButtonSize,
} from "../widget-theme.js";

export type ScrollAreaProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  /** Total height of scrollable content. */
  contentHeight: number;
  /** Controlled scroll offset; use together with onScroll for controlled mode. */
  scrollY?: number;
  /** Called when the scroll position should change. */
  onScroll?: (y: number) => void;
  children?: ReactNode;
  /** Show a scrollbar thumb. Defaults to true when content overflows. */
  scrollbar?: boolean;
  size?: ButtonSize;
  /** Legacy escape hatch for the viewport paint. */
  fill?: number;
};

type ThumbDrag = { pointerY: number; scrollY: number };

export function ScrollArea(props: ScrollAreaProps): ReactNode {
  const recipe = useWidgetTheme().recipes.scrollArea[props.size ?? "medium"];
  const [internalScrollY, setInternalScrollY] = useState(props.scrollY ?? 0);
  const [trackHovered, setTrackHovered] = useState(false);
  const [thumbHovered, setThumbHovered] = useState(false);
  const [thumbPressed, setThumbPressed] = useState(false);
  const drag = useRef<ThumbDrag | null>(null);
  const maxScroll = Math.max(0, props.contentHeight - props.height);
  const sourceY = props.scrollY !== undefined ? props.scrollY : internalScrollY;
  const clampedY = Math.max(0, Math.min(maxScroll, sourceY));
  const showScrollbar = props.scrollbar !== false && maxScroll > 0;
  const track = resolveStatefulStyle(
    recipe.track,
    trackHovered || thumbHovered || thumbPressed ? "hover" : "rest",
  );
  const thumb = resolveStatefulStyle(
    recipe.thumb,
    thumbPressed ? "pressed" : thumbHovered ? "hover" : "rest",
  );
  const scrollbarX =
    props.width -
    recipe.metrics.scrollbarMargin -
    recipe.metrics.scrollbarWidth;
  const ratio = props.height / Math.max(props.height, props.contentHeight);
  const thumbHeight = showScrollbar
    ? Math.min(
        props.height,
        Math.max(
          recipe.metrics.minThumbHeight,
          Math.floor(props.height * ratio),
        ),
      )
    : 0;
  const thumbTravel = Math.max(0, props.height - thumbHeight);
  const thumbY =
    maxScroll > 0 ? Math.floor((thumbTravel * clampedY) / maxScroll) : 0;

  const setScroll = (next: number) => {
    const clamped = Math.max(0, Math.min(maxScroll, next));
    if (props.onScroll) props.onScroll(clamped);
    else setInternalScrollY(clamped);
  };
  const handleWheel = (event: HitPointerEvent) => {
    setScroll(clampedY + (event.deltaY ?? recipe.metrics.wheelStep));
  };
  const scrollFromTrack = (localY: number) => {
    if (thumbTravel <= 0) return;
    setScroll(((localY - thumbHeight / 2) / thumbTravel) * maxScroll);
  };

  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={props.height}
      clip
    >
      <Rect
        width={props.width}
        height={props.height}
        fill={props.fill ?? recipe.viewport.fill}
        radius={recipe.viewport.radius}
        stroke={recipe.viewport.stroke}
        strokeWidth={recipe.viewport.strokeWidth}
      />
      <Group width={props.width} height={props.height} clip>
        <Group
          x={0}
          y={-clampedY}
          width={props.width}
          height={props.contentHeight}
        >
          {props.children}
        </Group>
      </Group>
      <Rect
        width={props.width}
        height={props.height}
        fill={0x00000000}
        onWheel={maxScroll > 0 ? handleWheel : undefined}
      />
      {showScrollbar ? (
        <Rect
          x={scrollbarX}
          y={0}
          width={recipe.metrics.scrollbarWidth}
          height={props.height}
          fill={track.fill}
          radius={track.radius}
          stroke={track.stroke}
          strokeWidth={track.strokeWidth}
          onPointerEnter={() => setTrackHovered(true)}
          onPointerLeave={() => setTrackHovered(false)}
          onPress={(event) => scrollFromTrack(event.localY)}
        />
      ) : null}
      {showScrollbar && thumbHeight > 0 ? (
        <Rect
          x={scrollbarX}
          y={thumbY}
          width={recipe.metrics.scrollbarWidth}
          height={thumbHeight}
          fill={thumb.fill}
          radius={thumb.radius}
          stroke={thumb.stroke}
          strokeWidth={thumb.strokeWidth}
          onPointerEnter={() => setThumbHovered(true)}
          onPointerLeave={() => setThumbHovered(false)}
          onPointerDown={(event) => {
            drag.current = { pointerY: event.y, scrollY: clampedY };
            setThumbPressed(true);
          }}
          onPointerMove={(event) => {
            if (!drag.current || thumbTravel <= 0) return;
            const delta = event.y - drag.current.pointerY;
            setScroll(drag.current.scrollY + (delta / thumbTravel) * maxScroll);
          }}
          onPointerUp={() => {
            drag.current = null;
            setThumbPressed(false);
          }}
        />
      ) : null}
    </Group>
  );
}
