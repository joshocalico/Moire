import React, { type ReactNode } from "react";
import {
  Box,
  Button,
  CollectionList,
  CollectionRow,
  Icon,
  Label,
  ScrollColumn,
  Surface,
  getUiScaleFactor,
  usePalette,
  type WindowSize,
} from "@moire/ui";
import { MUSIC_VIEWS, type MusicView } from "#music/model";

const ROW_HEIGHT = 44;

/** Small drawn glyphs for the views the icon set has no symbol for. */
function navigationIcon(view: MusicView, size: number, color: number): ReactNode {
  if (view === "Songs") return <Icon name="music" symbolic size={size} color={color} />;
  if (view === "Albums")
    return (
      <>
        <Surface
          width={size}
          height={size}
          radius={size / 2}
          fill={0x00000000}
          stroke={color}
          strokeWidth={1.5}
        />
        <Surface
          x={size * 0.4}
          y={size * 0.4}
          width={size * 0.2}
          height={size * 0.2}
          radius={size * 0.1}
          fill={color}
        />
      </>
    );
  if (view === "Artists")
    return (
      <>
        <Surface
          x={size * 0.35}
          width={size * 0.3}
          height={size * 0.3}
          radius={size * 0.15}
          fill={color}
        />
        <Surface
          x={size * 0.15}
          y={size * 0.42}
          width={size * 0.7}
          height={size * 0.55}
          radius={size * 0.2}
          fill={0x00000000}
          stroke={color}
          strokeWidth={1.5}
        />
      </>
    );
  return (
    <>
      <Surface
        width={size}
        height={size}
        radius={size / 2}
        fill={0x00000000}
        stroke={color}
        strokeWidth={1.5}
      />
      <Surface
        x={size * 0.48}
        y={size * 0.22}
        width={size * 0.08}
        height={size * 0.34}
        fill={color}
      />
      <Surface
        x={size * 0.48}
        y={size * 0.48}
        width={size * 0.28}
        height={size * 0.08}
        fill={color}
      />
    </>
  );
}
export function MusicNavigation(
  props: WindowSize & {
    view: MusicView;
    busy: boolean;
    albumCount: number;
    trackCount: number;
    onView: (view: MusicView) => void;
    onImport: () => void;
    onReload: () => void;
  },
): ReactNode {
  const ui = getUiScaleFactor(),
    pal = usePalette();
  return (
    <Surface width={props.width} height={props.height} fill={pal.panel}>
      <ScrollColumn width={props.width} height={props.height} padding={8 * ui} gap={14 * ui}>
        <Label x={8 * ui} text="Library" fontSize={12} color={pal.muted} />
        <CollectionList
          width={props.width - 16 * ui}
          height={MUSIC_VIEWS.length * ROW_HEIGHT * ui}
          rowHeight={ROW_HEIGHT * ui}
          items={MUSIC_VIEWS}
          getKey={(view) => view}
          selectedKey={props.view}
          onSelect={props.onView}
          onActivate={props.onView}
          focusId="music:navigation"
          renderItem={(view, state) => (
            <CollectionRow
              {...state}
              title={view}
              leading={
                <Box x={10 * ui} y={10 * ui} width={20 * ui} height={20 * ui}>
                  {navigationIcon(view, 20 * ui, state.selected ? pal.accent : pal.text)}
                </Box>
              }
            />
          )}
        />
        <Button
          label="Import music…"
          focusId="music:import"
          disabled={props.busy}
          onPress={props.onImport}
        />
        <Button
          label="Reload library"
          variant="ghost"
          disabled={props.busy}
          onPress={props.onReload}
        />
        <Label
          text={`${props.albumCount} albums · ${props.trackCount} tracks`}
          fontSize={11}
          color={pal.muted}
          wrap
        />
      </ScrollColumn>
    </Surface>
  );
}
