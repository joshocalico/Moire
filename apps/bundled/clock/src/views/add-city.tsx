import React, { useMemo, useState, type ReactNode } from "react";
import {
  Box,
  Button,
  CollectionList,
  CollectionRow,
  Dialog,
  FocusScope,
  Horizontal,
  ModalBarrier,
  SearchField,
  Vertical,
  getUiScaleFactor,
  type WindowSize,
} from "@moire/ui";
import { allZones, relativeOffset, searchZones, zoneTime, type Zone } from "#clock/world";

const DIALOG_WIDTH = 480;
const DIALOG_HEIGHT = 480;
const ROW_HEIGHT = 52;

/**
 * Search the IANA zones by city or region. Typing filters; Up/Down move the selection from the
 * search field; Enter or a double click adds the selected city; Escape cancels.
 */
export function AddCityDialog(
  props: WindowSize & {
    now: number;
    existing: readonly string[];
    onAdd: (zone: string) => void;
    onCancel: () => void;
  },
): ReactNode {
  const ui = getUiScaleFactor();
  const zones = useMemo(allZones, []);
  const [query, setQuery] = useState("");
  const matches = useMemo(
    () => searchZones(query, zones, props.existing),
    [query, zones, props.existing],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = matches.find((zone) => zone.id === selectedId) ?? matches[0] ?? null;
  const move = (step: number) => {
    if (!matches.length) return;
    const index = selected ? matches.indexOf(selected) : -1;
    setSelectedId(matches[Math.max(0, Math.min(matches.length - 1, index + step))]!.id);
  };
  const add = (zone: Zone | null) => {
    if (zone) props.onAdd(zone.id);
  };
  const width = Math.min(props.width - 32 * ui, DIALOG_WIDTH * ui);
  const height = Math.min(props.height - 32 * ui, DIALOG_HEIGHT * ui);
  const inner = width - 40 * ui;
  const listH = Math.max(ROW_HEIGHT * ui, height - 190 * ui);
  return (
    <Box width={props.width} height={props.height}>
      <ModalBarrier
        width={props.width}
        height={props.height}
        visible
        active
        onDismiss={props.onCancel}
      />
      <FocusScope
        id="clock:add-city-dialog"
        width={props.width}
        height={props.height}
        trap
        onEscape={props.onCancel}
      >
        <Dialog
          x={(props.width - width) / 2}
          y={(props.height - height) / 2}
          width={width}
          height={height}
          title="Add World Clock"
          onClose={props.onCancel}
          footer={
            <Horizontal width={inner} height={36 * ui} gap={8 * ui} align="center">
              <Box flexGrow={1} height={1} />
              <Button height={34 * ui} label="Cancel" onPress={props.onCancel} />
              <Button
                height={34 * ui}
                variant="primary"
                label="Add"
                focusId="clock:add-city-confirm"
                disabled={!selected}
                onPress={() => add(selected)}
              />
            </Horizontal>
          }
        >
          <Vertical width={inner} gap={8 * ui}>
            <SearchField
              width={inner}
              value={query}
              placeholder="Search cities or time zones"
              focusId="clock:city-search"
              autoFocus
              onChange={(value) => {
                setQuery(value);
                setSelectedId(null);
              }}
              onSubmit={() => add(selected)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.code === 108) move(1);
                else if (event.key === "ArrowUp" || event.code === 103) move(-1);
                else return false;
                return true;
              }}
            />
            <CollectionList
              width={inner}
              height={listH}
              items={matches}
              getKey={(zone) => zone.id}
              selectedKey={selected?.id ?? null}
              onSelect={(zone) => setSelectedId(zone.id)}
              onActivate={add}
              focusId="clock:city-results"
              rowHeight={ROW_HEIGHT * ui}
              emptyMessage="No matching city or time zone"
              renderItem={(zone, row) => (
                <CollectionRow
                  width={row.width}
                  height={row.height}
                  selected={row.selected}
                  title={zone.city}
                  subtitle={`${zone.region} · ${relativeOffset(zone.id, props.now)}`}
                  metadata={zoneTime(zone.id, props.now)}
                />
              )}
            />
          </Vertical>
        </Dialog>
      </FocusScope>
    </Box>
  );
}
