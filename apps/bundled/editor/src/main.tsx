import React, { useEffect, useRef, useState, type ReactNode } from "react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Application,
  Window,
  Box,
  OverlayHost,
  Surface,
  Toolbar,
  Button,
  Label,
  TextField,
  TextArea,
  Sheet,
  StatusBar,
  ShortcutManager,
  requestActiveWindowRedraw,
  setUiScaleFactor,
  getUiScaleFactor,
  usePalette,
  type WindowSize,
} from "@moire/ui";
import { loadSettings } from "@moire/prefs";
import {
  blankDocument,
  documentDirty,
  documentPath,
  openDocument,
  saveDocument,
  type TextDocument,
} from "./documents";

type Action = { kind: "new" } | { kind: "open"; path: string } | { kind: "close" };
type Prompt =
  | { kind: "none" }
  | { kind: "open"; input: string }
  | { kind: "save"; input: string; after: Action | null }
  | { kind: "discard"; after: Action }
  | { kind: "overwrite"; path: string; after: Action | null };
export type EditorProps = WindowSize & {
  initialDocument?: TextDocument;
  initialError?: string;
  onClose: () => void;
  onTitleChange?: (title: string) => void;
  onCloseGuard?: (guard: () => boolean) => void;
};
export function EditorApp(props: EditorProps): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const [document, setDocument] = useState(props.initialDocument ?? blankDocument());
  const [bufferIdentity, setBufferIdentity] = useState(0);
  const current = useRef(document);
  const [status, setStatus] = useState(props.initialError ?? "UTF-8 text · Ctrl+S to save");
  const [prompt, setPrompt] = useState<Prompt>({ kind: "none" });
  const update = (next: TextDocument) => {
    current.current = next;
    setDocument(next);
  };
  const dirty = documentDirty(document);
  const perform = (action: Action) => {
    try {
      if (action.kind === "close") {
        props.onClose();
        return;
      }
      const next = action.kind === "new" ? blankDocument() : openDocument(action.path);
      update(next);
      setBufferIdentity((identity) => identity + 1);
      setPrompt({ kind: "none" });
      setStatus(action.kind === "new" ? "New document" : "Opened document");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const request = (action: Action) => {
    if (documentDirty(current.current)) setPrompt({ kind: "discard", after: action });
    else perform(action);
  };
  const save = (
    input = current.current.path ?? "",
    overwrite = false,
    after: Action | null = null,
  ) => {
    if (!input) {
      setPrompt({ kind: "save", input: "", after });
      return;
    }
    try {
      const target = documentPath(input);
      if (target !== current.current.path && fs.existsSync(target) && !overwrite) {
        setPrompt({ kind: "overwrite", path: target, after });
        return;
      }
      update(saveDocument(current.current, target, overwrite));
      setStatus(`Saved ${path.basename(target)}`);
      setPrompt({ kind: "none" });
      if (after) perform(after);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  useEffect(() => {
    props.onTitleChange?.(
      `${dirty ? "• " : ""}${document.path ? path.basename(document.path) : "Untitled"} · Text Editor`,
    );
  }, [dirty, document.path, props.onTitleChange]);
  useEffect(() => {
    props.onCloseGuard?.(() => {
      if (!documentDirty(current.current)) return true;
      setPrompt({ kind: "discard", after: { kind: "close" } });
      requestActiveWindowRedraw();
      return false;
    });
  }, [props.onCloseGuard]);
  const sheetTitle =
    prompt.kind === "open"
      ? "Open text file"
      : prompt.kind === "save"
        ? "Save document as"
        : prompt.kind === "overwrite"
          ? "Replace this file?"
          : "Save changes before leaving?";
  const width = Math.max(1, props.width - 32);
  const narrow = props.width < 480 * ui;
  const filePrompt = prompt.kind === "open" || prompt.kind === "save";
  const submit = () => {
    if (prompt.kind === "open") request({ kind: "open", path: prompt.input });
    else if (prompt.kind === "save") save(prompt.input, false, prompt.after);
  };
  return (
    <OverlayHost width={props.width} height={props.height}>
      <ShortcutManager
        width={props.width}
        height={props.height}
        shortcuts={[
          { id: "save", code: 31, ctrl: true, onInvoke: () => save() },
          {
            id: "save-as",
            code: 31,
            ctrl: true,
            shift: true,
            onInvoke: () => setPrompt({ kind: "save", input: document.path ?? "", after: null }),
          },
          {
            id: "open",
            code: 24,
            ctrl: true,
            onInvoke: () => setPrompt({ kind: "open", input: "" }),
          },
          { id: "new", code: 49, ctrl: true, onInvoke: () => request({ kind: "new" }) },
        ]}
      >
        <Surface width={props.width} height={props.height} fill={pal.bg}>
          <Toolbar width={props.width} height={52}>
            <Button
              minWidth={(narrow ? 48 : 60) * ui}
              label="New"
              onPress={() => request({ kind: "new" })}
            />
            <Button
              minWidth={(narrow ? 48 : 60) * ui}
              label="Open"
              onPress={() => setPrompt({ kind: "open", input: "" })}
            />
            <Button
              minWidth={(narrow ? 48 : 60) * ui}
              label="Save"
              variant="primary"
              onPress={() => save()}
            />
            <Button
              minWidth={(narrow ? 58 : 82) * ui}
              label={narrow ? "As…" : "Save As…"}
              onPress={() => setPrompt({ kind: "save", input: document.path ?? "", after: null })}
            />
            <Button minWidth={56 * ui} label="Close" onPress={() => request({ kind: "close" })} />
          </Toolbar>
          <Label
            x={16}
            y={62}
            width={width}
            height={22}
            text={`${dirty ? "Unsaved · " : ""}${document.path ?? "Untitled document"}`}
            color={pal.muted}
            fontSize={12}
            overflow="ellipsis"
            maxLines={1}
          />
          <TextArea
            key={bufferIdentity}
            x={16}
            y={94}
            width={width}
            height={Math.max(80, props.height - 138)}
            value={document.text}
            onChange={(text) => update({ ...current.current, text })}
            autoFocus
            focusId="editor-document"
            fontFamily="mono"
            lineNumbers
            captureTab
            fontSize={14}
            placeholder="Start writing…"
          />
          <StatusBar y={props.height - 30} width={props.width} height={30}>
            <Label
              flexGrow={1}
              text={status}
              color={pal.muted}
              fontSize={11}
              overflow="ellipsis"
              maxLines={1}
            />
            <Label
              text={`${document.text.split("\n").length} lines`}
              color={pal.muted}
              fontSize={11}
            />
          </StatusBar>
        </Surface>
      </ShortcutManager>
      <Sheet
        open={prompt.kind !== "none"}
        viewportWidth={props.width}
        viewportHeight={props.height}
        edge="bottom"
        height={Math.min(props.height, 230 * ui)}
        title={sheetTitle}
        onDismiss={() => setPrompt({ kind: "none" })}
      >
        <Box width={Math.max(1, props.width - 48)} height={150 * ui}>
          {filePrompt ? (
            <>
              <Label
                y={10 * ui}
                width={width - 32}
                text="File path or file:// URL"
                color={pal.muted}
              />
              <TextField
                y={42 * ui}
                width={width - 32}
                value={prompt.input}
                autoFocus
                onChange={(input) => setPrompt({ ...prompt, input })}
                onSubmit={submit}
                onCancel={() => setPrompt({ kind: "none" })}
              />
              <Button
                y={100 * ui}
                width={96 * ui}
                label={prompt.kind === "open" ? "Open file" : "Save file"}
                variant="primary"
                onPress={submit}
              />
            </>
          ) : prompt.kind === "discard" ? (
            <>
              <Label
                y={6 * ui}
                width={width - 32}
                height={52 * ui}
                text="This document has unsaved changes. Save it, discard the changes, or keep editing."
                wrap
                maxLines={3}
              />
              <Button
                y={76 * ui}
                width={90 * ui}
                label="Save"
                variant="primary"
                onPress={() => save(current.current.path ?? "", false, prompt.after)}
              />
              <Button
                x={100 * ui}
                y={76 * ui}
                width={90 * ui}
                label="Discard"
                variant="danger"
                onPress={() => perform(prompt.after)}
              />
              <Button
                x={200 * ui}
                y={76 * ui}
                width={90 * ui}
                label="Cancel"
                onPress={() => setPrompt({ kind: "none" })}
              />
            </>
          ) : prompt.kind === "overwrite" ? (
            <>
              <Label width={width - 32} height={54 * ui} text={prompt.path} wrap maxLines={3} />
              <Button
                y={76 * ui}
                width={96 * ui}
                label="Replace"
                variant="danger"
                onPress={() => save(prompt.path, true, prompt.after)}
              />
              <Button
                x={106 * ui}
                y={76 * ui}
                width={90 * ui}
                label="Cancel"
                onPress={() => setPrompt({ kind: "none" })}
              />
            </>
          ) : null}
        </Box>
      </Sheet>
    </OverlayHost>
  );
}
export async function main(args = process.argv.slice(2)): Promise<void> {
  const settings = loadSettings();
  setUiScaleFactor(settings.uiScale);
  const app = new Application();
  for (const input of args.length ? args : [null]) {
    let initialDocument = blankDocument(),
      initialError = "";
    if (input) {
      try {
        initialDocument = openDocument(input);
      } catch (error) {
        initialError = error instanceof Error ? error.message : String(error);
      }
    }
    const win = new Window({
      title: "Text Editor",
      appId: "org.moire.Editor",
      width: Math.round(850 * settings.uiScale),
      height: Math.round(650 * settings.uiScale),
      resizable: true,
    });
    win.setContent((size) => (
      <EditorApp
        {...size}
        initialDocument={initialDocument}
        initialError={initialError}
        onClose={() => win.destroy()}
        onTitleChange={(title) => win.setTitle(title)}
        onCloseGuard={(guard) => win.setCloseGuard(guard)}
      />
    ));
    app.addWindow(win);
  }
  await app.run();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch((error) => {
    console.error("[editor]", error);
    process.exitCode = 1;
  });
