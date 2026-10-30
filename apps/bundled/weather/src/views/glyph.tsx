import React, { type ReactNode } from "react";
import { Box, Surface, usePalette } from "@moire/ui";

type Sky = "clear" | "partly" | "cloud" | "fog" | "rain" | "snow" | "storm";

/** The WMO weather interpretation code, reduced to the handful of skies the glyph can draw. */
function skyFor(code: number): Sky {
  if (code === 0) return "clear";
  if (code <= 2) return "partly";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  if (code >= 51 && code <= 82) return "rain";
  return "cloud";
}

const SUN = 0xfff5b841;
/** Rain, in the glyphs and wherever a chance of rain is quoted. */
export const RAIN = 0xff5aa9e6;

function Disc(props: { cx: number; cy: number; r: number; fill: number }): ReactNode {
  return (
    <Surface
      x={props.cx - props.r}
      y={props.cy - props.r}
      width={props.r * 2}
      height={props.r * 2}
      radius={props.r}
      fill={props.fill}
    />
  );
}

/** A cloud drawn from overlapping discs over a rounded base, filling the top of an s×s box. */
function Cloud(props: { s: number; dy: number; fill: number }): ReactNode {
  const { s, dy, fill } = props;
  return (
    <>
      <Disc cx={0.36 * s} cy={0.52 * s + dy} r={0.17 * s} fill={fill} />
      <Disc cx={0.56 * s} cy={0.42 * s + dy} r={0.22 * s} fill={fill} />
      <Disc cx={0.73 * s} cy={0.57 * s + dy} r={0.14 * s} fill={fill} />
      <Surface
        x={0.14 * s}
        y={0.52 * s + dy}
        width={0.72 * s}
        height={0.19 * s}
        radius={0.095 * s}
        fill={fill}
      />
    </>
  );
}

/** A small, flat weather illustration for a WMO weather code. */
export function WeatherGlyph(props: { x?: number; y?: number; size: number; code: number }) {
  const pal = usePalette();
  const s = props.size;
  const sky = skyFor(props.code);
  const cloud = pal.muted;
  const precipitation = sky === "rain" || sky === "snow" || sky === "storm";
  const dy = precipitation ? -0.1 * s : 0;
  return (
    <Box x={props.x} y={props.y} width={s} height={s}>
      {sky === "clear" ? <Disc cx={0.5 * s} cy={0.5 * s} r={0.3 * s} fill={SUN} /> : null}
      {sky === "partly" ? <Disc cx={0.36 * s} cy={0.34 * s} r={0.2 * s} fill={SUN} /> : null}
      {sky === "fog"
        ? [0.3, 0.48, 0.66].map((y, index) => (
            <Surface
              key={y}
              x={(index === 1 ? 0.18 : 0.1) * s}
              y={y * s}
              width={(index === 1 ? 0.72 : 0.8) * s}
              height={0.09 * s}
              radius={0.045 * s}
              fill={cloud}
            />
          ))
        : null}
      {sky !== "clear" && sky !== "fog" ? <Cloud s={s} dy={dy} fill={cloud} /> : null}
      {sky === "rain"
        ? [0.34, 0.52, 0.7].map((x) => (
            <Surface
              key={x}
              x={x * s - 0.03 * s}
              y={0.7 * s}
              width={0.06 * s}
              height={0.16 * s}
              radius={0.03 * s}
              fill={RAIN}
            />
          ))
        : null}
      {sky === "snow"
        ? [0.34, 0.52, 0.7].map((x, index) => (
            <Disc
              key={x}
              cx={x * s}
              cy={(index === 1 ? 0.84 : 0.76) * s}
              r={0.05 * s}
              fill={pal.text}
            />
          ))
        : null}
      {sky === "storm" ? (
        <Surface
          x={0.47 * s}
          y={0.68 * s}
          width={0.08 * s}
          height={0.22 * s}
          radius={0.03 * s}
          fill={SUN}
        />
      ) : null}
    </Box>
  );
}
