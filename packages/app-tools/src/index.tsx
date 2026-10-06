import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PNG } from "pngjs";
import React, { useState, type ReactNode } from "react";
import {
  Application,
  Window,
  Surface,
  Label,
  TextField,
  Button,
  Row,
  setUiScaleFactor,
  getUiScaleFactor,
  usePalette,
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
        ? { ...process.env, LC_ALL: process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8" }
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
export async function privatePreview(
  make: (file: string, directory: string) => Promise<void>,
): Promise<Preview> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-preview-"));
  const file = path.join(directory, "preview.png");
  try {
    await make(file, directory);
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
      dispose: () => fs.rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true });
    throw error;
  }
}
export function FileHeader(props: {
  width: number;
  value: string;
  onOpen: (value: string) => void;
  disabled?: boolean;
}): ReactNode {
  const ui = getUiScaleFactor();
  const [draft, setDraft] = useState(props.value);
  return (
    <Row width={props.width} height={44 * ui} padding={6 * ui} gap={6 * ui}>
      <TextField
        width={Math.max(100 * ui, props.width - 90 * ui)}
        height={32 * ui}
        value={draft}
        disabled={props.disabled}
        autoFocus
        selectAllOnFocus
        onChange={setDraft}
        onSubmit={() => props.onOpen(draft)}
        placeholder="Local path or file URL"
      />
      <Button
        width={66 * ui}
        height={32 * ui}
        disabled={props.disabled}
        label="Open"
        onPress={() => props.onOpen(draft)}
      />
    </Row>
  );
}
export function AppFrame(
  props: WindowSize & {
    header?: ReactNode;
    controls?: ReactNode;
    controlsHeight?: number;
    status: string;
    children?: ReactNode;
  },
): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const controlsHeight = props.controlsHeight ?? 44 * ui;
  const bodyY = 44 * ui + controlsHeight;
  return (
    <Surface width={props.width} height={props.height} fill={pal.bg}>
      {props.header}
      <Surface y={44 * ui} width={props.width} height={controlsHeight} fill={pal.panel}>
        {props.controls}
      </Surface>
      <Surface
        y={bodyY}
        width={props.width}
        height={Math.max(1, props.height - bodyY - 30 * ui)}
        clip
      >
        {props.children}
      </Surface>
      <Label
        x={10 * ui}
        y={props.height - 28 * ui}
        width={props.width - 20 * ui}
        height={24 * ui}
        text={props.status}
        color={pal.muted}
        fontSize={11}
        overflow="ellipsis"
        maxLines={1}
      />
    </Surface>
  );
}
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
    decorated: options.decorated,
    resizable: true,
  });
  window.setContent((size) => render(size, window));
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
export { PlaybackSession, type PlaybackState } from "./playback";
export { PlayerApp } from "./player";
