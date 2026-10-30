/**
 * Header bar actions: New and Open (wide windows), Find, Save and More. Called as a function so
 * the header bar receives the buttons themselves, which it measures to lay out the title.
 */
import React, { type ReactNode } from "react";
import { Button } from "@moire/ui";
import { ToolButton } from "@moire/app-tools";
import type { EditorSession } from "#editor/session";

export function headerActions(props: {
  editor: EditorSession;
  compact: boolean;
  onMore: () => void;
}): ReactNode {
  const { editor } = props;
  const finding = editor.find.mode !== "closed";
  return (
    <>
      {props.compact ? null : (
        <>
          <ToolButton
            icon="plus"
            tooltip="New document (Ctrl+N)"
            focusId="editor:new"
            onPress={() => editor.request({ kind: "new" })}
          />
          <ToolButton
            icon="folder"
            tooltip="Open… (Ctrl+O)"
            focusId="editor:open"
            onPress={editor.open}
          />
        </>
      )}
      <ToolButton
        icon="search"
        tooltip="Find and replace (Ctrl+F)"
        focusId="editor:find"
        selected={finding}
        onPress={() => (finding ? editor.closeFind() : editor.openFind("find"))}
      />
      <Button label="Save" variant="primary" focusId="editor:save" onPress={() => editor.save()} />
      <ToolButton icon="more" tooltip="More actions" focusId="editor:more" onPress={props.onMore} />
    </>
  );
}
