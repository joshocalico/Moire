import React, { type ReactNode } from "react";
import {
  Button,
  Label,
  Row,
  ScrollColumn,
  TextField,
  getUiScaleFactor,
  usePalette,
  type WindowSize,
} from "@moire/ui";

/** Add music: browse for a folder or file, or type a path or file URL. */
export function ImportPanel(
  props: WindowSize & {
    y: number;
    path: string;
    busy: boolean;
    onPath: (path: string) => void;
    onChoose: (mode: "folder" | "open") => void;
    onImport: () => void;
    onCancel: () => void;
  },
): ReactNode {
  const ui = getUiScaleFactor(),
    pal = usePalette();
  return (
    <ScrollColumn
      y={props.y}
      width={props.width}
      height={props.height}
      padding={20 * ui}
      gap={14 * ui}
    >
      <Label text="Import local music" fontSize={24} fontWeight="medium" />
      <Label
        text="Choose a music folder or a single audio file. Folders are scanned recursively; your original files remain in place. Metadata and artwork come from those files."
        wrap
        fontSize={13}
      />
      <Row height={40 * ui} gap={8 * ui}>
        <Button
          label="Choose folder…"
          variant="primary"
          focusId="music:choose-folder"
          disabled={props.busy}
          onPress={() => props.onChoose("folder")}
        />
        <Button
          label="Choose file…"
          focusId="music:choose-file"
          disabled={props.busy}
          onPress={() => props.onChoose("open")}
        />
      </Row>
      <Label text="Or enter a path or file URL" fontSize={12} color={pal.muted} />
      <TextField
        width={Math.max(1, props.width - 40 * ui)}
        value={props.path}
        onChange={props.onPath}
        placeholder="Local audio file or folder"
        autoFocus
        onSubmit={() => {
          if (!props.busy) props.onImport();
        }}
      />
      <Row height={40 * ui} gap={8 * ui}>
        <Button
          label={props.busy ? "Importing…" : "Import"}
          disabled={props.busy || !props.path.trim()}
          focusId="music:confirm-import"
          onPress={props.onImport}
        />
        <Button label={props.busy ? "Cancel import" : "Cancel"} onPress={props.onCancel} />
      </Row>
    </ScrollColumn>
  );
}
