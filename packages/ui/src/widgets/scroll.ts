/**
 * ScrollArea — clip:true group with content offset, wheel handler,
 * and optional scrollbar thumb.
 */
import { createElement, useState, type ReactNode } from "react";
import { Group, Rect } from "@moire/react-host";
import { themePalette } from "../theme.js";
import type { HitPointerEvent } from "@moire/react-host";

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
};

const SCROLLBAR_W = 6;
const SCROLLBAR_MARGIN = 2;

export function ScrollArea(props: ScrollAreaProps): ReactNode {
  const pal = themePalette();
  const [internalScrollY, setInternalScrollY] = useState(props.scrollY ?? 0);

  // Controlled vs. uncontrolled
  const scrollY = props.scrollY !== undefined ? props.scrollY : internalScrollY;
  const maxScroll = Math.max(0, props.contentHeight - props.height);
  const clampedY = Math.max(0, Math.min(maxScroll, scrollY));

  const handleWheel = (ev: HitPointerEvent) => {
    const dy = ev.deltaY ?? 30;
    const next = Math.max(0, Math.min(maxScroll, clampedY + dy));
    if (props.onScroll) {
      props.onScroll(next);
    } else {
      setInternalScrollY(next);
    }
  };

  const showScrollbar =
    (props.scrollbar !== false) && props.contentHeight > props.height;
  const scrollbarW = showScrollbar ? SCROLLBAR_W + SCROLLBAR_MARGIN : 0;
  const contentW = props.width - scrollbarW;

  // Scrollbar thumb geometry
  let thumbY = 0;
  let thumbH = 0;
  if (showScrollbar && maxScroll > 0) {
    const ratio = props.height / props.contentHeight;
    thumbH = Math.max(20, Math.floor(props.height * ratio));
    thumbY = Math.floor(
      ((props.height - thumbH) * clampedY) / maxScroll,
    );
  }

  return createElement(
    Group,
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: props.width,
      height: props.height,
    },
    // Background
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.width,
      height: props.height,
      fill: pal.panel,
    }),
    // Clipped content group
    createElement(
      Group,
      {
        x: 0,
        y: 0,
        width: contentW,
        height: props.height,
        clip: true,
      },
      // Inner content offset upward by scrollY
      createElement(
        Group,
        {
          x: 0,
          y: -clampedY,
          width: contentW,
          height: props.contentHeight,
        },
        props.children,
      ),
    ),
    // Invisible full-area wheel target
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.width,
      height: props.height,
      fill: 0x00000000,
      onWheel: maxScroll > 0 ? handleWheel : undefined,
    }),
    // Scrollbar track + thumb
    showScrollbar
      ? createElement(Rect, {
          x: contentW + SCROLLBAR_MARGIN,
          y: 0,
          width: SCROLLBAR_W,
          height: props.height,
          fill: pal.surface,
        })
      : null,
    showScrollbar && thumbH > 0
      ? createElement(Rect, {
          x: contentW + SCROLLBAR_MARGIN,
          y: thumbY,
          width: SCROLLBAR_W,
          height: thumbH,
          fill: pal.border,
        })
      : null,
  );
}
