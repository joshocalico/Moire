/** Document Viewer's effects: reading the document, rendering its pages and thumbnails. */
import { useEffect, useState } from "react";
import { errorText, rememberRecentFile, type Preview } from "@moire/app-tools";
import { ThumbnailStore, documentInfo, renderPage, type DocumentInfo } from "./backend";
import type { ViewerState } from "./model";

export type DocumentLoad =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; info: DocumentInfo }
  | { kind: "error"; message: string };

export function useDocument(state: ViewerState, appId: string): DocumentLoad {
  const [load, setLoad] = useState<DocumentLoad>({ kind: "idle" });
  const file = state.kind === "open" ? state.file : "";
  const attempt = state.kind === "open" ? state.attempt : 0;
  useEffect(() => {
    if (!file) {
      setLoad({ kind: "idle" });
      return;
    }
    let alive = true;
    const controller = new AbortController();
    setLoad({ kind: "loading" });
    documentInfo(file, controller.signal).then(
      (info) => {
        if (!alive) return;
        setLoad({ kind: "ready", info });
        rememberRecentFile(appId, info.file);
      },
      (error: unknown) => alive && setLoad({ kind: "error", message: errorText(error) }),
    );
    return () => {
      alive = false;
      controller.abort();
    };
  }, [file, attempt, appId]);
  return load;
}

/**
 * The rendered page. While the next page renders the last one stays up (`pending`), so paging
 * doesn't flash an empty view.
 */
export type PageLoad =
  | { kind: "loading" }
  | { kind: "ready"; preview: Preview; page: number; pending: boolean }
  | { kind: "error"; message: string };

/** `pixels` is the long edge to render at; null waits until the page's shown size is known. */
export function usePage(info: DocumentInfo | null, page: number, pixels: number | null): PageLoad {
  const [load, setLoad] = useState<PageLoad>({ kind: "loading" });
  useEffect(() => {
    if (!info || !pixels) {
      if (!info) setLoad({ kind: "loading" });
      return;
    }
    let alive = true;
    let loaded: Preview | null = null;
    const controller = new AbortController();
    setLoad((current) =>
      current.kind === "ready" ? { ...current, pending: true } : { kind: "loading" },
    );
    renderPage(info.file, page, info.pages, pixels, controller.signal).then(
      (preview) => {
        loaded = preview;
        if (!alive) return void preview.dispose();
        setLoad({ kind: "ready", preview, page, pending: false });
      },
      (error: unknown) => alive && setLoad({ kind: "error", message: errorText(error) }),
    );
    return () => {
      alive = false;
      controller.abort();
      // The bitmap stays in memory for display; only its private files go.
      if (loaded) void loaded.dispose();
    };
  }, [info, page, pixels]);
  return load;
}

/** A thumbnail store for the open document, disposed when it closes. */
export function useThumbnailStore(
  info: DocumentInfo | null,
  pixels: number,
): ThumbnailStore | null {
  const [store, setStore] = useState<ThumbnailStore | null>(null);
  useEffect(() => {
    if (!info) return;
    const next = new ThumbnailStore(info, pixels);
    setStore(next);
    return () => {
      setStore(null);
      void next.dispose();
    };
  }, [info, pixels]);
  return store;
}

export function useThumbnail(store: ThumbnailStore | null, page: number): Preview | "error" | null {
  const [thumbnail, setThumbnail] = useState<Preview | "error" | null>(null);
  useEffect(() => {
    if (!store) return;
    let alive = true;
    setThumbnail(null);
    store.get(page).then(
      (preview) => alive && setThumbnail(preview),
      () => alive && setThumbnail("error"),
    );
    return () => {
      alive = false;
    };
  }, [store, page]);
  return thumbnail;
}
