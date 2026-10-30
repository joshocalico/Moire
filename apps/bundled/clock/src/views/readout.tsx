import React, { type ReactNode } from "react";
import {
  Box,
  TextBlock,
  Vertical,
  getUiScaleFactor,
  registerIntrinsicSize,
  type WindowSize,
} from "@moire/ui";

/** Large tabular numerals shared by every tab, so the readouts sit on one visual scale. */
export const READOUT = { fontFamily: "display", fontSize: 84 } as const;
/** Timer and stopwatch share a readout position, so switching tabs does not jump. */
export const COUNTER_HEIGHT = 250;
const READOUT_HEIGHT = 100;
const PANEL_MAX_WIDTH = 520;
/** Average advance of a display-font digit relative to its size, for shrink-to-fit. */
export const DIGIT_ADVANCE = 0.56;

/** The width of a centred panel's column in a window of `width`. */
export function panelWidth(width: number, max = PANEL_MAX_WIDTH): number {
  const ui = getUiScaleFactor();
  return Math.min(width - 32 * ui, max * ui);
}

/** A large counter readout, shrunk only when the window is too narrow for it. */
export function Readout(props: { text: string; width: number }): ReactNode {
  const ui = getUiScaleFactor();
  const fontSize = Math.min(
    READOUT.fontSize,
    Math.floor(props.width / ui / (props.text.length * DIGIT_ADVANCE)),
  );
  return (
    <Box width={props.width} height={READOUT_HEIGHT * ui}>
      <TextBlock
        width={props.width}
        height={READOUT_HEIGHT * ui}
        text={props.text}
        fontFamily={READOUT.fontFamily}
        fontSize={fontSize}
        horizontalAlign="center"
        verticalAlign="center"
        maxLines={1}
      />
    </Box>
  );
}
registerIntrinsicSize(Readout, (props) => ({
  width: props.width,
  height: READOUT_HEIGHT * getUiScaleFactor(),
}));

/** A vertically centred stack (slightly above centre): the readout, then what sits under it. */
export function CenteredPanel(
  props: WindowSize & { contentHeight: number; children: ReactNode },
): ReactNode {
  const ui = getUiScaleFactor();
  const width = panelWidth(props.width);
  return (
    <Vertical
      x={Math.round((props.width - width) / 2)}
      y={Math.round(Math.max(16 * ui, (props.height - props.contentHeight) / 2.4))}
      width={width}
      height={props.contentHeight}
      gap={0}
      align="center"
    >
      {props.children}
    </Vertical>
  );
}

/** The padding `Card` from @moire/app-tools puts around its content, in unscaled pixels. */
export const CARD_INSET = 14;
