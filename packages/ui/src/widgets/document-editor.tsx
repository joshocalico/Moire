/** Controlled rich document editor; layout owns both painted runs and selection geometry. */
import React, { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Group,
  Rect,
  Text,
  measureTextBounds,
  type HitKeyEvent,
  type HitPointerEvent,
} from "@moire/react-host";
import { useWidgetTheme } from "#ui/widget-theme";
import { getUiScaleFactor } from "#ui/font";
import { readClipboardText, writeClipboardText } from "#ui/window";
import {
  createDocumentHistory,
  commitDocumentEdit,
  undoDocumentEdit,
  redoDocumentEdit,
  documentBoundary,
  documentRange,
  documentMarksAt,
  previousDocumentCharacter,
  nextDocumentCharacter,
  equalDocuments,
  replaceDocumentRange,
  toggleDocumentMark,
  selectionHasDocumentMark,
  type DocumentValue,
  type DocumentSelection,
  type DocumentHistory,
  type DocumentMark,
} from "./document-model";
import {
  layoutDocument,
  documentCaretRect,
  documentSelectionRects,
  documentOffsetAt,
  type DocumentRect,
} from "./document-layout";
import {
  SelectionToolbar,
  layoutSelectionToolbar,
  placeSelectionToolbar,
} from "./selection-toolbar";

export type DocumentSelectionGeometry = {
  selection: DocumentSelection;
  /** Visible selection rectangles in editor-local framebuffer pixels. */
  rects: readonly DocumentRect[];
  caret: DocumentRect;
  scrollY: number;
  /** Actual floating toolbar bounds in editor-local framebuffer pixels, when visible. */
  toolbar: DocumentRect | null;
};
export type DocumentEditorProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  value: DocumentValue;
  onChange?: (value: DocumentValue) => void;
  placeholder?: string;
  fontSize?: number;
  padding?: number;
  autoFocus?: boolean;
  focusId?: string;
  readOnly?: boolean;
  selectionToolbar?: boolean;
  onSelectionChange?: (geometry: DocumentSelectionGeometry) => void;
  onError?: (error: Error) => void;
};

export function DocumentEditor(props: DocumentEditorProps): ReactNode {
  const theme = useWidgetTheme(),
    pal = theme.foundations.palette,
    ui = getUiScaleFactor();
  const generatedId = useId();
  const live = useRef(createDocumentHistory(props.value));
  const [history, setHistory] = useState(live.current),
    [focused, setFocused] = useState(false),
    [error, setError] = useState("");
  const [, redraw] = useState(0);
  const scroll = useRef(0),
    dragging = useRef(false),
    mounted = useRef(true);
  const lastCaret = useRef("");
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  useEffect(() => {
    if (!equalDocuments(props.value, live.current.present.document)) {
      const next = createDocumentHistory(props.value);
      const previous = live.current.present.selection;
      next.present.selection = {
        anchor: documentBoundary(props.value.text, previous.anchor),
        focus: documentBoundary(props.value.text, previous.focus),
      };
      live.current = next;
      setHistory(next);
    }
  }, [props.value]);
  const { document, selection } = history.present;
  const fontSize = props.fontSize ?? 16,
    padding = props.padding ?? 14 * ui;
  const lineHeight = Math.max(
    fontSize + 8 * ui,
    measureTextBounds("Mg", { fontSize }).height + 6 * ui,
  );
  const showToolbar = props.selectionToolbar !== false && !props.readOnly && !!props.onChange;
  const toolbarGap = 12 * ui;
  const toolbarSize = layoutSelectionToolbar(
    [{ label: "B" }, { label: "U" }, { label: "Mark" }],
    props,
    ui,
  );
  // Keep first visible-line actions above text, including after scrolling or a compact reflow.
  const topPadding = showToolbar
    ? Math.min(
        Math.max(padding, toolbarSize.height + toolbarGap * 2),
        Math.max(padding, props.height - padding - lineHeight),
      )
    : padding;
  const viewWidth = Math.max(1, props.width - padding * 2),
    viewHeight = Math.max(1, props.height - topPadding - padding - (error ? lineHeight : 0));
  const layout = useMemo(
    () =>
      layoutDocument(
        document,
        viewWidth,
        lineHeight,
        (text, marks) =>
          measureTextBounds(text, {
            fontSize,
            fontWeight: marks.bold ? "bold" : "regular",
            fontFamily: "sans",
          }).width,
      ),
    [document, viewWidth, lineHeight, fontSize],
  );
  const caret = documentCaretRect(layout, selection.focus),
    maxScroll = Math.max(0, layout.height - viewHeight);
  const caretSignature = `${selection.focus}:${caret.y}:${layout.height}:${document.text}:${viewWidth}:${viewHeight}`;
  if (lastCaret.current !== caretSignature) {
    scroll.current = Math.max(
      0,
      Math.min(
        maxScroll,
        caret.y < scroll.current
          ? caret.y
          : caret.y + caret.height > scroll.current + viewHeight
            ? caret.y + caret.height - viewHeight
            : scroll.current,
      ),
    );
    lastCaret.current = caretSignature;
  }
  scroll.current = Math.min(maxScroll, scroll.current);
  const visible = (rect: DocumentRect): DocumentRect | null => {
    const left = Math.max(0, rect.x),
      top = Math.max(0, rect.y - scroll.current);
    const right = Math.min(viewWidth, rect.x + rect.width),
      bottom = Math.min(viewHeight, rect.y + rect.height - scroll.current);
    return right > left && bottom > top
      ? { x: left + padding, y: top + topPadding, width: right - left, height: bottom - top }
      : null;
  };
  const rects = documentSelectionRects(layout, selection).flatMap((rect) => {
    const clipped = visible(rect);
    return clipped ? [clipped] : [];
  });
  const geometry: DocumentSelectionGeometry = {
    selection,
    rects,
    caret: { ...caret, x: caret.x + padding, y: caret.y + topPadding - scroll.current },
    scrollY: scroll.current,
    toolbar:
      showToolbar && rects[0]
        ? {
            width: toolbarSize.width,
            height: toolbarSize.height,
            ...placeSelectionToolbar(rects[0], props, toolbarSize, toolbarGap),
          }
        : null,
  };
  const geometrySignature = JSON.stringify(geometry),
    publishedGeometry = useRef("");
  useEffect(() => {
    if (publishedGeometry.current === geometrySignature) return;
    publishedGeometry.current = geometrySignature;
    props.onSelectionChange?.(geometry);
  });
  const publish = (next: DocumentHistory) => {
    const changed = !equalDocuments(next.present.document, live.current.present.document);
    live.current = next;
    setHistory(next);
    setError("");
    if (changed) props.onChange?.(next.present.document);
  };
  const move = (focus: number, extend = false) => {
    const current = live.current.present;
    focus = documentBoundary(current.document.text, focus);
    publish({
      ...live.current,
      present: {
        ...current,
        selection: { anchor: extend ? current.selection.anchor : focus, focus },
        typingMarks: documentMarksAt(current.document, focus),
      },
    });
  };
  const replace = (text: string) => {
    const current = live.current.present,
      { from } = documentRange(current.document, current.selection);
    const next = replaceDocumentRange(
      current.document,
      current.selection,
      text,
      current.typingMarks,
    );
    const offset = from + text.length;
    publish(
      commitDocumentEdit(live.current, {
        document: next,
        selection: { anchor: offset, focus: offset },
        typingMarks: current.typingMarks,
      }),
    );
  };
  const format = (mark: DocumentMark) => {
    if (props.readOnly || !props.onChange) return;
    const current = live.current.present,
      { from, to } = documentRange(current.document, current.selection);
    if (from === to)
      publish({
        ...live.current,
        present: {
          ...current,
          typingMarks: { ...current.typingMarks, [mark]: !current.typingMarks[mark] },
        },
      });
    else {
      const next = toggleDocumentMark(current.document, current.selection, mark);
      publish(
        commitDocumentEdit(live.current, {
          ...current,
          document: next,
          typingMarks: documentMarksAt(next, from),
        }),
      );
    }
  };
  const report = (caught: unknown) => {
    if (!mounted.current) return;
    const failure = caught instanceof Error ? caught : new Error(String(caught));
    setError(failure.message);
    props.onError?.(failure);
  };
  const key = (event: HitKeyEvent) => {
    const current = live.current.present,
      { from, to } = documentRange(current.document, current.selection),
      editable = !props.readOnly && !!props.onChange;
    const modifier = event.ctrlKey || event.metaKey,
      character = event.key?.toLowerCase();
    if (modifier) {
      if (character === "a" || event.code === 30)
        publish({
          ...live.current,
          present: {
            ...current,
            selection: { anchor: 0, focus: current.document.text.length },
            typingMarks: documentMarksAt(current.document, current.document.text.length),
          },
        });
      else if (editable && (character === "b" || event.code === 48)) format("bold");
      else if (editable && (character === "u" || event.code === 22)) format("underline");
      else if (editable && event.shiftKey && (character === "h" || event.code === 35))
        format("highlight");
      else if (character === "c" || event.code === 46 || character === "x" || event.code === 45) {
        if (from !== to)
          void writeClipboardText(current.document.text.slice(from, to))
            .then(() => {
              if (
                editable &&
                (character === "x" || event.code === 45) &&
                mounted.current &&
                live.current.present === current
              )
                replace("");
            })
            .catch(report);
      } else if (editable && (character === "v" || event.code === 47))
        void readClipboardText()
          .then((text) => {
            if (mounted.current) replace(text);
          })
          .catch(report);
      else if (
        editable &&
        (character === "z" || event.code === 44 || character === "y" || event.code === 21)
      )
        publish(
          event.shiftKey || character === "y" || event.code === 21
            ? redoDocumentEdit(live.current)
            : undoDocumentEdit(live.current),
        );
      else if (event.code === 102) move(0, event.shiftKey);
      else if (event.code === 107) move(current.document.text.length, event.shiftKey);
      return;
    }
    switch (event.code) {
      case 105:
        move(
          !event.shiftKey && from !== to
            ? from
            : previousDocumentCharacter(current.document.text, current.selection.focus),
          event.shiftKey,
        );
        return;
      case 106:
        move(
          !event.shiftKey && from !== to
            ? to
            : nextDocumentCharacter(current.document.text, current.selection.focus),
          event.shiftKey,
        );
        return;
      case 102:
        move(layout.lines[Math.floor(caret.y / lineHeight)]!.from, event.shiftKey);
        return;
      case 107:
        move(layout.lines[Math.floor(caret.y / lineHeight)]!.to, event.shiftKey);
        return;
      case 103:
      case 108:
      case 104:
      case 109: {
        const direction = event.code === 103 || event.code === 104 ? -1 : 1,
          distance =
            event.code === 104 || event.code === 109
              ? Math.max(1, Math.floor(viewHeight / lineHeight))
              : 1;
        move(
          documentOffsetAt(layout, caret.x, caret.y + direction * distance * lineHeight),
          event.shiftKey,
        );
        return;
      }
      case 14:
        if (editable) {
          if (from !== to) replace("");
          else if (from > 0) {
            move(previousDocumentCharacter(current.document.text, from), true);
            replace("");
          }
        }
        return;
      case 111:
        if (editable) {
          if (from !== to) replace("");
          else {
            move(nextDocumentCharacter(current.document.text, to), true);
            replace("");
          }
        }
        return;
      case 28:
        if (editable) replace("\n");
        return;
      case 1:
        move(current.selection.focus);
        return;
    }
    if (editable && event.text && !event.altKey) replace(event.text);
  };
  const locate = (event: HitPointerEvent) =>
    documentOffsetAt(layout, event.localX - padding, event.localY - topPadding + scroll.current);
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height}>
      <Rect
        width={props.width}
        height={props.height}
        fill={pal.bg}
        focusable
        autoFocus={props.autoFocus}
        focusId={props.focusId ?? `document:${generatedId}`}
        onFocusChange={setFocused}
        onKeyDown={key}
        onPointerDown={(event) => {
          if (event.button !== "left") return;
          dragging.current = true;
          move(locate(event), event.shiftKey);
        }}
        onPointerMove={(event) => {
          if (dragging.current) move(locate(event), true);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onWheel={(event) => {
          const next = Math.max(0, Math.min(maxScroll, scroll.current + (event.deltaY ?? 0)));
          // At its limit the editor lets an enclosing scroller take the wheel.
          if (next === scroll.current) return false;
          scroll.current = next;
          redraw((value) => value + 1);
          return true;
        }}
      />
      <Group x={padding} y={topPadding} width={viewWidth} height={viewHeight} clip>
        {documentSelectionRects(layout, selection).map((rect, index) => (
          <Rect
            key={`selection:${index}`}
            {...rect}
            y={rect.y - scroll.current}
            fill={(pal.accent & 0x00ffffff) | 0x48000000}
          />
        ))}
        {layout.lines
          .filter(
            (row) => row.y + lineHeight > scroll.current && row.y < scroll.current + viewHeight,
          )
          .map((row) => (
            <Group key={row.from} y={row.y - scroll.current} width={viewWidth} height={lineHeight}>
              {row.fragments.map((fragment) => (
                <Group
                  key={fragment.from}
                  x={fragment.x}
                  width={fragment.width}
                  height={lineHeight}
                >
                  {fragment.marks.highlight && (
                    <Rect
                      width={fragment.width}
                      height={lineHeight}
                      fill={(pal.accent & 0x00ffffff) | 0x30000000}
                    />
                  )}
                  <Text
                    text={fragment.text}
                    fontSize={fontSize}
                    fontWeight={fragment.marks.bold ? "bold" : "regular"}
                    color={pal.text}
                  />
                  {fragment.marks.underline && (
                    <Rect
                      y={measureTextBounds("Mg", { fontSize }).height - 1}
                      width={fragment.width}
                      height={1}
                      fill={pal.text}
                    />
                  )}
                </Group>
              ))}
            </Group>
          ))}
        {!document.text && (
          <Text text={props.placeholder ?? "Write a note…"} fontSize={fontSize} color={pal.muted} />
        )}
        {focused && <Rect {...caret} y={caret.y - scroll.current} fill={pal.accent} />}
      </Group>
      {error && (
        <Text
          x={padding}
          y={props.height - padding - lineHeight}
          text={error}
          fontSize={11}
          color={pal.accent}
        />
      )}
      {showToolbar && (
        <SelectionToolbar
          anchor={rects[0] ?? null}
          width={props.width}
          height={props.height}
          scale={ui}
          gap={toolbarGap}
          actions={[
            {
              id: "bold",
              label: "B",
              active: selectionHasDocumentMark(document, selection, "bold"),
              onInvoke: () => format("bold"),
            },
            {
              id: "underline",
              label: "U",
              active: selectionHasDocumentMark(document, selection, "underline"),
              onInvoke: () => format("underline"),
            },
            {
              id: "highlight",
              label: "Mark",
              active: selectionHasDocumentMark(document, selection, "highlight"),
              onInvoke: () => format("highlight"),
            },
          ]}
        />
      )}
    </Group>
  );
}
