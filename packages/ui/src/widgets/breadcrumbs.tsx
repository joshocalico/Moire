import React, { useMemo, useState, type ReactNode } from "react";
import { Group, Text, measureText, measureTextBounds } from "@moire/react-host";
import {
  resolveStatefulStyle,
  useWidgetTheme,
  type ButtonSize,
} from "../widget-theme.js";
import { Button } from "./button.js";
import { DropZone } from "./dnd.js";
import { Pressable } from "./pressable.js";
import { TextField } from "./text-field.js";

export type BreadcrumbSegment = {
  id: string;
  label: string;
};

export type BreadcrumbsProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  size?: ButtonSize;
  segments: readonly BreadcrumbSegment[];
  onNavigate: (id: string) => void;
};

export function Breadcrumbs(props: BreadcrumbsProps): ReactNode {
  const recipe = useWidgetTheme().recipes.pathBar[props.size ?? "medium"];
  const metrics = recipe.metrics;
  const h = props.height ?? metrics.height;
  const label = resolveStatefulStyle(recipe.label, "rest");
  const currentLabel = resolveStatefulStyle(recipe.label, "selected");
  const segmentStyle = resolveStatefulStyle(recipe.segment, "rest");
  const hoveredSegment = resolveStatefulStyle(recipe.segment, "hover");
  const pressedSegment = resolveStatefulStyle(recipe.segment, "pressed");
  const labelHeight = measureTextBounds("Mg", {
    fontSize: label.fontSize,
    fontWeight: label.fontWeight,
  }).height;
  const separatorHeight = measureTextBounds("›", {
    fontSize: recipe.separator.fontSize,
    fontWeight: recipe.separator.fontWeight,
  }).height;
  const visible = useMemo(() => {
    const widths = props.segments.map(
      (item) =>
        Math.ceil(measureText(item.label, label.fontSize / 14)) +
        metrics.paddingX * 2,
    );
    let total = widths.reduce((sum, width) => sum + width, 0) +
      Math.max(0, widths.length - 1) *
        (metrics.separatorWidth + metrics.gap);
    let start = 0;
    while (start < widths.length - 1 && total > props.width) {
      total -= widths[start]! + metrics.separatorWidth + metrics.gap;
      start++;
    }
    return props.segments.slice(start);
  }, [label.fontSize, metrics, props.segments, props.width]);

  let cursorX = 0;
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={h} clip>
      {visible.map((segment, index) => {
        const itemWidth = Math.min(
          props.width - cursorX,
          Math.ceil(measureText(segment.label, label.fontSize / 14)) +
            metrics.paddingX * 2,
        );
        const x = cursorX;
        cursorX += itemWidth + metrics.separatorWidth + metrics.gap;
        const isCurrent = index === visible.length - 1;
        const labelStyle = isCurrent ? currentLabel : label;
        return (
          <Group
            key={segment.id}
            x={x}
            y={0}
            width={itemWidth + metrics.separatorWidth}
            height={h}
          >
            <DropZone width={itemWidth} height={h} id={segment.id}>
              <Pressable
                width={itemWidth}
                height={h}
                fill={segmentStyle.fill}
                hoverFill={hoveredSegment.fill}
                pressedFill={pressedSegment.fill}
                radius={segmentStyle.radius}
                stroke={segmentStyle.stroke}
                strokeWidth={segmentStyle.strokeWidth}
                onPress={() => props.onNavigate(segment.id)}
              >
                <Text
                  x={metrics.paddingX}
                  y={Math.floor((h - labelHeight) / 2)}
                  text={segment.label}
                  color={labelStyle.color}
                  fontSize={labelStyle.fontSize}
                  fontWeight={labelStyle.fontWeight}
                />
              </Pressable>
            </DropZone>
            {!isCurrent ? (
              <Text
                x={itemWidth + metrics.gap}
                y={Math.floor((h - separatorHeight) / 2)}
                text="›"
                color={recipe.separator.color}
                fontSize={recipe.separator.fontSize}
                fontWeight={recipe.separator.fontWeight}
              />
            ) : null}
          </Group>
        );
      })}
    </Group>
  );
}

export type PathBarProps = BreadcrumbsProps & {
  value: string;
  onCommit: (value: string) => string | undefined;
  editButtonWidth?: number;
};

export function PathBar(props: PathBarProps): ReactNode {
  const recipe = useWidgetTheme().recipes.pathBar[props.size ?? "medium"];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.value);
  const [error, setError] = useState<string | null>(null);
  const buttonWidth = props.editButtonWidth ?? recipe.metrics.editButtonWidth;
  const gap = recipe.metrics.editGap;
  const h = props.height ?? recipe.metrics.height;

  const beginEditing = () => {
    setDraft(props.value);
    setError(null);
    setEditing(true);
  };
  const commit = () => {
    const nextError = props.onCommit(draft.trim());
    setError(nextError ?? null);
    if (!nextError) setEditing(false);
  };

  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={h}>
      {editing ? (
        <TextField
          width={Math.max(1, props.width - buttonWidth - gap)}
          height={h}
          size={props.size}
          value={draft}
          autoFocus
          invalid={!!error}
          onChange={(value) => {
            setDraft(value);
            setError(null);
          }}
          onSubmit={commit}
          onCancel={() => {
            setEditing(false);
            setError(null);
          }}
        />
      ) : (
        <Breadcrumbs
          width={Math.max(1, props.width - buttonWidth - gap)}
          height={h}
          size={props.size}
          segments={props.segments}
          onNavigate={props.onNavigate}
        />
      )}
      <Button
        x={props.width - buttonWidth}
        y={0}
        width={buttonWidth}
        height={h}
        size={props.size}
        label={editing ? (error ? "Retry" : "Done") : "Edit"}
        variant={error ? "danger" : "ghost"}
        onPress={editing ? commit : beginEditing}
      />
    </Group>
  );
}
