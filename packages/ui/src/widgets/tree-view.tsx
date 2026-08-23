import React, { type ReactNode } from "react";
import { Group, Rect, type HitKeyEvent } from "@moire/react-host";
import { CollectionItem } from "./interaction.js";
import { Icon, type IconName } from "./icon.js";
import { Pressable } from "./pressable.js";
import { VirtualList } from "./virtual-list.js";
import { useWidgetTheme } from "../widget-theme.js";
import { Box, Horizontal, Inset } from "./layout.js";
import { TextBlock } from "./primitives.js";

export type TreeNode<T = unknown> = {
  id: string;
  label: string;
  icon?: IconName;
  disabled?: boolean;
  data?: T;
  children?: readonly TreeNode<T>[];
};

export type TreeViewProps<T = unknown> = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  nodes: readonly TreeNode<T>[];
  expandedIds: ReadonlySet<string>;
  onExpandedChange?: (expandedIds: ReadonlySet<string>) => void;
  selectedId?: string | null;
  onSelect?: (node: TreeNode<T>) => void;
  onActivate?: (node: TreeNode<T>) => void;
  rowHeight?: number;
  indent?: number;
};

type FlatNode<T> = { node: TreeNode<T>; depth: number };

function flatten<T>(
  nodes: readonly TreeNode<T>[],
  expandedIds: ReadonlySet<string>,
  depth = 0,
  output: FlatNode<T>[] = [],
): FlatNode<T>[] {
  for (const node of nodes) {
    output.push({ node, depth });
    if (node.children?.length && expandedIds.has(node.id)) {
      flatten(node.children, expandedIds, depth + 1, output);
    }
  }
  return output;
}

/** Expandable virtualized hierarchy with keyed selection and keyboard toggles. */
export function TreeView<T,>(props: TreeViewProps<T>): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const rowHeight = props.rowHeight ?? 34;
  const indent = props.indent ?? 18;
  const rows = flatten(props.nodes, props.expandedIds);
  const toggle = (node: TreeNode<T>) => {
    if (!node.children?.length) return;
    const next = new Set(props.expandedIds);
    if (next.has(node.id)) next.delete(node.id);
    else next.add(node.id);
    props.onExpandedChange?.(next);
  };

  return (
    <VirtualList
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      items={rows}
      itemHeight={rowHeight}
      getKey={(entry) => entry.node.id}
      renderItem={({ node, depth }) => {
        const branch = !!node.children?.length;
        const expanded = props.expandedIds.has(node.id);
        const handleKey = (event: HitKeyEvent): boolean => {
          if ((event.key === "ArrowRight" || event.code === 106) && branch && !expanded) {
            toggle(node);
            return true;
          }
          if ((event.key === "ArrowLeft" || event.code === 105) && branch && expanded) {
            toggle(node);
            return true;
          }
          return false;
        };
        return (
          <Group width={props.width} height={rowHeight}>
            {props.selectedId === node.id ? (
              <Rect width={props.width} height={rowHeight} fill={pal.selection} radius={pal.radiusSm} />
            ) : null}
            <CollectionItem
              width={props.width}
              height={rowHeight}
              focusId={`tree-row:${node.id}`}
              disabled={node.disabled}
              onPress={() => props.onSelect?.(node)}
              onDoublePress={() => branch ? toggle(node) : props.onActivate?.(node)}
              onKeyDown={handleKey}
            />
            <Inset
              width={props.width}
              height={rowHeight}
              padding={{ left: 8 + depth * indent, right: 8 }}
            >
              <Horizontal gap={4} align="center">
                <Box width={24} height={24}>
                  {branch ? (
                    <Pressable
                      width={24}
                      height={24}
                      radius={pal.radiusSm}
                      onPress={() => toggle(node)}
                    >
                      <TextBlock
                        width={24}
                        height={24}
                        text={expanded ? "▾" : "›"}
                        color={pal.muted}
                        fontSize={12}
                        horizontalAlign="center"
                        verticalAlign="center"
                      />
                    </Pressable>
                  ) : null}
                </Box>
                {node.icon ? (
                  <Box width={18} height={18}>
                    <Icon
                      name={node.icon}
                      size={18}
                      color={props.selectedId === node.id ? pal.accent : pal.text}
                    />
                  </Box>
                ) : null}
                <TextBlock
                  flexGrow={1}
                  text={node.label}
                  color={node.disabled ? pal.muted : pal.text}
                  fontSize={12}
                  verticalAlign="center"
                  overflow="ellipsis"
                  maxLines={1}
                />
              </Horizontal>
            </Inset>
          </Group>
        );
      }}
    />
  );
}
