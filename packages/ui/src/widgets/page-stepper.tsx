/** "‹ Page 1 of N ›": a dark pill for paging through a document's preview, laid over the page. */
import React, { useRef, type ReactNode } from "react";
import { Group, measureTextBounds, type HitKeyEvent } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { Icon, type IconName } from "./icon";
import { IconButton } from "./icon-button";
import { registerIntrinsicSize } from "./layout";
import { Surface, TextBlock } from "./primitives";

export type PageStepperProps = {
  x?: number;
  y?: number;
  /** The page shown, from 1. */
  page: number;
  /** Page count, or null while unknown (shows "Page n" and never disables Next). */
  pages: number | null;
  onPage?(page: number): void;
  /** Prefix for the buttons' focus ids: `${focusId}:previous` and `${focusId}:next`. */
  focusId?: string;
};

const PILL_H = 32;
const MIN_W = 148;
const BUTTON = 28;
const BUTTON_INSET = 2;
const CHEVRON = 14;
const TEXT_SIZE = 12;
const TEXT_PAD = 8;
// Fixed, not themed: the pill sits on a page preview, whose colours the theme doesn't know.
const FILL = 0xe0202024;
const INK = 0xffffffff;
const INK_DISABLED = 0x59ffffff;

function pageText(page: number, pages: number | null): string {
  return pages === null ? `Page ${page}` : `Page ${page} of ${pages}`;
}

/** The pill's width, scaled: at least 148px, and room for its widest page label. */
export function pageStepperWidth(pages: number | null): number {
  const ui = getUiScaleFactor();
  // Size for the widest label the count allows, so the pill doesn't change width while paging.
  const widest = pages === null ? pageText(9999, null) : pageText(pages, pages);
  const text = measureTextBounds(widest, { fontSize: TEXT_SIZE, fontWeight: "medium" }).width;
  return Math.ceil(Math.max(MIN_W * ui, text + (BUTTON + BUTTON_INSET + TEXT_PAD) * 2 * ui));
}

export function pageStepperHeight(): number {
  return Math.round(PILL_H * getUiScaleFactor());
}

function chevron(name: IconName, size: number) {
  return (style: { size: number; color: number }) => (
    <Icon
      x={Math.round((style.size - size) / 2)}
      y={Math.round((style.size - size) / 2)}
      name={name}
      size={size}
      color={style.color}
      symbolic
    />
  );
}

/**
 * Previous and Next around the page label. While either button has focus, Left and Right page
 * too; Previous is disabled on the first page and Next on the last.
 */
export function PageStepper(props: PageStepperProps): ReactNode {
  const ui = getUiScaleFactor();
  const width = pageStepperWidth(props.pages);
  const height = pageStepperHeight();
  const button = Math.round(BUTTON * ui);
  const inset = Math.round((height - button) / 2);
  const canPrevious = props.page > 1;
  const canNext = props.pages === null || props.page < props.pages;
  const focused = useRef(new Set<string>());
  const go = (page: number) => props.onPage?.(page);
  const trackFocus = (id: string) => (next: boolean) => {
    if (next) focused.current.add(id);
    else focused.current.delete(id);
  };
  // Buttons only take Enter and Space, so the pill listens for arrows while one of them has focus.
  const handleArrows = (event: HitKeyEvent): boolean => {
    if (!focused.current.size) return false;
    if (event.code === 105 || event.key === "ArrowLeft") {
      if (canPrevious) go(props.page - 1);
      return true;
    }
    if (event.code === 106 || event.key === "ArrowRight") {
      if (canNext) go(props.page + 1);
      return true;
    }
    return false;
  };
  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={width}
      height={height}
      onGlobalKeyDown={handleArrows}
    >
      <Surface width={width} height={height} radius={height / 2} fill={FILL} elevation="low">
        <IconButton
          x={inset}
          y={inset}
          width={button}
          height={button}
          variant="ghost"
          size="small"
          color={canPrevious ? INK : INK_DISABLED}
          disabled={!canPrevious}
          tooltip="Previous page"
          tooltipPlacement="top"
          focusId={props.focusId ? `${props.focusId}:previous` : undefined}
          onFocusChange={trackFocus("previous")}
          icon={chevron("chevron-left", Math.round(CHEVRON * ui))}
          onPress={() => go(props.page - 1)}
        />
        <TextBlock
          x={inset + button}
          width={width - (inset + button) * 2}
          height={height}
          text={pageText(props.page, props.pages)}
          color={INK}
          fontSize={TEXT_SIZE}
          fontWeight="medium"
          horizontalAlign="center"
          verticalAlign="center"
          overflow="ellipsis"
          maxLines={1}
        />
        <IconButton
          x={width - inset - button}
          y={inset}
          width={button}
          height={button}
          variant="ghost"
          size="small"
          color={canNext ? INK : INK_DISABLED}
          disabled={!canNext}
          tooltip="Next page"
          tooltipPlacement="top"
          focusId={props.focusId ? `${props.focusId}:next` : undefined}
          onFocusChange={trackFocus("next")}
          icon={chevron("chevron-right", Math.round(CHEVRON * ui))}
          onPress={() => go(props.page + 1)}
        />
      </Surface>
    </Group>
  );
}

registerIntrinsicSize(PageStepper, (props) => ({
  width: pageStepperWidth(props.pages),
  height: pageStepperHeight(),
}));
