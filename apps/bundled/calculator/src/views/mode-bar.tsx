/** Standard/Scientific switch, and the angle unit trig functions use in scientific mode. */
import React, { type ReactNode } from "react";
import { SegmentedControl, getUiScaleFactor } from "@moire/ui";
import type { AngleUnit } from "#calculator/arithmetic";
import type { Box } from "#calculator/layout";
import type { Mode } from "#calculator/model";

const MODES = [
  { id: "standard", label: "Standard" },
  { id: "scientific", label: "Scientific" },
] as const;
const ANGLES = [
  { id: "degrees", label: "Deg" },
  { id: "radians", label: "Rad" },
] as const;
const ANGLE_WIDTH = 120;

export function ModeBar(
  props: Box & {
    mode: Mode;
    angle: AngleUnit;
    onMode: (mode: Mode) => void;
    onAngle: (angle: AngleUnit) => void;
  },
): ReactNode {
  const ui = getUiScaleFactor();
  const gap = 8 * ui;
  const angleWidth = props.mode === "scientific" ? ANGLE_WIDTH * ui : 0;
  const modeWidth = Math.min(240 * ui, props.width - (angleWidth ? angleWidth + gap : 0));
  return (
    <>
      <SegmentedControl
        x={props.x}
        y={props.y}
        width={modeWidth}
        height={props.height}
        size="small"
        options={MODES}
        value={props.mode}
        onChange={(value) => props.onMode(value === "scientific" ? "scientific" : "standard")}
      />
      {angleWidth ? (
        <SegmentedControl
          x={props.x + props.width - angleWidth}
          y={props.y}
          width={angleWidth}
          height={props.height}
          size="small"
          options={ANGLES}
          value={props.angle}
          onChange={(value) => props.onAngle(value === "radians" ? "radians" : "degrees")}
        />
      ) : null}
    </>
  );
}
