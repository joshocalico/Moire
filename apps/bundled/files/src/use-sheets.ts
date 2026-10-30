/**
 * The sheets over a tab's page: Preview (Space) for one item, or Properties for the selection.
 * Switching tabs closes Preview but keeps Properties open, following the new tab's selection.
 */
import { useEffect, useState } from "react";

export type Sheet = { kind: "preview"; key: string } | { kind: "properties" };

export function useSheets(tabId: string) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  // The pane's text fields (tags, inline rename) unmount with it without reporting blur.
  const [tagFocused, setTagFocused] = useState(false);
  // F2 with Properties open renames in the pane; each request moves this on.
  const [renameRequest, setRenameRequest] = useState(0);
  useEffect(() => {
    setTagFocused(false);
    setSheet((current) => (current?.kind === "properties" ? current : null));
  }, [tabId]);
  const propertiesOpen = sheet?.kind === "properties";
  useEffect(() => {
    if (!propertiesOpen) setTagFocused(false);
  }, [propertiesOpen]);
  return {
    sheet,
    tagFocused,
    setTagFocused,
    propertiesOpen,
    previewKey: sheet?.kind === "preview" ? sheet.key : null,
    showProperties: () => setSheet({ kind: "properties" }),
    renameRequest,
    requestRename: () => setRenameRequest((value) => value + 1),
    preview: (key: string) => setSheet({ kind: "preview", key }),
    close: () => setSheet(null),
  };
}
