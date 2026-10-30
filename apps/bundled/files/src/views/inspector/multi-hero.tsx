/** A selection's first three items fanned out like cards on a table. */
import React, { type ReactNode } from "react";
import { Box, Surface, usePalette } from "@moire/ui";
import type { Entry } from "#files/filesystem";
import { Thumbnail } from "#files/views/thumbnail";
import { px } from "./cards";

const HEIGHT = 150;
const CARD = 110;
/** The side cards' offset from the middle one, and how much lower they sit. */
const SPREAD = 70;
const DROP = 10;

export const multiHeroHeight = () => px(HEIGHT);

export function MultiHero(props: { entries: readonly Entry[]; width: number }): ReactNode {
  const pal = usePalette();
  const card = px(CARD);
  const height = px(HEIGHT);
  const shown = props.entries.slice(0, 3);
  const spread = Math.min(px(SPREAD), Math.round((props.width - card) / 2) - px(8));
  const centre = Math.round((props.width - card) / 2);
  // Side cards first so the middle one is drawn on top.
  const slots =
    shown.length === 1
      ? [{ entry: shown[0]!, x: centre, y: px(20) }]
      : shown.length === 2
        ? [
            { entry: shown[0]!, x: centre - Math.round(spread / 2), y: px(20 + DROP / 2) },
            { entry: shown[1]!, x: centre + Math.round(spread / 2), y: px(20) },
          ]
        : [
            { entry: shown[0]!, x: centre - spread, y: px(14 + DROP) },
            { entry: shown[2]!, x: centre + spread, y: px(14 + DROP) },
            { entry: shown[1]!, x: centre, y: px(14) },
          ];
  return (
    <Surface width={props.width} height={height} fill={pal.bg} radius={px(10)} clip>
      {slots.map(({ entry, x, y }) => (
        <Box key={entry.path} x={x} y={y} width={card} height={card}>
          <Surface
            width={card}
            height={card}
            radius={px(10)}
            fill={pal.surface}
            stroke={pal.border}
            strokeWidth={1}
            elevation="medium"
            clip
          >
            <Thumbnail
              entry={entry}
              width={card}
              height={card}
              radius={px(10)}
              backdrop={pal.surface}
            />
          </Surface>
        </Box>
      ))}
    </Surface>
  );
}
