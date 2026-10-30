import path from "node:path";
import React, { useReducer, useState, type ReactNode } from "react";
import {
  Box,
  ShortcutManager,
  getUiScaleFactor,
  type WindowActions,
  type WindowSize,
} from "@moire/ui";
import {
  AppFrame,
  FileChooser,
  OpenButton,
  OpenFileState,
  TitleActions,
  appFrameBody,
  errorText,
  initialFile,
  localPath,
  runApp,
  startMain,
  useShownSize,
  useZoom,
  zoomShortcuts,
} from "@moire/app-tools";
import { pageAspect, pagePixels } from "./backend";
import { useDocument, usePage, useThumbnailStore } from "./hooks";
import { initialState, pageForKey, reduce } from "./model";
import { DocumentToolbar } from "./views/document-toolbar";
import { PageView } from "./views/page-view";
import { SIDEBAR_WIDTH, ThumbnailSidebar, thumbnailPixels } from "./views/thumbnail-sidebar";

const APP_ID = "org.moire.DocumentViewer";
const TITLE = "Document Viewer";
/** Below this window width the thumbnails start hidden, leaving the page the room. */
const SIDEBAR_MIN_WINDOW = 760;
/** CSS pixels per PDF point, so 100% is the page's printed size. */
const PIXELS_PER_POINT = 96 / 72;
const PAGING_KEYS = ["PageDown", "PageUp", "Home", "End"] as const;

export function DocumentViewerApp(
  props: WindowSize & { initialPath?: string; window?: WindowActions | null },
): ReactNode {
  const ui = getUiScaleFactor();
  const roomy = props.width >= SIDEBAR_MIN_WINDOW * ui;
  const [state, dispatch] = useReducer(reduce, props.initialPath, (file) =>
    initialState(file, roomy),
  );
  const [choosing, setChoosing] = useState(false);
  const [editingPage, setEditingPage] = useState(false);
  const [notice, setNotice] = useState("");
  const file = state.kind === "open" ? state.file : "";
  const page = state.kind === "open" ? state.page : 1;
  const document = useDocument(state, APP_ID);
  const info = document.kind === "ready" ? document.info : null;
  const thumbnails = useThumbnailStore(info, thumbnailPixels(info));
  const body = appFrameBody({ height: props.height, title: TITLE, controls: !!file });
  const sidebar = state.kind === "open" && state.sidebar && !!info;
  const pageArea = {
    width: props.width - (sidebar ? SIDEBAR_WIDTH * ui : 0),
    height: body.height,
  };
  const pageWidth = (info?.pageSize.width ?? 0) * PIXELS_PER_POINT * ui;
  const zoom = useZoom(
    file,
    info ? { width: pageWidth, height: pageWidth * pageAspect(info) } : null,
    pageArea,
    { fit: "width", min: 0.25, max: 4, maxFit: 4 },
  );
  // Pages render at the size they are shown, once zooming or resizing pauses.
  const shownSize = useShownSize(zoom, !!info);
  const rendered = usePage(info, page, shownSize && pagePixels(shownSize));
  const preview = rendered.kind === "ready" ? rendered.preview : null;

  const open = (value: string) => {
    setNotice("");
    try {
      dispatch({ type: "open", file: localPath(value), sidebar: roomy });
    } catch (error) {
      dispatch({ type: "close", error: errorText(error) });
    }
  };
  const go = (next: number) => {
    if (!info || next === page) return;
    setNotice("");
    dispatch({ type: "go", page: next, pages: info.pages });
    zoom.scrollToEdge("top");
  };

  const status =
    notice ||
    (document.kind === "loading"
      ? "Reading PDF…"
      : document.kind === "error"
        ? document.message
        : rendered.kind === "ready" && rendered.pending
          ? `Rendering page ${page}…`
          : info
            ? `PDF · ${info.pages} ${info.pages === 1 ? "page" : "pages"} · Page Up and Page Down turn pages`
            : "Open a PDF document");

  return (
    <ShortcutManager
      width={props.width}
      height={props.height}
      enabled={!!info && !choosing && !editingPage}
      shortcuts={[
        ...PAGING_KEYS.map((key) => ({
          id: key,
          key,
          allowRepeat: true,
          onInvoke: () => go(pageForKey(key, page, info?.pages ?? 1) ?? page),
        })),
        { id: "open", key: "o", ctrl: true, onInvoke: () => setChoosing(true) },
        ...zoomShortcuts(zoom, !preview),
      ]}
    >
      <AppFrame
        {...props}
        title={TITLE}
        icon="document"
        subtitle={file ? (info?.title ?? path.basename(file)) : undefined}
        status={status}
        statusEnd={info ? `Page ${page} of ${info.pages}` : undefined}
        actions={
          file ? (
            <TitleActions>
              <OpenButton focusId="document:open" onPress={() => setChoosing(true)} />
            </TitleActions>
          ) : null
        }
        controls={
          file ? (
            <DocumentToolbar
              width={props.width}
              zoom={zoom}
              page={page}
              pages={info?.pages ?? null}
              sidebar={sidebar}
              ready={!!preview}
              onToggleSidebar={() => dispatch({ type: "toggle-sidebar" })}
              onGo={go}
              onInvalidPage={setNotice}
              onEditingPage={setEditingPage}
            />
          ) : undefined
        }
      >
        {file ? (
          <Box width={props.width} height={body.height}>
            {sidebar && info ? (
              <ThumbnailSidebar
                height={body.height}
                pages={info.pages}
                page={page}
                aspect={pageAspect(info)}
                store={thumbnails}
                onGo={go}
              />
            ) : null}
            <Box x={props.width - pageArea.width} width={pageArea.width} height={pageArea.height}>
              <PageView
                {...pageArea}
                file={file}
                document={document}
                page={rendered}
                zoom={zoom}
                onRetry={() => dispatch({ type: "retry" })}
              />
            </Box>
          </Box>
        ) : (
          <OpenFileState
            width={props.width}
            height={body.height}
            appId={APP_ID}
            icon="document"
            title="Open a document"
            message="View PDF documents with page thumbnails, zoom and keyboard paging."
            placeholder="Path to a PDF"
            error={state.kind === "empty" ? state.error : undefined}
            onBrowse={() => setChoosing(true)}
            onOpen={open}
          />
        )}
      </AppFrame>
      {choosing ? (
        <FileChooser
          width={props.width}
          height={props.height}
          mode="open"
          title="Open a document"
          appId={APP_ID}
          accept={["pdf"]}
          directory={file ? path.dirname(file) : undefined}
          onChoose={(chosen) => {
            setChoosing(false);
            open(chosen);
          }}
          onCancel={() => setChoosing(false)}
        />
      ) : null}
    </ShortcutManager>
  );
}

startMain(import.meta.url, () =>
  runApp(TITLE, APP_ID, (size, window) => (
    <DocumentViewerApp {...size} window={window} initialPath={initialFile()} />
  )),
);
