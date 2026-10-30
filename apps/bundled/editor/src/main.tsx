import React, { useState, type ReactNode } from "react";
import path from "node:path";
import {
  Application,
  ContextMenu,
  OverlayHost,
  ShortcutManager,
  TextArea,
  Window,
  getUiScaleFactor,
  setUiScaleFactor,
  type WindowActions,
  type WindowSize,
} from "@moire/ui";
import { AppFrame, appFrameBody, errorText, isMain } from "@moire/app-tools";
import { loadSettings } from "@moire/prefs";
import { blankDocument, openDocument, type TextDocument } from "./backend";
import { editorMenu, editorShortcuts } from "./commands";
import { EDITOR_APP_ID, cursorPosition, documentName, lineCount } from "./model";
import { useEditorSession } from "./session";
import { FindBar, findBarHeight } from "./views/find-bar";
import { headerActions } from "./views/header-actions";
import { EditorPrompts } from "./views/prompts";

export type EditorProps = WindowSize & {
  initialDocument?: TextDocument;
  initialError?: string;
  onClose: () => void;
  onTitleChange?: (title: string) => void;
  onCloseGuard?: (guard: () => boolean) => void;
  /** The window the header bar controls (minimize, maximize, close, move). */
  window?: WindowActions | null;
};

const PAD = 12;
const COMPACT_WIDTH = 760;
// The More menu opens under the header's trailing actions.
const MENU_INSET = 260;
const MENU_TOP = 40;

export function EditorApp(props: EditorProps): ReactNode {
  const ui = getUiScaleFactor();
  const editor = useEditorSession(props);
  const [menuOpen, setMenuOpen] = useState(false);
  const { document, find } = editor;
  const compact = props.width < COMPACT_WIDTH * ui;
  const controlsHeight = findBarHeight(find.mode);
  const body = appFrameBody({
    height: props.height,
    title: "Text Editor",
    controls: find.mode !== "closed",
    controlsHeight,
  });
  const pad = PAD * ui;
  const position = cursorPosition(document.text, editor.selection.focus);
  const lines = lineCount(document.text);
  return (
    <OverlayHost width={props.width} height={props.height}>
      <ShortcutManager
        width={props.width}
        height={props.height}
        shortcuts={editorShortcuts(editor, menuOpen)}
      >
        <AppFrame
          width={props.width}
          height={props.height}
          title="Text Editor"
          icon="editor"
          subtitle={`${documentName(document.path)}${editor.dirty ? " — Edited" : ""}`}
          window={props.window}
          actions={headerActions({ editor, compact, onMore: () => setMenuOpen(true) })}
          controls={
            find.mode === "closed" ? undefined : (
              <FindBar
                width={props.width}
                find={find}
                summary={editor.findSummary}
                focusRequest={editor.findFocus}
                onChange={editor.changeFind}
                onNext={() => editor.step(1)}
                onPrevious={() => editor.step(-1)}
                onReplace={editor.replaceOne}
                onReplaceAll={editor.replaceEverything}
                onClose={editor.closeFind}
              />
            )
          }
          controlsHeight={controlsHeight}
          status={editor.status}
          statusEnd={`Ln ${position.line}, Col ${position.column} · ${lines} ${lines === 1 ? "line" : "lines"}`}
        >
          <TextArea
            key={editor.buffer}
            x={pad}
            y={pad}
            width={Math.max(1, props.width - pad * 2)}
            height={Math.max(80, body.height - pad * 2)}
            value={document.text}
            command={editor.command}
            highlights={editor.matches}
            wrap={editor.wrap}
            onChange={editor.edit}
            onSelectionChange={editor.selectionChanged}
            autoFocus
            focusId={`editor-document:${editor.documentFocus}`}
            fontFamily="mono"
            lineNumbers
            captureTab
            fontSize={14}
            placeholder="Start writing…"
          />
        </AppFrame>
      </ShortcutManager>
      {menuOpen ? (
        <ContextMenu
          viewportWidth={props.width}
          viewportHeight={props.height}
          x={props.width - MENU_INSET * ui}
          y={MENU_TOP * ui}
          actions={editorMenu(editor, compact)}
          onDismiss={() => setMenuOpen(false)}
        />
      ) : null}
      <EditorPrompts width={props.width} height={props.height} editor={editor} />
    </OverlayHost>
  );
}

/** One window per file argument, or one untitled document. */
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
        initialError = `Couldn't open ${path.basename(input)}: ${errorText(error)}`;
      }
    }
    const win = new Window({
      title: "Text Editor",
      appId: EDITOR_APP_ID,
      width: Math.round(850 * settings.uiScale),
      height: Math.round(650 * settings.uiScale),
      resizable: true,
      // The AppFrame header bar is this window's titlebar.
      decorated: false,
    });
    win.setContent((size) => (
      <EditorApp
        {...size}
        window={win}
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
if (isMain(import.meta.url))
  void main().catch((error) => {
    console.error("[editor]", error);
    process.exitCode = 1;
  });
