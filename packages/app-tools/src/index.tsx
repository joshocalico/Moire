import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PNG } from "pngjs";
import React, { type ReactNode } from "react";
import {
  Application,
  OverlayHost,
  Window,
  setUiScaleFactor,
  type WindowSize,
  type ImageData,
} from "@moire/ui";
import { loadSettings } from "@moire/prefs";

export function errorText(error: unknown): string {
  if (error instanceof Error && "code" in error) {
    switch (error.code) {
      case "ENOENT":
        return "The file or required backend was not found. Check the path and installed tools.";
      case "EEXIST":
        return "That output already exists. Choose a new name or folder.";
      case "EACCES":
      case "EPERM":
        return "Permission denied. Choose a file or folder you can access.";
      case "ENOSPC":
        return "There is not enough space to finish this operation.";
    }
  }
  return error instanceof Error ? error.message : String(error);
}
export async function runTool(
  command: string,
  args: readonly string[],
  signal?: AbortSignal,
  options: { utf8Locale?: boolean } = {},
): Promise<string> {
  try {
    const result = await promisify(execFile)(command, [...args], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: 120000,
      signal,
      // Archive listings must preserve Unicode member names even under a C locale.
      env: options.utf8Locale
        ? {
            ...process.env,
            LC_ALL: process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8",
          }
        : undefined,
    });
    return result.stdout;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      throw new Error(`${command} is unavailable. Install this app's backend to continue.`);
    if (error instanceof Error && "stderr" in error && typeof error.stderr === "string")
      throw new Error(error.stderr.trim().slice(-2000) || error.message);
    throw error;
  }
}
export function localPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Enter a local file path.");
  if (trimmed.startsWith("file:")) return fileURLToPath(trimmed);
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) throw new Error("Only local files are supported.");
  return path.resolve(
    trimmed === "~"
      ? os.homedir()
      : trimmed.startsWith("~/")
        ? path.join(os.homedir(), trimmed.slice(2))
        : trimmed,
  );
}
export async function readableFile(value: string): Promise<string> {
  const file = localPath(value);
  if (!(await fs.stat(file)).isFile()) throw new Error("Choose a regular file.");
  return file;
}
export function initialFile(argv = process.argv.slice(2)): string {
  return argv.find((argument) => !argument.startsWith("-")) ?? "";
}
export function isMain(url: string): boolean {
  return !!process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === url;
}
export type Preview = {
  file: string;
  width: number;
  height: number;
  bitmap: ImageData;
  dispose: () => Promise<void>;
};
/** Private preview work (rendering into or removing a preview directory) still in flight. */
const previewWork = new Set<Promise<unknown>>();
function trackPreviewWork<T>(work: Promise<T>): Promise<T> {
  previewWork.add(work);
  const done = () => previewWork.delete(work);
  work.then(done, done);
  return work;
}
/**
 * Resolve once no private preview is rendering or being removed. A view that unmounts aborts its
 * render and disposes its preview without awaiting either; whoever then removes the temporary
 * directory (a test fixture) waits here first, or it races the late writes and rmdir fails with
 * ENOTEMPTY.
 */
export async function privatePreviewsSettled(): Promise<void> {
  // setImmediate runs after the microtask queue drains, so a settled render's caller has had
  // its chance to dispose (or adopt) the result before the set is checked again.
  do {
    await Promise.allSettled([...previewWork]);
    await new Promise((resolve) => setImmediate(resolve));
  } while (previewWork.size);
}
/**
 * Render a PNG into a private temporary directory with `make` and decode it. An aborted `signal`
 * refuses before the directory is created, so an unmounted view leaves nothing behind.
 */
export function privatePreview(
  make: (file: string, directory: string) => Promise<void>,
  signal?: AbortSignal,
): Promise<Preview> {
  return trackPreviewWork(renderPrivatePreview(make, signal));
}
async function renderPrivatePreview(
  make: (file: string, directory: string) => Promise<void>,
  signal?: AbortSignal,
): Promise<Preview> {
  signal?.throwIfAborted();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-preview-"));
  const file = path.join(directory, "preview.png");
  try {
    await make(file, directory);
    signal?.throwIfAborted();
    const png = await fs.readFile(file);
    if (
      png.length < 24 ||
      !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      throw new Error("Backend did not produce a PNG preview.");
    const width = png.readUInt32BE(16),
      height = png.readUInt32BE(20);
    if (!width || !height || width * height > 32 * 1024 * 1024)
      throw new Error("Preview dimensions are too large.");
    const decoded = PNG.sync.read(png);
    return {
      file,
      width,
      height,
      bitmap: { rgba: new Uint8Array(decoded.data), width, height },
      dispose: () => trackPreviewWork(fs.rm(directory, { recursive: true, force: true })),
    };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}
/**
 * Open the app's window and render it. The content draws the window's titlebar itself (an
 * AppFrame with a `title`, or AppHeaderBar, given `window`), so the window opens undecorated
 * unless `decorated: true` asks the compositor for its own titlebar.
 */
export async function runApp(
  name: string,
  appId: string,
  render: (size: WindowSize, window: Window) => ReactNode,
  options: { decorated?: boolean; width?: number; height?: number } = {},
): Promise<void> {
  const settings = loadSettings();
  setUiScaleFactor(settings.uiScale);
  const app = new Application();
  const window = new Window({
    title: name,
    appId,
    width: Math.round((options.width ?? 860) * settings.uiScale),
    height: Math.round((options.height ?? 620) * settings.uiScale),
    decorated: options.decorated ?? false,
    resizable: true,
  });
  // Tooltips and other top-layer content paint above the whole app, not under later rows.
  window.setContent((size) => <OverlayHost {...size}>{render(size, window)}</OverlayHost>);
  window.onClose(() => app.quit());
  app.addWindow(window);
  await app.run();
}
export function startMain(url: string, work: () => Promise<void>): void {
  if (isMain(url))
    void work().catch((error: unknown) => {
      console.error(errorText(error));
      process.exitCode = 1;
    });
}
export {
  AppFrame,
  Card,
  CenteredMessage,
  FileHeader,
  IconTile,
  OpenButton,
  OpenFileState,
  OpenPathRow,
  RecentFiles,
  TitleActions,
  ToolButton,
  ToolIcon,
  ToolReadout,
  ToolRow,
  ToolSeparator,
  appFrameBody,
  cardContent,
  clearRecentFiles,
  countRecentFiles,
  loadRecentFiles,
  recentFilesHeight,
  rememberRecentFile,
  type AppFrameProps,
  type ToolIconName,
} from "./frame";
export { FileChooser, type FileChooserMode, type FileChooserProps } from "./file-chooser";
export { formatBytes, formatTimeAgo, tidyPath } from "./format";
export { isTimeZone, localTimeZone, wallClock, wallClockTimestamp } from "./time-zones";
export { freePath, homeFolder, moveToTrash, showInFiles } from "./places";
export { PlaybackSession, type PlaybackState } from "./playback";
export { PlayerApp } from "./player";
export { ZOOM_STEP, type FitMode, type Placement, type ZoomLimits, type ZoomView } from "./zoom";
export {
  ZoomControls,
  ZoomSurface,
  useShownSize,
  useZoom,
  zoomShortcuts,
  type Zoom,
} from "./zoom-view";
export { appSettingsPath, loadAppSettings, saveAppSettings } from "./app-settings";
