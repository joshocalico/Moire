/** Stable pane slots, shared collapse policy, and keyboard-resizable boundaries. */
import React, { useId, useRef, useState, type ReactNode } from "react";
import { Group } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { useWidgetTheme } from "#ui/widget-theme";
import { Button } from "./button";
import { FocusScope } from "./focus";
import { Row } from "./layout";
import { Surface } from "./primitives";
import { SplitView } from "./split-view";

export type AdaptivePane = {
  id: string;
  title: string;
  render: (size: { width: number; height: number }) => ReactNode;
  /** Framebuffer pixels. Omitted role defaults follow the current UI scale. */
  preferredWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  onWidthChange?: (width: number) => void;
};
export type AdaptivePanesProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  navigation?: AdaptivePane;
  collection?: AdaptivePane;
  content: AdaptivePane;
  accessory?: AdaptivePane & { open: boolean; onClose: () => void };
  activePaneId?: string;
  onActivePaneChange?: (id: string) => void;
};
type Allocation = { x: number; width: number; height: number };

export function AdaptivePanes(props: AdaptivePanesProps): ReactNode {
  const ui = getUiScaleFactor();
  const pal = useWidgetTheme().foundations.palette;
  const id = useId();
  const [active, setActive] = useState(props.content.id);
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const lastAllocations = useRef(new Map<string, Allocation>());
  const panes = [props.navigation, props.collection, props.content, props.accessory].filter(
    (pane): pane is AdaptivePane => !!pane,
  );
  const visible = new Set(panes.map((pane) => pane.id));
  if (!props.accessory?.open && props.accessory) visible.delete(props.accessory.id);
  const divider = 7 * ui;
  const minimum = (pane: AdaptivePane) =>
    Math.max(
      0,
      pane.minWidth ?? (pane === props.content ? 320 : pane === props.navigation ? 160 : 220) * ui,
    );
  const preferred = (pane: AdaptivePane) =>
    Math.max(
      minimum(pane),
      Math.min(
        pane.maxWidth ?? Number.POSITIVE_INFINITY,
        (pane.onWidthChange ? pane.preferredWidth : (sizes[pane.id] ?? pane.preferredWidth)) ??
          (pane === props.navigation ? 208 : pane === props.accessory ? 280 : 300) * ui,
      ),
    );
  const required = () =>
    panes.filter((pane) => visible.has(pane.id)).reduce((sum, pane) => sum + minimum(pane), 0) +
    Math.max(0, visible.size - 1) * divider;
  for (const pane of [props.accessory, props.navigation, props.collection]) {
    if (required() <= props.width) break;
    if (pane) visible.delete(pane.id);
  }
  const collapsed = panes.filter(
    (pane) => !visible.has(pane.id) && (pane !== props.accessory || props.accessory?.open),
  );
  const activeId = props.activePaneId ?? active;
  const overlay = collapsed.find((pane) => pane.id === activeId);
  const headerHeight = collapsed.length ? Math.min(props.height, 44 * ui) : 0;
  const bodyHeight = Math.max(0, props.height - headerHeight);
  const changeActive = (next: string) => {
    if (props.activePaneId === undefined) setActive(next);
    props.onActivePaneChange?.(next);
  };
  const closeOverlay = () => {
    changeActive(props.content.id);
    if (overlay === props.accessory) props.accessory?.onClose();
  };
  const allocations = new Map<string, Allocation>();
  const ordered = panes.filter((pane) => visible.has(pane.id));
  const remaining = Math.max(0, props.width - Math.max(0, ordered.length - 1) * divider);
  const widths = new Map<string, number>();
  for (const pane of ordered) widths.set(pane.id, minimum(pane));
  let surplus = Math.max(0, remaining - ordered.reduce((sum, pane) => sum + minimum(pane), 0));
  for (const pane of ordered.filter((pane) => pane !== props.content)) {
    const extra = Math.min(surplus, preferred(pane) - minimum(pane));
    widths.set(pane.id, minimum(pane) + extra);
    surplus -= extra;
  }
  // At extremely small sizes the flexible content must fit the actual viewport.
  widths.set(
    props.content.id,
    Math.max(
      0,
      remaining -
        ordered
          .filter((pane) => pane !== props.content)
          .reduce((sum, pane) => sum + (widths.get(pane.id) ?? 0), 0),
    ),
  );
  let x = 0;
  for (const pane of ordered) {
    const width = widths.get(pane.id) ?? 0;
    allocations.set(pane.id, { x, width, height: bodyHeight });
    x += width + divider;
  }
  const resize = (pane: AdaptivePane, width: number) => {
    const next = Math.max(minimum(pane), Math.min(pane.maxWidth ?? Infinity, width));
    if (!pane.onWidthChange) setSizes((old) => ({ ...old, [pane.id]: next }));
    pane.onWidthChange?.(next);
  };
  return (
    <Surface x={props.x} y={props.y} width={props.width} height={props.height} fill={pal.bg} clip>
      {headerHeight ? (
        <Row width={props.width} height={headerHeight} padding={6 * ui} gap={4 * ui}>
          {overlay ? (
            <Button label="Back" size="small" focusId={`panes:${id}:back`} onPress={closeOverlay} />
          ) : null}
          {panes
            .filter((pane) => pane !== props.accessory || props.accessory?.open)
            .map((pane) => (
              <Button
                key={pane.id}
                label={pane.title}
                size="small"
                variant={activeId === pane.id ? "primary" : "ghost"}
                focusId={`panes:${id}:${pane.id}`}
                onPress={() => changeActive(pane.id)}
              />
            ))}
        </Row>
      ) : null}
      <Group y={headerHeight} width={props.width} height={bodyHeight} clip>
        {/* Slots never change parent or order when panes collapse or expand. */}
        {panes.map((pane) => {
          const allocation =
            overlay === pane
              ? { x: 0, width: props.width, height: bodyHeight }
              : allocations.get(pane.id);
          const valid = !!allocation && allocation.width > 0 && allocation.height > 0;
          const shown = valid && (overlay ? pane === overlay : visible.has(pane.id));
          if (valid) lastAllocations.current.set(pane.id, allocation);
          const retained = (valid ? allocation : undefined) ??
            lastAllocations.current.get(pane.id) ?? {
              x: 0,
              width: preferred(pane),
              height: Math.max(1, bodyHeight),
            };
          return (
            <Group
              key={pane.id}
              x={shown ? retained.x : 0}
              width={shown ? retained.width : 0}
              height={shown ? retained.height : 0}
              clip
            >
              <FocusScope
                id={`panes:${id}:scope:${pane.id}`}
                width={retained.width}
                height={retained.height}
                active={shown}
                trap={!!overlay && shown}
                onEscape={overlay === pane ? closeOverlay : undefined}
              >
                {pane.render({ width: retained.width, height: retained.height })}
              </FocusScope>
            </Group>
          );
        })}
        {!overlay
          ? ordered.slice(0, -1).map((pane, index) => {
              const allocation = allocations.get(pane.id)!;
              const next = ordered[index + 1]!;
              const nextBox = allocations.get(next.id)!;
              const accessoryBoundary = next === props.accessory;
              return (
                <SplitView
                  key={`divider:${pane.id}`}
                  x={allocation.x}
                  width={allocation.width + divider + nextBox.width}
                  height={bodyHeight}
                  firstSize={allocation.width}
                  minFirst={minimum(pane)}
                  minSecond={minimum(next)}
                  dividerSize={divider}
                  first={null}
                  second={null}
                  onFirstSizeChange={(width) =>
                    accessoryBoundary
                      ? resize(next, allocation.width + nextBox.width - width)
                      : resize(pane, width)
                  }
                />
              );
            })
          : null}
      </Group>
    </Surface>
  );
}
