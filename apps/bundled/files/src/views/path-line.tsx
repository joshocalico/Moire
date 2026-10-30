/**
 * The folder's ancestors above its title ("Home / Work /"). Each segment is a button and a drop
 * target; clicking the line's empty space, or Ctrl+L, swaps it for a path field with Tab completion.
 */
import React, { useEffect, useState, type ReactNode } from "react";
import {
  Box,
  DropZone,
  PointerArea,
  Pressable,
  TextBlock,
  TextField,
  getUiScaleFactor,
  measureWrappedText,
  usePalette,
  type BreadcrumbSegment,
} from "@moire/ui";

const FONT = 12;
const SEGMENT_PAD = 4;
const SLASH = 14;

const PATH_FIELD_ID = "files:path";

export function PathLine(props: {
  width: number;
  height: number;
  /** The folders above the current one, outermost first. */
  segments: readonly BreadcrumbSegment[];
  /** The current folder's path as the field starts it. */
  value: string;
  /** Owned by the page, so the field survives the header moving it (full or collapsed). */
  editing: boolean;
  onEditingChange(editing: boolean): void;
  onNavigate(directory: string): void;
  /** An error to show, or undefined once the path was opened. */
  onCommit(value: string): string | undefined;
  complete(draft: string): string | null;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  // Null until typed in: the field opens on the current path.
  const [typed, setTyped] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (props.editing) return;
    setTyped(null);
    setError(null);
  }, [props.editing]);
  const draft = typed ?? props.value;
  if (props.editing)
    return (
      <TextField
        width={props.width}
        height={props.height}
        size="small"
        focusId={PATH_FIELD_ID}
        value={draft}
        autoFocus
        selectAllOnFocus
        invalid={!!error}
        captureTab
        onChange={(value) => {
          setTyped(value);
          setError(null);
        }}
        onKeyDown={(event) => {
          if (!(event.key === "Tab" || event.code === 15)) return false;
          const completed = props.complete(draft);
          if (completed !== null && completed !== draft) setTyped(completed);
          return true;
        }}
        onSubmit={() => {
          const failure = props.onCommit(draft.trim());
          setError(failure ?? null);
          if (!failure) props.onEditingChange(false);
        }}
        onCancel={() => props.onEditingChange(false)}
        onFocusChange={(focused) => {
          if (!focused) props.onEditingChange(false);
        }}
      />
    );
  let x = 0;
  const pad = SEGMENT_PAD * ui;
  const slash = SLASH * ui;
  return (
    <Box width={props.width} height={props.height}>
      <PointerArea
        width={props.width}
        height={props.height}
        onPointerDown={() => props.onEditingChange(true)}
      />
      {props.segments.map((segment) => {
        const labelWidth = Math.ceil(
          measureWrappedText(segment.label, props.width, { fontSize: FONT }).width,
        );
        const width = Math.min(labelWidth + pad * 2, Math.max(0, props.width - x));
        const at = x;
        x += width + slash;
        if (width <= 0) return null;
        return (
          <Box key={segment.id} x={at} width={width + slash} height={props.height}>
            <DropZone width={width} height={props.height} id={segment.id}>
              <Pressable
                width={width}
                height={props.height}
                radius={4 * ui}
                hoverFill={pal.hover}
                focusId={`path:${segment.id}`}
                onPress={() => props.onNavigate(segment.id)}
              >
                <TextBlock
                  x={pad}
                  width={Math.max(1, width - pad * 2)}
                  height={props.height}
                  text={segment.label}
                  color={pal.muted}
                  fontSize={FONT}
                  verticalAlign="center"
                  overflow="ellipsis"
                  maxLines={1}
                />
              </Pressable>
            </DropZone>
            <TextBlock
              x={width}
              width={slash}
              height={props.height}
              text="/"
              color={pal.muted}
              fontSize={FONT}
              horizontalAlign="center"
              verticalAlign="center"
            />
          </Box>
        );
      })}
    </Box>
  );
}
