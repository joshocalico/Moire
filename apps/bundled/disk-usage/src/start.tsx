/** Before a scan: pick a folder with the chooser, or one of the usual places. */
import React, { type ReactNode } from "react";
import {
  Box,
  Button,
  Horizontal,
  Icon,
  Pressable,
  TextBlock,
  Vertical,
  getUiScaleFactor,
  usePalette,
  type IconName,
} from "@moire/ui";
import { IconTile } from "@moire/app-tools";

const PICK_HEIGHT = 44;
const CONTENT_WIDTH = 420;

export type QuickPick = { id: string; label: string; path: string; detail: string };

export function StartView(props: {
  width: number;
  height: number;
  title: string;
  message: string;
  /** "danger" for a failed scan. */
  tone?: "danger";
  picks: readonly QuickPick[];
  onChoose: () => void;
  onPick: (path: string) => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const contentW = Math.min(CONTENT_WIDTH * ui, props.width - 48 * ui);
  const contentH =
    56 * ui +
    14 * ui +
    26 * ui +
    40 * ui +
    16 * ui +
    36 * ui +
    24 * ui +
    props.picks.length * (PICK_HEIGHT + 4) * ui;
  return (
    <Box width={props.width} height={props.height}>
      <Vertical
        x={(props.width - contentW) / 2}
        y={Math.max(16 * ui, (props.height - contentH) / 2.4)}
        width={contentW}
        gap={0}
        align="center"
      >
        <IconTile icon="disk-usage" color={props.tone === "danger" ? pal.danger : undefined} />
        <Box width={contentW} height={14 * ui} />
        <TextBlock
          width={contentW}
          height={26 * ui}
          text={props.title}
          fontSize={17}
          fontWeight="medium"
          horizontalAlign="center"
          maxLines={1}
          overflow="ellipsis"
        />
        <TextBlock
          width={contentW}
          height={40 * ui}
          text={props.message}
          color={props.tone === "danger" ? pal.danger : pal.muted}
          fontSize={12}
          wrap
          maxLines={2}
          overflow="ellipsis"
          horizontalAlign="center"
        />
        <Box width={contentW} height={16 * ui} />
        <Button
          width={Math.min(200 * ui, contentW)}
          height={36 * ui}
          variant="primary"
          label="Choose folder…"
          focusId="usage:choose"
          autoFocus
          onPress={props.onChoose}
        />
        <Box width={contentW} height={24 * ui} />
        <Vertical width={contentW} gap={4 * ui}>
          {props.picks.map((pick) => (
            <Pressable
              key={pick.id}
              width={contentW}
              height={PICK_HEIGHT * ui}
              radius={8 * ui}
              fill={pal.surface}
              hoverFill={pal.hover}
              pressedFill={pal.pressed}
              focusId={`usage:pick:${pick.id}`}
              onPress={() => props.onPick(pick.path)}
            >
              <Horizontal
                x={12 * ui}
                width={contentW - 24 * ui}
                height={PICK_HEIGHT * ui}
                gap={10 * ui}
                align="center"
              >
                <Box width={18 * ui} height={18 * ui} flexShrink={0}>
                  <Icon
                    name={
                      (pick.id === "root"
                        ? "disk-usage"
                        : pick.id === "home"
                          ? "home"
                          : "folder") as IconName
                    }
                    size={18 * ui}
                    color={pal.accent}
                    symbolic
                  />
                </Box>
                <TextBlock
                  flexGrow={1}
                  text={`Scan ${pick.label}`}
                  fontSize={13}
                  maxLines={1}
                  overflow="ellipsis"
                />
                <TextBlock
                  text={pick.detail}
                  color={pal.muted}
                  fontSize={12}
                  maxLines={1}
                  overflow="ellipsis"
                />
              </Horizontal>
            </Pressable>
          ))}
        </Vertical>
      </Vertical>
    </Box>
  );
}
