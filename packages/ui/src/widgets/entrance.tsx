/** Content that fades and settles in once, each time it mounts. */
import React, { type ReactNode } from "react";
import { Group } from "@moire/react-host";
import { useEntrance } from "#ui/motion";
import { useWidgetTheme } from "#ui/widget-theme";

export type EntranceProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  /** Distance the content rises through, in pixels (negative drops it in from above). */
  rise?: number;
  /** Defaults to the theme's normal motion duration; reduced motion shows it settled. */
  duration?: number;
  children?: ReactNode;
};

export function Entrance(props: EntranceProps): ReactNode {
  const motion = useWidgetTheme().foundations.motion;
  const entrance = useEntrance({
    duration: motion.normalMs === 0 ? 0 : (props.duration ?? motion.normalMs),
    rise: props.rise,
  });
  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={props.height}
      {...entrance}
    >
      {props.children}
    </Group>
  );
}
