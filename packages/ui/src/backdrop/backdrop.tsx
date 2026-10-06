import React, { type ReactNode } from "react";
import { Group, Image, Rect } from "@moire/react-host";
import { useOscillation, type RetainedMotionAdmission } from "#ui/motion";
import { useWidgetTheme } from "#ui/widget-theme";
import type { SilkBackdropSource } from "./silk";
import { backdropPlacement, resolveBackdropMotion, type BackdropMotion } from "./placement";

export type BackdropProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  source: SilkBackdropSource;
  reducedMotion?: boolean;
  motion?: BackdropMotion;
  admission?: RetainedMotionAdmission;
  /** Wave is visibly paced; ambient keeps the slow decorative drift. */
  motionStyle?: "ambient" | "wave";
};

/** Decorative, non-interactive backdrop; the consumer owns its immutable source and visibility. */
export function Backdrop(props: BackdropProps): ReactNode {
  const theme = useWidgetTheme();
  const reducedMotion = props.reducedMotion === true || theme.foundations.motion.normalMs === 0;
  const playing = props.admission
    ? !reducedMotion
    : resolveBackdropMotion(props.motion, reducedMotion);
  const placement = backdropPlacement(props.width, props.height, props.motionStyle);
  const dx = useOscillation({
    from: -placement.driftX,
    to: placement.driftX,
    period: props.motionStyle === "wave" ? 16000 : 73000,
    playing,
    admission: props.admission,
  });
  const dy = useOscillation({
    from: -placement.driftY,
    to: placement.driftY,
    period: props.motionStyle === "wave" ? 22000 : 97000,
    playing,
    admission: props.admission,
  });
  // Hidden pauses keep their phase; static/reduced-motion policy paints canonical geometry.
  const ambient =
    props.admission !== undefined ||
    (props.motion?.kind === "ambient" &&
      props.motion.rendering === "hardware-retained" &&
      !reducedMotion);
  const { image } = props.source;
  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={Math.max(0, props.width)}
      height={Math.max(0, props.height)}
      clip
    >
      <Rect
        width={Math.max(0, props.width)}
        height={Math.max(0, props.height)}
        fill={props.source.background}
      />
      <Group translateX={ambient ? dx : 0} translateY={ambient ? dy : 0}>
        <Image
          x={placement.x}
          y={placement.y}
          width={placement.width}
          height={placement.height}
          imagePixels={image.rgba}
          imageWidth={image.width}
          imageHeight={image.height}
        />
      </Group>
    </Group>
  );
}
