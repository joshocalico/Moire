/** Clipped vertical viewport with wheel, track, and captured thumb scrolling. */
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { Group, Rect, type HitKeyEvent, type HitPointerEvent } from "@moire/react-host";
import { resolveStatefulStyle, useWidgetTheme, type ButtonSize } from "#ui/widget-theme";
import { useDampedValue } from "#ui/motion";
import { FocusRing } from "./primitives";

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
  onScroll?: (y: number, metrics?: ScrollMetrics) => void;
  /** Give a passive viewport its own stable keyboard focus stop, including after resize. */
  keyboard?: { focusId: string };
  children?: ReactNode;
  /** Show a scrollbar thumb. Defaults to true when content overflows. */
  scrollbar?: boolean;
  /** Ease wheel and track scrolling while keeping thumb drags direct. Defaults to true. */
  smooth?: boolean;
  size?: ButtonSize;
  /** Legacy escape hatch for the viewport paint. */
  fill?: number;
};

export type ScrollMetrics = Readonly<{
  contentHeight: number;
  viewportHeight: number;
  maxScroll: number;
}>;

type ThumbDrag = { pointerY: number; scrollY: number };
type ScrollInput = "programmatic" | "wheel" | "track" | "thumb";

export function ScrollArea(props: ScrollAreaProps): ReactNode {
  const theme = useWidgetTheme();
  const recipe = theme.recipes.scrollArea[props.size ?? "medium"];
  const [internalScrollY, setInternalScrollY] = useState(props.scrollY ?? 0);
  const [trackHovered, setTrackHovered] = useState(false);
  const [thumbHovered, setThumbHovered] = useState(false);
  const [thumbPressed, setThumbPressed] = useState(false);
  const [focused, setFocused] = useState(false);
  const drag = useRef<ThumbDrag | null>(null);
  const scrollInput = useRef<ScrollInput>("programmatic");
  const maxScroll = Math.max(0, props.contentHeight - props.height);
  const sourceY = props.scrollY !== undefined ? props.scrollY : internalScrollY;
  const clampedY = Math.max(0, Math.min(maxScroll, sourceY));
  const logicalScrollY = useRef(clampedY);
  logicalScrollY.current = clampedY;
  const showScrollbar = props.scrollbar !== false && maxScroll > 0;
  const track = resolveStatefulStyle(
    recipe.track,
    trackHovered || thumbHovered || thumbPressed ? "hover" : "rest",
  );
  const thumb = resolveStatefulStyle(
    recipe.thumb,
    thumbPressed ? "pressed" : thumbHovered ? "hover" : "rest",
  );
  const scrollbarX = props.width - recipe.metrics.scrollbarMargin - recipe.metrics.scrollbarWidth;
  // Keep the visual rail slender while giving mouse and touch input a forgiving
  // gutter. A missed thumb should never turn into an accidental track jump.
  const scrollbarHitWidth = Math.max(14, recipe.metrics.scrollbarWidth + 8);
  const scrollbarHitInset = (scrollbarHitWidth - recipe.metrics.scrollbarWidth) / 2;
  const scrollbarHitX = Math.max(0, scrollbarX - scrollbarHitInset);
  const ratio = props.height / Math.max(props.height, props.contentHeight);
  const thumbHeight = showScrollbar
    ? Math.min(
        props.height,
        Math.max(recipe.metrics.minThumbHeight, Math.floor(props.height * ratio)),
      )
    : 0;
  const thumbTravel = Math.max(0, props.height - thumbHeight);
  const thumbY = maxScroll > 0 ? Math.floor((thumbTravel * clampedY) / maxScroll) : 0;
  const directManipulation = props.smooth === false || thumbPressed || drag.current !== null;
  const reducedMotion = theme.foundations.motion.fastMs === 0;
  const presentationSpeed = scrollInput.current === "track" ? 13 : 19;
  const presentationImmediate =
    directManipulation || (reducedMotion && scrollInput.current !== "wheel");
  const contentTranslateY = useDampedValue(-clampedY, {
    speed: presentationSpeed,
    immediate: presentationImmediate,
  });
  const thumbTranslateY = useDampedValue(thumbY, {
    speed: presentationSpeed,
    immediate: presentationImmediate,
  });
  useEffect(() => {
    scrollInput.current = "programmatic";
  }, [clampedY]);

  const setScroll = (next: number) => {
    const clamped = Math.max(0, Math.min(maxScroll, next));
    // Pointer streams can deliver several events before React commits. Keep a
    // synchronous logical position so none of those deltas are collapsed.
    logicalScrollY.current = clamped;
    if (props.onScroll)
      props.onScroll(clamped, {
        contentHeight: props.contentHeight,
        viewportHeight: props.height,
        maxScroll,
      });
    else setInternalScrollY(clamped);
  };
  const handleWheel = (event: HitPointerEvent) => {
    // Wheel motion is navigational feedback rather than ornamental motion;
    // retain its short interpolation even when reduced motion is requested.
    scrollInput.current = "wheel";
    setScroll(logicalScrollY.current + (event.deltaY ?? recipe.metrics.wheelStep));
  };
  const handleKey = (event: HitKeyEvent) => {
    if (maxScroll <= 0) return;
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    const page = Math.max(recipe.metrics.wheelStep, props.height * 0.8);
    const current = logicalScrollY.current;
    switch (event.code) {
      case 103: // Up
        setScroll(current - recipe.metrics.wheelStep);
        break;
      case 108: // Down
        setScroll(current + recipe.metrics.wheelStep);
        break;
      case 104: // Page Up
        setScroll(current - page);
        break;
      case 109: // Page Down
        setScroll(current + page);
        break;
      case 102: // Home
        setScroll(0);
        break;
      case 107: // End
        setScroll(maxScroll);
        break;
    }
  };
  const scrollFromTrack = (localY: number) => {
    if (thumbTravel <= 0) return;
    scrollInput.current = "track";
    const visibleThumbY = thumbTranslateY.get();
    const page = Math.max(recipe.metrics.wheelStep, props.height * 0.8);
    if (localY < visibleThumbY) setScroll(logicalScrollY.current - page);
    else if (localY > visibleThumbY + thumbHeight) setScroll(logicalScrollY.current + page);
  };

  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={props.height}
      clip
      focusable={props.keyboard !== undefined}
      focusId={props.keyboard?.focusId}
      onFocusChange={props.keyboard ? setFocused : undefined}
      onKeyDown={props.keyboard ? handleKey : undefined}
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
          y={0}
          translateY={contentTranslateY}
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
        />
      ) : null}
      {showScrollbar ? (
        <Rect
          x={scrollbarHitX}
          y={0}
          width={Math.min(scrollbarHitWidth, props.width - scrollbarHitX)}
          height={props.height}
          fill={0x00000000}
          onPointerEnter={() => setTrackHovered(true)}
          onPointerLeave={() => setTrackHovered(false)}
          onWheel={handleWheel}
          onPress={(event) => scrollFromTrack(event.localY)}
        />
      ) : null}
      {showScrollbar && thumbHeight > 0 ? (
        <Group
          x={scrollbarHitX}
          y={0}
          translateY={thumbTranslateY}
          width={Math.min(scrollbarHitWidth, props.width - scrollbarHitX)}
          height={thumbHeight}
        >
          <Rect
            x={scrollbarX - scrollbarHitX}
            y={0}
            width={recipe.metrics.scrollbarWidth}
            height={thumbHeight}
            fill={thumb.fill}
            radius={thumb.radius}
            stroke={thumb.stroke}
            strokeWidth={thumb.strokeWidth}
          />
          <Rect
            x={0}
            y={0}
            width={Math.min(scrollbarHitWidth, props.width - scrollbarHitX)}
            height={thumbHeight}
            fill={0x00000000}
            onPointerEnter={() => setThumbHovered(true)}
            onPointerLeave={() => setThumbHovered(false)}
            onWheel={handleWheel}
            onPointerDown={(event) => {
              scrollInput.current = "thumb";
              drag.current = { pointerY: event.y, scrollY: logicalScrollY.current };
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
        </Group>
      ) : null}
      {focused && props.keyboard ? (
        <FocusRing width={props.width} height={props.height} radius={recipe.viewport.radius} />
      ) : null}
    </Group>
  );
}
