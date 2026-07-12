/**
 * PlatformBackend — OS window I/O. Widgets/fonts never import platforms.
 */
export type PointerButton = "left" | "right" | "middle";

export type UiPointerEvent = {
  type: "move" | "down" | "up" | "wheel";
  x: number;
  y: number;
  button?: PointerButton;
  /** Scroll delta in pixels (positive = scroll down). Only set for type="wheel". */
  deltaY?: number;
  timeMs: number;
};

export type UiKeyEvent = {
  type: "down" | "up" | "repeat";
  /** Linux evdev-ish keycode when available; else 0. */
  code: number;
  /** UTF-8 character if printable. */
  text?: string;
  timeMs: number;
};

export type PlatformWindowOpts = {
  title: string;
  appId: string;
  width: number;
  height: number;
  /** When false, request a fixed size (min==max) from the compositor. Default true. */
  resizable?: boolean;
};

export interface PlatformWindow {
  setTitle(title: string): void;
  setSize(w: number, h: number): void;
  /** Present full ARGB8888 frame (row-major, stride = width * 4). */
  present(pixels: Uint8Array, width: number, height: number): void;
  onConfigure(cb: (w: number, h: number) => void): void;
  onClose(cb: () => void): void;
  onPointer(cb: (ev: UiPointerEvent) => void): void;
  onKey(cb: (ev: UiKeyEvent) => void): void;
  destroy(): void;
}

export interface PlatformBackend {
  readonly name: string;
  connect(): Promise<void>;
  createWindow(opts: PlatformWindowOpts): PlatformWindow;
  pump(): void;
  disconnect(): void;
}

/** A single item in a drag-and-drop transfer. */
export type UiDataTransferItem = {
  mimeType: string;
  /** Returns the item data as a Buffer/string (async for DnD from compositor). */
  getData(): Promise<Buffer | string>;
};

/** Payload carried during a DnD operation. */
export type UiDataTransfer = {
  /** MIME types available in this transfer. */
  readonly types: readonly string[];
  getItem(mimeType: string): UiDataTransferItem | null;
};

/** DnD capability that PlatformBackend implementations may opt into. */
export interface DndCapable {
  /**
   * Start a Wayland DnD drag.  Called by Draggable widgets via setDndBridge.
   * @param mimeTypes  MIME types offered.
   * @param getPayload Callback that returns serialisable data for a given MIME type.
   * @param serial     Input serial from the triggering pointer-press event.
   */
  startDrag(
    mimeTypes: string[],
    getPayload: (mime: string) => string | Buffer | null,
    serial: number,
  ): void;
}

export type PlatformKind = "wayland" | "headless";

export function resolvePlatformKind(): PlatformKind {
  const env = process.env.MOIRE_UI_PLATFORM?.trim().toLowerCase();
  if (env === "wayland" || env === "headless") return env;
  if (process.env.WAYLAND_DISPLAY && process.platform === "linux") {
    return "wayland";
  }
  return "headless";
}

export async function createPlatformBackend(
  kind: PlatformKind = resolvePlatformKind(),
): Promise<PlatformBackend> {
  if (kind === "wayland") {
    const { WaylandPlatform } = await import("./platforms/wayland/index.js");
    return new WaylandPlatform();
  }
  const { HeadlessPlatform } = await import("./platforms/headless/index.js");
  return new HeadlessPlatform();
}
