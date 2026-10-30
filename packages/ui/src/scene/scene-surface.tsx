import React, { type ReactNode } from "react";
import { Group } from "@moire/react-host";
import { useFrameDriver } from "#ui/motion";

export type SceneSurfaceProps = {
  /** A name registered with registerSceneSurface. */
  name: string;
  x?: number;
  y?: number;
  width: number;
  height: number;
  /** Keep presenting frames (the surface animates); false holds its last frame. */
  playing?: boolean;
};

/** Reserve a box for a GPU scene surface, drawn by the platform every presented frame. */
export function SceneSurface(props: SceneSurfaceProps): ReactNode {
  useFrameDriver(props.playing !== false);
  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={props.height}
      surface={props.name}
    />
  );
}
