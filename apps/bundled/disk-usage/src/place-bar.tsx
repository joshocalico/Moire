/** The tool row over a scan: up, where you are as breadcrumbs, and a filter. */
import React, { type ReactNode } from "react";
import {
  Breadcrumbs,
  Horizontal,
  Icon,
  IconButton,
  SearchField,
  getUiScaleFactor,
} from "@moire/ui";
import type { UsageNode } from "./backend";

const FILTER_WIDTH = 220;

export function PlaceBar(props: {
  width: number;
  trail: readonly UsageNode[];
  home: string;
  query: string;
  onGoTo: (depth: number) => void;
  onQuery: (query: string) => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const filterW = Math.min(FILTER_WIDTH * ui, Math.max(120 * ui, props.width * 0.3));
  return (
    <Horizontal
      x={12 * ui}
      width={props.width - 24 * ui}
      height={44 * ui}
      gap={6 * ui}
      align="center"
    >
      <IconButton
        width={32 * ui}
        height={32 * ui}
        variant="ghost"
        tooltip="Enclosing folder"
        focusId="usage:up"
        disabled={props.trail.length < 2}
        icon={<Icon name="up" size={16 * ui} symbolic />}
        onPress={() => props.onGoTo(props.trail.length - 2)}
      />
      <Breadcrumbs
        width={Math.max(1, props.width - 24 * ui - 44 * ui - filterW)}
        height={32 * ui}
        segments={props.trail.map((node, index) => ({
          id: String(index),
          label: index === 0 && node.path === props.home ? "Home" : node.name,
        }))}
        onNavigate={(id) => props.onGoTo(Number(id))}
      />
      <SearchField
        width={filterW}
        height={32 * ui}
        value={props.query}
        onChange={props.onQuery}
        onClear={() => props.onQuery("")}
        placeholder="Filter"
      />
    </Horizontal>
  );
}
