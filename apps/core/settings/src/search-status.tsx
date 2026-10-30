/** The status card's headline: what the index is doing, with the walk's progress while it runs. */
import React, { type ReactNode } from "react";
import {
  Horizontal,
  Icon,
  ProgressBar,
  Surface,
  TextBlock,
  Vertical,
  getUiScaleFactor,
  usePalette,
} from "@moire/ui";
import type { IndexSummary } from "./search-model";

const BADGE = 36;
const GLYPH = 18;
const HEADLINE = 40;
const PROGRESS_GAP = 10;
const PROGRESS = 6;

export function indexStatusHeight(summary: IndexSummary): number {
  const ui = getUiScaleFactor();
  return (HEADLINE + (summary.progress != null ? PROGRESS_GAP + PROGRESS : 0)) * ui;
}

export function IndexStatusHeadline(props: { summary: IndexSummary; width: number }): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const { summary } = props;
  const tint =
    summary.tone === "error" ? pal.danger : summary.tone === "warning" ? pal.muted : pal.accent;
  const textW = Math.max(1, props.width - (BADGE + 12) * ui);
  return (
    <Vertical width={props.width} height={indexStatusHeight(summary)} gap={PROGRESS_GAP * ui}>
      <Horizontal width={props.width} height={HEADLINE * ui} gap={12 * ui} align="center">
        <Surface
          width={BADGE * ui}
          height={BADGE * ui}
          radius={10 * ui}
          fill={pal.bg}
          stroke={pal.borderSubtle}
          strokeWidth={1}
        >
          <Icon
            x={((BADGE - GLYPH) / 2) * ui}
            y={((BADGE - GLYPH) / 2) * ui}
            name="search"
            symbolic
            size={GLYPH * ui}
            color={tint}
          />
        </Surface>
        <Vertical width={textW} height={HEADLINE * ui} gap={2 * ui} justify="center">
          <TextBlock
            width={textW}
            text={summary.title}
            fontSize={15}
            fontWeight="medium"
            color={summary.tone === "error" ? pal.danger : pal.text}
            overflow="ellipsis"
            maxLines={1}
          />
          {summary.detail ? (
            <TextBlock
              width={textW}
              text={summary.detail}
              fontSize={12}
              color={pal.muted}
              overflow="ellipsis"
              maxLines={1}
            />
          ) : null}
        </Vertical>
      </Horizontal>
      {summary.progress != null ? (
        <ProgressBar width={props.width} height={PROGRESS * ui} value={summary.progress} />
      ) : null}
    </Vertical>
  );
}
