import React, { type ReactNode } from "react";
import { Surface, getUiScaleFactor, usePalette } from "@moire/ui";

export function Card(props: {
  x?: number;
  y?: number;
  width: number;
  height: number;
  children?: ReactNode;
}): ReactNode {
  const pal = usePalette();
  return (
    <Surface
      {...props}
      fill={pal.surface}
      radius={12 * getUiScaleFactor()}
      stroke={pal.borderSubtle}
      strokeWidth={1}
    />
  );
}
