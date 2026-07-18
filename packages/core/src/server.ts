import fs from "node:fs";
import path from "node:path";
import {
  CORE_GLOBALS,
  decodeHeader,
  MessageBuilder,
  MessageReader,
  WL_HEADER_SIZE,
} from "@moire/protocol";
import {
  fillKmsColor,
  presentKms,
  openKmsOutput,
  closeKmsOutput,
  type KmsOutput,
  WaylandSocketServer,
  type WaylandClientConn,
  type WaylandChunk,
  createXkbKeymapMemfd,
  type KeymapMemfd,
  EvdevKeyboard,
  type EvdevKeyEvent,
  EvdevPointer,
  type EvdevPointerMotion,
  type EvdevPointerAbsolute,
  type EvdevPointerButton,
  type EvdevPointerAxis,
  closeFd,
  flushMmap,
  GbmDevice,
  getLibc,
} from "@moire/sys";
import { mmapShm, munmapShm, copyFromPool } from "./shm-map.js";
import {
  closeDmabufPlanes,
  copyFromDmabuf,
  type DmabufBuffer,
  type DmabufPlane,
} from "./dmabuf-map.js";
import {
  createDmabufFormatTableMemfd,
  DMABUF_FEEDBACK_FORMAT_COUNT,
  resolveDrmFeedbackDevice,
  type DrmFeedbackDevice,
} from "./dmabuf-feedback.js";
import { X11Wm, type XwmWindow } from "./xwm.js";
import {
  paintWallpaper,
  hexToArgb,
  loadPngFile,
  setWallpaperImagePixels,
  type MoireTheme,
} from "@moire/theme";
import { createPrefsWatcher, loadRuntimeTheme, type PrefsWatcher } from "@moire/prefs";

const WL_DISPLAY_ID = 1;

// opcodes
const OP = {
  display_sync: 0,
  display_get_registry: 1,
  registry_bind: 0,
  compositor_create_surface: 0,
  compositor_create_region: 1,
  shm_create_pool: 0,
  shm_pool_create_buffer: 0,
  shm_pool_destroy: 1,
  shm_pool_resize: 2,
  surface_destroy: 0,
  surface_attach: 1,
  surface_damage: 2,
  surface_frame: 3,
  surface_set_opaque_region: 4,
  surface_set_input_region: 5,
  surface_commit: 6,
  surface_set_buffer_transform: 7,
  surface_set_buffer_scale: 8,
  surface_damage_buffer: 9,
  buffer_destroy: 0,
  subcompositor_destroy: 0,
  subcompositor_get_subsurface: 1,
  seat_get_pointer: 0,
  seat_get_keyboard: 1,
  seat_get_touch: 2,
  seat_release: 3,
  pointer_set_cursor: 0,
  pointer_release: 1,
  data_device_manager_create_data_source: 0,
  data_device_manager_get_data_device: 1,
  data_source_offer: 0,
  data_source_destroy: 1,
  data_source_set_actions: 2,
  data_device_start_drag: 0,
  data_device_set_selection: 1,
  data_device_release: 2,
  data_offer_accept: 0,
  data_offer_receive: 1,
  data_offer_destroy: 2,
  data_offer_finish: 3,
  data_offer_set_actions: 4,
  xdg_decoration_manager_destroy: 0,
  xdg_decoration_manager_get_toplevel_decoration: 1,
  xdg_toplevel_decoration_destroy: 0,
  xdg_toplevel_decoration_set_mode: 1,
  xdg_toplevel_decoration_unset_mode: 2,
  xdg_wm_base_destroy: 0,
  xdg_wm_base_create_positioner: 1,
  xdg_wm_base_get_xdg_surface: 2,
  xdg_wm_base_pong: 3,
  xdg_surface_destroy: 0,
  xdg_surface_get_toplevel: 1,
  xdg_surface_get_popup: 2,
  xdg_surface_set_window_geometry: 3,
  xdg_surface_ack_configure: 4,
  xdg_toplevel_destroy: 0,
  xdg_toplevel_set_parent: 1,
  xdg_toplevel_set_title: 2,
  xdg_toplevel_set_app_id: 3,
  xdg_toplevel_show_window_menu: 4,
  xdg_toplevel_move: 5,
  xdg_toplevel_resize: 6,
  xdg_toplevel_set_max_size: 7,
  xdg_toplevel_set_min_size: 8,
  xdg_toplevel_set_maximized: 9,
  xdg_toplevel_unset_maximized: 10,
  xdg_toplevel_set_fullscreen: 11,
  xdg_toplevel_unset_fullscreen: 12,
  xdg_toplevel_set_minimized: 13,
  xdg_positioner_destroy: 0,
  xdg_positioner_set_size: 1,
  xdg_positioner_set_anchor_rect: 2,
  xdg_positioner_set_anchor: 3,
  xdg_positioner_set_gravity: 4,
  xdg_positioner_set_constraint_adjustment: 5,
  xdg_positioner_set_offset: 6,
  xdg_positioner_set_reactive: 7,
  xdg_positioner_set_parent_size: 8,
  xdg_positioner_set_parent_configure: 9,
  xdg_popup_destroy: 0,
  xdg_popup_grab: 1,
  xdg_popup_reposition: 2,
  region_destroy: 0,
  region_add: 1,
  linux_dmabuf_destroy: 0,
  linux_dmabuf_create_params: 1,
  linux_dmabuf_get_default_feedback: 2,
  linux_dmabuf_get_surface_feedback: 3,
  linux_buffer_params_destroy: 0,
  linux_buffer_params_add: 1,
  linux_buffer_params_create: 2,
  linux_buffer_params_create_immed: 3,
  linux_dmabuf_feedback_destroy: 0,
  /** Mesa wayland-drm (not in wayland.xml — still required by Xwayland Glamor). */
  drm_authenticate: 0,
  drm_create_buffer: 1,
  drm_create_planar_buffer: 2,
  drm_create_prime_buffer: 3,

  xwayland_shell_destroy: 0,
  xwayland_shell_get_xwayland_surface: 1,
  xwayland_surface_destroy: 0,
  xwayland_surface_set_serial: 1,
} as const;

const EV = {
  display_error: 0,
  display_delete_id: 1,
  registry_global: 0,
  callback_done: 0,
  shm_format: 0,
  buffer_release: 0,
  seat_capabilities: 0,
  seat_name: 1,
  pointer_enter: 0,
  pointer_leave: 1,
  pointer_motion: 2,
  pointer_button: 3,
  pointer_axis: 4,
  pointer_frame: 5,
  keyboard_keymap: 0,
  keyboard_enter: 1,
  keyboard_leave: 2,
  keyboard_key: 3,
  keyboard_modifiers: 4,
  keyboard_repeat_info: 5,
  output_geometry: 0,
  output_mode: 1,
  output_done: 2,
  output_scale: 3,
  surface_enter: 0,
  surface_leave: 1,
  xdg_wm_base_ping: 0,
  xdg_surface_configure: 0,
  xdg_toplevel_configure: 0,
  xdg_toplevel_close: 1,
  xdg_popup_configure: 0,
  xdg_popup_popup_done: 1,
  xdg_popup_repositioned: 2,
  linux_dmabuf_format: 0,
  linux_dmabuf_modifier: 1,
  linux_buffer_params_created: 0,
  linux_buffer_params_failed: 1,
  linux_dmabuf_feedback_done: 0,
  linux_dmabuf_feedback_format_table: 1,
  linux_dmabuf_feedback_main_device: 2,
  linux_dmabuf_feedback_tranche_done: 3,
  linux_dmabuf_feedback_tranche_target_device: 4,
  linux_dmabuf_feedback_tranche_formats: 5,
  linux_dmabuf_feedback_tranche_flags: 6,
  data_offer_offer: 0,
  data_offer_source_actions: 1,
  data_offer_action: 2,
  data_source_target: 0,
  data_source_send: 1,
  data_source_cancelled: 2,
  data_source_dnd_drop_performed: 3,
  data_source_dnd_finished: 4,
  data_source_action: 5,
  data_device_data_offer: 0,
  data_device_enter: 1,
  data_device_leave: 2,
  data_device_motion: 3,
  data_device_drop: 4,
  data_device_selection: 5,
  xdg_toplevel_decoration_configure: 0,
  drm_device: 0,
  drm_format: 1,
  drm_authenticated: 2,
  drm_capabilities: 3,
} as const;

const WL_SEAT_CAPABILITY_POINTER = 1;
const WL_SEAT_CAPABILITY_KEYBOARD = 2;
const WL_OUTPUT_MODE_CURRENT = 0x1;
const WL_KEYBOARD_KEYMAP_FORMAT_XKB_V1 = 1;
const WL_KEYBOARD_KEY_STATE_RELEASED = 0;
const WL_KEYBOARD_KEY_STATE_PRESSED = 1;
const WL_POINTER_BUTTON_STATE_RELEASED = 0;
const WL_POINTER_BUTTON_STATE_PRESSED = 1;
const WL_POINTER_AXIS_VERTICAL_SCROLL = 0;

const XDG_TOPLEVEL_STATE_MAXIMIZED = 1;
const XDG_TOPLEVEL_STATE_FULLSCREEN = 2;
const XDG_TOPLEVEL_STATE_RESIZING = 3;
const XDG_TOPLEVEL_STATE_ACTIVATED = 4;

const XDG_TOPLEVEL_RESIZE_EDGE_TOP = 1;
const XDG_TOPLEVEL_RESIZE_EDGE_BOTTOM = 2;
const XDG_TOPLEVEL_RESIZE_EDGE_LEFT = 4;
const XDG_TOPLEVEL_RESIZE_EDGE_RIGHT = 8;

/** xdg_positioner.anchor / gravity (xdg-shell stable). */
const XDG_ANCHOR_NONE = 0;
const XDG_ANCHOR_TOP = 1;
const XDG_ANCHOR_BOTTOM = 2;
const XDG_ANCHOR_LEFT = 3;
const XDG_ANCHOR_RIGHT = 4;
const XDG_ANCHOR_TOP_LEFT = 5;
const XDG_ANCHOR_BOTTOM_LEFT = 6;
const XDG_ANCHOR_TOP_RIGHT = 7;
const XDG_ANCHOR_BOTTOM_RIGHT = 8;

const XDG_CONSTRAINT_SLIDE_X = 1;
const XDG_CONSTRAINT_SLIDE_Y = 2;

const KEY_ESC = 1;

type PositionerState = {
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  anchorW: number;
  anchorH: number;
  anchor: number;
  gravity: number;
  constraintAdjustment: number;
  offsetX: number;
  offsetY: number;
};

function emptyPositioner(): PositionerState {
  return {
    width: 0,
    height: 0,
    anchorX: 0,
    anchorY: 0,
    anchorW: 0,
    anchorH: 0,
    anchor: XDG_ANCHOR_NONE,
    gravity: XDG_ANCHOR_NONE,
    constraintAdjustment: 0,
    offsetX: 0,
    offsetY: 0,
  };
}

function xdgAnchorPoint(
  x: number,
  y: number,
  w: number,
  h: number,
  anchor: number,
): { x: number; y: number } {
  const cx = x + w / 2;
  const cy = y + h / 2;
  switch (anchor) {
    case XDG_ANCHOR_TOP:
      return { x: cx, y };
    case XDG_ANCHOR_BOTTOM:
      return { x: cx, y: y + h };
    case XDG_ANCHOR_LEFT:
      return { x, y: cy };
    case XDG_ANCHOR_RIGHT:
      return { x: x + w, y: cy };
    case XDG_ANCHOR_TOP_LEFT:
      return { x, y };
    case XDG_ANCHOR_BOTTOM_LEFT:
      return { x, y: y + h };
    case XDG_ANCHOR_TOP_RIGHT:
      return { x: x + w, y };
    case XDG_ANCHOR_BOTTOM_RIGHT:
      return { x: x + w, y: y + h };
    default:
      return { x: cx, y: cy };
  }
}

/** Offset from popup top-left to the gravity point. */
function xdgGravityOffset(
  w: number,
  h: number,
  gravity: number,
): { dx: number; dy: number } {
  switch (gravity) {
    case XDG_ANCHOR_TOP:
      return { dx: w / 2, dy: 0 };
    case XDG_ANCHOR_BOTTOM:
      return { dx: w / 2, dy: h };
    case XDG_ANCHOR_LEFT:
      return { dx: 0, dy: h / 2 };
    case XDG_ANCHOR_RIGHT:
      return { dx: w, dy: h / 2 };
    case XDG_ANCHOR_TOP_LEFT:
      return { dx: 0, dy: 0 };
    case XDG_ANCHOR_BOTTOM_LEFT:
      return { dx: 0, dy: h };
    case XDG_ANCHOR_TOP_RIGHT:
      return { dx: w, dy: 0 };
    case XDG_ANCHOR_BOTTOM_RIGHT:
      return { dx: w, dy: h };
    default:
      return { dx: w / 2, dy: h / 2 };
  }
}

/** Place popup window-geometry relative to parent window-geometry. */
function placePopupRelative(
  pos: PositionerState,
  outputW: number,
  outputH: number,
  parentGeomScreenX: number,
  parentGeomScreenY: number,
): { x: number; y: number; w: number; h: number } {
  const pw = Math.max(1, pos.width);
  const ph = Math.max(1, pos.height);
  const anchor = xdgAnchorPoint(
    pos.anchorX,
    pos.anchorY,
    pos.anchorW,
    pos.anchorH,
    pos.anchor,
  );
  const grav = xdgGravityOffset(pw, ph, pos.gravity);
  let relX = anchor.x - grav.dx + pos.offsetX;
  let relY = anchor.y - grav.dy + pos.offsetY;
  let w = pw;
  let h = ph;

  // Slide into output bounds (parent-relative → screen → clamp → relative).
  const adj = pos.constraintAdjustment;
  let screenX = parentGeomScreenX + relX;
  let screenY = parentGeomScreenY + relY;
  if (adj & XDG_CONSTRAINT_SLIDE_X) {
    if (screenX + w > outputW) screenX = outputW - w;
    if (screenX < 0) screenX = 0;
  }
  if (adj & XDG_CONSTRAINT_SLIDE_Y) {
    if (screenY + h > outputH) screenY = outputH - h;
    if (screenY < 0) screenY = 0;
  }
  // Always soft-clamp so menus stay visible even if client omitted slide flags.
  if (screenX + w > outputW) screenX = Math.max(0, outputW - w);
  if (screenY + h > outputH) screenY = Math.max(0, outputH - h);
  if (screenX < 0) screenX = 0;
  if (screenY < 0) screenY = 0;

  relX = screenX - parentGeomScreenX;
  relY = screenY - parentGeomScreenY;
  return { x: Math.round(relX), y: Math.round(relY), w, h };
}

/** zxdg_toplevel_decoration_v1 mode — prefer SERVER (React SSD). */
const XDG_DECORATION_MODE_CLIENT = 1;
const XDG_DECORATION_MODE_SERVER = 2;

/** Auto-cancel a drag with no motion/button activity for this long. */
const DRAG_WATCHDOG_TIMEOUT_MS = 15_000;

/** SSD titlebar height — keep in sync with @moire/shell TitleBar. */
const SSD_TITLEBAR_H = 34;
const SSD_TITLEBAR_BTN = 28;
const SSD_TITLEBAR_BTN_GAP = 4;
const SSD_TITLEBAR_BTN_PAD = 6;
const SSD_PANEL_H = 42;

const WL_SHM_FORMAT_ARGB8888 = 0;
const WL_SHM_FORMAT_XRGB8888 = 1;

/** wl_drm capability: PRIME fd buffers. */
const WL_DRM_CAPABILITY_PRIME = 1;

/** DRM fourcc — little-endian ASCII 'AR24' / 'XR24'. */
const DRM_FORMAT_ARGB8888 = 0x34325241;
const DRM_FORMAT_XRGB8888 = 0x34325258;
/** DRM_FORMAT_MOD_INVALID — linear / unspecified. */
const DRM_FORMAT_MOD_INVALID_HI = 0xffffffff;
const DRM_FORMAT_MOD_INVALID_LO = 0xffffffff;

/** XRGB leaves A=0; blit skips a===0 — force opaque for CPU paint. */
function forceOpaqueAlpha(pixels: Uint8Array): void {
  const words = new Uint32Array(
    pixels.buffer,
    pixels.byteOffset,
    pixels.byteLength >>> 2,
  );
  for (let i = 0; i < words.length; i++) {
    words[i] = (words[i]! | 0xff000000) >>> 0;
  }
}

const OP_SUBSURFACE = {
  destroy: 0,
  set_position: 1,
  place_above: 2,
  place_below: 3,
  set_sync: 4,
  set_desync: 5,
} as const;

type WlObject = {
  id: number;
  iface: string;
  version: number;
  data?: Record<string, unknown>;
};

type SurfaceState = {
  bufferId: number | null;
  /** Offset supplied with the most recent wl_surface.attach. */
  bufferOffsetX: number;
  bufferOffsetY: number;
  frameCallbacks: number[];
  mapped: boolean;
  /** Absolute desktop position (computed for subsurfaces). */
  x: number;
  y: number;
  /** Subsurface offset relative to parent. */
  subX: number;
  subY: number;
  width: number;
  height: number;
  stride: number;
  title: string;
  /** CPU snapshot of the last committed buffer (ARGB/XRGB). */
  pixels: Uint8Array | null;
  /** Buffer ids waiting for wl_buffer.release after composite. */
  releaseBuffers: number[];
  /**
   * True after attach until we schedule release for that buffer.
   * Prevents double wl_buffer.release on empty/re-commits (GTK aborts).
   */
  bufferAttached: boolean;
  role: "none" | "toplevel" | "subsurface" | "cursor" | "popup";
  parentId: number | null;
  /** Child wl_surface object ids. */
  children: number[];
  /** Owning wl_surface object id. */
  id: number;
  xdgToplevelId: number | null;
  xdgPopupId: number | null;
  xdgSurfaceId: number | null;
  /** Popup position relative to parent window geometry (from configure). */
  popupRelX: number;
  popupRelY: number;
  popupConfW: number;
  popupConfH: number;
  /** Explicit xdg_popup.grab is active. */
  popupGrabbed: boolean;
  /** xdg_surface window geometry (content box within the buffer). */
  geomX: number;
  geomY: number;
  geomW: number;
  geomH: number;
  maximized: boolean;
  fullscreen: boolean;
  minimized: boolean;
  savedX: number;
  savedY: number;
  savedW: number;
  savedH: number;
  /** Client-requested size constraints (0 = unset). */
  minW: number;
  minH: number;
  maxW: number;
  maxH: number;
  /** Decoration mode: server = React SSD; client/none = client draws chrome. */
  decoration: "none" | "client" | "server";
  /** Pending / applied xwayland_shell serial (rootless). */
  xwaylandSerial: bigint | null;
  /** Paired X11 window id (rootless). */
  x11Wid: number | null;
  /**
   * True after get_xwayland_surface — survives xwayland_surface_v1.destroy,
   * which Xwayland may do before the first buffer commit.
   */
  xwaylandPending: boolean;
};

type ShmBufferState = {
  kind: "shm";
  poolId: number;
  /** Kept alive even after wl_shm_pool.destroy (Wayland allows that). */
  pool: PoolState;
  offset: number;
  width: number;
  height: number;
  stride: number;
  format: number;
};

type BufferState = ShmBufferState | DmabufBuffer;

type DmabufParamsState = {
  planes: DmabufPlane[];
  created: boolean;
};

type PoolState = {
  fd: number;
  size: number;
  map: unknown | null;
  /** Buffers still referencing this pool. */
  refCount: number;
  /** True after wl_shm_pool.destroy — munmap when refCount hits 0. */
  destroyed: boolean;
};

type InteractiveGrab =
  | {
      kind: "move";
      session: ClientSession;
      surfaceId: number;
      originX: number;
      originY: number;
      cursorX: number;
      cursorY: number;
    }
  | {
      kind: "resize";
      session: ClientSession;
      surfaceId: number;
      edges: number;
      originX: number;
      originY: number;
      originW: number;
      originH: number;
      cursorX: number;
      cursorY: number;
    };

/** Optional in-process DE chrome (panel / launcher / SSD). */
export type SsdWindowInfo = {
  surfaceId: number;
  /** Distinguishes clients — Wayland object ids are per-connection. */
  clientId: number;
  x: number;
  y: number;
  contentW: number;
  contentH: number;
  title: string;
  focused: boolean;
};

export type SsdAction =
  | { kind: "drag"; surfaceId: number; clientId: number }
  | { kind: "close"; surfaceId: number; clientId: number }
  | { kind: "maximize"; surfaceId: number; clientId: number }
  | { kind: "minimize"; surfaceId: number; clientId: number };

export type CompositorShell = {
  paint(
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
  ): void;
  beginSsdFrame?(): void;
  paintSsdWindow?(
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
    window: SsdWindowInfo,
  ): void;
  paintSsd?(
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
    windows: SsdWindowInfo[],
  ): void;
  hitSsd?(x: number, y: number): SsdAction | null;
  onKey(ev: { code: number; value: number }): boolean;
  onPointerButton(ev: {
    timeMs: number;
    button: number;
    value: number;
    x: number;
    y: number;
  }): boolean;
  onPointerMotion?(ev: { x: number; y: number }): boolean;
  /** Desktop icon clicks when no client surface is under the cursor. */
  onDesktopPointerButton?(ev: {
    timeMs: number;
    button: number;
    value: number;
    x: number;
    y: number;
  }): boolean;
  onDesktopPointerMotion?(ev: { x: number; y: number }): void;
  isLauncherOpen(): boolean;
  /** True when panel/launcher content changed (e.g. clock). */
  needsRepaint?(): boolean;
  /** Drop SSD/panel caches after theme or prefs change. */
  invalidateChrome?(): void;
  /**
   * Called when a drag-and-drop lands on the desktop with no client target.
   * `x`/`y` are the drop position, so the shell can tell whether it landed
   * on a folder icon (move in) vs. empty desktop (default placement).
   */
  acceptDesktopDrop?(uris: string[], x: number, y: number): boolean;
  /** Paint desktop icons / drop highlight after wallpaper, before windows. */
  paintDesktop?(
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
  ): void;
  /** Return true when (x,y) is a valid desktop drop zone (defaults true). */
  hitDesktop?(x: number, y: number): boolean;
  /** Paint a shell-owned drag preview when no client icon surface is available. */
  paintDragPreview?(
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
    cursorX: number,
    cursorY: number,
    label: string,
  ): void;
  desktopDragLabel?(): string | null;
  /**
   * URI payload + label for the desktop icon currently mid local-reposition
   * drag, if any. Used to escalate into a real compositor DnD session when
   * the pointer crosses onto a client surface.
   */
  desktopDragUri?(): { uri: string; label: string } | null;
  /**
   * Called when an escalated (real-DnD) desktop-origin drag ends.
   * `commit=true`: drop landed back on the desktop —
   * finalize the reposition at (x, y). `commit=false`: drop was handed to a
   * client target — clear local drag state without touching layout.
   */
  finishDesktopDrag?(commit: boolean, x: number, y: number): void;
  /**
   * Called on every drag motion while the pointer is over the desktop (no
   * client surface) during an active DnD session — lets the shell
   * live-highlight a folder icon under the cursor as a valid drop target,
   * the same "dragenter/dragleave" affordance `@moire/ui`'s Draggable gets.
   */
  onDesktopDragHover?(x: number, y: number, mimeTypes: string[]): void;
  /** Called when the drag leaves the desktop (entered a client) or ended. */
  clearDesktopDragHover?(): void;
  /**
   * Force-clear an in-flight local desktop-icon drag. This state never
   * touches the compositor's own `this.drag`, so neither Escape nor the
   * drag watchdog would otherwise reach it. Called on Escape.
   */
  cancelDesktopDrag?(x?: number, y?: number): void;
  /** Polled unconditionally by the drag watchdog — see `cancelDesktopDrag`. */
  checkDesktopDragWatchdog?(): void;
};

/** Seat clipboard selection (wl_data_device.set_selection). */
type ClipboardSelection = {
  sourceSession: ClientSession;
  sourceId: number;
  mimeTypes: string[];
};

type DataSourceState = {
  mimeTypes: string[];
  /** DnD action bitmask (1=copy, 2=move, 4=ask). */
  dndActions: number;
};

/**
 * Minimal surface a DnD source must expose. Real clients (`ClientSession`)
 * satisfy this structurally; `ShellDragSource` is a synthetic in-process
 * source for shell-originated drags (desktop icons) that have no wl_client
 * backing them.
 */
type DragSourceLike = {
  dataSourceMimes(sourceId: number): string[] | null;
  dataSourceActions(sourceId: number): number;
  sendDataSourceCancelled(sourceId: number): void;
  sendDataSourceDndDropPerformed(sourceId: number): void;
  sendDataSourceDndFinished(sourceId: number): void;
  sendDataSourceSend(sourceId: number, mime: string, fd: number): void;
  surfaceById(id: number): SurfaceState | null;
};

/**
 * In-process DnD source for drags that start on the desktop icon layer
 * (shell, not a real Wayland client). Answers `sendDataSourceSend` by
 * writing the payload straight into the fd, the same way a real client's
 * `data_source.send` handler would.
 */
class ShellDragSource implements DragSourceLike {
  constructor(private readonly payloads: Map<string, string>) {}
  dataSourceMimes(): string[] {
    return [...this.payloads.keys()];
  }
  dataSourceActions(): number {
    return 1 /* copy */ | 2 /* move */;
  }
  sendDataSourceCancelled(): void {
    // No remote client to notify.
  }
  sendDataSourceDndDropPerformed(): void {
    // No remote client to notify.
  }
  sendDataSourceDndFinished(): void {
    // No remote client to notify.
  }
  sendDataSourceSend(_sourceId: number, mime: string, fd: number): void {
    const text = this.payloads.get(mime);
    if (text == null) {
      try {
        closeFd(fd);
      } catch {
        // ok
      }
      return;
    }
    try {
      fs.writeSync(fd, Buffer.from(text, "utf8"));
    } catch (err) {
      console.warn("[dnd] ShellDragSource send failed:", err);
    }
    try {
      closeFd(fd);
    } catch {
      // ok
    }
  }
  surfaceById(): null {
    return null;
  }
}

type DataOfferState = {
  /** Source that backs this offer (may be in another client, or synthetic). */
  sourceSession: DragSourceLike;
  sourceId: number;
  mimeTypes: string[];
  /** wl_data_device that received this offer. */
  deviceId: number;
  /** True when this offer was created for a DnD session (vs clipboard). */
  isDnd: boolean;
};

/** Active compositor-managed drag-and-drop session. */
type DragSession = {
  sourceSession: DragSourceLike;
  sourceId: number;
  mimeTypes: string[];
  /** DnD action bitmask from source. */
  actions: number;
  iconId: number | null;
  /** Initial top-left of the preview, used as the failed-drop return target. */
  previewOriginX: number;
  previewOriginY: number;
  /** Short label for the compositor/shell drag chip. */
  label: string;
  /** Current drag target surface, or null if over desktop / no surface. */
  currentTarget: {
    session: ClientSession;
    surfaceId: number;
    offerId: number;
    deviceId: number;
  } | null;
  /** Wayland serial sent with data_device.enter. */
  enterSerial: number;
};

type DragReturnAnimation = {
  pixels: Uint8Array;
  width: number;
  height: number;
  stride: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  startedMs: number;
  durationMs: number;
};

export class CompositorServer {
  private socket: WaylandSocketServer | null = null;
  private kms: KmsOutput | null = null;
  private clients = new Set<ClientSession>();
  private running = false;
  private nextGlobalName = 1;
  private globals: { name: number; iface: string; version: number }[] = [];
  private keymap: KeymapMemfd | null = null;
  private evdev: EvdevKeyboard | null = null;
  private pointerDev: EvdevPointer | null = null;
  private focused: ClientSession | null = null;
  private pointerFocus: { session: ClientSession; surfaceId: number } | null =
    null;
  /** Last forwarded button press, used to recover the exact drag start point. */
  private lastPointerPress: {
    session: ClientSession;
    serial: number;
    x: number;
    y: number;
  } | null = null;
  private cursorX = 100;
  private cursorY = 100;
  /** Client cursor from wl_pointer.set_cursor (not part of the scene). */
  private clientCursor: {
    session: ClientSession;
    surfaceId: number;
    hotspotX: number;
    hotspotY: number;
  } | null = null;
  /** Resize edges under the pointer (compositor grip), for cursor fallback. */
  private hoverEdges = 0;
  private grab: InteractiveGrab | null = null;
  private toplevelCount = 0;
  private lastPainted = 0;
  /** Allocates unique clientIds for SSD / stack lookups. */
  private nextClientId = 1;
  /**
   * When false, skip full composite + presentKms (idle CPU).
   * Set by markDirty() on commits, pointer motion, shell clock, etc.
   */
  private needsComposite = true;
  /** Bottom → top paint/focus order for mapped toplevels. */
  private stack: { session: ClientSession; surfaceId: number }[] = [];
  /** Bottom → top mapped xdg_popups (painted/hit above toplevels). */
  private popupStack: { session: ClientSession; surfaceId: number }[] = [];
  private focusedToplevel: { session: ClientSession; surfaceId: number } | null =
    null;
  private altHeld = false;
  private shiftHeld = false;
  /** CPU staging buffer — paint here, then flushMmap + presentKms. */
  private stage: Buffer | null = null;
  /** Optional GBM device for dmabuf CPU import (same DRM fd as KMS). */
  private gbm: GbmDevice | null = null;
  /** DRM device advertised via zwp_linux_dmabuf_feedback_v1.main_device. */
  /** Seat-wide clipboard selection. */
  private selection: ClipboardSelection | null = null;
  /** Active DnD session (one at a time). */
  private drag: DragSession | null = null;
  /** Pixel snapshot retained while a rejected/cancelled drag snaps home. */
  private dragReturn: DragReturnAnimation | null = null;
  /** Timestamp of the last motion/button activity while `drag` is active. */
  private dragActivityMs = 0;
  private dragWatchdog: NodeJS.Timeout | null = null;
  private shell: CompositorShell | null = null;
  private drmFeedback: DrmFeedbackDevice | null = null;
  /** Shared format table memfd for feedback events. */
  private dmabufFormatTable: { fd: number; size: number } | null = null;
  /** Rootless XWM (optional). */
  private xwm: X11Wm | null = null;
  /** Wayland surfaces waiting for X11 serial match. */
  private xwayPendingBySerial = new Map<
    bigint,
    { session: ClientSession; surfaceId: number }
  >();
  /** X11 wid → paired Wayland surface. */
  private xwayByWid = new Map<
    number,
    { session: ClientSession; surfaceId: number }
  >();
  /** Last SSD window list from composite — used for reliable hit-testing. */
  private ssdWindows: SsdWindowInfo[] = [];
  /** Desktop theme (tokens + wallpaper). */
  private theme: MoireTheme = loadRuntimeTheme();
  private prefsWatcher: PrefsWatcher | null = null;

  constructor(
    private readonly runtimeDir: string,
    private readonly displayName = "wayland-1",
  ) {
    for (const [iface, version] of Object.entries(CORE_GLOBALS)) {
      this.globals.push({
        name: this.nextGlobalName++,
        iface,
        version,
      });
    }
  }

  get socketPath(): string {
    return path.join(this.runtimeDir, this.displayName);
  }

  async start(cardPath?: string): Promise<void> {
    fs.mkdirSync(this.runtimeDir, { recursive: true, mode: 0o700 });
    this.kms = openKmsOutput(cardPath);
    const bootBg = hexToArgb(this.theme.tokens.bg);
    fillKmsColor(this.kms, {
      r: (bootBg >>> 16) & 0xff,
      g: (bootBg >>> 8) & 0xff,
      b: bootBg & 0xff,
    });
    console.log(
      `[theme] ${this.theme.name} wallpaper=${this.theme.wallpaper.mode}`,
    );
    this.prefsWatcher = createPrefsWatcher((theme) => {
      this.theme = theme;
      if (theme.wallpaper.mode === "image") {
        const wp = theme.wallpaper as { mode: "image"; path?: string };
        if (wp.path) {
          try {
            const img = loadPngFile(wp.path);
            setWallpaperImagePixels(img);
          } catch (err) {
            console.warn("[compositor] wallpaper image load failed:", err);
            setWallpaperImagePixels(null);
          }
        } else {
          setWallpaperImagePixels(null);
        }
      } else {
        setWallpaperImagePixels(null);
      }
      this.shell?.invalidateChrome?.();
      this.markDirty();
    });
    try {
      this.gbm = GbmDevice.openForImport(this.kms.fd);
      console.log("[dmabuf] GBM device ready");
    } catch (err) {
      console.warn("[dmabuf] GBM unavailable (mmap-only import):", err);
      this.gbm = null;
    }
    try {
      this.drmFeedback = resolveDrmFeedbackDevice(this.kms.cardPath);
      this.dmabufFormatTable = createDmabufFormatTableMemfd();
      console.log(
        `[dmabuf] feedback device=${this.drmFeedback.path} rdev=0x${this.drmFeedback.deviceBytes.readBigUInt64LE(0).toString(16)} formats=${DMABUF_FEEDBACK_FORMAT_COUNT}`,
      );
    } catch (err) {
      console.warn("[dmabuf] feedback setup failed:", err);
      this.drmFeedback = null;
      this.dmabufFormatTable = null;
    }

    try {
      this.keymap = createXkbKeymapMemfd();
      console.log(`[seat] keymap memfd size=${this.keymap.size}`);
    } catch (err) {
      console.warn("[seat] keymap unavailable:", err);
    }

    this.evdev = new EvdevKeyboard();
    this.evdev.on("key", (ev: EvdevKeyEvent) => this.onKey(ev));
    this.evdev.start();

    this.pointerDev = new EvdevPointer();
    this.pointerDev.on("motion", (ev: EvdevPointerMotion) => this.onPointerMotion(ev));
    this.pointerDev.on("absolute", (ev: EvdevPointerAbsolute) =>
      this.onPointerAbsolute(ev),
    );
    this.pointerDev.on("button", (ev: EvdevPointerButton) => this.onPointerButton(ev));
    this.pointerDev.on("axis", (ev: EvdevPointerAxis) => this.onPointerAxis(ev));
    this.pointerDev.start();

    if (this.kms) {
      this.cursorX = Math.floor(this.kms.width / 2);
      this.cursorY = Math.floor(this.kms.height / 2);
    }
    this.socket = new WaylandSocketServer(this.socketPath);
    this.socket.on("connection", (conn: WaylandClientConn) => {
      const session = new ClientSession(this, conn, this.nextClientId++);
      this.clients.add(session);
      conn.on("close", () => {
        if (this.focused === session) this.focused = null;
        if (this.focusedToplevel?.session === session) this.focusedToplevel = null;
        if (this.pointerFocus?.session === session) this.pointerFocus = null;
        if (this.grab?.session === session) this.grab = null;
        if (this.clientCursor?.session === session) this.clientCursor = null;
        if (this.selection?.sourceSession === session) {
          this.selection = null;
        }
        this.stack = this.stack.filter((e) => e.session !== session);
        this.popupStack = this.popupStack.filter((e) => e.session !== session);
        for (const [wid, pair] of this.xwayByWid) {
          if (pair.session === session) this.xwayByWid.delete(wid);
        }
        for (const [serial, pair] of this.xwayPendingBySerial) {
          if (pair.session === session) this.xwayPendingBySerial.delete(serial);
        }
        session.destroy();
        this.clients.delete(session);
      });
    });
    this.socket.start();

    console.log(`Wayland display: ${this.displayName}`);
    console.log(`Socket: ${this.socketPath}`);
    console.log(
      `KMS: ${this.kms.width}x${this.kms.height} on ${this.kms.cardPath}`,
    );
    console.log(
      `Export: WAYLAND_DISPLAY=${this.displayName} XDG_RUNTIME_DIR=${this.runtimeDir}`,
    );

    // Auto-cancel a drag that's gone quiet for too long — a lost
    // terminating button-up (e.g. release happened outside the guest's
    // input surface entirely, such as a VM window boundary) would otherwise
    // leave `this.drag` stuck forever, wedging all pointer routing behind
    // updateDragFocus and freezing the drag preview on screen.
    this.dragWatchdog = setInterval(() => {
      // Desktop-only reposition drags live in the shell rather than
      // `this.drag`, so they need to be polled even when there is no active
      // Wayland DnD session.
      this.shell?.checkDesktopDragWatchdog?.();
      if (!this.drag) return;
      const idleMs = Date.now() - this.dragActivityMs;
      if (idleMs > DRAG_WATCHDOG_TIMEOUT_MS) {
        console.warn(`[dnd] watchdog: cancelling drag idle for ${idleMs}ms`);
        this.cancelDrag();
      }
    }, 2000);
    this.dragWatchdog.unref?.();

    this.running = true;
    this.loop();
  }

  stop(): void {
    this.running = false;
    if (this.dragWatchdog) {
      clearInterval(this.dragWatchdog);
      this.dragWatchdog = null;
    }
    this.xwm?.stop();
    this.xwm = null;
    this.evdev?.stop();
    this.evdev = null;
    this.pointerDev?.stop();
    this.pointerDev = null;
    this.pointerFocus = null;
    for (const c of this.clients) c.destroy();
    this.clients.clear();
    this.socket?.stop();
    if (this.keymap) {
      try {
        closeFd(this.keymap.fd);
      } catch {
        // ok
      }
      this.keymap = null;
    }
    if (this.kms) {
      this.gbm?.destroy();
      this.gbm = null;
      if (this.dmabufFormatTable) {
        try {
          closeFd(this.dmabufFormatTable.fd);
        } catch {
          // ok
        }
        this.dmabufFormatTable = null;
      }
      this.drmFeedback = null;
      closeKmsOutput(this.kms);
      this.kms = null;
    }
  }

  getGlobals() {
    return this.globals;
  }

  /** Globals visible to a specific client (hides xwayland_shell from others). */
  getGlobalsForClient(session: ClientSession) {
    if (session.isXwayland) return this.globals;
    return this.globals.filter((g) => g.iface !== "xwayland_shell_v1");
  }

  /** Attach in-process shell chrome (panel + launcher). */
  setShell(shell: CompositorShell | null): void {
    this.shell = shell;
  }

  /**
   * Attach rootless XWM. Pairs WL_SURFACE_SERIAL with xwayland_shell surfaces.
   */
  attachXwm(wm: X11Wm): void {
    this.xwm = wm;
    wm.on("serial", (win: XwmWindow, serial: bigint) => {
      this.tryPairXwayland(serial, win);
      // set_serial may be missing/raced; claim any unpaired xwayland surface.
      if (!this.xwayByWid.has(win.wid)) this.claimOrphanXwaylandSurface(serial, win);
    });
    wm.on("mapped", (win: XwmWindow) => {
      if (win.serial != null) {
        this.tryPairXwayland(win.serial, win);
        if (!this.xwayByWid.has(win.wid)) {
          this.claimOrphanXwaylandSurface(win.serial, win);
        }
      }
      const pair = this.xwayByWid.get(win.wid);
      if (pair) this.applyXwaylandGeometry(pair.session, pair.surfaceId, win);
    });
    wm.on("configured", (win: XwmWindow) => {
      const pair = this.xwayByWid.get(win.wid);
      if (pair) this.applyXwaylandGeometry(pair.session, pair.surfaceId, win);
    });
    wm.on("title", (win: XwmWindow) => {
      const pair = this.xwayByWid.get(win.wid);
      if (!pair) return;
      const surf = pair.session.surfaceById(pair.surfaceId);
      if (surf) surf.title = win.title || surf.title;
    });
    wm.on("unmapped", (win: XwmWindow) => {
      const pair = this.xwayByWid.get(win.wid);
      if (!pair) return;
      const surf = pair.session.surfaceById(pair.surfaceId);
      if (surf) {
        surf.mapped = false;
        this.unregisterToplevel(pair.session, pair.surfaceId);
      }
    });
    wm.on("destroyed", (win: XwmWindow) => {
      const pair = this.xwayByWid.get(win.wid);
      this.xwayByWid.delete(win.wid);
      if (win.serial != null) this.xwayPendingBySerial.delete(win.serial);
      if (!pair) return;
      const surf = pair.session.surfaceById(pair.surfaceId);
      if (surf) {
        surf.x11Wid = null;
        surf.xwaylandSerial = null;
        surf.mapped = false;
        this.unregisterToplevel(pair.session, pair.surfaceId);
      }
    });
    wm.on("activate", (win: XwmWindow) => {
      const pair = this.xwayByWid.get(win.wid);
      if (!pair) return;
      this.focusClient(pair.session, pair.surfaceId);
    });
    console.log("[xwm] attached to compositor");
  }

  /** Called when an xwayland_surface serial is committed on a wl_surface. */
  noteXwaylandSerial(
    session: ClientSession,
    surfaceId: number,
    serial: bigint,
  ): void {
    if (serial === 0n) return;
    const surf = session.surfaceById(surfaceId);
    if (surf) surf.xwaylandSerial = serial;
    this.xwayPendingBySerial.set(serial, { session, surfaceId });
    const win = this.xwm?.windowBySerial(serial) ?? null;
    if (win) this.tryPairXwayland(serial, win);
  }

  /**
   * Fallback when set_serial is missing from the Wayland stream but the
   * surface was created via xwayland_shell and XWM already saw WL_SURFACE_SERIAL.
   */
  tryPairOrphanXwaylandSurface(
    session: ClientSession,
    surfaceId: number,
  ): void {
    const surf = session.surfaceById(surfaceId);
    if (
      !surf ||
      !surf.xwaylandPending ||
      surf.xwaylandSerial != null ||
      surf.x11Wid != null
    ) {
      return;
    }
    const win =
      this.xwm?.takeUnpairedSerialWindow((wid) => !this.xwayByWid.has(wid)) ??
      null;
    if (!win || win.serial == null) return;
    console.warn(
      `[xwm] orphan pair surface=${surfaceId} ← wid=${win.wid} serial=${win.serial}`,
    );
    this.noteXwaylandSerial(session, surfaceId, win.serial);
  }

  /** XWM-side orphan: serial arrived before/without Wayland set_serial. */
  private claimOrphanXwaylandSurface(serial: bigint, win: XwmWindow): void {
    if (this.xwayByWid.has(win.wid) || this.xwayPendingBySerial.has(serial)) {
      return;
    }
    for (const session of this.clients) {
      for (const surf of session.surfaces()) {
        if (
          !surf.xwaylandPending ||
          surf.xwaylandSerial != null ||
          surf.x11Wid != null
        ) {
          continue;
        }
        console.warn(
          `[xwm] claim orphan surface=${surf.id} ← wid=${win.wid} serial=${serial}`,
        );
        this.noteXwaylandSerial(session, surf.id, serial);
        return;
      }
    }
  }

  private tryPairXwayland(serial: bigint, win: XwmWindow): void {
    const pending = this.xwayPendingBySerial.get(serial);
    if (!pending) return;
    const surf = pending.session.surfaceById(pending.surfaceId);
    if (!surf) return;

    this.xwayPendingBySerial.delete(serial);
    this.xwayByWid.set(win.wid, pending);
    surf.x11Wid = win.wid;
    surf.xwaylandSerial = serial;
    surf.role = "toplevel";
    if (win.title) surf.title = win.title;

    const undecorated =
      win.overrideRedirect || X11Wm.isUndecoratedType(win.windowType);
    surf.decoration = undecorated ? "none" : "server";

    const parentPair =
      win.transientFor != null ? this.xwayByWid.get(win.transientFor) : null;
    const parentSurf = parentPair
      ? parentPair.session.surfaceById(parentPair.surfaceId)
      : null;

    // Place transients/dialogs/modals over their parent; otherwise cascade if unset.
    const wantsParentPlace =
      !!parentSurf &&
      parentSurf.mapped &&
      (win.transientFor != null ||
        win.windowType === "dialog" ||
        win.modal);
    if (wantsParentPlace && parentSurf) {
      const parentFrame = this.frameBox(parentSurf);
      const childW = win.width > 0 ? win.width : Math.max(1, surf.width);
      const childH = win.height > 0 ? win.height : Math.max(1, surf.height);
      const frameH = childH + (this.usesSsd(surf) ? SSD_TITLEBAR_H : 0);
      const kms = this.kms;
      let x = parentFrame.x + Math.floor((parentFrame.w - childW) / 2);
      let y = parentFrame.y + Math.floor((parentFrame.h - frameH) / 2);
      if (kms) {
        x = Math.max(0, Math.min(x, Math.max(0, kms.width - childW)));
        y = Math.max(0, Math.min(y, Math.max(0, kms.height - frameH - SSD_PANEL_H)));
      }
      surf.x = x;
      surf.y = y;
      // Push geometry to X so the client matches the centered position.
      win.x = x;
      win.y = y + (this.usesSsd(surf) ? SSD_TITLEBAR_H : 0);
    } else if (surf.x === 0 && surf.y === 0 && win.x === 0 && win.y === 0) {
      const slot = this.allocToplevelSlot();
      surf.x = slot.x;
      surf.y = slot.y;
    }

    this.applyXwaylandGeometry(pending.session, pending.surfaceId, win);
    // Align X11 window with the Wayland content box so XQueryPointer matches.
    const contentY =
      surf.y + (this.usesSsd(surf) ? SSD_TITLEBAR_H : 0);
    this.xwm?.configureWindow(
      win.wid,
      surf.x,
      contentY,
      win.width > 0 ? win.width : surf.width,
      win.height > 0 ? win.height : surf.height,
    );
    if (surf.mapped && surf.pixels) {
      const firstMap = !this.isStacked(pending.session, surf.id);
      this.registerToplevel(pending.session, surf.id);
      if (parentPair) {
        // Keep transient above its parent in the stack.
        this.raiseToplevel(pending.session, surf.id);
      }
      if (firstMap) this.focusClient(pending.session, surf.id);
    }
    console.log(
      `[xwm] paired wid=${win.wid} serial=${serial} surface=${surf.id} ${win.width}x${win.height} @ ${surf.x},${surf.y} deco=${surf.decoration} type=${win.windowType} transient=${win.transientFor ?? "-"} title=${JSON.stringify(win.title)}`,
    );
  }

  private applyXwaylandGeometry(
    session: ClientSession,
    surfaceId: number,
    win: XwmWindow,
  ): void {
    const surf = session.surfaceById(surfaceId);
    if (!surf) return;
    // Keep compositor slot placement when X still reports 0,0.
    if (win.x !== 0 || win.y !== 0) {
      surf.x = win.x;
      surf.y = Math.max(0, win.y - (this.usesSsd(surf) ? SSD_TITLEBAR_H : 0));
    }
    if (win.width > 0) {
      surf.geomW = win.width;
      surf.geomH = win.height;
      surf.geomX = 0;
      surf.geomY = 0;
    }
  }

  getXwm(): X11Wm | null {
    return this.xwm;
  }

  getKms(): KmsOutput {
    if (!this.kms) throw new Error("KMS not started");
    return this.kms;
  }

  getGbm(): GbmDevice | null {
    return this.gbm;
  }

  getKmsSize(): { width: number; height: number } {
    return {
      width: this.kms?.width ?? 1920,
      height: this.kms?.height ?? 1080,
    };
  }

  setFocusedSession(session: ClientSession): void {
    this.focused = session;
  }

  getDmabufFeedback(): {
    device: DrmFeedbackDevice;
    formatTable: { fd: number; size: number };
  } | null {
    if (!this.drmFeedback || !this.dmabufFormatTable) return null;
    return { device: this.drmFeedback, formatTable: this.dmabufFormatTable };
  }

  /** Clear seat selection and notify the previous source. */
  clearSelection(reason: "cancelled" | "cleared" = "cancelled"): void {
    const prev = this.selection;
    this.selection = null;
    if (prev && reason === "cancelled") {
      prev.sourceSession.sendDataSourceCancelled(prev.sourceId);
    }
    for (const c of this.clients) c.sendSelection(null);
  }

  setSelection(
    sourceSession: ClientSession,
    sourceId: number | null,
    _serial: number,
  ): void {
    if (sourceId == null || sourceId === 0) {
      this.clearSelection("cancelled");
      console.log("[clipboard] selection cleared");
      return;
    }
    const mimes = sourceSession.dataSourceMimes(sourceId);
    if (!mimes) {
      console.warn(`[clipboard] set_selection unknown source=${sourceId}`);
      return;
    }
    const prev = this.selection;
    if (
      prev &&
      (prev.sourceSession !== sourceSession || prev.sourceId !== sourceId)
    ) {
      prev.sourceSession.sendDataSourceCancelled(prev.sourceId);
    }
    this.selection = { sourceSession, sourceId, mimeTypes: [...mimes] };
    console.log(
      `[clipboard] selection set source=${sourceId} mimes=${mimes.join(",")}`,
    );
    for (const c of this.clients) c.sendSelection(this.selection);
  }

  getSelection(): ClipboardSelection | null {
    return this.selection;
  }

  /** Source client writes clipboard bytes into `fd` (from offer.receive). */
  forwardSelectionReceive(mime: string, fd: number): void {
    const sel = this.selection;
    if (!sel) {
      try {
        closeFd(fd);
      } catch {
        // ok
      }
      return;
    }
    sel.sourceSession.sendDataSourceSend(sel.sourceId, mime, fd);
  }

  getKeymap(): KeymapMemfd | null {
    return this.keymap;
  }

  getDrag(): DragSession | null {
    return this.drag;
  }

  startDrag(
    sourceSession: ClientSession,
    sourceId: number,
    _originId: number,
    iconId: number | null,
    serial: number,
  ): void {
    if (this.drag) this.cancelDrag();
    this.dragReturn = null;
    const mimes = sourceSession.dataSourceMimes(sourceId);
    if (!mimes || mimes.length === 0) {
      sourceSession.sendDataSourceCancelled(sourceId);
      return;
    }
    const actions = sourceSession.dataSourceActions(sourceId);
    const icon = iconId != null ? sourceSession.surfaceById(iconId) : null;
    const press = this.lastPointerPress;
    const startX =
      press?.session === sourceSession && press.serial === serial
        ? press.x
        : this.cursorX;
    const startY =
      press?.session === sourceSession && press.serial === serial
        ? press.y
        : this.cursorY;
    const previewOriginX = startX + (icon?.bufferOffsetX ?? 12);
    const previewOriginY = startY + (icon?.bufferOffsetY ?? 10);
    this.drag = {
      sourceSession,
      sourceId,
      mimeTypes: [...mimes],
      actions,
      iconId,
      previewOriginX,
      previewOriginY,
      label: mimes.includes("text/uri-list")
        ? "File"
        : mimes.includes("text/plain")
          ? "Text"
          : "Item",
      currentTarget: null,
      enterSerial: 0,
    };
    console.log(
      `[dnd] start source=${sourceId} icon=${iconId ?? 0} mimes=${mimes.join(",")} actions=${actions}`,
    );
    this.dragActivityMs = Date.now();
    this.markDirty();
  }

  /**
   * Begin a compositor DnD session for a desktop icon drag, backed by a
   * synthetic in-process source (no real wl_client owns it). Called when a
   * local desktop-icon reposition drag crosses onto a client surface, so
   * the target sees a normal text/uri-list drop like any other DnD source.
   */
  startDesktopDrag(uri: string, label: string): void {
    if (this.drag) this.cancelDrag();
    this.dragReturn = null;
    const source = new ShellDragSource(new Map([["text/uri-list", uri]]));
    this.drag = {
      sourceSession: source,
      sourceId: 0,
      mimeTypes: ["text/uri-list"],
      actions: source.dataSourceActions(),
      iconId: null,
      previewOriginX: this.cursorX,
      previewOriginY: this.cursorY,
      label,
      currentTarget: null,
      enterSerial: 0,
    };
    console.log(`[dnd] start desktop-source label=${label}`);
    this.dragActivityMs = Date.now();
    this.markDirty();
    this.updateDragFocus(monotonicMs());
  }

  /**
   * When the pointer moves onto a client surface while a local desktop-icon
   * drag is in progress (shell-tracked, not yet a compositor DnD session),
   * promote it into a real drag so the client sees a normal DnD offer/drop
   * instead of a plain hover. Checked (and hit-tested independently) before
   * the normal pointer-focus path so the target never sees a stray hover
   * enter/motion ahead of the DnD enter. Returns true if escalated.
   */
  private maybeEscalateDesktopDrag(): boolean {
    if (this.drag) return false;
    const desktopDrag = this.shell?.desktopDragUri?.();
    if (!desktopDrag) return false;
    if (!this.hitTest(this.cursorX, this.cursorY)) return false;
    this.startDesktopDrag(desktopDrag.uri, desktopDrag.label);
    return true;
  }

  cancelDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    if (drag.currentTarget) {
      drag.currentTarget.session.sendDndLeave(drag.currentTarget.deviceId);
    }
    this.beginDragReturn(drag, this.cursorX, this.cursorY);
    drag.sourceSession.sendDataSourceCancelled(drag.sourceId);
    if (drag.sourceSession instanceof ShellDragSource) {
      this.shell?.cancelDesktopDrag?.(this.cursorX, this.cursorY);
    }
    this.shell?.clearDesktopDragHover?.();
    this.drag = null;
    console.log("[dnd] cancel");
    this.markDirty();
  }

  /** Retain the icon pixels before the source destroys them, then ease home. */
  private beginDragReturn(drag: DragSession, cursorX: number, cursorY: number): void {
    if (drag.iconId == null) return;
    const surf = drag.sourceSession.surfaceById(drag.iconId);
    if (!surf?.pixels || surf.width <= 0 || surf.height <= 0) return;
    this.dragReturn = {
      pixels: new Uint8Array(surf.pixels),
      width: surf.width,
      height: surf.height,
      stride: surf.stride,
      fromX: cursorX + surf.bufferOffsetX,
      fromY: cursorY + surf.bufferOffsetY,
      toX: drag.previewOriginX,
      toY: drag.previewOriginY,
      startedMs: monotonicMs(),
      durationMs: 220,
    };
  }

  private updateDragFocus(timeMs: number): void {
    const drag = this.drag;
    if (!drag) return;
    this.dragActivityMs = Date.now();

    const hit = this.hitTest(this.cursorX, this.cursorY);
    const prev = drag.currentTarget;
    const sameTarget =
      prev !== null &&
      hit !== null &&
      prev.session === hit.session &&
      prev.surfaceId === hit.surface.id;

    if (sameTarget && hit && prev) {
      const ssdY =
        hit.surface.role === "toplevel" && this.usesSsd(hit.surface)
          ? SSD_TITLEBAR_H
          : 0;
      const localX = this.cursorX - hit.surface.x;
      const localY = this.cursorY - hit.surface.y - ssdY;
      prev.session.sendDndMotion(prev.deviceId, timeMs, localX, localY);
      return;
    }

    if (prev) {
      prev.session.sendDndLeave(prev.deviceId);
      console.log(`[dnd] leave surface=${prev.surfaceId}`);
      drag.currentTarget = null;
    }

    if (!hit) {
      // Over the desktop (no client surface) — let the shell live-highlight
      // a folder icon under the cursor, mirroring dragenter/dragleave.
      this.shell?.onDesktopDragHover?.(
        this.cursorX,
        this.cursorY,
        drag.mimeTypes,
      );
      return;
    }
    this.shell?.clearDesktopDragHover?.();

    const deviceId = hit.session.firstDataDeviceId();
    if (deviceId != null) {
      const offerId = hit.session.createDndOffer(
        deviceId,
        drag.sourceSession,
        drag.sourceId,
        drag.mimeTypes,
        drag.actions,
      );
      if (offerId != null) {
        const ssdY =
          hit.surface.role === "toplevel" && this.usesSsd(hit.surface)
            ? SSD_TITLEBAR_H
            : 0;
        const localX = this.cursorX - hit.surface.x;
        const localY = this.cursorY - hit.surface.y - ssdY;
        const serial = hit.session.nextSerial();
        drag.enterSerial = serial;
        hit.session.sendDndEnter(
          deviceId,
          serial,
          hit.surface.id,
          localX,
          localY,
          offerId,
          drag.actions,
        );
        drag.currentTarget = {
          session: hit.session,
          surfaceId: hit.surface.id,
          offerId,
          deviceId,
        };
        console.log(
          `[dnd] enter surface=${hit.surface.id} client=${hit.session.clientId}`,
        );
      }
    }
  }

  endDrag(_timeMs: number): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    this.shell?.clearDesktopDragHover?.();
    const isDesktopSource = drag.sourceSession instanceof ShellDragSource;

    if (drag.currentTarget) {
      const target = drag.currentTarget;
      target.session.sendDndDrop(target.deviceId);
      drag.sourceSession.sendDataSourceDndDropPerformed(drag.sourceId);
      console.log(
        `[dnd] drop surface=${target.surfaceId} client=${target.session.clientId}`,
      );
      if (isDesktopSource) {
        // Handed off to a real client target — clear local desktop drag
        // state without touching the icon's saved layout position.
        this.shell?.finishDesktopDrag?.(false, this.cursorX, this.cursorY);
      }
      // offer.finish from target will trigger dnd_finished; source destroyed
      // by the client when done.
    } else if (isDesktopSource) {
      // Dropped back on the desktop (or nowhere) — finalize as a reposition,
      // not a self-copy through the acceptDesktopDrop path below.
      this.shell?.finishDesktopDrag?.(true, this.cursorX, this.cursorY);
      drag.sourceSession.sendDataSourceCancelled(drag.sourceId);
    } else {
      // Drop on desktop — request URI list and forward to shell. Capture
      // the drop position now; readDndData resolves asynchronously and the
      // cursor could otherwise have moved by the time the callback runs.
      const shell = this.shell;
      const dropX = this.cursorX;
      const dropY = this.cursorY;
      if (
        shell?.acceptDesktopDrop &&
        drag.mimeTypes.includes("text/uri-list") &&
        (shell.hitDesktop?.(dropX, dropY) ?? true)
      ) {
        console.log("[dnd] desktop-drop requesting text/uri-list");
        this.readDndData(drag, "text/uri-list", (data) => {
          if (!data) {
            console.warn("[dnd] desktop-drop readDndData returned null — nothing was read from the source");
            this.beginDragReturn(drag, dropX, dropY);
            drag.sourceSession.sendDataSourceCancelled(drag.sourceId);
            this.markDirty();
            return;
          }
          const uris = data
            .toString("utf8")
            .split(/\r?\n/)
            .map((u) => u.trim())
            .filter((u) => u.length > 0 && !u.startsWith("#"));
          console.log(`[dnd] desktop-drop uris=${uris.join(",")}`);
          const accepted =
            uris.length > 0 && shell.acceptDesktopDrop!(uris, dropX, dropY);
          if (accepted) {
            drag.sourceSession.sendDataSourceDndDropPerformed(drag.sourceId);
            drag.sourceSession.sendDataSourceDndFinished(drag.sourceId);
          } else {
            this.beginDragReturn(drag, dropX, dropY);
            drag.sourceSession.sendDataSourceCancelled(drag.sourceId);
          }
          this.markDirty();
        });
      } else {
        this.beginDragReturn(drag, this.cursorX, this.cursorY);
        drag.sourceSession.sendDataSourceCancelled(drag.sourceId);
      }
    }
    this.markDirty();
  }

  private readDndData(
    drag: DragSession,
    mime: string,
    cb: (data: Buffer | null) => void,
  ): void {
    try {
      const libc = getLibc();
      const pipe2 = libc.func("int pipe2(int *pipefd, int flags)") as (
        pipefd: Buffer,
        flags: number,
      ) => number;
      const O_CLOEXEC_FLAG = 0o2000000;
      const pfds = Buffer.alloc(8);
      const rc = pipe2(pfds, O_CLOEXEC_FLAG);
      if (rc !== 0) {
        console.warn(`[dnd] readDndData pipe2 failed rc=${rc}`);
        cb(null);
        return;
      }
      const readFd = pfds.readInt32LE(0);
      const writeFd = pfds.readInt32LE(4);
      console.log(
        `[dnd] readDndData pipe readFd=${readFd} writeFd=${writeFd} sourceId=${drag.sourceId} synthetic=${drag.sourceSession instanceof ShellDragSource}`,
      );
      // Source client will write into writeFd (transferred via SCM_RIGHTS).
      drag.sourceSession.sendDataSourceSend(drag.sourceId, mime, writeFd);
      console.log(`[dnd] readDndData sendDataSourceSend returned, awaiting stream`);
      // sendDataSourceSend closes writeFd on our side after sending.
      const chunks: Buffer[] = [];
      const readBuf = Buffer.allocUnsafe(64 * 1024);
      let finished = false;
      const finish = (data: Buffer | null): void => {
        if (finished) return;
        finished = true;
        try {
          closeFd(readFd);
        } catch {
          // ok
        }
        cb(data);
      };
      const readNext = (): void => {
        // Pipes are not seekable. Passing a null position is essential here;
        // createReadStream with `start: 0` issues positioned reads and fails
        // with ESPIPE even though the source wrote the payload successfully.
        fs.read(readFd, readBuf, 0, readBuf.length, null, (err, bytesRead) => {
          if (err) {
            console.warn("[dnd] readDndData pipe read error:", err);
            finish(null);
            return;
          }
          if (bytesRead === 0) {
            console.log(`[dnd] readDndData pipe end, ${chunks.length} chunks`);
            finish(Buffer.concat(chunks));
            return;
          }
          chunks.push(Buffer.from(readBuf.subarray(0, bytesRead)));
          readNext();
        });
      };
      readNext();
    } catch (err) {
      console.warn("[dnd] readDndData failed:", err);
      cb(null);
    }
  }

  /** Forward a DnD data_offer.receive to the drag source (like clipboard). */
  forwardDndReceive(
    sourceSession: DragSourceLike,
    sourceId: number,
    mime: string,
    fd: number,
  ): void {
    sourceSession.sendDataSourceSend(sourceId, mime, fd);
  }

  allocToplevelSlot(): { x: number; y: number } {
    const n = this.toplevelCount++;
    return { x: 48 + (n % 6) * 36, y: 48 + (n % 6) * 36 };
  }

  /** True if this toplevel is already on the stacking list. */
  isStacked(session: ClientSession, surfaceId: number): boolean {
    return this.stack.some(
      (e) => e.session === session && e.surfaceId === surfaceId,
    );
  }

  registerToplevel(session: ClientSession, surfaceId: number): void {
    if (this.isStacked(session, surfaceId)) return;
    this.stack.push({ session, surfaceId });
    this.markDirty();
  }

  unregisterToplevel(session: ClientSession, surfaceId: number): void {
    this.stack = this.stack.filter(
      (e) => !(e.session === session && e.surfaceId === surfaceId),
    );
    if (
      this.focusedToplevel?.session === session &&
      this.focusedToplevel.surfaceId === surfaceId
    ) {
      this.focusedToplevel = null;
    }
    this.markDirty();
  }

  registerPopup(session: ClientSession, surfaceId: number): void {
    if (
      this.popupStack.some(
        (e) => e.session === session && e.surfaceId === surfaceId,
      )
    ) {
      return;
    }
    this.popupStack.push({ session, surfaceId });
  }

  /** Move a popup to the top of the popup stack (nested menus). */
  raisePopup(session: ClientSession, surfaceId: number): void {
    this.popupStack = this.popupStack.filter(
      (e) => !(e.session === session && e.surfaceId === surfaceId),
    );
    this.popupStack.push({ session, surfaceId });
  }

  unregisterPopup(session: ClientSession, surfaceId: number): void {
    this.popupStack = this.popupStack.filter(
      (e) => !(e.session === session && e.surfaceId === surfaceId),
    );
  }

  /** Read-only access for seat focus checks. */
  getPopupStack(): readonly { session: ClientSession; surfaceId: number }[] {
    return this.popupStack;
  }

  /** Screen coords of a surface's xdg window-geometry top-left. */
  windowGeomOrigin(surf: SurfaceState): { x: number; y: number } {
    if (surf.role === "toplevel" && this.usesSsd(surf)) {
      return { x: surf.x, y: surf.y + SSD_TITLEBAR_H };
    }
    return {
      x: surf.x + (surf.geomW > 0 ? surf.geomX : 0),
      y: surf.y + (surf.geomH > 0 ? surf.geomY : 0),
    };
  }

  /** Apply popupRel* into absolute surface.x/y from live parent position. */
  layoutPopup(session: ClientSession, surf: SurfaceState): void {
    if (surf.role !== "popup" || surf.parentId == null) return;
    const seen = new Set<number>();
    const walk = (s: SurfaceState): void => {
      if (s.role !== "popup" || s.parentId == null) return;
      if (seen.has(s.id)) return;
      seen.add(s.id);
      const parent = session.surfaceById(s.parentId);
      if (!parent) return;
      walk(parent);
      const origin = this.windowGeomOrigin(parent);
      const gx = origin.x + s.popupRelX;
      const gy = origin.y + s.popupRelY;
      s.x = gx - (s.geomW > 0 ? s.geomX : 0);
      s.y = gy - (s.geomH > 0 ? s.geomY : 0);
    };
    walk(surf);
  }

  dismissPopup(
    session: ClientSession,
    surfaceId: number,
    sendDone = true,
  ): void {
    const surf = session.surfaceById(surfaceId);
    if (!surf || surf.role !== "popup") {
      this.unregisterPopup(session, surfaceId);
      return;
    }
    // Dismiss nested children first (top of stack → this popup's descendants).
    const children = this.popupStack
      .filter((e) => {
        const s = e.session.surfaceById(e.surfaceId);
        return s?.role === "popup" && s.parentId === surfaceId;
      })
      .map((e) => e.surfaceId);
    for (const childId of children) {
      this.dismissPopup(session, childId, sendDone);
    }
    if (sendDone && surf.xdgPopupId != null) {
      session.sendPopupDone(surf.xdgPopupId);
      console.log(`[popup] popup_done surface=${surfaceId}`);
    }
    surf.mapped = false;
    surf.popupGrabbed = false;
    surf.xdgPopupId = null;
    if (surf.role === "popup") surf.role = "none";
    surf.pixels = null;
    this.unregisterPopup(session, surfaceId);
  }

  /** Dismiss all grabbed popups (and their children), top-first. */
  dismissGrabbedPopups(session?: ClientSession): void {
    const grabbed = [...this.popupStack].reverse().filter((e) => {
      if (session && e.session !== session) return false;
      const s = e.session.surfaceById(e.surfaceId);
      return s?.popupGrabbed;
    });
    for (const e of grabbed) {
      this.dismissPopup(e.session, e.surfaceId, true);
    }
    // Restore keyboard focus to the focused toplevel when clearing all grabs.
    if (!session && this.focusedToplevel) {
      this.focusedToplevel.session.keyboardEnter(
        this.focusedToplevel.surfaceId,
      );
    }
  }

  /** Dismiss every popup for a client (grabbed or not), top-first. */
  dismissSessionPopups(session: ClientSession): void {
    const mine = [...this.popupStack]
      .reverse()
      .filter((e) => e.session === session);
    for (const e of mine) {
      this.dismissPopup(e.session, e.surfaceId, true);
    }
  }

  hasGrabbedPopup(): boolean {
    return this.popupStack.some((e) => {
      const s = e.session.surfaceById(e.surfaceId);
      return !!s?.popupGrabbed;
    });
  }

  /** Move toplevel to the top of the stack (painted last / hit first). */
  raiseToplevel(session: ClientSession, surfaceId: number): void {
    // Reorder only — do not clear focusedToplevel (unregister would).
    this.stack = this.stack.filter(
      (e) => !(e.session === session && e.surfaceId === surfaceId),
    );
    this.stack.push({ session, surfaceId });
    this.markDirty();
  }

  focusClient(session: ClientSession, surfaceId: number): void {
    const top = session.toplevelFor(surfaceId);
    const topId = top?.id ?? surfaceId;

    // xdg_popup.grab requires exclusive seat focus until popup_done. Mapping a
    // dialog (About, Properties, …) from a menu must end the grab first or
    // GTK/libadwaita aborts on the protocol violation.
    if (top?.role === "toplevel" && this.hasGrabbedPopup()) {
      const hadGrab = this.popupStack.some((e) => {
        if (e.session !== session) return false;
        return !!e.session.surfaceById(e.surfaceId)?.popupGrabbed;
      });
      if (hadGrab) {
        console.log(
          `[popup] dismiss grabs before focus toplevel=${topId}`,
        );
        this.dismissGrabbedPopups(session);
      }
    }

    const already =
      this.focusedToplevel?.session === session &&
      this.focusedToplevel.surfaceId === topId;

    if (!already && this.focusedToplevel) {
      const prev = this.focusedToplevel.session.surfaceById(
        this.focusedToplevel.surfaceId,
      );
      if (prev?.role === "toplevel") {
        this.sendToplevelStates(this.focusedToplevel.session, prev, false);
      }
    }

    if (this.focused && this.focused !== session) {
      this.focused.keyboardLeave();
    }
    this.focused = session;
    this.focusedToplevel = { session, surfaceId: topId };
    session.keyboardEnter(surfaceId);

    if (top?.role === "toplevel") {
      top.minimized = false;
      this.raiseToplevel(session, topId);
      if (!already) this.sendToplevelStates(session, top, true);
      this.xwm?.setActiveWindow(top.x11Wid ?? null);
    } else {
      this.xwm?.setActiveWindow(null);
    }
    this.markDirty();
  }

  private sendToplevelStates(
    session: ClientSession,
    surf: SurfaceState,
    activated: boolean,
  ): void {
    const w = surf.geomW > 0 ? surf.geomW : surf.width;
    const h = surf.geomH > 0 ? surf.geomH : surf.height;
    if (w <= 0 || h <= 0) return;
    const states: number[] = [];
    if (surf.maximized) states.push(XDG_TOPLEVEL_STATE_MAXIMIZED);
    if (surf.fullscreen) states.push(XDG_TOPLEVEL_STATE_FULLSCREEN);
    if (activated) states.push(XDG_TOPLEVEL_STATE_ACTIVATED);
    session.configureToplevel(surf, w, h, states);
  }

  setMinimized(session: ClientSession, surfaceId: number): void {
    const surf = session.surfaceById(surfaceId);
    if (!surf || surf.role !== "toplevel") return;
    surf.minimized = true;
    if (
      this.focusedToplevel?.session === session &&
      this.focusedToplevel.surfaceId === surfaceId
    ) {
      this.focusedToplevel = null;
      if (this.focused === session) {
        this.focused.keyboardLeave();
        this.focused = null;
      }
    }
    console.log(`[wm] minimized surface=${surfaceId}`);
    this.markDirty();
  }

  restoreToplevel(session: ClientSession, surfaceId: number): void {
    const surf = session.surfaceById(surfaceId);
    if (!surf || surf.role !== "toplevel") return;
    surf.minimized = false;
    this.focusClient(session, surfaceId);
    console.log(`[wm] restored surface=${surfaceId}`);
  }

  /** Alt+Tab — cycle to the next (or previous with Shift) toplevel. */
  private cycleToplevel(backward = false): void {
    const mapped = this.stack.filter((e) => {
      const s = e.session.surfaceById(e.surfaceId);
      return s?.mapped && s.role === "toplevel" && !s.minimized;
    });
    if (mapped.length === 0) return;
    const curIdx = this.focusedToplevel
      ? mapped.findIndex(
          (e) =>
            e.session === this.focusedToplevel!.session &&
            e.surfaceId === this.focusedToplevel!.surfaceId,
        )
      : -1;
    let next: number;
    if (backward) {
      next = curIdx <= 0 ? mapped.length - 1 : curIdx - 1;
    } else {
      next = curIdx < 0 || curIdx >= mapped.length - 1 ? 0 : curIdx + 1;
    }
    const e = mapped[next]!;
    const surf = e.session.surfaceById(e.surfaceId);
    if (surf) {
      surf.minimized = false;
      this.focusClient(e.session, e.surfaceId);
    }
  }

  private onKey(ev: EvdevKeyEvent): void {
    const KEY_LEFTALT = 56;
    const KEY_RIGHTALT = 100;
    const KEY_TAB = 15;
    const KEY_LEFTSHIFT = 42;
    const KEY_RIGHTSHIFT = 54;

    if (ev.code === KEY_LEFTALT || ev.code === KEY_RIGHTALT) {
      this.altHeld = ev.value !== 0;
    }
    if (ev.code === KEY_LEFTSHIFT || ev.code === KEY_RIGHTSHIFT) {
      this.shiftHeld = ev.value !== 0;
    }
    if (this.altHeld && ev.code === KEY_TAB && ev.value === 1) {
      this.cycleToplevel(this.shiftHeld);
      return;
    }

    // Escape cancels an in-flight drag — an escape hatch for a drag that
    // never receives its terminating button-up (e.g. release happened
    // outside the guest input surface entirely) and would otherwise be
    // stuck forever, since nothing else clears `this.drag`.
    if (
      ev.code === KEY_ESC &&
      ev.value === 1 &&
      (this.drag || this.shell?.desktopDragLabel?.())
    ) {
      if (this.drag) this.cancelDrag();
      // A local desktop reposition has no compositor DragSession. This is
      // also harmless after cancelDrag() cleared an escalated desktop drag.
      this.shell?.cancelDesktopDrag?.();
      return;
    }

    // Escape dismisses grabbing popups (context menus).
    if (ev.code === KEY_ESC && ev.value === 1 && this.hasGrabbedPopup()) {
      this.dismissGrabbedPopups();
      return;
    }

    if (this.shell?.onKey(ev)) {
      // Shell overlays and grabbed client popups are both modal layers. If a
      // global shortcut opens shell chrome, close the client popup first so
      // two competing modal layers can never coexist.
      if (this.hasGrabbedPopup()) this.dismissGrabbedPopups();
      return;
    }

    if (!this.focused) {
      for (const c of this.clients) {
        const id = c.primaryToplevelSurfaceId();
        if (id != null) {
          this.focusClient(c, id);
          break;
        }
      }
    }
    this.focused?.keyboardKey(ev);
  }

  private onPointerMotion(ev: EvdevPointerMotion): void {
    const kms = this.kms;
    if (!kms) return;
    const nx = Math.max(0, Math.min(kms.width - 1, this.cursorX + ev.dx));
    const ny = Math.max(0, Math.min(kms.height - 1, this.cursorY + ev.dy));
    if (nx !== this.cursorX || ny !== this.cursorY) this.markDirty();
    this.cursorX = nx;
    this.cursorY = ny;
    if (this.drag) {
      this.updateDragFocus(ev.timeMs);
      return;
    }
    if (this.applyGrab()) {
      this.markDirty();
      return;
    }
    // Check before updatePointerFocus so a client the pointer just entered
    // never sees a stray hover enter/motion ahead of the DnD enter.
    // (startDesktopDrag already runs updateDragFocus once for this position.)
    if (this.maybeEscalateDesktopDrag()) return;
    const popupHit = this.hitTestPopup(this.cursorX, this.cursorY);
    if (popupHit || this.hasGrabbedPopup()) {
      this.updatePointerFocus(ev.timeMs, true, popupHit);
      return;
    }
    if (
      this.shell?.onPointerMotion?.({ x: this.cursorX, y: this.cursorY })
    ) {
      this.clearPointerFocusForShellOverlay();
      return;
    }
    this.updatePointerFocus(ev.timeMs, true);
    this.updateHoverEdges();
    this.syncXwaylandPointer();
    if (!this.pointerFocus && !this.grab) {
      this.shell?.onDesktopPointerMotion?.({
        x: this.cursorX,
        y: this.cursorY,
      });
    }
  }

  private onPointerAbsolute(ev: EvdevPointerAbsolute): void {
    const kms = this.kms;
    if (!kms) return;
    const nx = Math.max(
      0,
      Math.min(kms.width - 1, Math.round(ev.x * (kms.width - 1))),
    );
    const ny = Math.max(
      0,
      Math.min(kms.height - 1, Math.round(ev.y * (kms.height - 1))),
    );
    if (nx !== this.cursorX || ny !== this.cursorY) this.markDirty();
    this.cursorX = nx;
    this.cursorY = ny;
    if (this.drag) {
      this.updateDragFocus(ev.timeMs);
      return;
    }
    if (this.applyGrab()) {
      this.markDirty();
      return;
    }
    // Check before updatePointerFocus so a client the pointer just entered
    // never sees a stray hover enter/motion ahead of the DnD enter.
    // (startDesktopDrag already runs updateDragFocus once for this position.)
    if (this.maybeEscalateDesktopDrag()) return;
    const popupHit = this.hitTestPopup(this.cursorX, this.cursorY);
    if (popupHit || this.hasGrabbedPopup()) {
      this.updatePointerFocus(ev.timeMs, true, popupHit);
      return;
    }
    if (
      this.shell?.onPointerMotion?.({ x: this.cursorX, y: this.cursorY })
    ) {
      this.clearPointerFocusForShellOverlay();
      return;
    }
    this.updatePointerFocus(ev.timeMs, true);
    this.updateHoverEdges();
    this.syncXwaylandPointer();
    if (!this.pointerFocus && !this.grab) {
      this.shell?.onDesktopPointerMotion?.({
        x: this.cursorX,
        y: this.cursorY,
      });
    }
  }

  /**
   * Rootless Xwayland only updates its X pointer from wl_pointer. Xeyes uses
   * XQueryPointer, so tracking freezes when the cursor is over native clients.
   * Ghost-feed motion to an X11 surface (separate Wayland client) without
   * stealing this.pointerFocus from foot/etc.
   */
  private syncXwaylandPointer(): void {
    const target = this.pickXwaylandPointerTarget();
    if (!target) return;
    if (
      this.pointerFocus?.session === target.session &&
      this.pointerFocus.surfaceId === target.surface.id
    ) {
      return; // real hit-test path already delivers events
    }
    const ssdY = this.usesSsd(target.surface) ? SSD_TITLEBAR_H : 0;
    const localX = this.cursorX - target.surface.x;
    const localY = this.cursorY - target.surface.y - ssdY;
    target.session.pointerEnter(target.surface.id, localX, localY);
    target.session.pointerMotion(monotonicMs(), localX, localY);
  }

  private pickXwaylandPointerTarget(): {
    session: ClientSession;
    surface: SurfaceState;
  } | null {
    if (this.focusedToplevel) {
      const surf = this.focusedToplevel.session.surfaceById(
        this.focusedToplevel.surfaceId,
      );
      if (surf?.x11Wid != null && surf.mapped) {
        return { session: this.focusedToplevel.session, surface: surf };
      }
    }
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const e = this.stack[i]!;
      const surf = e.session.surfaceById(e.surfaceId);
      if (surf?.x11Wid != null && surf.mapped) {
        return { session: e.session, surface: surf };
      }
    }
    return null;
  }

  private onPointerButton(ev: EvdevPointerButton): void {
    this.markDirty();
    if (this.drag) {
      console.log(
        `[dnd] button code=${ev.code} value=${ev.value} at ${this.cursorX},${this.cursorY}`,
      );
    }
    if (ev.value === 0 && this.drag) {
      this.endDrag(ev.timeMs);
      return;
    }
    if (ev.value === 0 && this.grab) {
      this.endGrab();
    }

    const popupHit = this.hitTestPopup(this.cursorX, this.cursorY);
    const popupGrabbed = this.hasGrabbedPopup();
    // Popup grabs outrank shell chrome. A press outside dismisses and is
    // consumed; a press inside routes to the popup even over the panel.
    if (ev.value === 1 && popupGrabbed && !popupHit) {
      this.updatePointerFocus(ev.timeMs, false, null);
      this.dismissGrabbedPopups();
      return;
    }

    if (
      !popupHit &&
      !popupGrabbed &&
      this.shell?.onPointerButton({
        timeMs: ev.timeMs,
        button: ev.code,
        value: ev.value,
        x: this.cursorX,
        y: this.cursorY,
      })
    ) {
      return;
    }

    // Geometric SSD hit-test — refresh list so positions match latest moves.
    if (ev.value === 1 && !popupHit) {
      this.ssdWindows = this.collectSsdWindows();
      const action = this.hitSsd(this.cursorX, this.cursorY);
      if (action) {
        if (this.hasGrabbedPopup()) this.dismissGrabbedPopups();
        this.handleSsdAction(action);
        return;
      }
    }

    this.updatePointerFocus(
      ev.timeMs,
      false,
      popupHit || popupGrabbed ? popupHit : undefined,
    );
    this.updateHoverEdges();
    const hit = this.pointerFocus;

    // Desktop icons — only when no client surface is under the cursor.
    if (!hit && !this.grab && this.shell?.onDesktopPointerButton) {
      if (
        this.shell.onDesktopPointerButton({
          timeMs: ev.timeMs,
          button: ev.code,
          value: ev.value,
          x: this.cursorX,
          y: this.cursorY,
        })
      ) {
        return;
      }
    }

    if (hit && ev.value === 1) {
      const top = hit.session.toplevelFor(hit.surfaceId);
      const hitSurf = hit.session.surfaceById(hit.surfaceId);
      if (hitSurf?.role === "popup") {
        // Keep keyboard on the popup; still raise the parent toplevel.
        if (top) {
          this.raiseToplevel(hit.session, top.id);
          this.focused = hit.session;
          this.focusedToplevel = { session: hit.session, surfaceId: top.id };
        }
      } else if (top) {
        this.focusClient(hit.session, top.id);
        // Don't start resize when interacting with a popup.
        if (!this.grab && !top.maximized && !top.fullscreen) {
          const edges = this.resizeEdgesAt(top, this.cursorX, this.cursorY);
          if (edges) this.beginResize(hit.session, top.id, edges);
        }
      } else {
        this.focusClient(hit.session, hit.surfaceId);
      }
    } else if (ev.value === 1 && !hit && !this.grab) {
      // CSD shadows / SSD frame: click may sit just outside geom — still start resize.
      for (let i = this.stack.length - 1; i >= 0; i--) {
        const entry = this.stack[i]!;
        const surf = entry.session.surfaceById(entry.surfaceId);
        if (!surf || !surf.mapped || entry.session.isHidden(surf)) continue;
        if (surf.maximized || surf.fullscreen) continue;
        const edges = this.resizeEdgesAt(surf, this.cursorX, this.cursorY);
        if (edges) {
          this.focusClient(entry.session, surf.id);
          this.beginResize(entry.session, surf.id, edges);
          break;
        }
      }
    }
    const serial = hit?.session.pointerButton(ev) ?? null;
    if (ev.value === 1 && hit && serial != null) {
      this.lastPointerPress = {
        session: hit.session,
        serial,
        x: this.cursorX,
        y: this.cursorY,
      };
    }
  }

  private handleSsdAction(action: SsdAction): void {
    const entry = this.stack.find(
      (e) =>
        e.surfaceId === action.surfaceId &&
        e.session.clientId === action.clientId,
    );
    if (!entry) {
      console.warn(
        `[ssd] action ${action.kind} missing surface=${action.surfaceId} client=${action.clientId}`,
      );
      return;
    }
    const surf = entry.session.surfaceById(action.surfaceId);
    if (!surf) return;
    this.focusClient(entry.session, action.surfaceId);
    if (action.kind === "drag") {
      this.beginMove(entry.session, action.surfaceId);
    } else if (action.kind === "close") {
      entry.session.requestClose(surf);
    } else if (action.kind === "maximize") {
      this.toggleMaximized(entry.session, action.surfaceId, !surf.maximized);
    } else if (action.kind === "minimize") {
      this.setMinimized(entry.session, action.surfaceId);
    }
  }

  /**
   * Hit-test Moire SSD titlebars by geometry (matches TitleBar.tsx layout).
   * Topmost SSD window wins.
   */
  private hitSsd(x: number, y: number): SsdAction | null {
    for (let i = this.ssdWindows.length - 1; i >= 0; i--) {
      const w = this.ssdWindows[i]!;
      if (x < w.x || y < w.y || x >= w.x + w.contentW || y >= w.y + SSD_TITLEBAR_H) {
        continue;
      }
      const localX = x - w.x;
      const btnY0 = Math.floor((SSD_TITLEBAR_H - SSD_TITLEBAR_BTN) / 2);
      const btnY1 = btnY0 + SSD_TITLEBAR_BTN;
      const inBtnRow = y >= w.y + btnY0 && y < w.y + btnY1;
      const closeX0 =
        w.contentW - SSD_TITLEBAR_BTN_PAD - SSD_TITLEBAR_BTN;
      const maxX0 = closeX0 - SSD_TITLEBAR_BTN_GAP - SSD_TITLEBAR_BTN;
      const minX0 = maxX0 - SSD_TITLEBAR_BTN_GAP - SSD_TITLEBAR_BTN;
      if (inBtnRow) {
        if (localX >= closeX0 && localX < closeX0 + SSD_TITLEBAR_BTN) {
          return { kind: "close", surfaceId: w.surfaceId, clientId: w.clientId };
        }
        if (localX >= maxX0 && localX < maxX0 + SSD_TITLEBAR_BTN) {
          return { kind: "maximize", surfaceId: w.surfaceId, clientId: w.clientId };
        }
        if (localX >= minX0 && localX < minX0 + SSD_TITLEBAR_BTN) {
          return { kind: "minimize", surfaceId: w.surfaceId, clientId: w.clientId };
        }
      }
      return { kind: "drag", surfaceId: w.surfaceId, clientId: w.clientId };
    }
    return null;
  }

  private collectSsdWindows(): SsdWindowInfo[] {
    const windows: SsdWindowInfo[] = [];
    for (const entry of this.stack) {
      const surf = entry.session.surfaceById(entry.surfaceId);
      if (!surf || !surf.mapped || entry.session.isHidden(surf)) continue;
      if (!this.usesSsd(surf)) continue;
      const size = this.contentSize(surf);
      if (size.w <= 0 || size.h <= 0) continue;
      const focused =
        this.focusedToplevel?.session === entry.session &&
        this.focusedToplevel.surfaceId === surf.id;
      windows.push({
        surfaceId: surf.id,
        clientId: entry.session.clientId,
        x: surf.x,
        y: surf.y,
        contentW: size.w,
        contentH: size.h,
        title: surf.title || "Window",
        focused,
      });
    }
    return windows;
  }

  private onPointerAxis(ev: EvdevPointerAxis): void {
    this.updatePointerFocus(ev.timeMs, false);
    this.pointerFocus?.session.pointerAxis(ev);
  }

  beginMove(session: ClientSession, surfaceId: number): void {
    const surf = session.surfaceById(surfaceId);
    if (!surf || surf.role !== "toplevel") return;
    if (surf.maximized || surf.fullscreen) return;
    const frame = this.frameBox(surf);
    this.grab = {
      kind: "move",
      session,
      surfaceId,
      originX: frame.x,
      originY: frame.y,
      cursorX: this.cursorX,
      cursorY: this.cursorY,
    };
    console.log(`[wm] begin move surface=${surfaceId}`);
  }

  beginResize(session: ClientSession, surfaceId: number, edges: number): void {
    const surf = session.surfaceById(surfaceId);
    if (!surf || surf.role !== "toplevel") return;
    if (surf.maximized || surf.fullscreen) return;
    if (!edges) return;
    const size = this.contentSize(surf);
    const frame = this.frameBox(surf);
    this.grab = {
      kind: "resize",
      session,
      surfaceId,
      edges,
      originX: frame.x,
      originY: frame.y,
      originW: size.w,
      originH: size.h,
      cursorX: this.cursorX,
      cursorY: this.cursorY,
    };
    this.hoverEdges = edges;
    console.log(`[wm] begin resize surface=${surfaceId} edges=${edges}`);
  }

  /** Outer geometry border (incl. corners) used for compositor-initiated resize. */
  private resizeEdgesAt(surf: SurfaceState, x: number, y: number): number {
    const border = 6;
    const frame = this.frameBox(surf);
    const gx = frame.x;
    const gy = frame.y;
    const gw = frame.w;
    const gh = frame.h;
    if (gw < border * 2 || gh < border * 2) return 0;
    if (x < gx - border || y < gy - border || x >= gx + gw + border || y >= gy + gh + border) {
      return 0;
    }
    const onLeft = x < gx + border;
    const onRight = x >= gx + gw - border;
    const onTop = y < gy + border;
    const onBottom = y >= gy + gh - border;
    if (!onLeft && !onRight && !onTop && !onBottom) return 0;
    // Titlebar drag owns the top edge for SSD windows.
    if (this.usesSsd(surf) && onTop && !onLeft && !onRight) return 0;
    let edges = 0;
    if (onLeft) edges |= XDG_TOPLEVEL_RESIZE_EDGE_LEFT;
    if (onRight) edges |= XDG_TOPLEVEL_RESIZE_EDGE_RIGHT;
    if (onTop) edges |= XDG_TOPLEVEL_RESIZE_EDGE_TOP;
    if (onBottom) edges |= XDG_TOPLEVEL_RESIZE_EDGE_BOTTOM;
    return edges;
  }

  private updateHoverEdges(): void {
    if (this.grab?.kind === "resize") {
      this.hoverEdges = this.grab.edges;
      return;
    }
    if (this.grab) {
      this.hoverEdges = 0;
      return;
    }
    const hit = this.hitTest(this.cursorX, this.cursorY);
    const top = hit ? hit.session.toplevelFor(hit.surface.id) : null;
    if (!top || top.maximized || top.fullscreen) {
      this.hoverEdges = 0;
      return;
    }
    this.hoverEdges = this.resizeEdgesAt(top, this.cursorX, this.cursorY);
  }

  private endGrab(): void {
    const g = this.grab;
    this.grab = null;
    if (!g) return;
    if (g.kind === "resize") {
      const surf = g.session.surfaceById(g.surfaceId);
      if (surf) {
        const gw = surf.geomW > 0 ? surf.geomW : surf.width;
        const gh = surf.geomH > 0 ? surf.geomH : surf.height;
        g.session.configureToplevel(surf, gw, gh, [
          XDG_TOPLEVEL_STATE_ACTIVATED,
        ]);
      }
    }
    console.log(`[wm] end ${g.kind}`);
  }

  /** Place toplevel so its window-geometry top-left is at (gx, gy). */
  private setGeometryPosition(surf: SurfaceState, gx: number, gy: number): void {
    if (this.usesSsd(surf)) {
      // For SSD, (x,y) is the frame origin (titlebar top-left).
      surf.x = gx;
      surf.y = gy;
    } else {
      surf.x = gx - surf.geomX;
      surf.y = gy - surf.geomY;
    }
    if (surf.x11Wid != null) {
      const contentY = surf.y + (this.usesSsd(surf) ? SSD_TITLEBAR_H : 0);
      const size = this.contentSize(surf);
      this.xwm?.configureWindow(
        surf.x11Wid,
        surf.x,
        contentY,
        size.w,
        size.h,
      );
    }
  }

  usesSsd(surf: SurfaceState): boolean {
    return surf.decoration === "server" && !surf.fullscreen;
  }

  /** Outer interactive frame in screen coords (includes SSD titlebar). */
  frameBox(surf: SurfaceState): { x: number; y: number; w: number; h: number } {
    const cw = surf.geomW > 0 ? surf.geomW : surf.width;
    const ch = surf.geomH > 0 ? surf.geomH : surf.height;
    if (this.usesSsd(surf)) {
      return {
        x: surf.x,
        y: surf.y,
        w: cw,
        h: ch + SSD_TITLEBAR_H,
      };
    }
    return {
      x: surf.x + surf.geomX,
      y: surf.y + surf.geomY,
      w: cw,
      h: ch,
    };
  }

  contentSize(surf: SurfaceState): { w: number; h: number } {
    return {
      w: surf.geomW > 0 ? surf.geomW : surf.width,
      h: surf.geomH > 0 ? surf.geomH : surf.height,
    };
  }

  /** Apply interactive move/resize; returns true if a grab consumed the motion. */
  private applyGrab(): boolean {
    const g = this.grab;
    const kms = this.kms;
    if (!g || !kms) return false;
    const surf = g.session.surfaceById(g.surfaceId);
    if (!surf || !surf.mapped) {
      this.grab = null;
      return false;
    }
    const dx = this.cursorX - g.cursorX;
    const dy = this.cursorY - g.cursorY;

    if (g.kind === "move") {
      let gx = g.originX + dx;
      let gy = g.originY + dy;
      const frame = this.frameBox(surf);
      const fw = frame.w;
      const fh = frame.h;
      gx = Math.max(0, Math.min(kms.width - Math.min(fw, kms.width), gx));
      gy = Math.max(0, Math.min(kms.height - Math.min(fh, kms.height), gy));
      this.setGeometryPosition(surf, gx, gy);
      return true;
    }

    let gx = g.originX;
    let gy = g.originY;
    let w = g.originW;
    let h = g.originH;
    if (g.edges & XDG_TOPLEVEL_RESIZE_EDGE_LEFT) {
      gx = g.originX + dx;
      w = g.originW - dx;
    }
    if (g.edges & XDG_TOPLEVEL_RESIZE_EDGE_RIGHT) {
      w = g.originW + dx;
    }
    if (g.edges & XDG_TOPLEVEL_RESIZE_EDGE_TOP) {
      gy = g.originY + dy;
      h = g.originH - dy;
    }
    if (g.edges & XDG_TOPLEVEL_RESIZE_EDGE_BOTTOM) {
      h = g.originH + dy;
    }
    const minW = Math.max(200, surf.minW || 0);
    const minH = Math.max(100, surf.minH || 0);
    if (w < minW) {
      if (g.edges & XDG_TOPLEVEL_RESIZE_EDGE_LEFT) gx -= minW - w;
      w = minW;
    }
    if (h < minH) {
      if (g.edges & XDG_TOPLEVEL_RESIZE_EDGE_TOP) gy -= minH - h;
      h = minH;
    }
    if (surf.maxW > 0) w = Math.min(w, surf.maxW);
    if (surf.maxH > 0) h = Math.min(h, surf.maxH);
    w = Math.min(w, kms.width);
    h = Math.min(h, kms.height);
    gx = Math.max(0, Math.min(kms.width - w, gx));
    gy = Math.max(0, Math.min(kms.height - h, gy));
    this.setGeometryPosition(surf, gx, gy);
    g.session.configureToplevel(surf, w | 0, h | 0, [
      XDG_TOPLEVEL_STATE_RESIZING,
      XDG_TOPLEVEL_STATE_ACTIVATED,
    ]);
    return true;
  }

  /** Align a maximized/fullscreen toplevel so window geometry fills the output. */
  placeMaximized(surf: SurfaceState): void {
    this.setGeometryPosition(surf, 0, 0);
  }

  toggleMaximized(session: ClientSession, surfaceId: number, want: boolean): void {
    const surf = session.surfaceById(surfaceId);
    const kms = this.kms;
    if (!surf || !kms || surf.role !== "toplevel") return;
    if (want && !surf.maximized) {
      const frame = this.frameBox(surf);
      const size = this.contentSize(surf);
      surf.savedX = frame.x;
      surf.savedY = frame.y;
      surf.savedW = size.w;
      surf.savedH = size.h;
      surf.maximized = true;
      surf.fullscreen = false;
      this.placeMaximized(surf);
      const contentH = this.usesSsd(surf)
        ? Math.max(100, kms.height - SSD_PANEL_H - SSD_TITLEBAR_H)
        : kms.height;
      session.configureToplevel(surf, kms.width, contentH, [
        XDG_TOPLEVEL_STATE_MAXIMIZED,
        XDG_TOPLEVEL_STATE_ACTIVATED,
      ]);
    } else if (!want && surf.maximized) {
      surf.maximized = false;
      this.setGeometryPosition(surf, surf.savedX, surf.savedY);
      session.configureToplevel(surf, surf.savedW, surf.savedH, [
        XDG_TOPLEVEL_STATE_ACTIVATED,
      ]);
    }
  }

  toggleFullscreen(session: ClientSession, surfaceId: number, want: boolean): void {
    const surf = session.surfaceById(surfaceId);
    const kms = this.kms;
    if (!surf || !kms || surf.role !== "toplevel") return;
    if (want && !surf.fullscreen) {
      if (!surf.maximized) {
        surf.savedX = surf.x + surf.geomX;
        surf.savedY = surf.y + surf.geomY;
        surf.savedW = surf.geomW > 0 ? surf.geomW : surf.width;
        surf.savedH = surf.geomH > 0 ? surf.geomH : surf.height;
      }
      surf.fullscreen = true;
      this.placeMaximized(surf);
      session.configureToplevel(surf, kms.width, kms.height, [
        XDG_TOPLEVEL_STATE_FULLSCREEN,
        XDG_TOPLEVEL_STATE_ACTIVATED,
      ]);
    } else if (!want && surf.fullscreen) {
      surf.fullscreen = false;
      if (surf.maximized) {
        this.placeMaximized(surf);
        session.configureToplevel(surf, kms.width, kms.height, [
          XDG_TOPLEVEL_STATE_MAXIMIZED,
          XDG_TOPLEVEL_STATE_ACTIVATED,
        ]);
      } else {
        this.setGeometryPosition(surf, surf.savedX, surf.savedY);
        session.configureToplevel(surf, surf.savedW, surf.savedH, [
          XDG_TOPLEVEL_STATE_ACTIVATED,
        ]);
      }
    }
  }

  /** Topmost mapped surface under the cursor (last in stack wins). */
  private hitTest(
    x: number,
    y: number,
  ): { session: ClientSession; surface: SurfaceState } | null {
    // Popups sit above all toplevels.
    const popup = this.hitTestPopup(x, y);
    if (popup) return popup;

    // Walk top → bottom so the raised window wins.
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const entry = this.stack[i]!;
      entry.session.layout();
      const tree = entry.session.paintTree(entry.surfaceId);
      for (let j = tree.length - 1; j >= 0; j--) {
        const surf = tree[j]!;
        if (!surf.mapped || !surf.pixels) continue;
        if (surf.role === "cursor") continue;
        if (entry.session.isHidden(surf)) continue;
        if (surf.role === "toplevel") {
          if (this.usesSsd(surf)) {
            const size = this.contentSize(surf);
            const cx = surf.x;
            const cy = surf.y + SSD_TITLEBAR_H;
            if (
              x >= cx &&
              y >= cy &&
              x < cx + size.w &&
              y < cy + size.h
            ) {
              return { session: entry.session, surface: surf };
            }
            continue;
          }
          const frame = this.frameBox(surf);
          if (
            x >= frame.x &&
            y >= frame.y &&
            x < frame.x + frame.w &&
            y < frame.y + frame.h
          ) {
            return { session: entry.session, surface: surf };
          }
          continue;
        }
        // Subsurfaces: full buffer bounds
        if (
          surf.role === "subsurface" &&
          x >= surf.x &&
          y >= surf.y &&
          x < surf.x + surf.width &&
          y < surf.y + surf.height
        ) {
          return { session: entry.session, surface: surf };
        }
      }
    }
    return null;
  }

  private hitTestPopup(
    x: number,
    y: number,
  ): { session: ClientSession; surface: SurfaceState } | null {
    for (let i = this.popupStack.length - 1; i >= 0; i--) {
      const entry = this.popupStack[i]!;
      entry.session.layout();
      const surf = entry.session.surfaceById(entry.surfaceId);
      if (!surf || !surf.mapped || !surf.pixels) continue;
      if (entry.session.isHidden(surf)) continue;
      this.layoutPopup(entry.session, surf);
      const gw = surf.geomW > 0 ? surf.geomW : surf.width;
      const gh = surf.geomH > 0 ? surf.geomH : surf.height;
      const ox = surf.x + (surf.geomW > 0 ? surf.geomX : 0);
      const oy = surf.y + (surf.geomH > 0 ? surf.geomY : 0);
      if (x >= ox && y >= oy && x < ox + gw && y < oy + gh) {
        return { session: entry.session, surface: surf };
      }
      if (
        x >= surf.x &&
        y >= surf.y &&
        x < surf.x + surf.width &&
        y < surf.y + surf.height
      ) {
        return { session: entry.session, surface: surf };
      }
    }
    return null;
  }

  private updatePointerFocus(
    timeMs: number,
    sendMotion: boolean,
    forcedHit?: { session: ClientSession; surface: SurfaceState } | null,
  ): void {
    const hit =
      forcedHit === undefined
        ? this.hitTest(this.cursorX, this.cursorY)
        : forcedHit;
    const prev = this.pointerFocus;
    const nextId = hit?.surface.id ?? null;
    const prevId = prev?.surfaceId ?? null;

    if (prev && (nextId == null || prev.session !== hit?.session || prevId !== nextId)) {
      prev.session.pointerLeave();
      // Cursor is undefined after leave until the next set_cursor (xdg/wl).
      this.clearClientCursor(prev.session);
      this.pointerFocus = null;
    }

    if (hit) {
      const ssdY =
        hit.surface.role === "toplevel" && this.usesSsd(hit.surface)
          ? SSD_TITLEBAR_H
          : 0;
      const localX = this.cursorX - hit.surface.x;
      const localY = this.cursorY - hit.surface.y - ssdY;
      if (this.pointerFocus?.surfaceId !== hit.surface.id) {
        this.pointerFocus = { session: hit.session, surfaceId: hit.surface.id };
        hit.session.pointerEnter(hit.surface.id, localX, localY);
      } else if (sendMotion) {
        hit.session.pointerMotion(timeMs, localX, localY);
      }
    } else {
      // Over the desktop — no client owns the cursor.
      this.clearClientCursor();
    }
  }

  private clearPointerFocusForShellOverlay(): void {
    const prev = this.pointerFocus;
    if (prev) {
      prev.session.pointerLeave();
      this.clearClientCursor(prev.session);
      this.pointerFocus = null;
    } else {
      this.clearClientCursor();
    }
  }

  private clearClientCursor(session?: ClientSession): void {
    const cc = this.clientCursor;
    if (!cc) return;
    if (session && cc.session !== session) return;
    const prev = cc.session.surfaceById(cc.surfaceId);
    if (prev?.role === "cursor") prev.role = "none";
    this.clientCursor = null;
  }

  /** wl_pointer.set_cursor — surface is drawn at the hotspot, never as a window. */
  setClientCursor(
    session: ClientSession,
    surfaceId: number,
    hotspotX: number,
    hotspotY: number,
  ): void {
    if (surfaceId === 0) {
      this.clearClientCursor(session);
      return;
    }
    // Ignore set_cursor unless this session currently has pointer focus
    // (matches the protocol: only valid after enter, with that serial).
    if (this.pointerFocus?.session !== session) return;
    const surf = session.surfaceById(surfaceId);
    if (!surf) return;
    if (surf.role === "toplevel" || surf.role === "subsurface" || surf.role === "popup") return;
    if (
      this.clientCursor &&
      (this.clientCursor.session !== session ||
        this.clientCursor.surfaceId !== surfaceId)
    ) {
      const prev = this.clientCursor.session.surfaceById(
        this.clientCursor.surfaceId,
      );
      if (prev?.role === "cursor") prev.role = "none";
    }
    surf.role = "cursor";
    this.clientCursor = { session, surfaceId, hotspotX, hotspotY };
  }

  private blitArgb(
    fb: Uint32Array,
    pitchPx: number,
    fbW: number,
    fbH: number,
    dx: number,
    dy: number,
    src: Uint8Array,
    srcW: number,
    srcH: number,
    srcStride: number,
    /**
     * Window-geometry box in source coords. Inside: normal blit.
     * Outside: blend translucent pixels (CSD soft shadows); skip opaque
     * (often solid black margins from clients that don't use real alpha).
     */
    geom?: { x: number; y: number; w: number; h: number },
  ): void {
    // Wayland wl_shm / linux-dmabuf ARGB8888 is premultiplied.
    const srcWords = new Uint32Array(
      src.buffer,
      src.byteOffset,
      src.byteLength >>> 2,
    );
    const stridePx = srcStride >>> 2;
    const gx0 = geom?.x ?? 0;
    const gy0 = geom?.y ?? 0;
    const gx1 = geom ? geom.x + geom.w : srcW;
    const gy1 = geom ? geom.y + geom.h : srcH;

    for (let row = 0; row < srcH; row++) {
      const py = dy + row;
      if (py < 0 || py >= fbH) continue;
      let si = row * stridePx;
      for (let col = 0; col < srcW; col++, si++) {
        const px = dx + col;
        if (px < 0 || px >= fbW) continue;
        const pixel = srcWords[si]!;
        const a = (pixel >>> 24) & 0xff;
        if (a === 0) continue;
        const inGeom =
          !geom || (col >= gx0 && col < gx1 && row >= gy0 && row < gy1);
        // Opaque pixels outside window geometry are almost always fake CSD
        // "shadow" fill (solid black) — skip them so soft alpha shadows show.
        if (!inGeom && a === 255) continue;
        const di = py * pitchPx + px;
        if (a === 255) {
          fb[di] = pixel;
          continue;
        }
        const dst = fb[di]!;
        const inv = 255 - a;
        const r =
          (((pixel >>> 16) & 0xff) + ((((dst >>> 16) & 0xff) * inv) / 255)) | 0;
        const g =
          (((pixel >>> 8) & 0xff) + ((((dst >>> 8) & 0xff) * inv) / 255)) | 0;
        const b = ((pixel & 0xff) + (((dst & 0xff) * inv) / 255)) | 0;
        fb[di] = (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;
      }
    }
  }

  private paintDragPreview(
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
  ): void {
    const drag = this.drag;

    // Prefer client-provided drag icon surface when it has pixels.
    if (drag?.iconId != null) {
      const surf = drag.sourceSession.surfaceById(drag.iconId);
      if (surf?.pixels && surf.width > 0 && surf.height > 0) {
        const dx = (this.cursorX | 0) + surf.bufferOffsetX;
        const dy = (this.cursorY | 0) + surf.bufferOffsetY;
        try {
          this.blitArgb(
            fb,
            pitchPx,
            width,
            height,
            dx,
            dy,
            surf.pixels,
            surf.width,
            surf.height,
            surf.stride,
          );
          return;
        } catch (err) {
          console.warn("[dnd] icon blit failed:", err);
        }
      }
    }

    if (!drag && this.dragReturn) {
      const anim = this.dragReturn;
      const progress = Math.min(
        1,
        Math.max(0, (monotonicMs() - anim.startedMs) / anim.durationMs),
      );
      if (progress >= 1) {
        this.dragReturn = null;
        return;
      }
      const eased = 1 - Math.pow(1 - progress, 3);
      const dx = Math.round(anim.fromX + (anim.toX - anim.fromX) * eased);
      const dy = Math.round(anim.fromY + (anim.toY - anim.fromY) * eased);
      this.blitArgb(
        fb,
        pitchPx,
        width,
        height,
        dx,
        dy,
        anim.pixels,
        anim.width,
        anim.height,
        anim.stride,
      );
      this.markDirty();
      return;
    }

    const label =
      drag?.label ||
      this.shell?.desktopDragLabel?.() ||
      null;
    if (!label) return;

    try {
      this.shell?.paintDragPreview?.(
        fb,
        pitchPx,
        width,
        height,
        this.cursorX,
        this.cursorY,
        label,
      );
    } catch (err) {
      console.warn("[dnd] chip paint failed:", err);
    }
  }

  private drawShapeCursor(
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
    shape: string[],
    hotX: number,
    hotY: number,
  ): void {
    const white = 0xffffffff >>> 0;
    const black = 0xff000000 >>> 0;
    const ox = (this.cursorX | 0) - hotX;
    const oy = (this.cursorY | 0) - hotY;
    for (let row = 0; row < shape.length; row++) {
      const line = shape[row]!;
      const py = oy + row;
      if (py < 0 || py >= height) continue;
      for (let col = 0; col < line.length; col++) {
        const ch = line[col]!;
        if (ch === " ") continue;
        const px = ox + col;
        if (px < 0 || px >= width) continue;
        fb[py * pitchPx + px] = ch === "X" ? black : white;
      }
    }
  }

  private fallbackCursorShape(): { shape: string[]; hotX: number; hotY: number } {
    const g = this.grab;
    const edges =
      g?.kind === "resize" ? g.edges : this.hoverEdges;
    const left = !!(edges & XDG_TOPLEVEL_RESIZE_EDGE_LEFT);
    const right = !!(edges & XDG_TOPLEVEL_RESIZE_EDGE_RIGHT);
    const top = !!(edges & XDG_TOPLEVEL_RESIZE_EDGE_TOP);
    const bottom = !!(edges & XDG_TOPLEVEL_RESIZE_EDGE_BOTTOM);

    // Diagonal corners: NW-SE (\) vs NE-SW (/)
    if ((left && top) || (right && bottom)) {
      return {
        hotX: 7,
        hotY: 7,
        shape: [
          "XX            ",
          "X.X           ",
          "X..X          ",
          " X..X         ",
          "  X..X        ",
          "   X..X       ",
          "    X..X      ",
          "     X..X     ",
          "      X..X    ",
          "       X..X   ",
          "        X..X  ",
          "         X..X ",
          "          X.X ",
          "           XX ",
        ],
      };
    }
    if ((right && top) || (left && bottom)) {
      return {
        hotX: 7,
        hotY: 7,
        shape: [
          "            XX",
          "           X.X",
          "          X..X",
          "         X..X ",
          "        X..X  ",
          "       X..X   ",
          "      X..X    ",
          "     X..X     ",
          "    X..X      ",
          "   X..X       ",
          "  X..X        ",
          " X..X         ",
          " X.X          ",
          " XX           ",
        ],
      };
    }
    if (left || right) {
      return {
        hotX: 10,
        hotY: 5,
        shape: [
          "     XX     ",
          "    X..X    ",
          "   X....X   ",
          "XXX......XXX",
          "X..........X",
          "XXX......XXX",
          "   X....X   ",
          "    X..X    ",
          "     XX     ",
        ],
      };
    }
    if (top || bottom) {
      return {
        hotX: 5,
        hotY: 10,
        shape: [
          "   XXXXX   ",
          "   X...X   ",
          "  XX...XX  ",
          " X.......X ",
          "X.........X",
          "X.........X",
          " X.......X ",
          "  XX...XX  ",
          "   X...X   ",
          "   XXXXX   ",
        ],
      };
    }
    if (g?.kind === "move") {
      return {
        hotX: 8,
        hotY: 8,
        shape: [
          "      X      ",
          "     X.X     ",
          "    X...X    ",
          "   X.....X   ",
          "XXX.......XXX",
          "X...........X",
          "XXX.......XXX",
          "   X.....X   ",
          "    X...X    ",
          "     X.X     ",
          "      X      ",
        ],
      };
    }
    // Default arrow
    return {
      hotX: 0,
      hotY: 0,
      shape: [
        "X               ",
        "XX              ",
        "X.X             ",
        "X..X            ",
        "X...X           ",
        "X....X          ",
        "X.....X         ",
        "X......X        ",
        "X.......X       ",
        "X........X      ",
        "X.....XXXXX     ",
        "X..X..X         ",
        "X.X X.X         ",
        "XX  X.X         ",
        "X    X.X        ",
        "     X.X        ",
        "      X.X       ",
        "      XXX       ",
      ],
    };
  }

  private drawCursor(fb: Uint32Array, pitchPx: number, width: number, height: number): void {
    // Always prefer the client's wl_pointer.set_cursor surface (foot's theme
    // glyphs for arrow / resize / text / etc.). Fallback shapes only when the
    // client hasn't set one (or the buffer isn't ready yet).
    const cc = this.clientCursor;
    if (cc) {
      const surf = cc.session.surfaceById(cc.surfaceId);
      if (surf?.pixels && surf.width > 0 && surf.height > 0) {
        this.blitArgb(
          fb,
          pitchPx,
          width,
          height,
          (this.cursorX | 0) - cc.hotspotX,
          (this.cursorY | 0) - cc.hotspotY,
          surf.pixels,
          surf.width,
          surf.height,
          surf.stride,
        );
        cc.session.finishSurfaceFrame(surf);
        return;
      }
      if (surf) cc.session.finishSurfaceFrame(surf);
    }
    const fbShape = this.fallbackCursorShape();
    this.drawShapeCursor(
      fb,
      pitchPx,
      width,
      height,
      fbShape.shape,
      fbShape.hotX,
      fbShape.hotY,
    );
  }

  /** Request a composite + present on the next loop tick. */
  markDirty(): void {
    this.needsComposite = true;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      this.prefsWatcher?.poll();
      if (this.shell?.needsRepaint?.()) this.markDirty();
      if (this.needsComposite) {
        this.needsComposite = false;
        try {
          this.composite();
        } catch (err) {
          console.error("[composite]", err);
          this.markDirty();
        }
        await new Promise((r) => setTimeout(r, 16));
      } else {
        // Idle — no wallpaper fill / flushMmap / presentKms.
        await new Promise((r) => setTimeout(r, 50));
      }
    }
  }

  /** Paint mapped xdg_popup surfaces above chrome and release their buffers. */
  private paintPopups(
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
  ): number {
    let painted = 0;
    for (const entry of this.popupStack) {
      const client = entry.session;
      const surf = client.surfaceById(entry.surfaceId);
      if (!surf || !surf.mapped || !surf.pixels) continue;
      this.layoutPopup(client, surf);
      const hidden = client.isHidden(surf);
      if (
        !hidden &&
        !(
          surf.x >= width ||
          surf.y >= height ||
          surf.x + surf.width <= 0 ||
          surf.y + surf.height <= 0
        )
      ) {
        try {
          const useGeom = surf.geomW > 0 && surf.geomH > 0;
          this.blitArgb(
            fb,
            pitchPx,
            width,
            height,
            surf.x,
            surf.y,
            surf.pixels,
            surf.width,
            surf.height,
            surf.stride,
            useGeom
              ? {
                  x: surf.geomX,
                  y: surf.geomY,
                  w: surf.geomW,
                  h: surf.geomH,
                }
              : undefined,
          );
          painted++;
        } catch (err) {
          console.error(
            `[composite] popup blit failed ${surf.width}x${surf.height}:`,
            err,
          );
        }
      }
      for (const cbId of surf.frameCallbacks) {
        client.sendCallbackDone(cbId, monotonicMs());
        client.deleteId(cbId);
      }
      surf.frameCallbacks = [];
      for (const bufId of surf.releaseBuffers) {
        client.sendBufferRelease(bufId);
      }
      surf.releaseBuffers = [];
    }
    return painted;
  }

  /** Paint wallpaper + all mapped surfaces into the KMS dumb buffer. */
  composite(): void {
    const kms = this.kms;
    if (!kms) return;

    if (!this.stage || this.stage.byteLength !== kms.size) {
      this.stage = Buffer.alloc(kms.size);
    }
    const stage = this.stage;
    const fb = new Uint32Array(
      stage.buffer,
      stage.byteOffset,
      stage.byteLength >>> 2,
    );
    // Wallpaper from theme (atmosphere / gradient / image) — cached in @moire/theme.
    const pitchPx = kms.pitch >>> 2;
    const wallPhase = (Date.now() / 60000) % 1; // ~60s period
    paintWallpaper(fb, pitchPx, kms.width, kms.height, this.theme, wallPhase);
    // Keep atmosphere drifting even when otherwise idle.
    if (this.theme.wallpaper.mode === "atmosphere") {
      this.markDirty();
    }

    // Desktop icons / DnD drop-zone overlay (after wallpaper, before windows).
    try {
      this.shell?.paintDesktop?.(fb, pitchPx, kms.width, kms.height);
    } catch (err) {
      console.error("[shell] paintDesktop:", err);
    }

    let painted = 0;
    try {
      this.shell?.beginSsdFrame?.();
      // Bottom → top stack order so raised windows paint last.
      for (const entry of this.stack) {
        const client = entry.session;
        client.layout();
        for (const surf of client.paintTree(entry.surfaceId)) {
          if (!surf.mapped || !surf.pixels) continue;
          // Minimized windows still need frame callbacks + buffer releases,
          // otherwise arrays grow without bound and clients stall.
          const hidden = client.isHidden(surf);

          // Skip only if fully off-screen (CSD shadows often use negative x/y).
          if (
            !hidden &&
            !(
              surf.x >= kms.width ||
              surf.y >= kms.height ||
              surf.x + surf.width <= 0 ||
              surf.y + surf.height <= 0
            )
          ) {
            try {
              // Paint from the committed pixel buffer directly — do not
              // Buffer.from() every frame (see docs/known-issues.md).
              const ssdY =
                surf.role === "toplevel" && this.usesSsd(surf)
                  ? SSD_TITLEBAR_H
                  : 0;
              const useGeom =
                surf.role === "toplevel" &&
                surf.geomW > 0 &&
                surf.geomH > 0 &&
                !this.usesSsd(surf);
              this.blitArgb(
                fb,
                pitchPx,
                kms.width,
                kms.height,
                surf.x,
                surf.y + ssdY,
                surf.pixels,
                surf.width,
                surf.height,
                surf.stride,
                useGeom
                  ? {
                      x: surf.geomX,
                      y: surf.geomY,
                      w: surf.geomW,
                      h: surf.geomH,
                    }
                  : undefined,
              );
              painted++;
            } catch (err) {
              console.error(
                `[composite] blit failed role=${surf.role} ${surf.width}x${surf.height}:`,
                err,
              );
            }
          }

          for (const cbId of surf.frameCallbacks) {
            client.sendCallbackDone(cbId, monotonicMs());
            client.deleteId(cbId);
          }
          surf.frameCallbacks = [];
          for (const bufId of surf.releaseBuffers) {
            client.sendBufferRelease(bufId);
          }
          surf.releaseBuffers = [];
        }

        // SSD chrome in the same stack slot as the window (not a global overlay).
        const top = client.surfaceById(entry.surfaceId);
        if (
          top &&
          top.mapped &&
          !client.isHidden(top) &&
          this.usesSsd(top) &&
          this.shell?.paintSsdWindow
        ) {
          const size = this.contentSize(top);
          if (size.w > 0 && size.h > 0) {
            const focused =
              this.focusedToplevel?.session === entry.session &&
              this.focusedToplevel.surfaceId === top.id;
            this.shell.paintSsdWindow(fb, pitchPx, kms.width, kms.height, {
              clientId: entry.session.clientId,
              surfaceId: top.id,
              x: top.x,
              y: top.y,
              contentW: size.w,
              contentH: size.h,
              title: top.title || "Window",
              focused,
            });
          }
        }
      }

    } finally {
      try {
        this.ssdWindows = this.collectSsdWindows();
        // Fallback if shell only implements the bulk paintSsd API.
        if (!this.shell?.paintSsdWindow && this.shell?.paintSsd) {
          this.shell.paintSsd(
            fb,
            pitchPx,
            kms.width,
            kms.height,
            this.ssdWindows,
          );
        }
        this.shell?.paint(fb, pitchPx, kms.width, kms.height);
      } catch (err) {
        console.error("[shell] paint:", err);
      }
      // Native menus/flyouts are the top interactive layer. They must remain
      // visible and clickable even when their bounds cross the bottom panel.
      try {
        painted += this.paintPopups(fb, pitchPx, kms.width, kms.height);
      } catch (err) {
        console.error("[composite] paintPopups:", err);
      }
      this.paintDragPreview(fb, pitchPx, kms.width, kms.height);
      this.drawCursor(fb, pitchPx, kms.width, kms.height);
      // Always flush — a mid-frame blit throw used to skip present entirely.
      flushMmap(kms.map, stage, kms.size);
      // Parallels VIRTUAL DRM does not pick up dumb-buffer dirties until SetCrtc
      // is re-applied (or a page flip). Without this, CPU readback looks correct
      // while prlctl capture / the display stay on the last modeset image.
      try {
        presentKms(kms);
      } catch (err) {
        console.error("[composite] presentKms:", err);
      }
    }

    if (painted > 0 && painted !== this.lastPainted) {
      console.log(`[composite] painted ${painted} surfaces`);
      this.lastPainted = painted;
    }
  }
}

function monotonicMs(): number {
  const [s, ns] = process.hrtime();
  return s * 1000 + Math.floor(ns / 1e6);
}

class ClientSession {
  private objects = new Map<number, WlObject>();
  private buf = Buffer.alloc(0);
  private pendingFds: number[] = [];
  private serial = 1;
  /** Server-allocated object ids (Wayland server range). */
  private nextServerId = 0xff000000;
  private keyboardId: number | null = null;
  private pointerId: number | null = null;
  private focusedSurfaceId: number | null = null;
  private pointerSurfaceId: number | null = null;
  private pressedKeys = new Set<number>();
  /** Last serial from pointer enter/button (for xdg_popup.grab). */
  private lastInputSerial = 0;
  /** Bound wl_data_device object ids for this client. */
  private dataDeviceIds = new Set<number>();
  /** True when peer looks like Xwayland (SO_PEERCRED + /proc/exe). */
  readonly isXwayland: boolean;

  constructor(
    private readonly server: CompositorServer,
    private readonly conn: WaylandClientConn,
    readonly clientId: number,
  ) {
    this.objects.set(WL_DISPLAY_ID, {
      id: WL_DISPLAY_ID,
      iface: "wl_display",
      version: 1,
    });
    this.isXwayland = looksLikeXwayland(conn.peerPid);
    console.log(
      `[client] connected id=${clientId} pid=${conn.peerPid ?? "?"} xwayland=${this.isXwayland ? 1 : 0}`,
    );
    conn.on("message", (chunk: WaylandChunk) => this.onChunk(chunk));
  }

  surfaces(): SurfaceState[] {
    const out: SurfaceState[] = [];
    for (const obj of this.objects.values()) {
      if (obj.iface === "wl_surface" && obj.data?.surface) {
        out.push(obj.data.surface as SurfaceState);
      }
    }
    return out;
  }

  surfaceById(id: number): SurfaceState | null {
    const obj = this.objects.get(id);
    return (obj?.data?.surface as SurfaceState) ?? null;
  }

  /** Walk up to the toplevel for a surface (itself if already toplevel). */
  toplevelFor(surfaceId: number): SurfaceState | null {
    let s = this.surfaceById(surfaceId);
    while (s && (s.role === "subsurface" || s.role === "popup") && s.parentId != null) {
      s = this.surfaceById(s.parentId);
    }
    return s && s.role === "toplevel" ? s : null;
  }

  isHidden(surf: SurfaceState): boolean {
    const top = this.toplevelFor(surf.id) ?? (surf.role === "toplevel" ? surf : null);
    return !!top?.minimized;
  }

  configureToplevel(
    surface: SurfaceState,
    width: number,
    height: number,
    states: number[],
  ): void {
    if (surface.xdgToplevelId == null || surface.xdgSurfaceId == null) return;
    const buf = Buffer.alloc(states.length * 4);
    for (let i = 0; i < states.length; i++) {
      buf.writeUInt32LE(states[i]!, i * 4);
    }
    this.send(surface.xdgToplevelId, EV.xdg_toplevel_configure, (b) => {
      b.int(width).int(height).array(buf);
    });
    const serial = this.serial++;
    this.send(surface.xdgSurfaceId, EV.xdg_surface_configure, (b) =>
      b.uint(serial),
    );
  }

  requestClose(surface: SurfaceState): void {
    if (surface.x11Wid != null) {
      console.log(
        `[ssd] close x11 client=${this.clientId} surface=${surface.id} wid=${surface.x11Wid} @ ${surface.x},${surface.y} ${surface.width}x${surface.height}`,
      );
      this.server.getXwm()?.closeWindow(surface.x11Wid);
      return;
    }
    if (surface.xdgToplevelId == null) return;
    console.log(
      `[ssd] close xdg client=${this.clientId} surface=${surface.id}`,
    );
    this.send(surface.xdgToplevelId, EV.xdg_toplevel_close, () => {});
  }

  private handleXwaylandShell(opcode: number, r: MessageReader): void {
    if (opcode === OP.xwayland_shell_destroy) {
      // ok
    } else if (opcode === OP.xwayland_shell_get_xwayland_surface) {
      const id = r.newId();
      const surfaceId = r.object();
      this.objects.set(id, {
        id,
        iface: "xwayland_surface_v1",
        version: 1,
        data: { wlSurfaceId: surfaceId, pendingSerial: null as bigint | null },
      });
      const surf = this.surfaceById(surfaceId);
      if (surf) surf.xwaylandPending = true;
      console.log(
        `[xwayland_shell] get_xwayland_surface id=${id} wl_surface=${surfaceId}`,
      );
      // Serial may already be waiting on the XWM side.
      this.server.tryPairOrphanXwaylandSurface(this, surfaceId);
    }
  }

  private handleXwaylandSurface(
    obj: WlObject,
    opcode: number,
    r: MessageReader,
  ): void {
    if (opcode === OP.xwayland_surface_destroy) {
      this.destroyObject(obj.id);
    } else if (opcode === OP.xwayland_surface_set_serial) {
      const lo = r.uint();
      const hi = r.uint();
      const serial = (BigInt(hi) << 32n) | BigInt(lo);
      obj.data!.pendingSerial = serial;
      console.log(
        `[xwayland_shell] set_serial id=${obj.id} surface=${obj.data?.wlSurfaceId} serial=${serial}`,
      );
      // Apply immediately as well as on commit. Xwayland issues set_serial+commit
      // back-to-back; applying here closes the race with the X11 ClientMessage
      // and avoids missing buffer-less association commits.
      if (serial !== 0n && obj.data?.wlSurfaceId != null) {
        this.server.noteXwaylandSerial(
          this,
          obj.data.wlSurfaceId as number,
          serial,
        );
        obj.data.pendingSerial = null;
      }
    } else {
      console.warn(
        `[xwayland_shell] unhandled xwayland_surface opcode=${opcode} id=${obj.id}`,
      );
    }
  }

  /**
   * Fixed-size windows (Xwayland rootful) set min==max>0.
   * Do not resize on min alone — foot and others send a tiny minimum.
   */
  private maybeConfigureFixedSize(surface: SurfaceState): void {
    const { minW, minH, maxW, maxH } = surface;
    if (minW <= 0 || minH <= 0 || maxW <= 0 || maxH <= 0) return;
    if (minW !== maxW || minH !== maxH) return;
    this.configureToplevel(surface, minW, minH, [XDG_TOPLEVEL_STATE_ACTIVATED]);
  }

  /** Parent-then-children paint order for one toplevel tree. */
  paintTree(toplevelId: number): SurfaceState[] {
    const byId = new Map<number, SurfaceState>();
    for (const s of this.surfaces()) byId.set(s.id, s);
    const out: SurfaceState[] = [];
    const visit = (id: number) => {
      const s = byId.get(id);
      if (!s || s.role === "cursor") return;
      out.push(s);
      for (const childId of s.children) visit(childId);
    };
    visit(toplevelId);
    return out;
  }

  /** Parent-then-children paint order across all toplevels (insertion order). */
  paintOrder(): SurfaceState[] {
    const out: SurfaceState[] = [];
    for (const s of this.surfaces()) {
      if (s.role === "toplevel") out.push(...this.paintTree(s.id));
    }
    return out;
  }

  layout(): void {
    const byId = new Map<number, SurfaceState>();
    for (const s of this.surfaces()) byId.set(s.id, s);

    const abs = (s: SurfaceState): { x: number; y: number } => {
      if (s.role !== "subsurface" || s.parentId == null) {
        return { x: s.x, y: s.y };
      }
      const parent = byId.get(s.parentId);
      if (!parent) return { x: s.subX, y: s.subY };
      const p = abs(parent);
      return { x: p.x + s.subX, y: p.y + s.subY };
    };

    for (const s of this.surfaces()) {
      if (s.role === "subsurface") {
        const p = abs(s);
        s.x = p.x;
        s.y = p.y;
      }
    }
  }

  primaryToplevelSurfaceId(): number | null {
    for (const s of this.surfaces()) {
      if (s.role === "toplevel" && s.mapped) return s.id;
    }
    return null;
  }

  /** Fire frame callbacks + buffer releases for a surface (e.g. cursor). */
  finishSurfaceFrame(surf: SurfaceState): void {
    for (const cbId of surf.frameCallbacks) {
      this.sendCallbackDone(cbId, monotonicMs());
      this.deleteId(cbId);
    }
    surf.frameCallbacks = [];
    for (const bufId of surf.releaseBuffers) {
      this.sendBufferRelease(bufId);
    }
    surf.releaseBuffers = [];
  }

  getBuffer(id: number): BufferState | null {
    const obj = this.objects.get(id);
    return (obj?.data?.buffer as BufferState) ?? null;
  }

  getPool(id: number): PoolState | null {
    const obj = this.objects.get(id);
    return (obj?.data?.pool as PoolState) ?? null;
  }

  private releasePool(pool: PoolState, force: boolean): void {
    if (!force) {
      pool.refCount = Math.max(0, pool.refCount - 1);
      if (pool.refCount > 0 || !pool.destroyed) return;
    }
    if (!pool.map) return;
    try {
      munmapShm(pool.map, pool.size);
    } catch {
      // ok
    }
    try {
      fs.closeSync(pool.fd);
    } catch {
      // ok
    }
    pool.map = null;
    pool.destroyed = true;
    pool.refCount = 0;
  }

  destroy(): void {
    for (const obj of this.objects.values()) {
      if (obj.iface === "wl_shm_pool" && obj.data?.pool) {
        const pool = obj.data.pool as PoolState;
        this.releasePool(pool, true);
      } else if (obj.iface === "wl_buffer") {
        const buf = obj.data?.buffer as BufferState | undefined;
        if (buf?.kind === "shm") this.releasePool(buf.pool, false);
        if (buf?.kind === "dmabuf") closeDmabufPlanes(buf.planes);
      } else if (obj.iface === "zwp_linux_buffer_params_v1") {
        const params = obj.data?.params as DmabufParamsState | undefined;
        if (params && !params.created) closeDmabufPlanes(params.planes);
      }
    }
    for (const fd of this.pendingFds) {
      try {
        closeFd(fd);
      } catch {
        // ok
      }
    }
    this.pendingFds = [];
    this.objects.clear();
    this.conn.close();
  }

  keyboardEnter(surfaceId: number): void {
    if (this.keyboardId == null) return;
    // Never leave keyboard on a grabbing popup without popup_done — if focus
    // is moving to a normal surface, end this client's grabs first.
    const target = this.surfaceById(surfaceId);
    if (!target || target.role !== "popup") {
      let grabbing = false;
      for (const e of this.server.getPopupStack()) {
        if (e.session !== this) continue;
        const s = e.session.surfaceById(e.surfaceId);
        if (s?.popupGrabbed) {
          grabbing = true;
          break;
        }
      }
      if (grabbing) {
        console.log(
          `[popup] dismiss grabs before keyboard_enter surface=${surfaceId} (from=${this.focusedSurfaceId})`,
        );
        this.server.dismissGrabbedPopups(this);
      }
    }
    if (this.focusedSurfaceId === surfaceId) return;
    if (this.focusedSurfaceId != null) {
      const serial = this.serial++;
      this.send(this.keyboardId, EV.keyboard_leave, (b) => {
        b.uint(serial).object(this.focusedSurfaceId!);
      });
    }
    this.focusedSurfaceId = surfaceId;
    const keys = Buffer.alloc(this.pressedKeys.size * 4);
    let i = 0;
    for (const k of this.pressedKeys) {
      keys.writeUInt32LE(k, i);
      i += 4;
    }
    const serial = this.serial++;
    this.send(this.keyboardId, EV.keyboard_enter, (b) => {
      b.uint(serial).object(surfaceId).array(keys);
    });
    this.send(this.keyboardId, EV.keyboard_modifiers, (b) => {
      b.uint(serial).uint(0).uint(0).uint(0).uint(0);
    });
    console.log(`[seat] keyboard enter surface=${surfaceId}`);
  }

  keyboardLeave(): void {
    if (this.keyboardId == null || this.focusedSurfaceId == null) return;
    const serial = this.serial++;
    this.send(this.keyboardId, EV.keyboard_leave, (b) => {
      b.uint(serial).object(this.focusedSurfaceId!);
    });
    this.focusedSurfaceId = null;
  }

  keyboardKey(ev: EvdevKeyEvent): void {
    if (this.keyboardId == null || this.focusedSurfaceId == null) return;
    if (ev.value === 1) this.pressedKeys.add(ev.code);
    else if (ev.value === 0) this.pressedKeys.delete(ev.code);
    // value 2 = repeat — still send as pressed
    const state =
      ev.value === 0
        ? WL_KEYBOARD_KEY_STATE_RELEASED
        : WL_KEYBOARD_KEY_STATE_PRESSED;
    const serial = this.serial++;
    this.send(this.keyboardId, EV.keyboard_key, (b) => {
      b.uint(serial).uint(ev.timeMs >>> 0).uint(ev.code).uint(state);
    });
  }

  pointerEnter(surfaceId: number, sx: number, sy: number): void {
    if (this.pointerId == null) return;
    if (this.pointerSurfaceId === surfaceId) {
      // Already entered (e.g. ghost-fed Xwayland) — refresh position.
      this.send(this.pointerId, EV.pointer_motion, (b) => {
        b.uint(monotonicMs()).fixed(sx).fixed(sy);
      });
      this.send(this.pointerId, EV.pointer_frame, () => {});
      return;
    }
    if (this.pointerSurfaceId != null) {
      const serial = this.serial++;
      this.send(this.pointerId, EV.pointer_leave, (b) => {
        b.uint(serial).object(this.pointerSurfaceId!);
      });
    }
    this.pointerSurfaceId = surfaceId;
    const serial = this.serial++;
    this.lastInputSerial = serial;
    this.send(this.pointerId, EV.pointer_enter, (b) => {
      b.uint(serial).object(surfaceId).fixed(sx).fixed(sy);
    });
    this.send(this.pointerId, EV.pointer_frame, () => {});
  }

  pointerLeave(): void {
    if (this.pointerId == null || this.pointerSurfaceId == null) return;
    const serial = this.serial++;
    this.send(this.pointerId, EV.pointer_leave, (b) => {
      b.uint(serial).object(this.pointerSurfaceId!);
    });
    this.send(this.pointerId, EV.pointer_frame, () => {});
    this.pointerSurfaceId = null;
  }

  pointerMotion(timeMs: number, sx: number, sy: number): void {
    if (this.pointerId == null || this.pointerSurfaceId == null) return;
    this.send(this.pointerId, EV.pointer_motion, (b) => {
      b.uint(timeMs >>> 0).fixed(sx).fixed(sy);
    });
    this.send(this.pointerId, EV.pointer_frame, () => {});
  }

  pointerButton(ev: EvdevPointerButton): number | null {
    if (this.pointerId == null || this.pointerSurfaceId == null) return null;
    const state =
      ev.value === 0
        ? WL_POINTER_BUTTON_STATE_RELEASED
        : WL_POINTER_BUTTON_STATE_PRESSED;
    const serial = this.serial++;
    this.lastInputSerial = serial;
    this.send(this.pointerId, EV.pointer_button, (b) => {
      b.uint(serial).uint(ev.timeMs >>> 0).uint(ev.code).uint(state);
    });
    this.send(this.pointerId, EV.pointer_frame, () => {});
    return serial;
  }

  pointerAxis(ev: EvdevPointerAxis): void {
    if (this.pointerId == null || this.pointerSurfaceId == null) return;
    // Linux wheel up (+) → Wayland axis negative (scroll up)
    this.send(this.pointerId, EV.pointer_axis, (b) => {
      b.uint(ev.timeMs >>> 0)
        .uint(WL_POINTER_AXIS_VERTICAL_SCROLL)
        .fixed(-ev.value * 10);
    });
    this.send(this.pointerId, EV.pointer_frame, () => {});
  }

  private onChunk(chunk: WaylandChunk): void {
    this.buf = Buffer.concat([this.buf, chunk.data]);
    this.pendingFds.push(...chunk.fds);

    while (this.buf.length >= WL_HEADER_SIZE) {
      const header = decodeHeader(this.buf);
      if (header.size < WL_HEADER_SIZE || this.buf.length < header.size) break;
      const msg = this.buf.subarray(0, header.size);
      this.buf = this.buf.subarray(header.size);

      // Pull ancillary fds for messages that carry them.
      const fdsForMsg: number[] = [];
      const obj = this.objects.get(header.objectId);
      if (
        obj?.iface === "wl_shm" &&
        header.opcode === OP.shm_create_pool &&
        this.pendingFds.length > 0
      ) {
        fdsForMsg.push(this.pendingFds.shift()!);
      } else if (
        obj?.iface === "zwp_linux_buffer_params_v1" &&
        header.opcode === OP.linux_buffer_params_add &&
        this.pendingFds.length > 0
      ) {
        fdsForMsg.push(this.pendingFds.shift()!);
      } else if (
        obj?.iface === "wl_data_offer" &&
        header.opcode === OP.data_offer_receive &&
        this.pendingFds.length > 0
      ) {
        fdsForMsg.push(this.pendingFds.shift()!);
      } else if (
        obj?.iface === "wl_drm" &&
        header.opcode === OP.drm_create_prime_buffer &&
        this.pendingFds.length > 0
      ) {
        fdsForMsg.push(this.pendingFds.shift()!);
      }

      try {
        this.dispatch(header.objectId, header.opcode, msg, fdsForMsg);
      } catch (err) {
        console.error("dispatch error", err);
      }
    }
  }

  private dispatch(
    objectId: number,
    opcode: number,
    msg: Buffer,
    fds: number[],
  ): void {
    const obj = this.objects.get(objectId);
    if (!obj) {
      console.warn(
        `[wl] unknown object id=${objectId} opcode=${opcode} size=${msg.length}`,
      );
      return;
    }
    const r = new MessageReader(msg, fds);

    switch (obj.iface) {
      case "wl_display":
        this.handleDisplay(opcode, r);
        break;
      case "wl_registry":
        this.handleRegistry(opcode, r);
        break;
      case "wl_compositor":
        this.handleCompositor(opcode, r);
        break;
      case "wl_shm":
        this.handleShm(opcode, r);
        break;
      case "wl_shm_pool":
        this.handleShmPool(obj, opcode, r);
        break;
      case "wl_surface":
        this.handleSurface(obj, opcode, r);
        break;
      case "wl_buffer":
        if (opcode === OP.buffer_destroy) this.destroyObject(objectId);
        break;
      case "wl_region":
        // ignore add/destroy geometry for MVP
        if (opcode === OP.region_destroy) this.destroyObject(objectId);
        break;
      case "wl_subcompositor":
        this.handleSubcompositor(opcode, r);
        break;
      case "wl_subsurface":
        this.handleSubsurface(obj, opcode, r);
        break;
      case "wl_seat":
        this.handleSeat(obj, opcode, r);
        break;
      case "wl_pointer":
        this.handlePointer(opcode, r);
        break;
      case "wl_keyboard":
      case "wl_touch":
      case "wl_output":
        break;
      case "wl_data_device_manager":
        this.handleDataDeviceManager(opcode, r);
        break;
      case "wl_data_device":
        this.handleDataDevice(obj, opcode, r);
        break;
      case "wl_data_source":
        this.handleDataSource(obj, opcode, r);
        break;
      case "wl_data_offer":
        this.handleDataOffer(obj, opcode, r);
        break;
      case "zxdg_decoration_manager_v1":
        this.handleXdgDecorationManager(opcode, r);
        break;
      case "zxdg_toplevel_decoration_v1":
        this.handleXdgToplevelDecoration(obj, opcode, r);
        break;
      case "xdg_wm_base":
        this.handleXdgWmBase(opcode, r);
        break;
      case "xdg_surface":
        this.handleXdgSurface(obj, opcode, r);
        break;
      case "xdg_toplevel":
        this.handleXdgToplevel(obj, opcode, r);
        break;
      case "xdg_positioner":
        this.handleXdgPositioner(obj, opcode, r);
        break;
      case "xdg_popup":
        this.handleXdgPopup(obj, opcode, r);
        break;
      case "zwp_linux_dmabuf_v1":
        this.handleLinuxDmabuf(opcode, r);
        break;
      case "zwp_linux_buffer_params_v1":
        this.handleLinuxBufferParams(obj, opcode, r);
        break;
      case "zwp_linux_dmabuf_feedback_v1":
        if (opcode === OP.linux_dmabuf_feedback_destroy) {
          this.destroyObject(objectId);
        }
        break;
      case "wl_drm":
        this.handleDrm(obj, opcode, r);
        break;
      case "xwayland_shell_v1":
        this.handleXwaylandShell(opcode, r);
        break;
      case "xwayland_surface_v1":
        this.handleXwaylandSurface(obj, opcode, r);
        break;
      default:
        console.warn(
          `[wl] unhandled ${obj.iface} id=${objectId} opcode=${opcode}`,
        );
        break;
    }
  }

  private handleDisplay(opcode: number, r: MessageReader): void {
    if (opcode === OP.display_sync) {
      const cbId = r.newId();
      this.objects.set(cbId, { id: cbId, iface: "wl_callback", version: 1 });
      this.sendCallbackDone(cbId, this.serial++);
      this.deleteId(cbId);
    } else if (opcode === OP.display_get_registry) {
      const id = r.newId();
      this.objects.set(id, { id, iface: "wl_registry", version: 1 });
      for (const g of this.server.getGlobalsForClient(this)) {
        this.send(id, EV.registry_global, (b) => {
          b.uint(g.name).string(g.iface).uint(g.version);
        });
      }
    }
  }

  private handleRegistry(opcode: number, r: MessageReader): void {
    if (opcode !== OP.registry_bind) return;
    const name = r.uint();
    // wl_registry.bind in v1: name, id — but since v2 also interface string + version
    // Clients send: name, interface (string), version, id (new_id)
    const iface = r.string()!;
    const version = r.uint();
    const id = r.newId();
    void name;
    this.objects.set(id, { id, iface, version });

    if (iface === "wl_shm") {
      this.send(id, EV.shm_format, (b) => b.uint(WL_SHM_FORMAT_ARGB8888));
      this.send(id, EV.shm_format, (b) => b.uint(WL_SHM_FORMAT_XRGB8888));
    } else if (iface === "zwp_linux_dmabuf_v1") {
      this.sendDmabufFormats(id);
    } else if (iface === "wl_seat") {
      // Do not send seat_name — some clients (weston-simple-shm) lack that listener.
      const caps = this.server.getKeymap()
        ? WL_SEAT_CAPABILITY_POINTER | WL_SEAT_CAPABILITY_KEYBOARD
        : WL_SEAT_CAPABILITY_POINTER;
      this.send(id, EV.seat_capabilities, (b) => b.uint(caps));
    } else if (iface === "wl_output") {
      this.sendOutputEvents(id);
    } else if (iface === "wl_data_device_manager") {
      // no immediate events
    } else if (iface === "wl_drm") {
      this.sendDrmBind(id);
    } else if (iface === "xwayland_shell_v1") {
      if (!this.isXwayland) {
        console.warn(
          `[xwayland_shell] rejected bind from non-Xwayland client id=${this.clientId}`,
        );
        this.objects.delete(id);
        this.sendError(
          WL_DISPLAY_ID,
          0,
          `xwayland_shell_v1 is only for Xwayland`,
        );
        return;
      }
      console.log(`[xwayland_shell] bound id=${id}`);
    }
  }

  /** wl_drm.bind — tell Mesa/Xwayland which render node to open. */
  private sendDrmBind(id: number): void {
    const path =
      this.server.getDmabufFeedback()?.device.path ?? "/dev/dri/renderD128";
    this.send(id, EV.drm_device, (b) => b.string(path));
    this.send(id, EV.drm_format, (b) => b.uint(DRM_FORMAT_ARGB8888));
    this.send(id, EV.drm_format, (b) => b.uint(DRM_FORMAT_XRGB8888));
    this.send(id, EV.drm_capabilities, (b) => b.uint(WL_DRM_CAPABILITY_PRIME));
    console.log(`[drm] bound wl_drm id=${id} device=${path}`);
  }

  private handleDrm(obj: WlObject, opcode: number, r: MessageReader): void {
    if (opcode === OP.drm_authenticate) {
      r.uint(); // magic — render nodes need no auth
      this.send(obj.id, EV.drm_authenticated, () => {});
    } else if (opcode === OP.drm_create_buffer) {
      // Legacy GEM-name buffers — unused when PRIME/dmabuf works.
      const bufferId = r.newId();
      r.uint();
      r.int();
      r.int();
      r.uint();
      r.uint();
      this.objects.set(bufferId, {
        id: bufferId,
        iface: "wl_buffer",
        version: 1,
        data: {
          buffer: {
            kind: "shm",
            poolId: 0,
            pool: {
              fd: -1,
              size: 0,
              map: null,
              refCount: 0,
              destroyed: true,
            },
            offset: 0,
            width: 0,
            height: 0,
            stride: 0,
            format: 0,
          } satisfies ShmBufferState,
        },
      });
      console.warn(`[drm] create_buffer unsupported id=${bufferId}`);
    } else if (opcode === OP.drm_create_planar_buffer) {
      const bufferId = r.newId();
      r.uint();
      r.int();
      r.int();
      r.uint();
      for (let i = 0; i < 6; i++) r.int();
      this.objects.set(bufferId, {
        id: bufferId,
        iface: "wl_buffer",
        version: 1,
      });
      console.warn(`[drm] create_planar_buffer unsupported id=${bufferId}`);
    } else if (opcode === OP.drm_create_prime_buffer) {
      // Same shape as a single-plane dmabuf — reuse import path.
      const bufferId = r.newId();
      const fd = r.fd();
      const width = r.int();
      const height = r.int();
      const format = r.uint();
      const offset0 = r.int();
      const stride0 = r.int();
      r.int();
      r.int();
      r.int();
      r.int(); // plane 1/2 offsets/strides unused for RGB
      const buffer: DmabufBuffer = {
        kind: "dmabuf",
        width,
        height,
        format,
        flags: 0,
        planes: [
          {
            fd,
            offset: offset0,
            stride: stride0,
            modifierHi: 0,
            modifierLo: 0,
          },
        ],
      };
      this.objects.set(bufferId, {
        id: bufferId,
        iface: "wl_buffer",
        version: 1,
        data: { buffer },
      });
      console.log(
        `[drm] create_prime_buffer id=${bufferId} ${width}x${height} fmt=0x${format.toString(16)}`,
      );
    }
  }

  private sendDmabufFormats(dmabufId: number): void {
    for (const format of [DRM_FORMAT_ARGB8888, DRM_FORMAT_XRGB8888]) {
      this.send(dmabufId, EV.linux_dmabuf_format, (b) => b.uint(format));
      // Explicit linear + implicit/invalid — Mesa/Xwayland expect linear.
      this.send(dmabufId, EV.linux_dmabuf_modifier, (b) => {
        b.uint(format).uint(0).uint(0);
      });
      this.send(dmabufId, EV.linux_dmabuf_modifier, (b) => {
        b.uint(format)
          .uint(DRM_FORMAT_MOD_INVALID_HI)
          .uint(DRM_FORMAT_MOD_INVALID_LO);
      });
    }
  }

  private sendOutputEvents(id: number): void {
    const kms = this.server.getKms();
    this.send(id, EV.output_geometry, (b) => {
      b.int(0)
        .int(0)
        .int(0)
        .int(0)
        .int(0) // unknown subpixel
        .string("Moire")
        .string("Virtual")
        .int(0); // transform normal
    });
    this.send(id, EV.output_mode, (b) => {
      b.uint(WL_OUTPUT_MODE_CURRENT)
        .int(kms.width)
        .int(kms.height)
        .int(60_000); // mHz
    });
    this.send(id, EV.output_scale, (b) => b.int(1));
    this.send(id, EV.output_done, () => {});
  }

  private handleSubcompositor(opcode: number, r: MessageReader): void {
    if (opcode === OP.subcompositor_destroy) return;
    if (opcode !== OP.subcompositor_get_subsurface) return;
    const id = r.newId();
    const surfaceId = r.object();
    const parentId = r.object();
    const surfObj = this.objects.get(surfaceId);
    const parentObj = this.objects.get(parentId);
    const surface = surfObj?.data?.surface as SurfaceState | undefined;
    const parent = parentObj?.data?.surface as SurfaceState | undefined;
    if (surface && parent) {
      surface.role = "subsurface";
      surface.parentId = parentId;
      surface.subX = 0;
      surface.subY = 0;
      if (!parent.children.includes(surfaceId)) parent.children.push(surfaceId);
    }
    this.objects.set(id, {
      id,
      iface: "wl_subsurface",
      version: 1,
      data: { surfaceId },
    });
  }

  private handleSubsurface(obj: WlObject, opcode: number, r: MessageReader): void {
    const surfaceId = obj.data?.surfaceId as number | undefined;
    const surface = surfaceId
      ? (this.objects.get(surfaceId)?.data?.surface as SurfaceState | undefined)
      : undefined;
    if (opcode === OP_SUBSURFACE.set_position) {
      const x = r.int();
      const y = r.int();
      if (surface) {
        surface.subX = x;
        surface.subY = y;
      }
    } else if (
      opcode === OP_SUBSURFACE.place_above ||
      opcode === OP_SUBSURFACE.place_below
    ) {
      const siblingId = r.object();
      if (surface && surface.parentId != null && surfaceId != null) {
        this.reorderSubsurface(
          surface.parentId,
          surfaceId,
          siblingId,
          opcode === OP_SUBSURFACE.place_above,
        );
      }
    } else if (opcode === OP_SUBSURFACE.destroy) {
      this.destroyObject(obj.id);
    }
    // set_sync / set_desync ignored — treat as desync (independent commits)
  }

  /** Reorder a subsurface in its parent's children list (z-order). */
  private reorderSubsurface(
    parentId: number,
    childId: number,
    siblingId: number,
    above: boolean,
  ): void {
    const parent = this.objects.get(parentId)?.data?.surface as
      | SurfaceState
      | undefined;
    if (!parent) return;
    const kids = parent.children.filter((id) => id !== childId);
    if (siblingId === parentId) {
      // Relative to parent surface: above → top of stack, below → bottom
      if (above) kids.push(childId);
      else kids.unshift(childId);
    } else {
      const idx = kids.indexOf(siblingId);
      if (idx < 0) {
        kids.push(childId);
      } else if (above) {
        kids.splice(idx + 1, 0, childId);
      } else {
        kids.splice(idx, 0, childId);
      }
    }
    parent.children = kids;
  }

  private handleSeat(obj: WlObject, opcode: number, r: MessageReader): void {
    // Child objects inherit the version the client bound on wl_seat.
    const ver = obj.version;
    if (opcode === OP.seat_get_pointer) {
      const id = r.newId();
      this.objects.set(id, { id, iface: "wl_pointer", version: ver });
      this.pointerId = id;
    } else if (opcode === OP.seat_get_keyboard) {
      const id = r.newId();
      this.objects.set(id, { id, iface: "wl_keyboard", version: ver });
      this.keyboardId = id;
      const keymap = this.server.getKeymap();
      if (keymap) {
        // format, fd, size — fd is ancillary only
        this.send(id, EV.keyboard_keymap, (b) => {
          b.uint(WL_KEYBOARD_KEYMAP_FORMAT_XKB_V1)
            .fd(keymap.fd)
            .uint(keymap.size);
        });
      }
      // repeat_info is since v4 — only send if the client bound that version.
      if (ver >= 4) {
        this.send(id, EV.keyboard_repeat_info, (b) => b.int(40).int(400));
      }
    } else if (opcode === OP.seat_get_touch) {
      const id = r.newId();
      this.objects.set(id, { id, iface: "wl_touch", version: ver });
    } else if (opcode === OP.seat_release) {
      // ok
    }
  }

  private handlePointer(opcode: number, r: MessageReader): void {
    if (opcode === OP.pointer_set_cursor) {
      r.uint(); // serial
      const surfaceId = r.object();
      const hotspotX = r.int();
      const hotspotY = r.int();
      this.server.setClientCursor(this, surfaceId, hotspotX, hotspotY);
    } else if (opcode === OP.pointer_release) {
      if (this.pointerId != null) this.destroyObject(this.pointerId);
      this.pointerId = null;
      this.pointerSurfaceId = null;
    }
  }

  private handleDataDeviceManager(opcode: number, r: MessageReader): void {
    if (opcode === OP.data_device_manager_create_data_source) {
      const id = r.newId();
      this.objects.set(id, {
        id,
        iface: "wl_data_source",
        version: 3,
        data: { source: { mimeTypes: [], dndActions: 0 } satisfies DataSourceState },
      });
    } else if (opcode === OP.data_device_manager_get_data_device) {
      const id = r.newId();
      r.object(); // seat
      this.objects.set(id, { id, iface: "wl_data_device", version: 3 });
      this.dataDeviceIds.add(id);
      // Announce current seat selection to the new device.
      this.sendSelection(this.server.getSelection(), id);
    }
  }

  private handleDataSource(obj: WlObject, opcode: number, r: MessageReader): void {
    const source = obj.data?.source as DataSourceState | undefined;
    if (opcode === OP.data_source_offer) {
      const mime = r.string();
      if (mime && source && !source.mimeTypes.includes(mime)) {
        source.mimeTypes.push(mime);
      }
    } else if (opcode === OP.data_source_set_actions) {
      const actions = r.uint();
      if (source) source.dndActions = actions;
    } else if (opcode === OP.data_source_destroy) {
      if (
        this.server.getSelection()?.sourceSession === this &&
        this.server.getSelection()?.sourceId === obj.id
      ) {
        this.server.clearSelection("cancelled");
      }
      const drag = this.server.getDrag();
      if (drag?.sourceSession === this && drag.sourceId === obj.id) {
        this.server.cancelDrag();
      }
      this.destroyObject(obj.id);
    }
  }

  private handleDataDevice(obj: WlObject, opcode: number, r: MessageReader): void {
    if (opcode === OP.data_device_start_drag) {
      const sourceId = r.object();
      const originId = r.object();
      const iconId = r.object();
      const serial = r.uint();
      if (!sourceId) {
        console.warn("[dnd] start_drag: no source id");
        return;
      }
      this.server.startDrag(this, sourceId, originId, iconId || null, serial);
    } else if (opcode === OP.data_device_set_selection) {
      const sourceId = r.object();
      const serial = r.uint();
      this.server.setSelection(this, sourceId || null, serial);
    } else if (opcode === OP.data_device_release) {
      this.dataDeviceIds.delete(obj.id);
      this.destroyObject(obj.id);
    }
  }

  private handleDataOffer(obj: WlObject, opcode: number, r: MessageReader): void {
    const offer = obj.data?.offer as DataOfferState | undefined;
    if (opcode === OP.data_offer_accept) {
      r.uint(); // serial
      r.string(); // mime (nullable)
    } else if (opcode === OP.data_offer_receive) {
      const mime = r.string() ?? "";
      const fd = r.fd();
      if (!offer) {
        try { closeFd(fd); } catch { /* ok */ }
        return;
      }
      if (offer.isDnd) {
        // DnD receive: relay to drag source.
        this.server.forwardDndReceive(offer.sourceSession, offer.sourceId, mime, fd);
      } else {
        // Clipboard receive: only allowed when offer matches current selection.
        const sel = this.server.getSelection();
        if (
          !sel ||
          sel.sourceSession !== offer.sourceSession ||
          sel.sourceId !== offer.sourceId
        ) {
          try { closeFd(fd); } catch { /* ok */ }
          return;
        }
        this.server.forwardSelectionReceive(mime, fd);
      }
    } else if (opcode === OP.data_offer_destroy) {
      this.destroyObject(obj.id);
    } else if (opcode === OP.data_offer_finish) {
      // Target finished reading drop data — notify source.
      if (offer?.isDnd) {
        offer.sourceSession.sendDataSourceDndFinished(offer.sourceId);
      }
    } else if (opcode === OP.data_offer_set_actions) {
      r.uint(); // dnd_actions
      r.uint(); // preferred_action
    }
  }

  dataSourceMimes(sourceId: number): string[] | null {
    const obj = this.objects.get(sourceId);
    if (obj?.iface !== "wl_data_source") return null;
    const source = obj.data?.source as DataSourceState | undefined;
    return source ? [...source.mimeTypes] : null;
  }

  dataSourceActions(sourceId: number): number {
    const obj = this.objects.get(sourceId);
    if (obj?.iface !== "wl_data_source") return 1; // default copy
    const source = obj.data?.source as DataSourceState | undefined;
    return source?.dndActions ?? 1;
  }

  nextSerial(): number {
    return this.serial++;
  }

  firstDataDeviceId(): number | null {
    for (const id of this.dataDeviceIds) return id;
    return null;
  }

  /**
   * Allocate a wl_data_offer for DnD on the given device, announce it,
   * and send source_actions + preferred action. Returns the new offer id,
   * or null if the device object is gone.
   */
  createDndOffer(
    deviceId: number,
    sourceSession: DragSourceLike,
    sourceId: number,
    mimeTypes: string[],
    actions: number,
  ): number | null {
    if (!this.objects.has(deviceId)) return null;
    const offerId = this.allocServerId();
    const offer: DataOfferState = {
      sourceSession,
      sourceId,
      mimeTypes: [...mimeTypes],
      deviceId,
      isDnd: true,
    };
    this.objects.set(offerId, {
      id: offerId,
      iface: "wl_data_offer",
      version: 3,
      data: { offer },
    });
    this.send(deviceId, EV.data_device_data_offer, (b) => b.newId(offerId));
    for (const mime of mimeTypes) {
      this.send(offerId, EV.data_offer_offer, (b) => b.string(mime));
    }
    // Advertise source actions and select preferred (prefer move over copy).
    const WL_DND_ACTION_MOVE = 2;
    const WL_DND_ACTION_COPY = 1;
    const preferred =
      (actions & WL_DND_ACTION_MOVE) !== 0
        ? WL_DND_ACTION_MOVE
        : WL_DND_ACTION_COPY;
    this.send(offerId, EV.data_offer_source_actions, (b) => b.uint(actions));
    this.send(offerId, EV.data_offer_action, (b) => b.uint(preferred));
    return offerId;
  }

  sendDndEnter(
    deviceId: number,
    serial: number,
    surfaceId: number,
    x: number,
    y: number,
    offerId: number,
    actions: number,
  ): void {
    void actions; // already sent via createDndOffer
    this.send(deviceId, EV.data_device_enter, (b) =>
      b.uint(serial).object(surfaceId).fixed(x).fixed(y).object(offerId),
    );
  }

  sendDndLeave(deviceId: number): void {
    if (!this.objects.has(deviceId)) return;
    this.send(deviceId, EV.data_device_leave, () => {});
  }

  sendDndMotion(deviceId: number, timeMs: number, x: number, y: number): void {
    if (!this.objects.has(deviceId)) return;
    this.send(deviceId, EV.data_device_motion, (b) =>
      b.uint(timeMs >>> 0).fixed(x).fixed(y),
    );
  }

  sendDndDrop(deviceId: number): void {
    if (!this.objects.has(deviceId)) return;
    this.send(deviceId, EV.data_device_drop, () => {});
  }

  sendDataSourceDndDropPerformed(sourceId: number): void {
    if (!this.objects.has(sourceId)) return;
    this.send(sourceId, EV.data_source_dnd_drop_performed, () => {});
  }

  sendDataSourceDndFinished(sourceId: number): void {
    if (!this.objects.has(sourceId)) return;
    this.send(sourceId, EV.data_source_dnd_finished, () => {});
  }

  sendDataSourceCancelled(sourceId: number): void {
    if (!this.objects.has(sourceId)) return;
    this.send(sourceId, EV.data_source_cancelled, () => {});
  }

  sendDataSourceSend(sourceId: number, mime: string, fd: number): void {
    if (!this.objects.has(sourceId)) {
      try {
        closeFd(fd);
      } catch {
        // ok
      }
      return;
    }
    this.send(sourceId, EV.data_source_send, (b) => {
      b.string(mime).fd(fd);
    });
    // Ownership transferred via SCM_RIGHTS; close our copy.
    try {
      closeFd(fd);
    } catch {
      // ok
    }
  }

  /**
   * Announce seat selection on one device (or all). Pass null to clear.
   */
  sendSelection(
    sel: ClipboardSelection | null,
    onlyDeviceId?: number,
  ): void {
    const devices = onlyDeviceId
      ? [onlyDeviceId]
      : [...this.dataDeviceIds];
    for (const deviceId of devices) {
      if (!this.objects.has(deviceId)) continue;
      if (!sel) {
        this.send(deviceId, EV.data_device_selection, (b) => b.object(0));
        continue;
      }
      // Source client still needs an offer object to paste from itself.
      const offerId = this.allocServerId();
      const offer: DataOfferState = {
        sourceSession: sel.sourceSession,
        sourceId: sel.sourceId,
        mimeTypes: [...sel.mimeTypes],
        deviceId,
        isDnd: false,
      };
      this.objects.set(offerId, {
        id: offerId,
        iface: "wl_data_offer",
        version: 3,
        data: { offer },
      });
      this.send(deviceId, EV.data_device_data_offer, (b) => b.newId(offerId));
      for (const mime of sel.mimeTypes) {
        this.send(offerId, EV.data_offer_offer, (b) => b.string(mime));
      }
      this.send(deviceId, EV.data_device_selection, (b) => b.object(offerId));
    }
  }

  private handleXdgDecorationManager(opcode: number, r: MessageReader): void {
    if (opcode === OP.xdg_decoration_manager_destroy) {
      // ok
    } else if (opcode === OP.xdg_decoration_manager_get_toplevel_decoration) {
      const id = r.newId();
      const toplevelId = r.object();
      this.objects.set(id, {
        id,
        iface: "zxdg_toplevel_decoration_v1",
        version: 1,
        data: { toplevelId },
      });
      const topObj = this.objects.get(toplevelId);
      const surface = topObj ? this.surfaceFromToplevel(topObj) : null;
      // Compositor preference is SERVER (React SSD). Clients may still
      // set_mode(CLIENT); we honor that to avoid double decorations.
      if (surface) surface.decoration = "server";
      this.send(id, EV.xdg_toplevel_decoration_configure, (b) =>
        b.uint(XDG_DECORATION_MODE_SERVER),
      );
      console.log(
        `[deco] get_toplevel_decoration toplevel=${toplevelId} surface=${surface?.id ?? "?"} → SERVER`,
      );
    }
  }

  private handleXdgToplevelDecoration(
    obj: WlObject,
    opcode: number,
    r: MessageReader,
  ): void {
    if (opcode === OP.xdg_toplevel_decoration_destroy) {
      this.destroyObject(obj.id);
    } else if (opcode === OP.xdg_toplevel_decoration_set_mode) {
      const mode = r.uint();
      const toplevelId = obj.data?.toplevelId as number | undefined;
      const topObj = toplevelId ? this.objects.get(toplevelId) : undefined;
      const surface = topObj ? this.surfaceFromToplevel(topObj) : null;
      if (mode === XDG_DECORATION_MODE_CLIENT) {
        if (surface) surface.decoration = "client";
        this.send(obj.id, EV.xdg_toplevel_decoration_configure, (b) =>
          b.uint(XDG_DECORATION_MODE_CLIENT),
        );
        console.log(
          `[deco] set_mode CLIENT toplevel=${toplevelId} surface=${surface?.id ?? "?"}`,
        );
      } else {
        if (surface) surface.decoration = "server";
        this.send(obj.id, EV.xdg_toplevel_decoration_configure, (b) =>
          b.uint(XDG_DECORATION_MODE_SERVER),
        );
        console.log(
          `[deco] set_mode SERVER toplevel=${toplevelId} surface=${surface?.id ?? "?"}`,
        );
      }
    } else if (opcode === OP.xdg_toplevel_decoration_unset_mode) {
      const toplevelId = obj.data?.toplevelId as number | undefined;
      const topObj = toplevelId ? this.objects.get(toplevelId) : undefined;
      const surface = topObj ? this.surfaceFromToplevel(topObj) : null;
      if (surface) surface.decoration = "server";
      this.send(obj.id, EV.xdg_toplevel_decoration_configure, (b) =>
        b.uint(XDG_DECORATION_MODE_SERVER),
      );
    }
  }

  private handleCompositor(opcode: number, r: MessageReader): void {
    if (opcode === OP.compositor_create_surface) {
      const id = r.newId();
      const surface: SurfaceState = {
        id,
        bufferId: null,
        bufferOffsetX: 0,
        bufferOffsetY: 0,
        frameCallbacks: [],
        mapped: false,
        x: 0,
        y: 0,
        subX: 0,
        subY: 0,
        width: 0,
        height: 0,
        stride: 0,
        title: "",
        pixels: null,
        releaseBuffers: [],
        bufferAttached: false,
        role: "none",
        parentId: null,
        children: [],
        xdgToplevelId: null,
        xdgPopupId: null,
        xdgSurfaceId: null,
        popupRelX: 0,
        popupRelY: 0,
        popupConfW: 0,
        popupConfH: 0,
        popupGrabbed: false,
        geomX: 0,
        geomY: 0,
        geomW: 0,
        geomH: 0,
        maximized: false,
        fullscreen: false,
        minimized: false,
        savedX: 0,
        savedY: 0,
        savedW: 800,
        savedH: 600,
        minW: 0,
        minH: 0,
        maxW: 0,
        maxH: 0,
        decoration: "none",
        xwaylandSerial: null,
        x11Wid: null,
        xwaylandPending: false,
      };
      this.objects.set(id, {
        id,
        iface: "wl_surface",
        version: 4,
        data: { surface },
      });
    } else if (opcode === OP.compositor_create_region) {
      const id = r.newId();
      this.objects.set(id, { id, iface: "wl_region", version: 1 });
    }
  }

  private handleShm(opcode: number, r: MessageReader): void {
    if (opcode !== OP.shm_create_pool) return;
    const id = r.newId();
    const fd = r.fd();
    const size = r.int();
    console.log(`[shm] create_pool id=${id} fd=${fd} size=${size}`);
    const map = mmapShm(fd, size);
    this.objects.set(id, {
      id,
      iface: "wl_shm_pool",
      version: 1,
      data: {
        pool: { fd, size, map, refCount: 0, destroyed: false } satisfies PoolState,
      },
    });
  }

  private handleShmPool(obj: WlObject, opcode: number, r: MessageReader): void {
    if (opcode === OP.shm_pool_create_buffer) {
      const id = r.newId();
      const offset = r.int();
      const width = r.int();
      const height = r.int();
      const stride = r.int();
      const format = r.uint();
      const pool = obj.data!.pool as PoolState;
      pool.refCount++;
      this.objects.set(id, {
        id,
        iface: "wl_buffer",
        version: 1,
        data: {
          buffer: {
            kind: "shm",
            poolId: obj.id,
            pool,
            offset,
            width,
            height,
            stride,
            format,
          } satisfies ShmBufferState,
        },
      });
    } else if (opcode === OP.shm_pool_destroy) {
      const pool = obj.data?.pool as PoolState | undefined;
      if (pool) {
        pool.destroyed = true;
        // Unmap only when no buffers still reference the pool.
        if (pool.refCount <= 0) this.releasePool(pool, true);
      }
      this.objects.delete(obj.id);
      this.send(WL_DISPLAY_ID, EV.display_delete_id, (b) => b.uint(obj.id));
    } else if (opcode === OP.shm_pool_resize) {
      const newSize = r.int();
      const pool = obj.data?.pool as PoolState | undefined;
      if (!pool || newSize <= 0 || !pool.map) return;
      // Client has already ftruncate'd the fd; remap to the new size.
      try {
        munmapShm(pool.map, pool.size);
      } catch {
        // ok
      }
      pool.map = mmapShm(pool.fd, newSize);
      pool.size = newSize;
    }
  }

  private handleXdgToplevel(obj: WlObject, opcode: number, r: MessageReader): void {
    const surface = this.surfaceFromToplevel(obj);
    if (opcode === OP.xdg_toplevel_set_title) {
      const title = r.string() ?? "";
      if (surface) {
        surface.title = title;
        // Rootful Xwayland has no CSD — give it Moire SSD.
        if (surface.decoration === "none" && /^Xwayland\b/i.test(title)) {
          surface.decoration = "server";
        }
      }
    } else if (opcode === OP.xdg_toplevel_set_app_id) {
      r.string();
    } else if (opcode === OP.xdg_toplevel_set_parent) {
      r.object();
    } else if (opcode === OP.xdg_toplevel_show_window_menu) {
      r.object(); // seat
      r.uint(); // serial
      r.int(); // x
      r.int(); // y
    } else if (opcode === OP.xdg_toplevel_move) {
      r.object(); // seat
      r.uint(); // serial
      if (surface) this.server.beginMove(this, surface.id);
    } else if (opcode === OP.xdg_toplevel_resize) {
      r.object(); // seat
      r.uint(); // serial
      const edges = r.uint();
      if (surface) this.server.beginResize(this, surface.id, edges);
    } else if (opcode === OP.xdg_toplevel_set_max_size) {
      const w = r.int();
      const h = r.int();
      if (surface) {
        surface.maxW = Math.max(0, w);
        surface.maxH = Math.max(0, h);
        this.maybeConfigureFixedSize(surface);
      }
    } else if (opcode === OP.xdg_toplevel_set_min_size) {
      const w = r.int();
      const h = r.int();
      if (surface) {
        surface.minW = Math.max(0, w);
        surface.minH = Math.max(0, h);
        this.maybeConfigureFixedSize(surface);
      }
    } else if (opcode === OP.xdg_toplevel_set_maximized) {
      if (surface) this.server.toggleMaximized(this, surface.id, true);
    } else if (opcode === OP.xdg_toplevel_unset_maximized) {
      if (surface) this.server.toggleMaximized(this, surface.id, false);
    } else if (opcode === OP.xdg_toplevel_set_fullscreen) {
      r.object(); // output (nullable — 0)
      if (surface) this.server.toggleFullscreen(this, surface.id, true);
    } else if (opcode === OP.xdg_toplevel_unset_fullscreen) {
      if (surface) this.server.toggleFullscreen(this, surface.id, false);
    } else if (opcode === OP.xdg_toplevel_set_minimized) {
      if (surface) this.server.setMinimized(this, surface.id);
    } else if (opcode === OP.xdg_toplevel_destroy) {
      this.destroyObject(obj.id);
    }
  }

  private surfaceFromToplevel(obj: WlObject): SurfaceState | null {
    const wlSurfaceId = obj.data?.wlSurfaceId as number | undefined;
    if (!wlSurfaceId) return null;
    const surfObj = this.objects.get(wlSurfaceId);
    return (surfObj?.data?.surface as SurfaceState) ?? null;
  }

  private handleSurface(obj: WlObject, opcode: number, r: MessageReader): void {
    const surface = obj.data!.surface as SurfaceState;
    if (opcode === OP.surface_attach) {
      const bufId = r.object();
      surface.bufferOffsetX = r.int();
      surface.bufferOffsetY = r.int();
      surface.bufferId = bufId === 0 ? null : bufId;
      // New attach starts a release cycle; empty re-commits must not
      // wl_buffer.release again (GDK SHM asserts / aborts on double release).
      surface.bufferAttached = true;
      if (bufId) {
        const buf = this.getBuffer(bufId);
        if (buf) {
          surface.width = buf.width;
          surface.height = buf.height;
        }
      }
    } else if (opcode === OP.surface_damage || opcode === OP.surface_damage_buffer) {
      r.int();
      r.int();
      r.int();
      r.int();
    } else if (
      opcode === OP.surface_set_opaque_region ||
      opcode === OP.surface_set_input_region
    ) {
      r.object();
    } else if (opcode === OP.surface_set_buffer_transform) {
      r.int();
    } else if (opcode === OP.surface_set_buffer_scale) {
      r.int();
    } else if (opcode === OP.surface_frame) {
      const cbId = r.newId();
      this.objects.set(cbId, { id: cbId, iface: "wl_callback", version: 1 });
      surface.frameCallbacks.push(cbId);
    } else if (opcode === OP.surface_commit) {
      // xwayland_shell serial is double-buffered — apply on every commit,
      // including the buffer-less association commit from Xwayland.
      for (const o of this.objects.values()) {
        if (
          o.iface === "xwayland_surface_v1" &&
          o.data?.wlSurfaceId === surface.id &&
          o.data.pendingSerial != null
        ) {
          const serial = o.data.pendingSerial as bigint;
          o.data.pendingSerial = null;
          this.server.noteXwaylandSerial(this, surface.id, serial);
        }
      }

      if (surface.bufferId && surface.bufferAttached) {
        const buf = this.getBuffer(surface.bufferId);
        if (!buf) {
          console.error(
            `[surface] commit missing buffer id=${surface.bufferId}`,
          );
          surface.bufferAttached = false;
        } else {
          try {
            if (buf.kind === "shm") {
              const pool = buf.pool;
              if (!pool.map) {
                throw new Error(
                  `shm pool gone poolId=${buf.poolId} buf=${surface.bufferId}`,
                );
              }
              const byteLen = buf.stride * buf.height;
              surface.pixels = copyFromPool(
                pool,
                buf.offset,
                byteLen,
                surface.pixels,
              );
              surface.stride = buf.stride;
              // wl_shm XRGB8888 leaves A=0 — blit skips those pixels.
              if (buf.format === WL_SHM_FORMAT_XRGB8888) {
                forceOpaqueAlpha(surface.pixels);
              }
            } else {
              const snapped = copyFromDmabuf(
                buf,
                this.server.getGbm(),
                surface.pixels,
              );
              surface.pixels = snapped.pixels;
              surface.stride = snapped.stride;
              // DRM XRGB8888 (Xwayland Glamor) same issue — A unused/zero.
              if (buf.format === DRM_FORMAT_XRGB8888) {
                forceOpaqueAlpha(surface.pixels);
              }
            }
            surface.width = buf.width;
            surface.height = buf.height;
            surface.mapped = true;
            if (!surface.releaseBuffers.includes(surface.bufferId)) {
              surface.releaseBuffers.push(surface.bufferId);
            }
            surface.bufferAttached = false;
            // Fallback: if set_serial was missed on the wire but this surface
            // was claimed via xwayland_shell and the XWM has an unpaired serial.
            if (surface.xwaylandPending && surface.xwaylandSerial == null) {
              this.server.tryPairOrphanXwaylandSurface(this, surface.id);
            }
            if (surface.role === "toplevel") {
              // Do not auto-promote none→server. Apps that draw their own
              // chrome without finishing zxdg_decoration (LibreOffice/GTK)
              // would get double titlebars. SSD only after SERVER negotiate
              // (or explicit Xwayland rootful title hack above).
              const firstMap = !this.server.isStacked(this, surface.id);
              this.server.registerToplevel(this, surface.id);
              // Focus / raise only on first map — not every commit.
              // Ends any xdg_popup.grab for this client before keyboard_enter.
              if (firstMap) this.server.focusClient(this, surface.id);
            } else if (surface.role === "popup") {
              this.server.layoutPopup(this, surface);
              this.server.registerPopup(this, surface.id);
              // Nested grab: ensure parent chain is laid out above siblings.
              this.server.raisePopup(this, surface.id);
            }
            if (
              surface.role !== "cursor" &&
              process.env.MOIRE_DEBUG_SURFACE === "1"
            ) {
              console.log(
                `[surface] commit mapped id=${surface.id} ${surface.width}x${surface.height} @ ${surface.x},${surface.y} role=${surface.role} kind=${buf.kind} deco=${surface.decoration} x11=${surface.x11Wid} title=${JSON.stringify(surface.title)}`,
              );
            }
          } catch (err) {
            console.error(`[surface] snapshot failed`, err);
            surface.bufferAttached = false;
          }
        }
      } else if (surface.bufferAttached && !surface.bufferId) {
        // Explicit attach(null) — detach; keep last pixels for now.
        surface.bufferAttached = false;
      }
      // Commits (buffer, frame callback, or xwayland serial) need a composite pass.
      this.server.markDirty();
    } else if (opcode === OP.surface_destroy) {
      if (surface.role === "toplevel") {
        this.server.unregisterToplevel(this, surface.id);
      } else if (surface.role === "popup") {
        this.server.dismissPopup(this, surface.id, false);
      }
      this.finishSurfaceFrame(surface);
      surface.pixels = null;
      this.destroyObject(obj.id);
    }
  }

  private handleXdgWmBase(opcode: number, r: MessageReader): void {
    if (opcode === OP.xdg_wm_base_create_positioner) {
      const id = r.newId();
      this.objects.set(id, {
        id,
        iface: "xdg_positioner",
        version: 3,
        data: { positioner: emptyPositioner() },
      });
    } else if (opcode === OP.xdg_wm_base_get_xdg_surface) {
      const id = r.newId();
      const surfaceId = r.object();
      this.objects.set(id, {
        id,
        iface: "xdg_surface",
        version: 3,
        data: { wlSurfaceId: surfaceId, configured: false },
      });
    } else if (opcode === OP.xdg_wm_base_pong) {
      r.uint();
    } else if (opcode === OP.xdg_wm_base_destroy) {
      // ok
    }
  }

  private handleXdgPositioner(obj: WlObject, opcode: number, r: MessageReader): void {
    const pos = (obj.data?.positioner as PositionerState | undefined) ?? emptyPositioner();
    if (!obj.data) obj.data = {};
    obj.data.positioner = pos;

    if (opcode === OP.xdg_positioner_destroy) {
      this.destroyObject(obj.id);
    } else if (opcode === OP.xdg_positioner_set_size) {
      pos.width = r.int();
      pos.height = r.int();
    } else if (opcode === OP.xdg_positioner_set_anchor_rect) {
      pos.anchorX = r.int();
      pos.anchorY = r.int();
      pos.anchorW = r.int();
      pos.anchorH = r.int();
    } else if (opcode === OP.xdg_positioner_set_anchor) {
      pos.anchor = r.uint();
    } else if (opcode === OP.xdg_positioner_set_gravity) {
      pos.gravity = r.uint();
    } else if (opcode === OP.xdg_positioner_set_constraint_adjustment) {
      pos.constraintAdjustment = r.uint();
    } else if (opcode === OP.xdg_positioner_set_offset) {
      pos.offsetX = r.int();
      pos.offsetY = r.int();
    } else if (opcode === OP.xdg_positioner_set_reactive) {
      // day-0: ignore
    } else if (opcode === OP.xdg_positioner_set_parent_size) {
      r.int();
      r.int();
    } else if (opcode === OP.xdg_positioner_set_parent_configure) {
      r.uint();
    }
  }

  private handleXdgSurface(obj: WlObject, opcode: number, r: MessageReader): void {
    if (opcode === OP.xdg_surface_get_toplevel) {
      const id = r.newId();
      const wlSurfaceId = obj.data!.wlSurfaceId as number;
      this.objects.set(id, {
        id,
        iface: "xdg_toplevel",
        version: 3,
        data: { wlSurfaceId, xdgSurfaceId: obj.id },
      });
      const surface = this.objects.get(wlSurfaceId)?.data?.surface as
        | SurfaceState
        | undefined;
      if (surface) {
        surface.role = "toplevel";
        surface.xdgToplevelId = id;
        surface.xdgSurfaceId = obj.id;
        // Leave decoration "none" until zxdg_decoration negotiates.
        // Clients that never bind get SSD on first map (see surface commit).
        const slot = this.server.allocToplevelSlot();
        surface.x = slot.x;
        surface.y = slot.y;
        // 0×0 = client picks its own size (xdg-shell). A fixed 800×600 hint
        // forced toolkit apps away from their requested geometry.
        this.configureToplevel(surface, 0, 0, [
          XDG_TOPLEVEL_STATE_ACTIVATED,
        ]);
      }
    } else if (opcode === OP.xdg_surface_get_popup) {
      const id = r.newId();
      const parentXdgId = r.object(); // nullable
      const positionerId = r.object();
      const wlSurfaceId = obj.data!.wlSurfaceId as number;
      const parentXdg = parentXdgId
        ? this.objects.get(parentXdgId)
        : undefined;
      const parentWlId = (parentXdg?.data?.wlSurfaceId as number | undefined) ?? null;
      const posObj = this.objects.get(positionerId);
      const posSnap: PositionerState = {
        ...((posObj?.data?.positioner as PositionerState | undefined) ??
          emptyPositioner()),
      };

      this.objects.set(id, {
        id,
        iface: "xdg_popup",
        version: 3,
        data: {
          wlSurfaceId,
          xdgSurfaceId: obj.id,
          parentXdgId,
          parentWlId,
          positioner: posSnap,
        },
      });

      const surface = this.objects.get(wlSurfaceId)?.data?.surface as
        | SurfaceState
        | undefined;
      if (!surface || parentWlId == null) {
        console.warn(
          `[popup] get_popup missing surface/parent popup=${id} parent=${parentXdgId}`,
        );
        return;
      }
      surface.role = "popup";
      surface.xdgPopupId = id;
      surface.xdgSurfaceId = obj.id;
      surface.parentId = parentWlId;
      surface.popupGrabbed = false;
      // Never keep a popup on the toplevel stack (SSD / focus path).
      this.server.unregisterToplevel(this, surface.id);

      const parent = this.surfaceById(parentWlId);
      const kms = this.server.getKmsSize();
      const origin = parent
        ? this.server.windowGeomOrigin(parent)
        : { x: 0, y: 0 };
      const placed = placePopupRelative(
        posSnap,
        kms.width,
        kms.height,
        origin.x,
        origin.y,
      );
      surface.popupRelX = placed.x;
      surface.popupRelY = placed.y;
      surface.popupConfW = placed.w;
      surface.popupConfH = placed.h;
      this.server.layoutPopup(this, surface);
      this.configurePopup(surface, placed.x, placed.y, placed.w, placed.h);
      console.log(
        `[popup] get_popup surface=${wlSurfaceId} parent=${parentWlId} @ ${placed.x},${placed.y} ${placed.w}x${placed.h}`,
      );
    } else if (opcode === OP.xdg_surface_set_window_geometry) {
      const gx = r.int();
      const gy = r.int();
      const gw = r.int();
      const gh = r.int();
      const wlSurfaceId = obj.data?.wlSurfaceId as number | undefined;
      const surface = wlSurfaceId
        ? (this.objects.get(wlSurfaceId)?.data?.surface as SurfaceState | undefined)
        : undefined;
      if (surface) {
        surface.geomX = gx;
        surface.geomY = gy;
        surface.geomW = gw;
        surface.geomH = gh;
        // Keep maximized/fullscreen geometry glued to the output.
        if (surface.maximized || surface.fullscreen) {
          this.server.placeMaximized(surface);
        }
        if (surface.role === "popup") {
          this.server.layoutPopup(this, surface);
        }
      }
    } else if (opcode === OP.xdg_surface_ack_configure) {
      r.uint();
      obj.data!.configured = true;
    } else if (opcode === OP.xdg_surface_destroy) {
      this.destroyObject(obj.id);
    }
  }

  private handleXdgPopup(obj: WlObject, opcode: number, r: MessageReader): void {
    const wlSurfaceId = obj.data?.wlSurfaceId as number | undefined;
    const surface = wlSurfaceId
      ? (this.objects.get(wlSurfaceId)?.data?.surface as SurfaceState | undefined)
      : undefined;

    if (opcode === OP.xdg_popup_destroy) {
      if (surface) {
        this.server.dismissPopup(this, surface.id, false);
        surface.xdgPopupId = null;
        if (surface.role === "popup") surface.role = "none";
      }
      this.destroyObject(obj.id);
    } else if (opcode === OP.xdg_popup_grab) {
      r.object(); // seat
      const serial = r.uint();
      if (!surface) return;
      // Day-0: accept grab leniently (serial from pointer button / enter).
      const last = this.lastInputSerial;
      if (last !== 0 && serial > last) {
        console.warn(
          `[popup] grab serial=${serial} ahead of lastInput=${last} — accepting`,
        );
      }
      surface.popupGrabbed = true;
      this.server.registerPopup(this, surface.id);
      // Keyboard focus on the popup for arrow-key menu navigation.
      this.server.setFocusedSession(this);
      this.keyboardEnter(surface.id);
      console.log(
        `[popup] grab surface=${surface.id} serial=${serial} lastInput=${last}`,
      );
    } else if (opcode === OP.xdg_popup_reposition) {
      const positionerId = r.object();
      const token = r.uint();
      if (!surface) return;
      const posObj = this.objects.get(positionerId);
      const posSnap: PositionerState = {
        ...((posObj?.data?.positioner as PositionerState | undefined) ??
          emptyPositioner()),
      };
      const parent = surface.parentId
        ? this.surfaceById(surface.parentId)
        : null;
      const kms = this.server.getKmsSize();
      const origin = parent
        ? this.server.windowGeomOrigin(parent)
        : { x: 0, y: 0 };
      const placed = placePopupRelative(
        posSnap,
        kms.width,
        kms.height,
        origin.x,
        origin.y,
      );
      surface.popupRelX = placed.x;
      surface.popupRelY = placed.y;
      surface.popupConfW = placed.w;
      surface.popupConfH = placed.h;
      this.server.layoutPopup(this, surface);
      this.send(obj.id, EV.xdg_popup_repositioned, (b) => b.uint(token));
      this.configurePopup(surface, placed.x, placed.y, placed.w, placed.h);
    }
  }

  configurePopup(
    surface: SurfaceState,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void {
    if (surface.xdgPopupId == null || surface.xdgSurfaceId == null) return;
    this.send(surface.xdgPopupId, EV.xdg_popup_configure, (b) => {
      b.int(x).int(y).int(width).int(height);
    });
    const serial = this.serial++;
    this.send(surface.xdgSurfaceId, EV.xdg_surface_configure, (b) =>
      b.uint(serial),
    );
  }

  sendPopupDone(popupId: number): void {
    this.send(popupId, EV.xdg_popup_popup_done, () => {});
  }

  sendCallbackDone(id: number, time: number): void {
    this.send(id, EV.callback_done, (b) => b.uint(time));
  }

  sendBufferRelease(id: number): void {
    this.send(id, EV.buffer_release, () => {});
  }

  deleteId(id: number): void {
    this.objects.delete(id);
    this.send(WL_DISPLAY_ID, EV.display_delete_id, (b) => b.uint(id));
  }

  private allocServerId(): number {
    return this.nextServerId++;
  }

  private handleLinuxDmabuf(opcode: number, r: MessageReader): void {
    if (opcode === OP.linux_dmabuf_destroy) {
      // ok
    } else if (opcode === OP.linux_dmabuf_create_params) {
      const id = r.newId();
      this.objects.set(id, {
        id,
        iface: "zwp_linux_buffer_params_v1",
        version: 4,
        data: {
          params: { planes: [], created: false } satisfies DmabufParamsState,
        },
      });
    } else if (opcode === OP.linux_dmabuf_get_default_feedback) {
      const id = r.newId();
      this.objects.set(id, {
        id,
        iface: "zwp_linux_dmabuf_feedback_v1",
        version: 4,
      });
      this.sendDmabufFeedback(id);
    } else if (opcode === OP.linux_dmabuf_get_surface_feedback) {
      const id = r.newId();
      r.object(); // surface — same tranche for all surfaces for now
      this.objects.set(id, {
        id,
        iface: "zwp_linux_dmabuf_feedback_v1",
        version: 4,
      });
      this.sendDmabufFeedback(id);
    }
  }

  /**
   * Advertise the render-node device + linear AR24/XR24 so Mesa/GTK can
   * open /dev/dri/renderD* for Wayland EGL (without this they get fd=-1).
   */
  private sendDmabufFeedback(feedbackId: number): void {
    const fb = this.server.getDmabufFeedback();
    if (!fb) {
      console.warn("[dmabuf] feedback requested but not configured");
      // Still emit done so the client doesn't hang waiting.
      this.send(feedbackId, EV.linux_dmabuf_feedback_done, () => {});
      return;
    }
    const { device, formatTable } = fb;

    this.send(feedbackId, EV.linux_dmabuf_feedback_format_table, (b) => {
      b.fd(formatTable.fd).uint(formatTable.size);
    });
    this.send(feedbackId, EV.linux_dmabuf_feedback_main_device, (b) => {
      b.array(device.deviceBytes);
    });

    // Single tranche targeting the same device, both table indices.
    this.send(feedbackId, EV.linux_dmabuf_feedback_tranche_target_device, (b) => {
      b.array(device.deviceBytes);
    });
    const indices = Buffer.alloc(DMABUF_FEEDBACK_FORMAT_COUNT * 2);
    for (let i = 0; i < DMABUF_FEEDBACK_FORMAT_COUNT; i++) {
      indices.writeUInt16LE(i, i * 2);
    }
    this.send(feedbackId, EV.linux_dmabuf_feedback_tranche_formats, (b) => {
      b.array(indices);
    });
    this.send(feedbackId, EV.linux_dmabuf_feedback_tranche_flags, (b) => {
      b.uint(0);
    });
    this.send(feedbackId, EV.linux_dmabuf_feedback_tranche_done, () => {});
    this.send(feedbackId, EV.linux_dmabuf_feedback_done, () => {});
    console.log(`[dmabuf] feedback sent id=${feedbackId} device=${device.path}`);
  }

  private handleLinuxBufferParams(
    obj: WlObject,
    opcode: number,
    r: MessageReader,
  ): void {
    const params = obj.data?.params as DmabufParamsState | undefined;
    if (!params) return;

    if (opcode === OP.linux_buffer_params_destroy) {
      if (!params.created) closeDmabufPlanes(params.planes);
      params.planes = [];
      this.destroyObject(obj.id);
      return;
    }

    if (opcode === OP.linux_buffer_params_add) {
      const fd = r.fd();
      const planeIdx = r.uint();
      const offset = r.uint();
      const stride = r.uint();
      const modifierHi = r.uint();
      const modifierLo = r.uint();
      if (params.created) {
        try {
          closeFd(fd);
        } catch {
          // ok
        }
        return;
      }
      // Ensure plane slot exists
      while (params.planes.length <= planeIdx) {
        params.planes.push({
          fd: -1,
          offset: 0,
          stride: 0,
          modifierHi: 0,
          modifierLo: 0,
        });
      }
      const prev = params.planes[planeIdx]!;
      if (prev.fd >= 0) {
        try {
          closeFd(prev.fd);
        } catch {
          // ok
        }
      }
      params.planes[planeIdx] = {
        fd,
        offset,
        stride,
        modifierHi,
        modifierLo,
      };
      return;
    }

    if (
      opcode === OP.linux_buffer_params_create ||
      opcode === OP.linux_buffer_params_create_immed
    ) {
      let bufferId = 0;
      if (opcode === OP.linux_buffer_params_create_immed) {
        bufferId = r.newId();
      }
      const width = r.int();
      const height = r.int();
      const format = r.uint();
      const flags = r.uint();

      const planes = params.planes.filter((p) => p.fd >= 0);
      const ok =
        !params.created &&
        width > 0 &&
        height > 0 &&
        planes.length > 0 &&
        (format === DRM_FORMAT_ARGB8888 || format === DRM_FORMAT_XRGB8888);

      if (!ok) {
        console.warn(
          `[dmabuf] create failed w=${width} h=${height} fmt=0x${format.toString(16)} planes=${planes.length}`,
        );
        if (opcode === OP.linux_buffer_params_create) {
          this.send(obj.id, EV.linux_buffer_params_failed, () => {});
        }
        // create_immed: still register a dead buffer so the client id exists
        if (opcode === OP.linux_buffer_params_create_immed && bufferId) {
          this.objects.set(bufferId, {
            id: bufferId,
            iface: "wl_buffer",
            version: 1,
            data: {
              buffer: {
                kind: "dmabuf",
                width: 0,
                height: 0,
                format,
                flags,
                planes: [],
              } satisfies DmabufBuffer,
            },
          });
        }
        closeDmabufPlanes(planes);
        params.planes = [];
        params.created = true;
        return;
      }

      params.created = true;
      params.planes = []; // ownership moves to buffer

      const buffer: DmabufBuffer = {
        kind: "dmabuf",
        width,
        height,
        format,
        flags,
        planes,
      };

      if (opcode === OP.linux_buffer_params_create) {
        bufferId = this.allocServerId();
        this.objects.set(bufferId, {
          id: bufferId,
          iface: "wl_buffer",
          version: 1,
          data: { buffer },
        });
        this.send(obj.id, EV.linux_buffer_params_created, (b) =>
          b.uint(bufferId),
        );
        console.log(
          `[dmabuf] created buffer=${bufferId} ${width}x${height} fmt=0x${format.toString(16)} planes=${planes.length}`,
        );
      } else {
        this.objects.set(bufferId, {
          id: bufferId,
          iface: "wl_buffer",
          version: 1,
          data: { buffer },
        });
        console.log(
          `[dmabuf] create_immed buffer=${bufferId} ${width}x${height} fmt=0x${format.toString(16)} planes=${planes.length}`,
        );
      }
    }
  }

  private destroyObject(id: number): void {
    const obj = this.objects.get(id);
    if (obj?.iface === "wl_buffer") {
      const buf = obj.data?.buffer as BufferState | undefined;
      if (buf?.kind === "shm") {
        this.releasePool(buf.pool, false);
      } else if (buf?.kind === "dmabuf") {
        closeDmabufPlanes(buf.planes);
        buf.planes = [];
      }
    } else if (obj?.iface === "zwp_linux_buffer_params_v1") {
      const params = obj.data?.params as DmabufParamsState | undefined;
      if (params && !params.created) {
        closeDmabufPlanes(params.planes);
        params.planes = [];
      }
    }
    this.objects.delete(id);
  }

  private sendError(objectId: number, code: number, message: string): void {
    this.send(WL_DISPLAY_ID, EV.display_error, (b) => {
      b.uint(objectId).uint(code).string(message);
    });
  }

  private send(
    objectId: number,
    opcode: number,
    build: (b: MessageBuilder) => void,
  ): void {
    const b = new MessageBuilder();
    build(b);
    const { data, fds } = b.build(objectId, opcode);
    this.conn.send(data, fds);
  }
}

/** True when /proc/<pid>/exe looks like Xwayland. */
function looksLikeXwayland(pid: number | null): boolean {
  if (pid == null || pid <= 0) return false;
  try {
    const exe = fs.readlinkSync(`/proc/${pid}/exe`);
    return /Xwayland/i.test(exe);
  } catch {
    return false;
  }
}
