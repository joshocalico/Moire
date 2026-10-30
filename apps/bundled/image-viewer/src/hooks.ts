/** Image Viewer's effects: decoding the open image and listing its folder. */
import path from "node:path";
import { useEffect, useState } from "react";
import { errorText, rememberRecentFile, type Preview } from "@moire/app-tools";
import { decodeImage, folderImages } from "./backend";
import type { ViewerState } from "./model";

export type ImageLoad =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; preview: Preview }
  | { kind: "error"; message: string };

/** Decodes the open image; the preview's private files are removed when it is replaced. */
export function useDecodedImage(state: ViewerState, appId: string): ImageLoad {
  const [load, setLoad] = useState<ImageLoad>({ kind: "idle" });
  const file = state.kind === "open" ? state.file : "";
  const turns = state.kind === "open" ? state.turns : 0;
  const attempt = state.kind === "open" ? state.attempt : 0;
  useEffect(() => {
    if (!file) {
      setLoad({ kind: "idle" });
      return;
    }
    let alive = true;
    let loaded: Preview | null = null;
    const controller = new AbortController();
    setLoad({ kind: "loading" });
    decodeImage(file, turns, controller.signal).then(
      (preview) => {
        loaded = preview;
        if (!alive) return void preview.dispose();
        setLoad({ kind: "ready", preview });
        rememberRecentFile(appId, file);
      },
      (error: unknown) => {
        if (alive) setLoad({ kind: "error", message: errorText(error) });
      },
    );
    return () => {
      alive = false;
      controller.abort();
      if (loaded) void loaded.dispose();
    };
  }, [file, turns, attempt, appId]);
  return load;
}

/** The images in the open image's folder, for previous/next. Empty until listed. */
export function useFolderImages(file: string): {
  images: string[];
  error: string;
} {
  const [result, setResult] = useState({ images: [] as string[], error: "" });
  // Only another folder needs listing; stepping through this one keeps the list.
  const folder = file ? path.dirname(file) : "";
  useEffect(() => {
    if (!folder) return;
    let alive = true;
    folderImages(folder).then(
      (images) => alive && setResult({ images, error: "" }),
      (error: unknown) => alive && setResult({ images: [], error: errorText(error) }),
    );
    return () => {
      alive = false;
    };
  }, [folder]);
  return result;
}

/**
 * The open image scaled to `edge` pixels along its long edge, when it is shown smaller than it
 * is; null while it is shown at or above its own size (the full decode is drawn then).
 */
export function useScaledImage(
  state: ViewerState,
  full: Preview | null,
  edge: number | null,
): Preview | null {
  const [scaled, setScaled] = useState<Preview | null>(null);
  const file = state.kind === "open" ? state.file : "";
  const turns = state.kind === "open" ? state.turns : 0;
  const smaller = !!full && !!edge && edge < Math.max(full.width, full.height) - 1;
  useEffect(() => {
    setScaled(null);
    if (!file || !smaller || !edge) return;
    let alive = true;
    let loaded: Preview | null = null;
    const controller = new AbortController();
    decodeImage(file, turns, controller.signal, edge).then(
      (preview) => {
        loaded = preview;
        if (alive) setScaled(preview);
        else void preview.dispose();
      },
      // The full decode is still drawn, so a failed rescale only costs sharpness.
      () => {},
    );
    return () => {
      alive = false;
      controller.abort();
      if (loaded) void loaded.dispose();
    };
  }, [file, turns, full, smaller, edge]);
  return smaller ? scaled : null;
}
