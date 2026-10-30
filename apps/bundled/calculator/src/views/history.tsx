/** Recent calculations, newest first; choosing one puts it back in the display. */
import React, { type ReactNode } from "react";
import {
  EmptyState,
  Icon,
  IconButton,
  Pressable,
  ScrollArea,
  Surface,
  TextBlock,
  getUiScaleFactor,
  usePalette,
} from "@moire/ui";
import type { Calculation } from "#calculator/arithmetic";
import type { Box } from "#calculator/layout";

const HEADER_HEIGHT = 36;
const ROW_HEIGHT = 44;
const INSET = 6;
const LABEL_INSET = 14;
const EXPRESSION_SHARE = 0.5;

export function History(
  props: Box & {
    entries: readonly Calculation[];
    onPick: (entry: Calculation) => void;
    onClear: () => void;
  },
): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const headerHeight = HEADER_HEIGHT * ui;
  const rowHeight = ROW_HEIGHT * ui;
  const inset = INSET * ui;
  const listWidth = props.width - inset * 2;
  const bodyHeight = Math.max(1, props.height - headerHeight - inset);
  return (
    <Surface
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      fill={pal.surface}
      radius={12 * ui}
      stroke={pal.borderSubtle}
      strokeWidth={1}
    >
      <TextBlock
        x={LABEL_INSET * ui}
        width={props.width - (LABEL_INSET + 40) * ui}
        height={headerHeight}
        text="HISTORY"
        color={pal.muted}
        fontSize={11}
        fontWeight="medium"
        verticalAlign="center"
      />
      {props.entries.length ? (
        <>
          <IconButton
            x={props.width - 36 * ui}
            y={4 * ui}
            width={28 * ui}
            height={28 * ui}
            size="small"
            variant="ghost"
            icon={(style) => <Icon name="trash" {...style} symbolic />}
            tooltip="Clear history"
            tooltipPlacement="bottom"
            focusId="calculator:clear-history"
            onPress={props.onClear}
          />
          <ScrollArea
            x={inset}
            y={headerHeight}
            width={listWidth}
            height={bodyHeight}
            contentHeight={props.entries.length * rowHeight}
            fill={0x00000000}
          >
            {props.entries.map((entry, index) => (
              <Pressable
                key={`${index}:${entry.expression}`}
                y={index * rowHeight}
                width={listWidth - 10 * ui}
                height={rowHeight}
                radius={8 * ui}
                focusId={`calculator:history:${index}`}
                onPress={() => props.onPick(entry)}
              >
                <TextBlock
                  x={8 * ui}
                  width={listWidth * EXPRESSION_SHARE}
                  height={rowHeight}
                  text={entry.expression}
                  color={pal.muted}
                  fontSize={13}
                  verticalAlign="center"
                  maxLines={1}
                  overflow="ellipsis"
                />
                <TextBlock
                  x={listWidth * EXPRESSION_SHARE}
                  width={listWidth * (1 - EXPRESSION_SHARE) - 18 * ui}
                  height={rowHeight}
                  text={entry.formatted}
                  fontSize={15}
                  fontWeight="medium"
                  horizontalAlign="end"
                  verticalAlign="center"
                  maxLines={1}
                  overflow="ellipsis"
                />
              </Pressable>
            ))}
          </ScrollArea>
        </>
      ) : (
        <EmptyState
          x={inset}
          y={headerHeight}
          width={listWidth}
          height={bodyHeight}
          title="No calculations yet"
          message="Results appear here. Choose one to reuse it."
        />
      )}
    </Surface>
  );
}
