/** Four rising bars for a 0–100 radio strength, such as a Wi‑Fi access point's. */
import React, { type ReactNode } from "react";
import { Group, Rect } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { colorWithAlpha } from "#ui/theme-family-color";
import { useWidgetTheme } from "#ui/widget-theme";
import { registerIntrinsicSize } from "./layout";

export type SignalStrengthProps = {
  x?: number;
  y?: number;
  /** 0–100. */
  strength: number;
  /** Lit bars; the text colour by default. */
  color?: number;
};

const WIDTH = 18;
const HEIGHT = 14;
const BAR = 3;
const STEP = 5;
/** Unlit bars stay visible so a weak signal still reads as four bars. */
const UNLIT_ALPHA = 0x59;

/** Bars lit for a strength: at least one, so a network in range never looks absent. */
export function signalBars(strength: number): number {
  return Math.max(1, Math.min(4, Math.ceil(Math.max(0, strength) / 25)));
}

/** What the bars say, for tooltips and accessible names. */
export function signalStrengthLabel(strength: number): string {
  return `Signal ${Math.round(Math.max(0, Math.min(100, strength)))}%`;
}

export function SignalStrength(props: SignalStrengthProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const ui = getUiScaleFactor();
  const lit = signalBars(props.strength);
  const height = HEIGHT * ui;
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={WIDTH * ui} height={height}>
      {[0, 1, 2, 3].map((index) => {
        const barHeight = ((index + 1) * height) / 4;
        return (
          <Rect
            key={index}
            x={index * STEP * ui}
            y={height - barHeight}
            width={BAR * ui}
            height={barHeight}
            radius={ui}
            fill={index < lit ? (props.color ?? pal.text) : colorWithAlpha(pal.muted, UNLIT_ALPHA)}
          />
        );
      })}
    </Group>
  );
}

registerIntrinsicSize(SignalStrength, () => ({
  width: WIDTH * getUiScaleFactor(),
  height: HEIGHT * getUiScaleFactor(),
}));
