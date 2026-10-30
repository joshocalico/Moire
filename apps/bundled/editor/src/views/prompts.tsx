/** Whatever the editor is asking right now: a file chooser or one of its dialogs. */
import path from "node:path";
import React, { type ReactNode } from "react";
import type { WindowSize } from "@moire/ui";
import { FileChooser } from "@moire/app-tools";
import { EDITOR_APP_ID, lineCount } from "#editor/model";
import type { EditorSession } from "#editor/session";
import { DiscardDialog, GoToLineDialog, OverwriteDialog } from "./dialogs";

export function EditorPrompts(props: WindowSize & { editor: EditorSession }): ReactNode {
  const { editor, width, height } = props;
  const { prompt, document } = editor;
  const size = { width, height };
  const cancel = () => editor.setPrompt({ kind: "none" });
  const folder = document.path ? path.dirname(document.path) : undefined;
  switch (prompt.kind) {
    case "choose-open":
      return (
        <FileChooser
          {...size}
          mode="open"
          appId={EDITOR_APP_ID}
          title="Open text file"
          directory={folder}
          onChoose={(file) => editor.request({ kind: "open", path: file })}
          onCancel={cancel}
        />
      );
    case "choose-save":
      return (
        <FileChooser
          {...size}
          mode="save"
          appId={EDITOR_APP_ID}
          title="Save document as"
          directory={folder}
          name={document.path ? path.basename(document.path) : "Untitled.txt"}
          onChoose={(file) => editor.save(file, false, prompt.after)}
          onCancel={cancel}
        />
      );
    case "discard":
      return (
        <DiscardDialog
          {...size}
          name={document.path ? path.basename(document.path) : "This document"}
          error={editor.problem}
          onSave={() => editor.save(undefined, false, prompt.after)}
          onDiscard={() => editor.perform(prompt.after)}
          onCancel={cancel}
        />
      );
    case "overwrite":
      return (
        <OverwriteDialog
          {...size}
          file={prompt.path}
          error={editor.problem}
          onReplace={() => editor.save(prompt.path, true, prompt.after)}
          onCancel={cancel}
        />
      );
    case "go-to-line":
      return (
        <GoToLineDialog
          {...size}
          input={prompt.input}
          lines={lineCount(document.text)}
          error={prompt.error}
          onChange={(input) => editor.setPrompt({ kind: "go-to-line", input, error: "" })}
          onGo={() => editor.goToLine(prompt.input)}
          onCancel={cancel}
        />
      );
    case "none":
      return null;
  }
}
