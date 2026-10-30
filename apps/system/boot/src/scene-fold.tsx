/** The original static Fold artwork with the quiet wordmark; no GPU surface. */
import React from "react";
import { Group } from "@moire/react-host";
import { Backdrop, BrandMark } from "@moire/ui";
import type { BootScene, BootSceneProps } from "./scene";

function FoldView({ width, height, artwork }: BootSceneProps) {
  return (
    <Group width={width} height={height}>
      {artwork && (
        <Backdrop width={width} height={height} source={artwork} motion={{ kind: "static" }} />
      )}
      <BrandMark
        x={width * 0.12}
        y={height * 0.29}
        width={width * 0.203125}
        height={height * 0.1075}
        symbol={false}
        color={0xffffe5d3}
      />
    </Group>
  );
}

export const foldScene: BootScene = Object.freeze({
  name: "fold",
  View: FoldView,
  surfaces: Object.freeze({}),
  settledAt: 0,
  ambientFps: 0,
});
