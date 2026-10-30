/** The expression being typed, and the last answer (or what went wrong) set large beneath it. */
import React, { type ReactNode } from "react";
import { Surface, TextBlock, TextField, getUiScaleFactor, usePalette } from "@moire/ui";
import type { Box } from "#calculator/layout";
import type { Outcome } from "#calculator/model";

const INSET = 12;
const FIELD_HEIGHT = 36;

export function Display(
  props: Box & {
    expression: string;
    outcome: Outcome;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onFocusChange: (focused: boolean) => void;
  },
): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const inset = INSET * ui;
  const innerWidth = props.width - inset * 2;
  const below = inset + (FIELD_HEIGHT + 4) * ui;
  const { outcome } = props;
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
      <TextField
        x={inset}
        y={inset}
        width={innerWidth}
        height={FIELD_HEIGHT * ui}
        value={props.expression}
        onChange={props.onChange}
        onFocusChange={props.onFocusChange}
        placeholder="2 × (3 + 4)"
        autoFocus
        onSubmit={props.onSubmit}
      />
      {outcome.kind === "error" ? (
        <TextBlock
          x={inset}
          y={below}
          width={innerWidth}
          height={props.height - below - inset}
          text={outcome.message}
          color={pal.danger}
          fontSize={13}
          horizontalAlign="end"
          verticalAlign="center"
          wrap
          maxLines={2}
          overflow="ellipsis"
        />
      ) : (
        <>
          <TextBlock
            x={inset}
            y={below}
            width={innerWidth}
            height={18 * ui}
            text={outcome.kind === "result" ? `${outcome.calculation.expression} =` : ""}
            color={pal.muted}
            fontSize={12}
            horizontalAlign="end"
            maxLines={1}
            overflow="ellipsis"
          />
          <TextBlock
            x={inset}
            y={below + 16 * ui}
            width={innerWidth}
            height={props.height - below - 16 * ui - inset / 2}
            text={outcome.kind === "result" ? outcome.calculation.formatted : "0"}
            fontSize={36}
            fontFamily="display"
            horizontalAlign="end"
            verticalAlign="center"
            maxLines={1}
            overflow="ellipsis"
          />
        </>
      )}
    </Surface>
  );
}
