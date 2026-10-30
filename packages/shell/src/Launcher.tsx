import { resolveApplicationIcon, type DesktopEntry } from "@moire/app-discovery";
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { Group, Rect, Text } from "@moire/react-host";
import { Entrance } from "@moire/ui";
import { themePalette, getTheme } from "@moire/theme";
import {
  Icon,
  Label,
  ListItem,
  ScrollArea,
  Surface,
  SearchField,
  applicationIcon,
} from "./widgets";

export type LauncherLaunchState =
  | { kind: "idle" }
  | { kind: "pending"; appName: string }
  | { kind: "failed"; appName: string };

export type LauncherProps = {
  open: boolean;
  screenW: number;
  screenH: number;
  apps: DesktopEntry[];
  query: string;
  selected: number;
  launchState?: LauncherLaunchState;
  onQueryChange: (q: string) => void;
  onLaunch: (app: DesktopEntry) => void;
  onDismiss: () => void;
  onSelect: (i: number) => void;
  /** Desktop entry ids pinned to the top of the list (Settings › Desktop & Launcher). */
  pins?: readonly string[];
  /** Right-click on an app pins or unpins it. */
  onPin?: (app: DesktopEntry) => void;
  /** The last pin change, shown in the footer while nothing is starting. */
  notice?: string;
};

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
  const launchState = props.launchState ?? { kind: "idle" };
  const pal = themePalette();
  const panelH = pal.panelHeight;
  const family = getTheme().family;
  const boxW = Math.min(420, props.screenW - 28);
  const maxBoxH = Math.max(240, Math.min(600, props.screenH - panelH - 24));
  const desiredListH = Math.max(ROW_H * 3, props.apps.length * ROW_H);
  const boxH = Math.min(maxBoxH, Math.max(300, LIST_TOP + desiredListH + FOOTER_H));
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

  const x =
    family === "redmond" || family === "cupertino" || family === "gnomish"
      ? Math.floor((props.screenW - boxW) / 2)
      : 14;
  const y = props.screenH - panelH - boxH - 8;
  const listW = boxW - PAD * 2;

  const rows = props.apps.map((app, i) => {
    const rowY = i * ROW_H;
    // The list glides to its scroll position, so keep a viewport of rows either side of the
    // logical one; otherwise rows pop in at the leading edge mid-glide.
    if (rowY + ROW_H < visibleScroll - listH || rowY > visibleScroll + listH * 2) {
      return null;
    }
    const selected = i === props.selected;
    const pinned = props.pins?.includes(app.id) ?? false;
    return (
      <Group key={app.id} x={0} y={rowY} width={listW} height={ROW_H}>
        <ListItem
          x={0}
          y={0}
          width={listW}
          height={ROW_H}
          title={truncate(app.name, 48)}
          subtitle={pinned ? "Pinned" : undefined}
          leading={
            <Icon
              name={
                applicationIcon(app.id) === "app" && app.categories.includes("FileManager")
                  ? "folder"
                  : applicationIcon(app.id)
              }
              path={resolveApplicationIcon(app.icon)}
              size={26}
            />
          }
          selected={selected}
          disabled={launchState.kind === "pending"}
          onPress={() => props.onLaunch(app)}
          onContextMenu={props.onPin ? () => props.onPin!(app) : undefined}
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
      <Entrance x={x} y={y} width={boxW} height={boxH} rise={10}>
        <Surface
          width={boxW}
          height={boxH}
          fill={pal.panel}
          radius={pal.radiusLg}
          stroke={pal.borderSubtle}
          strokeWidth={1}
          elevation="high"
          onPress={() => {}}
        >
          <Rect x={0} y={0} width={boxW} height={1} fill={pal.rimLight} />
          <Label
            x={PAD}
            y={16}
            text="Applications"
            color={pal.accent}
            fontSize={16}
            fontWeight="medium"
          />
          <SearchField
            x={PAD}
            y={SEARCH_Y}
            width={listW}
            height={36}
            value={props.query}
            placeholder="Search applications"
            focused
            autoFocus
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
            fontSize={11}
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
            text={
              launchState.kind === "failed"
                ? `Could not start ${truncate(launchState.appName, 26)}. Try again.`
                : launchState.kind === "pending"
                  ? `Starting ${truncate(launchState.appName, 38)}…`
                  : (props.notice ??
                    `${props.apps.length} ${props.apps.length === 1 ? "application" : "applications"}`)
            }
            color={launchState.kind === "failed" ? pal.danger : pal.muted}
            fontSize={11}
          />
        </Surface>
      </Entrance>
    </Group>
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}
