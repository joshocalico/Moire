/**
 * PlatformBackend — OS window I/O. Widgets/fonts never import platforms.
 */
import {
  discoverPersonalization,
  type PersonalizationProfile,
  type PersonalizationOverrides,
} from "./personalization";
export type { PersonalizationProfile } from "./personalization";
export type PointerButton = "left" | "right" | "middle";

export type UiPointerEvent = {
  type: "move" | "down" | "up" | "wheel";
  x: number;
  y: number;
  button?: PointerButton;
  /** Scroll delta in pixels (positive = scroll down). Only set for type="wheel". */
  deltaY?: number;
  /** Keyboard modifiers held when the pointer event was emitted. */
  modifiers?: UiKeyModifiers;
  timeMs: number;
};

export type UiKeyEvent = {
  type: "down" | "up" | "repeat";
  /** Linux evdev-ish keycode when available; else 0. */
  code: number;
  /** Logical key name (for example `Tab`, `ArrowLeft`, or `a`). */
  key?: string;
  /** UTF-8 character if printable. */
  text?: string;
  modifiers: UiKeyModifiers;
  timeMs: number;
};

export type UiKeyModifiers = {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
};

const KEY_NAMES: Record<number, string> = {
  1: "Escape",
  14: "Backspace",
  15: "Tab",
  28: "Enter",
  57: " ",
  102: "Home",
  103: "ArrowUp",
  105: "ArrowLeft",
  106: "ArrowRight",
  107: "End",
  108: "ArrowDown",
  111: "Delete",
};

const US_PRINTABLE: Record<number, [string, string]> = {
  2: ["1", "!"],
  3: ["2", "@"],
  4: ["3", "#"],
  5: ["4", "$"],
  6: ["5", "%"],
  7: ["6", "^"],
  8: ["7", "&"],
  9: ["8", "*"],
  10: ["9", "("],
  11: ["0", ")"],
  12: ["-", "_"],
  13: ["=", "+"],
  16: ["q", "Q"],
  17: ["w", "W"],
  18: ["e", "E"],
  19: ["r", "R"],
  20: ["t", "T"],
  21: ["y", "Y"],
  22: ["u", "U"],
  23: ["i", "I"],
  24: ["o", "O"],
  25: ["p", "P"],
  26: ["[", "{"],
  27: ["]", "}"],
  30: ["a", "A"],
  31: ["s", "S"],
  32: ["d", "D"],
  33: ["f", "F"],
  34: ["g", "G"],
  35: ["h", "H"],
  36: ["j", "J"],
  37: ["k", "K"],
  38: ["l", "L"],
  39: [";", ":"],
  40: ["'", '"'],
  41: ["`", "~"],
  43: ["\\", "|"],
  44: ["z", "Z"],
  45: ["x", "X"],
  46: ["c", "C"],
  47: ["v", "V"],
  48: ["b", "B"],
  49: ["n", "N"],
  50: ["m", "M"],
  51: [",", "<"],
  52: [".", ">"],
  53: ["/", "?"],
  57: [" ", " "],
};

export function modifiersFromPressed(pressed: ReadonlySet<number>): UiKeyModifiers {
  return {
    shift: pressed.has(42) || pressed.has(54),
    ctrl: pressed.has(29) || pressed.has(97),
    alt: pressed.has(56) || pressed.has(100),
    meta: pressed.has(125) || pressed.has(126),
  };
}

export function keyFromEvdev(
  code: number,
  modifiers: UiKeyModifiers,
): { key?: string; text?: string } {
  const printable = US_PRINTABLE[code];
  if (printable) {
    const text = printable[modifiers.shift ? 1 : 0];
    return { key: text, text };
  }
  return { key: KEY_NAMES[code] };
}

export type PlatformWindowOpts = {
  title: string;
  appId: string;
  width: number;
  height: number;
  /** When false, request a fixed size (min==max) from the compositor. Default true. */
  resizable?: boolean;
  /** Ask the compositor for server chrome. Default true. */
  decorated?: boolean;
  /** Request compositor-sized fullscreen presentation before the first commit. */
  fullscreen?: boolean;
};

export type PlatformPopupOpts = {
  /** Native parent surface; popup coordinates are relative to its content. */
  parent: PlatformWindow;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  /** Request an exclusive popup grab for outside-click/Escape dismissal. */
  grab?: boolean;
};

export type UiPresentationMode = "auto" | "egl" | "shm";
/** Explicit compositor observation; unknown must not be treated as visible. */
export type UiSurfaceVisibility = "visible" | "hidden" | "unknown";

/** Rendering authority is per actual submitted frame, never aggregate diagnostics. */
export type UiRenderingState =
  | Readonly<{ kind: "hardware-retained"; commitId: number }>
  | Readonly<{
      kind: "static";
      reason:
        | "pending"
        | "software"
        | "flat"
        | "readback"
        | "virtual"
        | "unknown-execution"
        | "awaiting-output"
        | "backend-loss"
        | "destroyed";
      commitId?: number;
    }>;

export type UiFrameEvent =
  | { type: "output-accepted"; commitId: number; execution: "software" | "virtual" }
  | { type: "output-revoked"; commitId: number }
  | {
      type: "submitted";
      commitId: number;
      transport: "dmabuf" | "shm" | "headless";
      submittedAtMs: number;
      copyMs: number;
      damagedPixels: number;
      totalPixels: number;
    }
  | {
      type: "compositor-frame";
      commitId: number;
      timestampMs: number;
      receivedAtMs: number;
      /** A newer draw was coalesced behind this frame callback. */
      retrySuggested?: boolean;
    }
  | {
      type: "presented";
      commitId: number;
      timestampNs: bigint;
      refreshNs: number;
      sequence: bigint;
      flags: number;
      receivedAtMs: number;
    }
  | {
      type: "discarded";
      commitId: number;
      receivedAtMs: number;
    }
  | {
      type: "buffer-release";
      commitId: number;
      transport: "dmabuf" | "shm";
      latencyMs: number;
      receivedAtMs: number;
      /** A retained frame was deferred until this transport slot reopened. */
      retrySuggested?: boolean;
    };

export interface PlatformWindow {
  getRenderingState(): UiRenderingState;
  onRenderingChange(cb: (state: UiRenderingState) => void): () => void;
  getVisibility(): UiSurfaceVisibility;
  /** Changes are independent of this surface's commits and frame callbacks. */
  onVisibilityChange(cb: (visibility: UiSurfaceVisibility) => void): () => void;
  setTitle(title: string): void;
  setSize(w: number, h: number): void;
  /** Begin an interactive compositor move using the current pointer press. */
  beginMove(): void;
  /** Native window state actions; absent on platforms that cannot provide them. */
  setMaximized?(maximized: boolean): void;
  isMaximized?(): boolean;
  setFullscreen?(fullscreen: boolean): void;
  isFullscreen?(): boolean;
  minimize?(): void;
  /**
   * An xdg-activation token naming this window, for a program it launches or hands a request to;
   * null when the compositor issues none.
   */
  requestActivationToken?(): Promise<string | null>;
  /** Ask to be raised and focused with an xdg-activation token. */
  activate?(token: string): void;
  /** Resolve once the compositor has handled every request this window sent so far. */
  sync?(): Promise<void>;
  /** Present ARGB8888 pixels and optional buffer-space damage. */
  present(
    pixels: Uint8Array,
    width: number,
    height: number,
    damage?: readonly RetainedClip[],
  ): void;
  /** Consume a renderer-neutral retained scene when acceleration is active. */
  presentScene?(scene: RetainedSceneFrame): boolean;
  /** Select this window's backing transport without changing renderer APIs. */
  setPresentationMode(mode: UiPresentationMode): void;
  onConfigure(cb: (w: number, h: number) => void): void;
  onClose(cb: () => void): void;
  onPointer(cb: (ev: UiPointerEvent) => void): void;
  onKey(cb: (ev: UiKeyEvent) => void): void;
  onFrame(cb: (ev: UiFrameEvent) => void): void;
  destroy(): void;
}

export interface PlatformBackend {
  readonly name: string;
  connect(): Promise<void>;
  createWindow(opts: PlatformWindowOpts): PlatformWindow;
  /** Optional native popup surface (xdg_popup on Wayland). */
  createPopup?(opts: PlatformPopupOpts): PlatformWindow;
  /** Runtime facts from the backend actually serving this application. */
  getDiagnostics(): PlatformDiagnostics;
  /** Appearance and accessibility preferences discoverable on this platform. */
  getPersonalization(): PersonalizationProfile;
  /** Optional live platform appearance subscription. */
  onPersonalizationChange?(callback: (profile: PersonalizationProfile) => void): () => void;
  /** Seat text clipboard; unsupported backends omit these methods. */
  writeClipboardText?(text: string): Promise<void>;
  readClipboardText?(): Promise<string>;
  pump(): void;
  disconnect(): void;
}

export function platformPersonalization(
  platform: string,
  overrides: PersonalizationOverrides = {},
): PersonalizationProfile {
  return discoverPersonalization(platform, overrides);
}

export type PlatformDiagnostics = {
  platform: string;
  displayServer: string;
  transport: string;
  presentation:
    | "retained-egl-dmabuf"
    | "retained-egl-shm"
    | "software-egl-dmabuf"
    | "software-shm"
    | "headless";
  requestedAcceleration: string;
  accelerated: boolean;
  display?: string;
  renderNode?: string;
  eglVendor?: string;
  eglVersion?: string;
  glVendor?: string;
  glRenderer?: string;
  glVersion?: string;
  fallbackReason?: string;
  capabilities: readonly string[];
  retainedFrames: number;
  softwareFrames: number;
  dmabufFrames: number;
  shmFrames: number;
};

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
    const { WaylandPlatform } = await import("./platforms/wayland/index");
    return new WaylandPlatform();
  }
  const { HeadlessPlatform } = await import("./platforms/headless/index");
  return new HeadlessPlatform();
}
import type { RetainedClip, RetainedSceneFrame } from "@moire/react-host";
