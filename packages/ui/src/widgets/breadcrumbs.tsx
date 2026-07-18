import React, { useMemo, useState, type ReactNode } from "react";
import { Group, Text, measureText } from "@moire/react-host";
import { themePalette } from "../theme.js";
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
  segments: readonly BreadcrumbSegment[];
  onNavigate: (id: string) => void;
};

const PAD_X = 9;
const GAP = 2;
const SEPARATOR_W = 12;
const FONT_SIZE = 13;

export function Breadcrumbs(props: BreadcrumbsProps): ReactNode {
  const pal = themePalette();
  const h = props.height ?? 34;
  const visible = useMemo(() => {
    const widths = props.segments.map(
      (segment) => Math.ceil(measureText(segment.label, FONT_SIZE / 14)) + PAD_X * 2,
    );
    let total = widths.reduce((sum, width) => sum + width, 0) +
      Math.max(0, widths.length - 1) * (SEPARATOR_W + GAP);
    let start = 0;
    while (start < widths.length - 1 && total > props.width) {
      total -= widths[start]! + SEPARATOR_W + GAP;
      start++;
    }
    return props.segments.slice(start);
  }, [props.segments, props.width]);

  let cursorX = 0;
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={h} clip>
      {visible.map((segment, index) => {
        const itemWidth = Math.min(
          props.width - cursorX,
          Math.ceil(measureText(segment.label, FONT_SIZE / 14)) + PAD_X * 2,
        );
        const x = cursorX;
        cursorX += itemWidth + SEPARATOR_W + GAP;
        return (
          <Group key={segment.id} x={x} y={0} width={itemWidth + SEPARATOR_W} height={h}>
            <DropZone width={itemWidth} height={h} id={segment.id}>
              <Pressable
                width={itemWidth}
                height={h}
                radius={pal.radiusSm}
                onPress={() => props.onNavigate(segment.id)}
              >
                <Text
                  x={PAD_X}
                  y={Math.floor((h - 12) / 2)}
                  text={segment.label}
                  color={index === visible.length - 1 ? pal.text : pal.muted}
                  fontSize={FONT_SIZE}
                  fontWeight={index === visible.length - 1 ? "medium" : "regular"}
                />
              </Pressable>
            </DropZone>
            {index < visible.length - 1 ? (
              <Text
                x={itemWidth + GAP}
                y={Math.floor((h - 12) / 2)}
                text="›"
                color={pal.muted}
                fontSize={FONT_SIZE}
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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.value);
  const [error, setError] = useState<string | null>(null);
  const buttonWidth = props.editButtonWidth ?? 54;
  const gap = 6;
  const h = props.height ?? 34;

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
          segments={props.segments}
          onNavigate={props.onNavigate}
        />
      )}
      <Button
        x={props.width - buttonWidth}
        y={0}
        width={buttonWidth}
        height={h}
        label={editing ? (error ? "Retry" : "Done") : "Edit"}
        variant="ghost"
        onPress={editing ? commit : beginEditing}
      />
    </Group>
  );
}
