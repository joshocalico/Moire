import React, { useEffect, useState, type ReactNode } from "react";
import { Box, TextField, getUiScaleFactor } from "@moire/ui";
import {
  ToolButton,
  ToolReadout,
  ToolRow,
  ToolSeparator,
  ZoomControls,
  type Zoom,
} from "@moire/app-tools";
import { parsePage } from "#document-viewer/model";

const PAGE_FIELD_WIDTH = 48;

/** The thumbnail toggle, paging with a go-to-page field, and zoom. */
export function DocumentToolbar(props: {
  width: number;
  zoom: Zoom;
  page: number;
  /** Null until the document has been read. */
  pages: number | null;
  sidebar: boolean;
  ready: boolean;
  onToggleSidebar: () => void;
  onGo: (page: number) => void;
  onInvalidPage: (message: string) => void;
  onEditingPage: (editing: boolean) => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const [draft, setDraft] = useState(String(props.page));
  useEffect(() => setDraft(String(props.page)), [props.page]);
  const { pages } = props;
  const submit = () => {
    if (!pages) return;
    const parsed = parsePage(draft, pages);
    if ("page" in parsed) props.onGo(parsed.page);
    else {
      setDraft(String(props.page));
      props.onInvalidPage(parsed.error);
    }
  };
  return (
    <ToolRow width={props.width}>
      <ToolButton
        icon="grid"
        tooltip={props.sidebar ? "Hide page thumbnails" : "Show page thumbnails"}
        focusId="document:sidebar"
        selected={props.sidebar}
        disabled={!pages}
        onPress={props.onToggleSidebar}
      />
      <ToolSeparator />
      <ToolButton
        icon="chevron-left"
        tooltip="Previous page (Page Up)"
        focusId="document:previous"
        disabled={!pages || props.page <= 1}
        onPress={() => props.onGo(props.page - 1)}
      />
      <Box width={PAGE_FIELD_WIDTH * ui} height={30 * ui} flexShrink={0}>
        <TextField
          width={PAGE_FIELD_WIDTH * ui}
          height={30 * ui}
          value={draft}
          disabled={!pages}
          selectAllOnFocus
          onChange={setDraft}
          onSubmit={submit}
          onFocusChange={props.onEditingPage}
        />
      </Box>
      <ToolReadout text={pages ? `of ${pages}` : "of —"} width={44 * ui} />
      <ToolButton
        icon="chevron-right"
        tooltip="Next page (Page Down)"
        focusId="document:next"
        disabled={!pages || props.page >= pages}
        onPress={() => props.onGo(props.page + 1)}
      />
      <ToolSeparator />
      <ZoomControls
        zoom={props.zoom}
        idPrefix="document"
        fitLabel="Fit width"
        disabled={!props.ready}
      />
    </ToolRow>
  );
}
