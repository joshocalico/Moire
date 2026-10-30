/**
 * The silk boot scene: a physically simulated silk ribbon with moiré interference over XMB-style
 * waves (GPU surface), and the wordmark settling above the ribbon's left reach (React).
 */
import React from "react";
import { Group } from "@moire/react-host";
import { Backdrop, Label, SILK_TIMELINE, silkSceneSurface } from "@moire/ui";
import type { BootScene, BootSceneProps } from "./scene";

/** Tunables, in fractions of the output so the composition holds at any mode. */
export const SILK_SCENE = Object.freeze({
  word: Object.freeze({
    text: "moire",
    /** Left edge and baseline, as fractions of width and height. */
    left: 0.13,
    baseline: 0.628,
    /** Em size and tracking, as fractions of height. */
    size: 0.115,
    tracking: -0.00115,
    /** Ivory, lighter at the top of the ink and warmer at its foot. */
    gradient: Object.freeze([0xfffbeee4, 0xffe7d2c4] as const),
    gradientBands: 10,
    /** Soft drop shadow: a ring of `taps` copies, radius and drop in fractions of height. */
    shadow: Object.freeze({ strength: 0.45, taps: 8, radius: 0.0031, drop: 0.0025 }),
    /** Seconds: the word fades in from `rise` (fraction of height) above its rest line, settling down. */
    fadeIn: Object.freeze([5.0, 6.2] as const),
    settle: Object.freeze([5.0, 6.6] as const),
    rise: 0.018,
  }),
  /** Display face (Newsreader 72pt cut) metrics in ems: ascender, and the word's ink box. */
  ascender: 0.735,
  inkTop: 0.7385,
  inkBottom: -0.01,
});

const mixColor = (a: number, b: number, t: number) => {
  let out = 0xff000000;
  for (const shift of [16, 8, 0]) {
    const ca = (a >>> shift) & 0xff;
    const cb = (b >>> shift) & 0xff;
    out |= Math.round(ca + (cb - ca) * t) << shift;
  }
  return out >>> 0;
};

const smooth = (from: number, to: number, x: number) => {
  const u = Math.min(1, Math.max(0, (x - from) / (to - from)));
  return u * u * (3 - 2 * u);
};

/** Layout shared with later stages (greeter), so the wordmark hands over in place. */
export function silkWordmarkLayout(width: number, height: number) {
  const word = SILK_SCENE.word;
  const fontSize = Math.round(word.size * height);
  return {
    x: Math.round(word.left * width),
    y: Math.round(word.baseline * height - SILK_SCENE.ascender * fontSize),
    fontSize,
    letterSpacing: word.tracking * height,
    /** Ink box relative to the layout origin. */
    inkTop: Math.round((SILK_SCENE.ascender - SILK_SCENE.inkTop) * fontSize),
    inkHeight: Math.round((SILK_SCENE.inkTop - SILK_SCENE.inkBottom) * fontSize),
  };
}

type WordmarkLayout = ReturnType<typeof silkWordmarkLayout>;

/** The wordmark as plain React text: a soft shadow ring under a banded ivory gradient. */
function Wordmark({
  layout,
  width,
  height,
}: {
  layout: WordmarkLayout;
  width: number;
  height: number;
}) {
  const word = SILK_SCENE.word;
  const text = {
    text: word.text,
    fontFamily: "display" as const,
    fontSize: layout.fontSize,
    letterSpacing: layout.letterSpacing,
    overflow: "visible" as const,
  };
  const { taps, radius, drop, strength } = word.shadow;
  // Copies compound: n overlapping taps of alpha a darken by 1 - (1 - a)^n.
  const tapAlpha = 1 - Math.pow(1 - strength, 1 / taps);
  const bands = word.gradientBands;
  const bandHeight = layout.inkHeight / bands;
  return (
    <Group width={width} height={height}>
      {Array.from({ length: taps }, (_, k) => {
        const angle = (k / taps) * Math.PI * 2;
        return (
          <Group
            key={`shadow${k}`}
            x={Math.round(Math.cos(angle) * radius * height)}
            y={Math.round((drop + Math.sin(angle) * radius) * height)}
            opacity={tapAlpha}
          >
            <Label {...text} color={0xff000000} />
          </Group>
        );
      })}
      {Array.from({ length: bands }, (_, k) => {
        // Outer bands extend to the box edges so no ink falls outside every band.
        const top = k === 0 ? 0 : Math.round(layout.inkTop + k * bandHeight);
        const bottom = k === bands - 1 ? height : Math.round(layout.inkTop + (k + 1) * bandHeight);
        return (
          <Group key={`band${k}`} y={top} width={width} height={bottom - top} clip>
            <Label
              {...text}
              y={-top}
              color={mixColor(word.gradient[0], word.gradient[1], (k + 0.5) / bands)}
            />
          </Group>
        );
      })}
    </Group>
  );
}

function SilkView({ width, height, time, gpu, artwork }: BootSceneProps) {
  const word = SILK_SCENE.word;
  const layout = silkWordmarkLayout(width, height);
  const live = gpu
    ? {
        opacity: { get: () => smooth(word.fadeIn[0], word.fadeIn[1], time()) },
        // Whole pixels only, so the settling text is never resampled.
        translateY: {
          get: () =>
            -Math.round((1 - smooth(word.settle[0], word.settle[1], time())) * word.rise * height),
        },
      }
    : {};
  return (
    <Group width={width} height={height}>
      {gpu ? (
        <Group surface="silk" width={width} height={height} />
      ) : artwork ? (
        <Backdrop width={width} height={height} source={artwork} motion={{ kind: "static" }} />
      ) : null}
      <Group
        x={layout.x}
        y={layout.y}
        width={width - layout.x}
        height={layout.fontSize * 1.4}
        {...live}
      >
        <Wordmark
          layout={layout}
          width={width - layout.x}
          height={Math.round(layout.fontSize * 1.4)}
        />
      </Group>
    </Group>
  );
}

export const silkScene: BootScene = Object.freeze({
  name: "silk",
  View: SilkView,
  surfaces: Object.freeze({ silk: silkSceneSurface(0) }),
  settledAt: SILK_TIMELINE.settled,
  ambientFps: 30,
});
