import {
  resolveApplicationIcon,
  type DesktopEntry,
} from "@moire/app-discovery";
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { Group, Rect, Text } from "@moire/react-host";
import { themePalette } from "@moire/theme";
import {
  Icon,
  Label,
  ListItem,
  ScrollArea,
  Surface,
  TextField,
} from "./widgets.js";

export type LauncherProps = {
  open: boolean;
  screenW: number;
  screenH: number;
  apps: DesktopEntry[];
  query: string;
  selected: number;
  onQueryChange: (q: string) => void;
  onLaunch: (app: DesktopEntry) => void;
  onDismiss: () => void;
  onSelect: (i: number) => void;
};

const BOX_W = 420;
const ROW_H = 44;
const PAD = 16;
const SEARCH_Y = 46;
const LIST_TOP = 112;
const FOOTER_H = 34;

/** Super-key app launcher overlay. */
export function Launcher(props: LauncherProps): ReactNode {
  const [scrollY, setScrollY] = useState(0);
  const previousSelected = useRef(props.selected);
  const previousQuery = useRef(props.query);
  const pal = themePalette();
  const panelH = pal.panelHeight;
  const maxBoxH = Math.max(
    240,
    Math.min(600, props.screenH - panelH - 24),
  );
  const desiredListH = Math.max(ROW_H * 3, props.apps.length * ROW_H);
  const boxH = Math.min(
    maxBoxH,
    Math.max(300, LIST_TOP + desiredListH + FOOTER_H),
  );
  const listH = boxH - LIST_TOP - FOOTER_H;
  const contentH = Math.max(listH, props.apps.length * ROW_H);
  const maxScroll = Math.max(0, contentH - listH);
  const selectionChanged = previousSelected.current !== props.selected;
  const queryChanged = previousQuery.current !== props.query;
  let visibleScroll = Math.max(0, Math.min(maxScroll, scrollY));
  if (queryChanged) {
    visibleScroll = 0;
  } else if (selectionChanged && props.apps.length > 0) {
    const selectedTop = props.selected * ROW_H;
    if (selectedTop < visibleScroll) visibleScroll = selectedTop;
    else if (selectedTop + ROW_H > visibleScroll + listH) {
      visibleScroll = selectedTop + ROW_H - listH;
    }
  }
  previousSelected.current = props.selected;
  previousQuery.current = props.query;

  useEffect(() => {
    if (visibleScroll !== scrollY) setScrollY(visibleScroll);
  }, [scrollY, visibleScroll]);

  if (!props.open) return null;

  const x = 14;
  const y = props.screenH - panelH - boxH - 8;
  const listW = BOX_W - PAD * 2;

  const rows = props.apps.map((app, i) => {
    const rowY = i * ROW_H;
    if (rowY + ROW_H < visibleScroll || rowY > visibleScroll + listH) {
      return null;
    }
    const selected = i === props.selected;
    return (
      <Group
        key={app.id}
        x={0}
        y={rowY}
        width={listW}
        height={ROW_H}
      >
        <ListItem
          x={0}
          y={0}
          width={listW}
          height={ROW_H}
          title={truncate(app.name, 48)}
          leading={
            <Icon
              name={app.categories.includes("FileManager") ? "folder" : "app"}
              path={resolveApplicationIcon(app.icon)}
              size={26}
            />
          }
          selected={selected}
          onPress={() => props.onLaunch(app)}
        />
      </Group>
    );
  });

  return (
    <Group x={0} y={0} width={props.screenW} height={props.screenH}>
      <Rect
        x={0}
        y={0}
        width={props.screenW}
        height={props.screenH - panelH}
        fill={0x01000000}
        onPress={props.onDismiss}
      />
      <Surface x={x} y={y} width={BOX_W} height={boxH} fill={pal.surface}>
        <Rect x={0} y={0} width={BOX_W} height={1} fill={pal.rimLight} />
        <Label
          x={PAD}
          y={16}
          text="Applications"
          color={pal.accent}
          fontSize={16}
          fontWeight="medium"
        />
        <TextField
          x={PAD}
          y={SEARCH_Y}
          width={listW}
          height={36}
          value={props.query}
          placeholder="Search applications"
          focused
          onChange={props.onQueryChange}
          onCancel={props.onDismiss}
          onSubmit={() => {
            const selected = props.apps[props.selected];
            if (selected) props.onLaunch(selected);
          }}
        />
        <Text
          x={PAD}
          y={92}
          text="ALL APPLICATIONS"
          color={pal.muted}
          fontSize={10}
          fontWeight="medium"
        />
        <ScrollArea
          x={PAD}
          y={LIST_TOP}
          width={listW}
          height={listH}
          contentHeight={contentH}
          scrollY={visibleScroll}
          onScroll={setScrollY}
        >
          {props.apps.length > 0 ? (
            rows
          ) : (
            <Text
              x={12}
              y={16}
              text="No applications match your search."
              color={pal.muted}
              fontSize={13}
            />
          )}
        </ScrollArea>
        <Text
          x={PAD}
          y={boxH - 22}
          text={`${props.apps.length} ${props.apps.length === 1 ? "application" : "applications"}`}
          color={pal.muted}
          fontSize={10}
        />
      </Surface>
    </Group>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}
