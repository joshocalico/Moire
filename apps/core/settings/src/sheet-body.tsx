/** A side sheet's body: sections of rows, scrolling when they don't fit. */
import React, { type ReactNode } from "react";
import {
  Box,
  ScrollArea,
  SettingsSection,
  TextBlock,
  getUiScaleFactor,
  settingsSectionHeight,
  usePalette,
  type SettingsSectionSpec,
} from "@moire/ui";

const PAD = 16;
const GAP = 14;

export function SheetBody(props: {
  width: number;
  height: number;
  /** A short paragraph above the sections. */
  intro?: string;
  sections: readonly SettingsSectionSpec[];
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const inner = Math.max(1, props.width - PAD * 2 * ui);
  const introH = props.intro ? 40 * ui : 0;
  const sections = props.sections.filter((section) => section.rows.length);
  const heights = sections.map((section) => settingsSectionHeight(section, inner));
  const content = introH + heights.reduce((sum, height) => sum + height + GAP * ui, 0) + PAD * ui;
  let y = introH;
  return (
    <ScrollArea
      width={props.width}
      height={props.height}
      contentHeight={Math.max(props.height, content)}
    >
      <Box width={props.width} height={Math.max(props.height, content)}>
        {props.intro ? (
          <TextBlock
            x={PAD * ui}
            width={inner}
            height={introH - 8 * ui}
            text={props.intro}
            fontSize={12}
            color={pal.muted}
            wrap
            maxLines={2}
            overflow="ellipsis"
          />
        ) : null}
        {sections.map((section, index) => {
          const top = y;
          y += heights[index]! + GAP * ui;
          return (
            <SettingsSection
              key={section.id}
              x={PAD * ui}
              y={top}
              width={inner}
              section={section}
            />
          );
        })}
      </Box>
    </ScrollArea>
  );
}
