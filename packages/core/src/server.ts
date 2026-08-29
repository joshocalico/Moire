import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
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
  presentKmsFramebuffer,
  setKmsCursor,
  moveKmsCursor,
  disableKmsCursor,
  openKmsOutput,
  openAdditionalKmsOutput,
  refreshKmsOutputModes,
  setKmsMode,
  switchKmsConnector,
  closeKmsOutput,
  listDrmConnectors,
  watchDrmHotplug,
  type DrmHotplugMonitor,
  type KmsMode,
  type KmsOutput,
  type KmsCursorImage,
  type KmsPresentationFeedback,
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
  createPipe,
  flushMmap,
  GbmDevice,
  LinuxReadinessDispatcher,
} from "@moire/sys";
import { mmapShm, munmapShm, copyFromPool } from "./shm-map";
import {
  desktopBounds,
  horizontalLayout,
  layoutsOverlap,
  normalizeLayoutOrigin,
  outputContainingPoint,
  outputsIntersectingRect,
  outputMembershipDelta,
  replacementOwner,
} from "./display-layout";
import { createCompositorOutputRenderer, type CompositorOutputRenderer } from "./output-renderer";
import type { CompositionLayer, CompositionRect, CompositionScene } from "./composition";
import {
  closeDmabufPlanes,
  copyFromDmabuf,
  type DmabufBuffer,
  type DmabufPlane,
} from "./dmabuf-map";
import {
  createDmabufFormatTableMemfd,
  DMABUF_FEEDBACK_FORMAT_COUNT,
  resolveDrmFeedbackDevice,
  type DrmFeedbackDevice,
} from "./dmabuf-feedback";
import { X11Wm, type XwmWindow } from "./xwm";
import {
  paintWallpaper,
  hexToArgb,
  loadPngFile,
  setWallpaperImagePixels,
  type MoireTheme,
} from "@moire/theme";
import {
  createPrefsWatcher,
  loadRuntimeTheme,
  loadSettings,
  type PrefsWatcher,
} from "@moire/prefs";

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
  presentation_destroy: 0,
  presentation_feedback: 1,
  output_release: 0,
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
  primary_manager_create_source: 0,
  primary_manager_get_device: 1,
  primary_manager_destroy: 2,
  primary_source_offer: 0,
  primary_source_destroy: 1,
  primary_device_set_selection: 0,
  primary_device_destroy: 1,
  primary_offer_receive: 0,
  primary_offer_destroy: 1,
  activation_destroy: 0,
  activation_get_token: 1,
  activation_activate: 2,
  activation_token_set_serial: 0,
  activation_token_set_app_id: 1,
  activation_token_set_surface: 2,
  activation_token_commit: 3,
  fractional_scale_manager_destroy: 0,
  fractional_scale_manager_get: 1,
  fractional_scale_destroy: 0,
  xdg_output_manager_destroy: 0,
  xdg_output_manager_get: 1,
  xdg_output_destroy: 0,
  viewporter_destroy: 0,
  viewporter_get_viewport: 1,
  viewport_destroy: 0,
  viewport_set_source: 1,
  viewport_set_destination: 2,
  cursor_shape_manager_destroy: 0,
  cursor_shape_manager_get_pointer: 1,
  cursor_shape_manager_get_tablet_tool: 2,
  cursor_shape_device_destroy: 0,
  cursor_shape_device_set_shape: 1,
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
  registry_global_remove: 1,
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
  primary_source_send: 0,
  primary_source_cancelled: 1,
  primary_device_data_offer: 0,
  primary_device_selection: 1,
  primary_offer_offer: 0,
  activation_token_done: 0,
  fractional_scale_preferred_scale: 0,
  xdg_output_logical_position: 0,
  xdg_output_logical_size: 1,
  xdg_output_done: 2,
  xdg_output_name: 3,
  xdg_output_description: 4,
  xdg_toplevel_decoration_configure: 0,
  drm_device: 0,
  drm_format: 1,
  drm_authenticated: 2,
  drm_capabilities: 3,
  presentation_clock_id: 0,
  presentation_feedback_sync_output: 0,
  presentation_feedback_presented: 1,
  presentation_feedback_discarded: 2,
} as const;

const WL_SEAT_CAPABILITY_POINTER = 1;
const WL_SEAT_CAPABILITY_KEYBOARD = 2;
const WL_OUTPUT_MODE_CURRENT = 0x1;
const WL_OUTPUT_MODE_PREFERRED = 0x2;
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
function xdgGravityOffset(w: number, h: number, gravity: number): { dx: number; dy: number } {
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
  const anchor = xdgAnchorPoint(pos.anchorX, pos.anchorY, pos.anchorW, pos.anchorH, pos.anchor);
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
  const words = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.byteLength >>> 2);
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
  /** Buffer-space damage accumulated for the next commit. */
  pendingDamage: CompositionRect[];
  /** Buffer-space damage committed but not yet consumed by composition. */
  damage: CompositionRect[];
  /** Feedback objects requested for the next surface commit. */
  pendingPresentationFeedbacks: number[];
  /** Feedback objects attached to the latest unpresented commit. */
  presentationFeedbacks: number[];
  /** Feedback for a frame already composited and awaiting output completion. */
  readyPresentationFeedbacks: number[];
  /** Set when this surface contributed to the frame awaiting scanout. */
  presentationReady: boolean;
  mapped: boolean;
  /** wl_output object ids for which wl_surface.enter has been sent. */
  enteredOutputIds: Set<number>;
  /** Absolute desktop position (computed for subsurfaces). */
  x: number;
  y: number;
  /** Subsurface offset relative to parent. */
  subX: number;
  subY: number;
  width: number;
  height: number;
  /** Physical dimensions of the attached buffer before viewport/buffer scale. */
  bufferWidth: number;
  bufferHeight: number;
  bufferScale: number;
  stride: number;
  title: string;
  appId: string;
  /** CPU snapshot of the last committed buffer (ARGB/XRGB). */
  pixels: Uint8Array | null;
  /** Monotonic content generation for retained renderer texture caches. */
  revision: number;
  /** True when the committed buffer format guarantees every pixel is opaque. */
  opaque: boolean;
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
  maximized: boolean;
};

export type SsdAction =
  | { kind: "drag"; surfaceId: number; clientId: number }
  | { kind: "close"; surfaceId: number; clientId: number }
  | { kind: "maximize"; surfaceId: number; clientId: number }
  | { kind: "minimize"; surfaceId: number; clientId: number };

export type TaskWindowInfo = {
  surfaceId: number;
  clientId: number;
  title: string;
  appId: string;
  focused: boolean;
  minimized: boolean;
};

type ShellRasterSurface = {
  id: string;
  pixels: Uint8Array;
  width: number;
  height: number;
  stride: number;
  revision: number;
  x: number;
  y: number;
};

export type CompositorShell = {
  setPrimaryOutput?(output: { x: number; y: number; width: number; height: number }): void;
  paint(fb: Uint32Array, pitchPx: number, width: number, height: number): void;
  chromeRaster?(width: number, height: number): ShellRasterSurface | null;
  desktopRaster?(width: number, height: number): ShellRasterSurface | null;
  beginSsdFrame?(): void;
  paintSsdWindow?(
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
    window: SsdWindowInfo,
  ): void;
  ssdRaster?(window: SsdWindowInfo): ShellRasterSurface;
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
  /** Hover feedback for visible SSD chrome after compositor occlusion checks. */
  onSsdPointerMotion?(ev: { x: number; y: number; inside: boolean }): boolean;
  onPointerAxis?(ev: { x: number; y: number; deltaY: number }): boolean;
  setTasks?(tasks: TaskWindowInfo[]): void;
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
  paintDesktop?(fb: Uint32Array, pitchPx: number, width: number, height: number): void;
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
  /** Revisioned shell drag preview for retained compositor backends. */
  dragRaster?(cursorX: number, cursorY: number, label: string): ShellRasterSurface | null;
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

type PrimarySelection = {
  sourceSession: ClientSession;
  sourceId: number;
  mimeTypes: string[];
};

type PrimaryOfferState = PrimarySelection & { deviceId: number };

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
    return 1 /* copy */ | 2; /* move */
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

export type DisplayOutput = {
  kms: KmsOutput;
  x: number;
  y: number;
  scale120: number;
  primary: boolean;
};

export type DisplayLayoutRequest = {
  id: string;
  x: number;
  y: number;
  primary: boolean;
  scale120: number;
};

function outputLogicalWidth(output: DisplayOutput): number {
  return Math.max(1, Math.round((output.kms.width * 120) / output.scale120));
}

function outputLogicalHeight(output: DisplayOutput): number {
  return Math.max(1, Math.round((output.kms.height * 120) / output.scale120));
}

export class CompositorServer {
  private socket: WaylandSocketServer | null = null;
  private kms: KmsOutput | null = null;
  /** Active outputs arranged in one logical desktop coordinate space. */
  private outputs: DisplayOutput[] = [];
  private outputStages = new Map<number, Buffer>();
  /** Output crop/scale backend; scene construction remains renderer-neutral. */
  private outputRenderer: CompositorOutputRenderer | null = null;
  private clients = new Set<ClientSession>();
  private running = false;
  private nextGlobalName = 1;
  private globals: { name: number; iface: string; version: number }[] = [];
  private outputGlobalNames: number[] = [];
  private keymap: KeymapMemfd | null = null;
  private evdev: EvdevKeyboard | null = null;
  private pointerDev: EvdevPointer | null = null;
  /** One native readiness worker shared by transport, input, and DRM events. */
  private readiness: LinuxReadinessDispatcher | null = null;
  private focused: ClientSession | null = null;
  private pointerFocus: { session: ClientSession; surfaceId: number } | null = null;
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
  /** Semantic cursor requested through wp_cursor_shape_device_v1. */
  private clientCursorShape: { session: ClientSession; shape: number } | null = null;
  /** Active DRM cursor plane; null keeps cursor rendering in the scene. */
  private hardwareCursor: { connectorId: number; imageKey: string } | null = null;
  private fallbackCursorPixels = new Map<string, Uint8Array>();
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
  private compositeWakeResolver: (() => void) | null = null;
  /** Absolute output cadence; avoids accumulating setTimeout rounding drift. */
  private nextCompositeDeadlineMs = 0;
  /** Bottom → top paint/focus order for mapped toplevels. */
  private stack: { session: ClientSession; surfaceId: number }[] = [];
  /** Stable taskbar order, independent of focus-driven stack reordering. */
  private taskOrder = new Map<string, number>();
  private nextTaskOrder = 1;
  /** Bottom → top mapped xdg_popups (painted/hit above toplevels). */
  private popupStack: { session: ClientSession; surfaceId: number }[] = [];
  private focusedToplevel: { session: ClientSession; surfaceId: number } | null = null;
  private altHeld = false;
  private shiftHeld = false;
  /** CPU staging buffer — paint here, then flushMmap + presentKms. */
  private stage: Buffer | null = null;
  private retainedWallpaper: Buffer | null = null;
  private retainedWallpaperKey = "";
  private retainedWallpaperRevision = 0;
  private readonly retainedEffectPixel = new Uint8Array(4);
  private profileFrames = 0;
  private profileSceneMs = 0;
  private profileWallpaperMs = 0;
  private profileDesktopMs = 0;
  private profileWindowsMs = 0;
  private profileChromeMs = 0;
  private profileTopMs = 0;
  private profileRenderMs = 0;
  private profilePresentMs = 0;
  private profileLastLogMs = 0;
  /** Optional GBM device for dmabuf CPU import (same DRM fd as KMS). */
  private gbm: GbmDevice | null = null;
  /** DRM device advertised via zwp_linux_dmabuf_feedback_v1.main_device. */
  /** Seat-wide clipboard selection. */
  private selection: ClipboardSelection | null = null;
  /** Middle-click primary selection, independent from the clipboard. */
  private primarySelection: PrimarySelection | null = null;
  /** One-shot xdg-activation tokens issued by this compositor. */
  private activationTokens = new Set<string>();
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
  private xwayPendingBySerial = new Map<bigint, { session: ClientSession; surfaceId: number }>();
  /** X11 wid → paired Wayland surface. */
  private xwayByWid = new Map<number, { session: ClientSession; surfaceId: number }>();
  /** Last SSD window list from composite — used for reliable hit-testing. */
  private ssdWindows: SsdWindowInfo[] = [];
  /** Desktop theme (tokens + wallpaper). */
  private theme: MoireTheme = loadRuntimeTheme();
  private prefsWatcher: PrefsWatcher | null = null;
  /** Pending user-visible mode trial; compositor owns rollback independently of Settings. */
  private pendingDisplayMode: {
    previousModeId: string;
    targetModeId: string;
    deadlineMs: number;
    timer: NodeJS.Timeout;
  } | null = null;
  private pendingDisplayLayout: {
    previous: DisplayLayoutRequest[];
    deadlineMs: number;
    timer: NodeJS.Timeout;
  } | null = null;
  /** Kernel DRM events plus a slow reconciliation poll for virtual GPUs. */
  private drmHotplugMonitor: DrmHotplugMonitor | null = null;
  private displayProbeTimer: NodeJS.Timeout | null = null;
  private displayRefreshTimer: NodeJS.Timeout | null = null;
  private lastMissingOutputLogMs = 0;
  private readonly displayChangeListeners = new Set<() => void>();

  constructor(
    private readonly runtimeDir: string,
    private readonly displayName = "wayland-1",
  ) {
    for (const [iface, version] of Object.entries(CORE_GLOBALS)) {
      const name = this.nextGlobalName++;
      this.globals.push({
        name,
        iface,
        version,
      });
      if (iface === "wl_output") this.outputGlobalNames.push(name);
    }
  }

  get socketPath(): string {
    return path.join(this.runtimeDir, this.displayName);
  }

  async start(cardPath?: string): Promise<void> {
    fs.mkdirSync(this.runtimeDir, { recursive: true, mode: 0o700 });
    const displaySettings = loadSettings();
    const requestedMode = process.env.MOIRE_MODE ?? displaySettings.displayMode ?? undefined;
    this.kms = openKmsOutput(cardPath, requestedMode);
    this.readiness = new LinuxReadinessDispatcher("compositor");
    this.outputs = [{ kms: this.kms, x: 0, y: 0, scale120: 120, primary: true }];
    const connected = listDrmConnectors().filter(
      (connector) =>
        connector.cardPath === this.kms!.cardPath &&
        connector.connection === "connected" &&
        connector.connectorId !== this.kms!.connectorId,
    );
    const usedCrtcs = new Set([this.kms.crtcId]);
    for (const connector of connected) {
      try {
        const output = openAdditionalKmsOutput(
          this.kms,
          connector.connectorId,
          requestedMode,
          usedCrtcs,
        );
        usedCrtcs.add(output.crtcId);
        this.outputs.push({ kms: output, x: 0, y: 0, scale120: 120, primary: false });
      } catch (error) {
        console.warn(`[output] could not activate connector ${connector.connectorId}:`, error);
      }
    }
    for (const output of this.outputs) {
      const savedMode = displaySettings.displayOutputs[output.kms.identity.id]?.mode;
      if (savedMode && output.kms.modes.some((mode) => mode.id === savedMode)) {
        setKmsMode(output.kms, savedMode);
      }
    }
    this.rebuildOutputLayout();
    this.applySavedOutputLayout();
    while (this.outputGlobalNames.length < this.outputs.length) {
      const name = this.nextGlobalName++;
      this.outputGlobalNames.push(name);
      this.globals.push({
        name,
        iface: "wl_output",
        version: CORE_GLOBALS.wl_output,
      });
    }
    this.outputRenderer = createCompositorOutputRenderer(this.kms.fd);
    console.log(
      `[renderer] ${this.outputRenderer.id}: ${this.outputRenderer.detail} capabilities=${JSON.stringify(this.outputRenderer.capabilities)}`,
    );
    const bootBg = hexToArgb(this.theme.tokens.bg);
    for (const output of this.outputs) {
      fillKmsColor(output.kms, {
        r: (bootBg >>> 16) & 0xff,
        g: (bootBg >>> 8) & 0xff,
        b: bootBg & 0xff,
      });
    }
    console.log(`[theme] ${this.theme.name} wallpaper=${this.theme.wallpaper.mode}`);
    console.log(
      `[output] layout ${this.outputs.map(({ kms, x, y }) => `${kms.connectorName}:${kms.currentModeId}@${x},${y}`).join(" ")}`,
    );
    try {
      this.drmHotplugMonitor = watchDrmHotplug((event) => {
        if (this.scheduleDisplayRefresh(150)) {
          console.log(`[output] DRM ${event.action}${event.sysname ? ` ${event.sysname}` : ""}`);
        }
      });
      console.log("[output] DRM hotplug monitor ready");
    } catch (error) {
      console.warn("[output] DRM hotplug monitor unavailable:", error);
    }
    this.displayProbeTimer = setInterval(() => this.scheduleDisplayRefresh(0), 2_000);
    this.displayProbeTimer.unref?.();
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

    this.evdev = new EvdevKeyboard(this.readiness);
    this.evdev.on("key", (ev: EvdevKeyEvent) => this.onKey(ev));
    this.evdev.start();

    this.pointerDev = new EvdevPointer(this.readiness);
    this.pointerDev.on("motion", (ev: EvdevPointerMotion) => this.onPointerMotion(ev));
    this.pointerDev.on("absolute", (ev: EvdevPointerAbsolute) => this.onPointerAbsolute(ev));
    this.pointerDev.on("button", (ev: EvdevPointerButton) => this.onPointerButton(ev));
    this.pointerDev.on("axis", (ev: EvdevPointerAxis) => this.onPointerAxis(ev));
    this.pointerDev.start();

    if (this.kms) {
      const desktop = this.getKmsSize();
      this.cursorX = Math.floor(desktop.width / 2);
      this.cursorY = Math.floor(desktop.height / 2);
    }
    this.socket = new WaylandSocketServer(this.socketPath, this.readiness);
    this.socket.on("connection", (conn: WaylandClientConn) => {
      const session = new ClientSession(this, conn, this.nextClientId++);
      this.clients.add(session);
      conn.on("error", (err: Error) => {
        console.warn(`[client] transport error id=${session.clientId}: ${err.message}`);
      });
      conn.on("close", () => {
        // Stop routing to this peer before clearing shared seat state. Both
        // clipboard broadcasts below send immediately, and a disconnected
        // selection owner must never be included in those broadcasts.
        if (!this.clients.delete(session)) return;
        if (this.focused === session) this.focused = null;
        if (this.focusedToplevel?.session === session) this.focusedToplevel = null;
        if (this.pointerFocus?.session === session) this.pointerFocus = null;
        if (this.grab?.session === session) this.grab = null;
        this.clearClientCursor(session);
        if (this.selection?.sourceSession === session) {
          this.clearSelection("cleared");
        }
        if (this.primarySelection?.sourceSession === session) {
          this.clearPrimarySelection("cleared");
        }
        this.stack = this.stack.filter((e) => e.session !== session);
        for (const key of this.taskOrder.keys()) {
          if (key.startsWith(`${session.clientId}:`)) this.taskOrder.delete(key);
        }
        this.popupStack = this.popupStack.filter((e) => e.session !== session);
        for (const [wid, pair] of this.xwayByWid) {
          if (pair.session === session) this.xwayByWid.delete(wid);
        }
        for (const [serial, pair] of this.xwayPendingBySerial) {
          if (pair.session === session) this.xwayPendingBySerial.delete(serial);
        }
        session.destroy();
      });
    });
    this.socket.start();

    console.log(`Wayland display: ${this.displayName}`);
    console.log(`Socket: ${this.socketPath}`);
    console.log(
      `KMS: ${this.outputs.length} output(s), desktop ${this.getKmsSize().width}x${this.getKmsSize().height} on ${this.kms.cardPath}`,
    );
    console.log(`Export: WAYLAND_DISPLAY=${this.displayName} XDG_RUNTIME_DIR=${this.runtimeDir}`);

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
    this.compositeWakeResolver?.();
    this.compositeWakeResolver = null;
    this.drmHotplugMonitor?.stop();
    this.drmHotplugMonitor = null;
    if (this.displayProbeTimer) {
      clearInterval(this.displayProbeTimer);
      this.displayProbeTimer = null;
    }
    if (this.displayRefreshTimer) {
      clearTimeout(this.displayRefreshTimer);
      this.displayRefreshTimer = null;
    }
    if (this.pendingDisplayMode) {
      clearTimeout(this.pendingDisplayMode.timer);
      this.pendingDisplayMode = null;
    }
    if (this.pendingDisplayLayout) {
      clearTimeout(this.pendingDisplayLayout.timer);
      this.pendingDisplayLayout = null;
    }
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
      this.disableHardwareCursor();
      // A direct renderer target may currently be scanned out. Restore each
      // output's durable dumb FB before the renderer unregisters its GBM BOs.
      for (const output of this.outputs) {
        try {
          presentKms(output.kms);
        } catch {
          // best effort during shutdown
        }
      }
      this.outputRenderer?.destroy();
      this.outputRenderer = null;
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
      for (const output of [...this.outputs].reverse()) {
        if (output.kms !== this.kms) closeKmsOutput(output.kms);
      }
      this.outputs = [];
      this.outputStages.clear();
      closeKmsOutput(this.kms);
      this.kms = null;
    }
    this.readiness?.stop();
    this.readiness = null;
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
        pair.session.clearSurfaceOutputs(surf);
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
        pair.session.clearSurfaceOutputs(surf);
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
  noteXwaylandSerial(session: ClientSession, surfaceId: number, serial: bigint): void {
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
  tryPairOrphanXwaylandSurface(session: ClientSession, surfaceId: number): void {
    const surf = session.surfaceById(surfaceId);
    if (!surf || !surf.xwaylandPending || surf.xwaylandSerial != null || surf.x11Wid != null) {
      return;
    }
    const win = this.xwm?.takeUnpairedSerialWindow((wid) => !this.xwayByWid.has(wid)) ?? null;
    if (!win || win.serial == null) return;
    console.warn(`[xwm] orphan pair surface=${surfaceId} ← wid=${win.wid} serial=${win.serial}`);
    this.noteXwaylandSerial(session, surfaceId, win.serial);
  }

  /** XWM-side orphan: serial arrived before/without Wayland set_serial. */
  private claimOrphanXwaylandSurface(serial: bigint, win: XwmWindow): void {
    if (this.xwayByWid.has(win.wid) || this.xwayPendingBySerial.has(serial)) {
      return;
    }
    for (const session of this.clients) {
      for (const surf of session.surfaces()) {
        if (!surf.xwaylandPending || surf.xwaylandSerial != null || surf.x11Wid != null) {
          continue;
        }
        console.warn(`[xwm] claim orphan surface=${surf.id} ← wid=${win.wid} serial=${serial}`);
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

    const undecorated = win.overrideRedirect || X11Wm.isUndecoratedType(win.windowType);
    surf.decoration = undecorated ? "none" : "server";

    const parentPair = win.transientFor != null ? this.xwayByWid.get(win.transientFor) : null;
    const parentSurf = parentPair ? parentPair.session.surfaceById(parentPair.surfaceId) : null;

    // Place transients/dialogs/modals over their parent; otherwise cascade if unset.
    const wantsParentPlace =
      !!parentSurf &&
      parentSurf.mapped &&
      (win.transientFor != null || win.windowType === "dialog" || win.modal);
    if (wantsParentPlace && parentSurf) {
      const parentFrame = this.frameBox(parentSurf);
      const childW = win.width > 0 ? win.width : Math.max(1, surf.width);
      const childH = win.height > 0 ? win.height : Math.max(1, surf.height);
      const frameH = childH + (this.usesSsd(surf) ? SSD_TITLEBAR_H : 0);
      const kms = this.getKmsSize();
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
    const contentY = surf.y + (this.usesSsd(surf) ? SSD_TITLEBAR_H : 0);
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

  private applyXwaylandGeometry(session: ClientSession, surfaceId: number, win: XwmWindow): void {
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

  getDisplayOutputs(): DisplayOutput[] {
    return this.outputs.map((output) => ({ ...output }));
  }

  displayOutputForGlobal(globalName: number): DisplayOutput | null {
    const index = this.outputGlobalNames.indexOf(globalName);
    return index >= 0 ? (this.outputs[index] ?? null) : null;
  }

  private addOutput(output: KmsOutput): void {
    const x = this.outputs.reduce(
      (right, current) => Math.max(right, current.x + current.kms.width),
      0,
    );
    const layout = { kms: output, x, y: 0, scale120: 120, primary: this.outputs.length === 0 };
    this.outputs.push(layout);
    const name = this.nextGlobalName++;
    this.outputGlobalNames.push(name);
    const global = {
      name,
      iface: "wl_output",
      version: CORE_GLOBALS.wl_output,
    };
    this.globals.push(global);
    for (const client of this.clients) client.globalAdded(global);
  }

  private removeOutputAt(index: number): void {
    const [removed] = this.outputs.splice(index, 1);
    if (!removed) return;
    for (const client of this.clients) client.outputRemoved(removed);
    const [globalName] = this.outputGlobalNames.splice(index, 1);
    if (globalName != null) {
      this.globals = this.globals.filter((global) => global.name !== globalName);
      for (const client of this.clients) client.globalRemoved(globalName);
    }
    this.outputStages.delete(removed.kms.connectorId);
    closeKmsOutput(removed.kms);
  }

  private rebuildOutputLayout(): void {
    const placed = horizontalLayout(
      this.outputs.map((output) => ({
        id: String(output.kms.connectorId),
        width: outputLogicalWidth(output),
        height: outputLogicalHeight(output),
      })),
    );
    for (let index = 0; index < this.outputs.length; index++) {
      this.outputs[index]!.x = placed[index]!.x;
      this.outputs[index]!.y = placed[index]!.y;
    }
    this.stage = null;
    this.outputStages.clear();
  }

  private applySavedOutputLayout(): void {
    const saved = loadSettings().displayOutputs;
    if (!saved || Object.keys(saved).length === 0) return;
    let matched = 0;
    for (const output of this.outputs) {
      const item = saved[output.kms.identity.id];
      if (!item) continue;
      output.x = item.x;
      output.y = item.y;
      output.scale120 = item.scale120;
      output.primary = item.primary;
      matched++;
    }
    if (!matched) return;
    if (!this.outputs.some((output) => output.primary)) {
      this.outputs[0]!.primary = true;
    }
    let foundPrimary = false;
    for (const output of this.outputs) {
      if (output.primary && foundPrimary) output.primary = false;
      foundPrimary ||= output.primary;
    }
    const normalized = normalizeLayoutOrigin(
      this.outputs.map((output) => ({
        ...output,
        id: output.kms.identity.id,
        width: outputLogicalWidth(output),
        height: outputLogicalHeight(output),
      })),
    );
    if (layoutsOverlap(normalized)) {
      this.rebuildOutputLayout();
      return;
    }
    normalized.forEach((item, index) => {
      this.outputs[index]!.x = item.x;
      this.outputs[index]!.y = item.y;
    });
  }

  getDisplayLayout(): DisplayLayoutRequest[] {
    return this.outputs.map((output) => ({
      id: output.kms.identity.id,
      x: output.x,
      y: output.y,
      primary: output.primary,
      scale120: output.scale120,
    }));
  }

  beginDisplayLayoutChange(
    requested: readonly DisplayLayoutRequest[],
    timeoutMs = 15_000,
  ): { changed: boolean; deadlineMs: number } {
    if (this.pendingDisplayLayout) this.revertDisplayLayout();
    const previous = this.getDisplayLayout();
    const byId = new Map(requested.map((item) => [item.id, item]));
    if (
      byId.size !== this.outputs.length ||
      this.outputs.some((output) => !byId.has(output.kms.identity.id))
    ) {
      throw new Error("Display layout must include every connected output");
    }
    const arranged = normalizeLayoutOrigin(
      this.outputs.map((output) => {
        const item = byId.get(output.kms.identity.id)!;
        const scale120 = Math.max(120, Math.min(240, Math.round(item.scale120)));
        const logicalWidth = Math.max(1, Math.round((output.kms.width * 120) / scale120));
        const logicalHeight = Math.max(1, Math.round((output.kms.height * 120) / scale120));
        return {
          id: item.id,
          x: Math.round(item.x),
          y: Math.round(item.y),
          width: logicalWidth,
          height: logicalHeight,
          scale120,
        };
      }),
    );
    if (layoutsOverlap(arranged)) throw new Error("Displays cannot overlap");
    const requestedPrimary = requested.filter((item) => item.primary);
    if (requestedPrimary.length !== 1) {
      throw new Error("Choose exactly one primary display");
    }
    let changed = false;
    arranged.forEach((item, index) => {
      const output = this.outputs[index]!;
      const primary = requestedPrimary[0]!.id === item.id;
      changed ||=
        output.x !== item.x ||
        output.y !== item.y ||
        output.primary !== primary ||
        output.scale120 !== item.scale120;
      output.x = item.x;
      output.y = item.y;
      output.primary = primary;
      output.scale120 = item.scale120;
    });
    if (!changed) return { changed: false, deadlineMs: 0 };
    this.publishDisplayGeometry("layout trial");
    const deadlineMs = Date.now() + timeoutMs;
    const timer = setTimeout(() => this.revertDisplayLayout(), timeoutMs);
    timer.unref?.();
    this.pendingDisplayLayout = { previous, deadlineMs, timer };
    return { changed: true, deadlineMs };
  }

  confirmDisplayLayout(): boolean {
    const pending = this.pendingDisplayLayout;
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingDisplayLayout = null;
    return true;
  }

  revertDisplayLayout(): boolean {
    const pending = this.pendingDisplayLayout;
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingDisplayLayout = null;
    const byId = new Map(pending.previous.map((item) => [item.id, item]));
    for (const output of this.outputs) {
      const item = byId.get(output.kms.identity.id);
      if (!item) continue;
      output.x = item.x;
      output.y = item.y;
      output.primary = item.primary;
      output.scale120 = item.scale120;
    }
    this.publishDisplayGeometry("layout reverted");
    return true;
  }

  getKmsSize(): { width: number; height: number } {
    if (this.outputs.length > 0) {
      return desktopBounds(
        this.outputs.map((output) => ({
          id: String(output.kms.connectorId),
          x: output.x,
          y: output.y,
          width: outputLogicalWidth(output),
          height: outputLogicalHeight(output),
        })),
      );
    }
    return {
      width: this.kms?.width ?? 1920,
      height: this.kms?.height ?? 1080,
    };
  }

  listDisplayModes(): KmsMode[] {
    return this.kms?.modes.map((mode) => ({ ...mode })) ?? [];
  }

  currentDisplayMode(): string {
    return this.kms?.currentModeId ?? "";
  }

  displayOutputInfo(): {
    name: string;
    widthMm: number;
    heightMm: number;
  } {
    return {
      name: this.kms?.connectorName ?? "",
      widthMm: this.kms?.physicalWidthMm ?? 0,
      heightMm: this.kms?.physicalHeightMm ?? 0,
    };
  }

  onDisplayChanged(listener: () => void): () => void {
    this.displayChangeListeners.add(listener);
    return () => this.displayChangeListeners.delete(listener);
  }

  /** Reconcile the active connector's live EDID/mode list after hotplug. */
  refreshDisplayOutput(): boolean {
    const owner = this.kms;
    if (!owner) return false;
    const configured = loadSettings().displayMode;
    const topology = listDrmConnectors().filter(
      (connector) => connector.cardPath === owner.cardPath && connector.connection === "connected",
    );
    let changed = false;

    for (let index = this.outputs.length - 1; index >= 0; index--) {
      const entry = this.outputs[index]!;
      const refresh = refreshKmsOutputModes(entry.kms);
      if (!refresh.connected) {
        if (this.outputs.length > 1) {
          if (entry.kms === this.kms) {
            const nextOwner = replacementOwner(this.outputs, index)!;
            entry.kms.ownsFd = false;
            nextOwner.kms.ownsFd = true;
            this.kms = nextOwner.kms;
          }
          console.log(`[output] removed ${entry.kms.connectorName}`);
          this.removeOutputAt(index);
          changed = true;
          continue;
        }

        const replacement = topology.find(
          (connector) => connector.connectorId !== entry.kms.connectorId,
        );
        if (replacement) {
          const previousName = entry.kms.connectorName;
          switchKmsConnector(entry.kms, replacement.connectorId, configured ?? undefined);
          console.log(`[output] connector ${previousName} → ${entry.kms.connectorName}`);
          changed = true;
        } else {
          const now = Date.now();
          if (now - this.lastMissingOutputLogMs >= 10_000) {
            this.lastMissingOutputLogMs = now;
            console.warn(
              `[output] ${entry.kms.connectorName} disconnected; waiting for a connected output on ${entry.kms.cardPath}`,
            );
          }
        }
        continue;
      }

      this.lastMissingOutputLogMs = 0;
      if (!refresh.currentModeAvailable) {
        const nextMode =
          (configured && entry.kms.modes.some((mode) => mode.id === configured)
            ? configured
            : null) ?? refresh.preferredModeId;
        if (nextMode) {
          console.log(
            `[output] ${entry.kms.connectorName} no longer advertises ${entry.kms.currentModeId}; selecting ${nextMode}`,
          );
          setKmsMode(entry.kms, nextMode);
          changed = true;
        }
      } else if (refresh.modesChanged) {
        console.log(
          `[output] refreshed ${entry.kms.connectorName}: ${entry.kms.modes.length} modes`,
        );
        changed = true;
      }
    }

    const activeIds = new Set(this.outputs.map((output) => output.kms.connectorId));
    const usedCrtcs = new Set(this.outputs.map((output) => output.kms.crtcId));
    for (const connector of topology) {
      if (activeIds.has(connector.connectorId)) continue;
      try {
        const output = openAdditionalKmsOutput(
          this.getKms(),
          connector.connectorId,
          configured ?? undefined,
          usedCrtcs,
        );
        usedCrtcs.add(output.crtcId);
        activeIds.add(output.connectorId);
        this.addOutput(output);
        console.log(`[output] added ${output.connectorName} ${output.currentModeId}`);
        changed = true;
      } catch (error) {
        console.warn(`[output] could not activate connector ${connector.connectorId}:`, error);
      }
    }

    if (!changed) return false;
    if (this.pendingDisplayMode) {
      clearTimeout(this.pendingDisplayMode.timer);
      this.pendingDisplayMode = null;
    }
    if (this.pendingDisplayLayout) {
      clearTimeout(this.pendingDisplayLayout.timer);
      this.pendingDisplayLayout = null;
    }
    this.rebuildOutputLayout();
    this.applySavedOutputLayout();
    this.publishDisplayGeometry(
      `layout ${this.outputs.map((output) => output.kms.connectorName).join(" + ")}`,
    );
    return true;
  }

  private scheduleDisplayRefresh(delayMs: number): boolean {
    if (!this.running || this.displayRefreshTimer) return false;
    this.displayRefreshTimer = setTimeout(() => {
      this.displayRefreshTimer = null;
      try {
        this.refreshDisplayOutput();
      } catch (error) {
        console.error("[output] connector refresh failed:", error);
      }
    }, delayMs);
    this.displayRefreshTimer.unref?.();
    return true;
  }

  private notifyDisplayChanged(): void {
    for (const listener of this.displayChangeListeners) {
      try {
        listener();
      } catch (error) {
        console.error("[output] display-change listener failed:", error);
      }
    }
  }

  /** Switch the physical output and publish the new logical desktop size. */
  setDisplayMode(modeId: string): boolean {
    const kms = this.kms;
    if (!kms) throw new Error("KMS not started");
    const changed = setKmsMode(kms, modeId);
    if (!changed) return false;

    this.rebuildOutputLayout();
    this.publishDisplayGeometry(`mode ${modeId}`);
    return true;
  }

  private publishDisplayGeometry(description: string): void {
    const kms = this.getKmsSize();
    this.stage = null;
    this.cursorX = Math.max(0, Math.min(kms.width - 1, this.cursorX));
    this.cursorY = Math.max(0, Math.min(kms.height - 1, this.cursorY));
    for (const client of this.clients) client.outputChanged();
    for (const entry of this.stack) {
      const surf = entry.session.surfaceById(entry.surfaceId);
      if (!surf || surf.role !== "toplevel") continue;
      if (surf.fullscreen) {
        const output = this.outputForSurface(surf);
        surf.x = output.x;
        surf.y = output.y;
        entry.session.configureToplevel(
          surf,
          outputLogicalWidth(output),
          outputLogicalHeight(output),
          [
            XDG_TOPLEVEL_STATE_FULLSCREEN,
            ...(this.focusedToplevel?.session === entry.session &&
            this.focusedToplevel.surfaceId === surf.id
              ? [XDG_TOPLEVEL_STATE_ACTIVATED]
              : []),
          ],
        );
      } else if (surf.maximized) {
        const output = this.outputForSurface(surf);
        surf.x = output.x;
        surf.y = output.y;
        const contentH = this.usesSsd(surf)
          ? Math.max(
              100,
              outputLogicalHeight(output) - (output.primary ? SSD_PANEL_H : 0) - SSD_TITLEBAR_H,
            )
          : outputLogicalHeight(output);
        entry.session.configureToplevel(surf, outputLogicalWidth(output), contentH, [
          XDG_TOPLEVEL_STATE_MAXIMIZED,
          ...(this.focusedToplevel?.session === entry.session &&
          this.focusedToplevel.surfaceId === surf.id
            ? [XDG_TOPLEVEL_STATE_ACTIVATED]
            : []),
        ]);
      } else {
        const w = surf.geomW > 0 ? surf.geomW : surf.width;
        const h = surf.geomH > 0 ? surf.geomH : surf.height;
        const maxContentH = this.usesSsd(surf)
          ? Math.max(100, kms.height - SSD_PANEL_H - SSD_TITLEBAR_H)
          : Math.max(100, kms.height - SSD_PANEL_H);
        const nextW = Math.min(w, kms.width);
        const nextH = Math.min(h, maxContentH);
        if (nextW !== w || nextH !== h) {
          const states =
            this.focusedToplevel?.session === entry.session &&
            this.focusedToplevel.surfaceId === surf.id
              ? [XDG_TOPLEVEL_STATE_ACTIVATED]
              : [];
          entry.session.configureToplevel(surf, nextW, nextH, states);
        }
        const chromeH = this.usesSsd(surf) ? SSD_TITLEBAR_H : 0;
        const maxY = Math.max(0, kms.height - SSD_PANEL_H - chromeH - nextH);
        surf.x = Math.max(0, Math.min(Math.max(0, kms.width - nextW), surf.x));
        surf.y = Math.max(0, Math.min(maxY, surf.y));
      }
    }
    this.shell?.invalidateChrome?.();
    console.log(`[output] ${description} → ${kms.width}x${kms.height}`);
    this.notifyDisplayChanged();
    this.markDirty();
  }

  beginDisplayModeChange(
    modeId: string,
    timeoutMs = 15_000,
  ): { changed: boolean; deadlineMs: number } {
    if (this.pendingDisplayMode) this.revertDisplayMode();
    const previousModeId = this.currentDisplayMode();
    const changed = this.setDisplayMode(modeId);
    if (!changed) return { changed: false, deadlineMs: 0 };
    const deadlineMs = Date.now() + timeoutMs;
    const timer = setTimeout(() => {
      console.warn(`[output] mode ${modeId} was not confirmed; reverting to ${previousModeId}`);
      try {
        this.revertDisplayMode();
      } catch (error) {
        console.error("[output] automatic mode rollback failed:", error);
      }
    }, timeoutMs);
    timer.unref?.();
    this.pendingDisplayMode = {
      previousModeId,
      targetModeId: modeId,
      deadlineMs,
      timer,
    };
    return { changed: true, deadlineMs };
  }

  confirmDisplayMode(): string | null {
    const pending = this.pendingDisplayMode;
    if (!pending) return null;
    clearTimeout(pending.timer);
    this.pendingDisplayMode = null;
    console.log(`[output] confirmed mode ${pending.targetModeId}`);
    return pending.targetModeId;
  }

  revertDisplayMode(): boolean {
    const pending = this.pendingDisplayMode;
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingDisplayMode = null;
    const changed = this.setDisplayMode(pending.previousModeId);
    console.log(`[output] reverted mode to ${pending.previousModeId}`);
    return changed;
  }

  pendingDisplayModeChange(): {
    previousModeId: string;
    targetModeId: string;
    deadlineMs: number;
  } | null {
    const pending = this.pendingDisplayMode;
    if (!pending) return null;
    return {
      previousModeId: pending.previousModeId,
      targetModeId: pending.targetModeId,
      deadlineMs: pending.deadlineMs,
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

  setSelection(sourceSession: ClientSession, sourceId: number | null, _serial: number): void {
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
    if (prev && (prev.sourceSession !== sourceSession || prev.sourceId !== sourceId)) {
      prev.sourceSession.sendDataSourceCancelled(prev.sourceId);
    }
    this.selection = { sourceSession, sourceId, mimeTypes: [...mimes] };
    console.log(`[clipboard] selection set source=${sourceId} mimes=${mimes.join(",")}`);
    for (const c of this.clients) c.sendSelection(this.selection);
  }

  getSelection(): ClipboardSelection | null {
    return this.selection;
  }

  clearPrimarySelection(reason: "cancelled" | "cleared" = "cancelled"): void {
    const previous = this.primarySelection;
    this.primarySelection = null;
    if (previous && reason === "cancelled") {
      previous.sourceSession.sendPrimarySourceCancelled(previous.sourceId);
    }
    for (const client of this.clients) client.sendPrimarySelection(null);
  }

  setPrimarySelection(
    sourceSession: ClientSession,
    sourceId: number | null,
    _serial: number,
  ): void {
    if (!sourceId) {
      this.clearPrimarySelection();
      return;
    }
    const mimeTypes = sourceSession.primarySourceMimes(sourceId);
    if (!mimeTypes) return;
    const previous = this.primarySelection;
    if (previous && (previous.sourceSession !== sourceSession || previous.sourceId !== sourceId)) {
      previous.sourceSession.sendPrimarySourceCancelled(previous.sourceId);
    }
    this.primarySelection = {
      sourceSession,
      sourceId,
      mimeTypes: [...mimeTypes],
    };
    for (const client of this.clients) {
      client.sendPrimarySelection(this.primarySelection);
    }
  }

  getPrimarySelection(): PrimarySelection | null {
    return this.primarySelection;
  }

  forwardPrimarySelectionReceive(mime: string, fd: number): void {
    const selection = this.primarySelection;
    if (!selection) {
      try {
        closeFd(fd);
      } catch {
        // ok
      }
      return;
    }
    selection.sourceSession.sendPrimarySourceSend(selection.sourceId, mime, fd);
  }

  issueActivationToken(): string {
    const token = `moire-${randomUUID()}`;
    this.activationTokens.add(token);
    return token;
  }

  activateWithToken(token: string, session: ClientSession, surfaceId: number): void {
    if (!this.activationTokens.delete(token)) return;
    const surface = session.toplevelFor(surfaceId);
    if (!surface?.mapped || surface.role !== "toplevel") return;
    this.focusClient(session, surface.id);
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
      press?.session === sourceSession && press.serial === serial ? press.x : this.cursorX;
    const startY =
      press?.session === sourceSession && press.serial === serial ? press.y : this.cursorY;
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
        hit.surface.role === "toplevel" && this.usesSsd(hit.surface) ? SSD_TITLEBAR_H : 0;
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
      this.shell?.onDesktopDragHover?.(this.cursorX, this.cursorY, drag.mimeTypes);
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
          hit.surface.role === "toplevel" && this.usesSsd(hit.surface) ? SSD_TITLEBAR_H : 0;
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
        console.log(`[dnd] enter surface=${hit.surface.id} client=${hit.session.clientId}`);
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
      console.log(`[dnd] drop surface=${target.surfaceId} client=${target.session.clientId}`);
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
            console.warn(
              "[dnd] desktop-drop readDndData returned null — nothing was read from the source",
            );
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
          const accepted = uris.length > 0 && shell.acceptDesktopDrop!(uris, dropX, dropY);
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

  private readDndData(drag: DragSession, mime: string, cb: (data: Buffer | null) => void): void {
    try {
      const O_CLOEXEC_FLAG = 0o2000000;
      const [readFd, writeFd] = createPipe(O_CLOEXEC_FLAG);
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
    return this.stack.some((e) => e.session === session && e.surfaceId === surfaceId);
  }

  registerToplevel(session: ClientSession, surfaceId: number): void {
    if (this.isStacked(session, surfaceId)) return;
    this.stack.push({ session, surfaceId });
    const key = `${session.clientId}:${surfaceId}`;
    if (!this.taskOrder.has(key)) this.taskOrder.set(key, this.nextTaskOrder++);
    this.markDirty();
  }

  /** Keep a newly mapped native toplevel reachable on the current output. */
  fitToplevelToOutput(session: ClientSession, surfaceId: number): void {
    const surf = session.surfaceById(surfaceId);
    if (!surf || surf.role !== "toplevel") return;
    const output = this.outputForSurface(surf);
    const width = outputLogicalWidth(output);
    const height = outputLogicalHeight(output);
    const panelH = output.primary ? SSD_PANEL_H : 0;
    const w = surf.geomW > 0 ? surf.geomW : surf.width;
    const h = surf.geomH > 0 ? surf.geomH : surf.height;
    const chromeH = this.usesSsd(surf) ? SSD_TITLEBAR_H : 0;
    const maxContentH = Math.max(100, height - panelH - chromeH);
    const nextW = Math.min(w, width);
    const nextH = Math.min(h, maxContentH);
    if (nextW !== w || nextH !== h) {
      session.configureToplevel(surf, nextW, nextH, [XDG_TOPLEVEL_STATE_ACTIVATED]);
    }
    surf.x = Math.max(output.x, Math.min(output.x + width - nextW, surf.x));
    surf.y = Math.max(
      0,
      Math.min(Math.max(output.y, output.y + height - panelH - chromeH - nextH), surf.y),
    );
  }

  unregisterToplevel(session: ClientSession, surfaceId: number): void {
    this.stack = this.stack.filter((e) => !(e.session === session && e.surfaceId === surfaceId));
    this.taskOrder.delete(`${session.clientId}:${surfaceId}`);
    if (this.focusedToplevel?.session === session && this.focusedToplevel.surfaceId === surfaceId) {
      this.focusedToplevel = null;
    }
    this.markDirty();
  }

  registerPopup(session: ClientSession, surfaceId: number): void {
    if (this.popupStack.some((e) => e.session === session && e.surfaceId === surfaceId)) {
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

  dismissPopup(session: ClientSession, surfaceId: number, sendDone = true): void {
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
    session.clearSurfaceOutputs(surf);
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
      this.focusedToplevel.session.keyboardEnter(this.focusedToplevel.surfaceId);
    }
  }

  /** Dismiss every popup for a client (grabbed or not), top-first. */
  dismissSessionPopups(session: ClientSession): void {
    const mine = [...this.popupStack].reverse().filter((e) => e.session === session);
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
    this.stack = this.stack.filter((e) => !(e.session === session && e.surfaceId === surfaceId));
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
        console.log(`[popup] dismiss grabs before focus toplevel=${topId}`);
        this.dismissGrabbedPopups(session);
      }
    }

    const already =
      this.focusedToplevel?.session === session && this.focusedToplevel.surfaceId === topId;

    if (!already && this.focusedToplevel) {
      const prev = this.focusedToplevel.session.surfaceById(this.focusedToplevel.surfaceId);
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

  private sendToplevelStates(session: ClientSession, surf: SurfaceState, activated: boolean): void {
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
    const wasFocused =
      this.focusedToplevel?.session === session && this.focusedToplevel.surfaceId === surfaceId;
    if (wasFocused) {
      this.focusedToplevel = null;
      if (this.focused === session) {
        this.focused.keyboardLeave();
        this.focused = null;
      }
    }
    console.log(`[wm] minimized surface=${surfaceId}`);
    if (wasFocused) {
      const next = [...this.stack].reverse().find((entry) => {
        const candidate = entry.session.surfaceById(entry.surfaceId);
        return candidate?.mapped && candidate.role === "toplevel" && !candidate.minimized;
      });
      if (next) this.focusClient(next.session, next.surfaceId);
      else this.xwm?.setActiveWindow(null);
    }
    this.markDirty();
  }

  restoreToplevel(session: ClientSession, surfaceId: number): void {
    const surf = session.surfaceById(surfaceId);
    if (!surf || surf.role !== "toplevel") return;
    surf.minimized = false;
    this.focusClient(session, surfaceId);
    console.log(`[wm] restored surface=${surfaceId}`);
  }

  /** Taskbar activation: restore, focus, or minimize the selected toplevel. */
  toggleTask(clientId: number, surfaceId: number): void {
    const entry = this.stack.find(
      (candidate) => candidate.session.clientId === clientId && candidate.surfaceId === surfaceId,
    );
    if (!entry) return;
    const surf = entry.session.surfaceById(surfaceId);
    if (!surf?.mapped || surf.role !== "toplevel") return;
    const focused =
      this.focusedToplevel?.session === entry.session &&
      this.focusedToplevel.surfaceId === surfaceId;
    if (surf.minimized) this.restoreToplevel(entry.session, surfaceId);
    else if (focused) this.setMinimized(entry.session, surfaceId);
    else this.focusClient(entry.session, surfaceId);
  }

  private collectTaskWindows(): TaskWindowInfo[] {
    return this.stack
      .map((entry) => {
        const surf = entry.session.surfaceById(entry.surfaceId);
        if (!surf?.mapped || surf.role !== "toplevel") return null;
        return {
          surfaceId: surf.id,
          clientId: entry.session.clientId,
          title: surf.title || surf.appId || "Window",
          appId: surf.appId,
          focused:
            this.focusedToplevel?.session === entry.session &&
            this.focusedToplevel.surfaceId === surf.id,
          minimized: surf.minimized,
          order:
            this.taskOrder.get(`${entry.session.clientId}:${surf.id}`) ?? Number.MAX_SAFE_INTEGER,
        };
      })
      .filter((task): task is TaskWindowInfo & { order: number } => task !== null)
      .sort((a, b) => a.order - b.order)
      .map(({ order: _order, ...task }) => task);
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
    if (ev.code === KEY_ESC && ev.value === 1 && (this.drag || this.shell?.desktopDragLabel?.())) {
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
    const kms = this.getKmsSize();
    const nx = Math.max(0, Math.min(kms.width - 1, this.cursorX + ev.dx));
    const ny = Math.max(0, Math.min(kms.height - 1, this.cursorY + ev.dy));
    const moved = nx !== this.cursorX || ny !== this.cursorY;
    this.cursorX = nx;
    this.cursorY = ny;
    if (moved) {
      const cursorPlaneActive = this.syncHardwareCursor();
      // A hardware cursor can move without repainting the scene, but drag
      // previews remain compositor layers and must track every motion.
      if (!cursorPlaneActive || this.drag || this.shell?.desktopDragLabel?.()) {
        this.markDirty();
      }
    }
    if (this.drag) {
      this.updateSsdPointerHover(false);
      this.updateDragFocus(ev.timeMs);
      return;
    }
    if (this.applyGrab()) {
      this.updateSsdPointerHover(false);
      this.markDirty();
      return;
    }
    // Check before updatePointerFocus so a client the pointer just entered
    // never sees a stray hover enter/motion ahead of the DnD enter.
    // (startDesktopDrag already runs updateDragFocus once for this position.)
    if (this.maybeEscalateDesktopDrag()) {
      this.updateSsdPointerHover(false);
      return;
    }
    const popupHit = this.hitTestPopup(this.cursorX, this.cursorY);
    if (popupHit || this.hasGrabbedPopup()) {
      this.updateSsdPointerHover(false);
      this.updatePointerFocus(ev.timeMs, true, popupHit);
      return;
    }
    const shellHandled = this.shell?.onPointerMotion?.({
      x: this.cursorX,
      y: this.cursorY,
    });
    if (shellHandled) {
      this.updateSsdPointerHover(false);
      this.clearPointerFocusForShellOverlay();
      return;
    }
    if (this.updateSsdPointerHover(true)) {
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
    const kms = this.getKmsSize();
    const nx = Math.max(0, Math.min(kms.width - 1, Math.round(ev.x * (kms.width - 1))));
    const ny = Math.max(0, Math.min(kms.height - 1, Math.round(ev.y * (kms.height - 1))));
    const moved = nx !== this.cursorX || ny !== this.cursorY;
    this.cursorX = nx;
    this.cursorY = ny;
    if (moved) {
      const cursorPlaneActive = this.syncHardwareCursor();
      if (!cursorPlaneActive || this.drag || this.shell?.desktopDragLabel?.()) {
        this.markDirty();
      }
    }
    if (this.drag) {
      this.updateSsdPointerHover(false);
      this.updateDragFocus(ev.timeMs);
      return;
    }
    if (this.applyGrab()) {
      this.updateSsdPointerHover(false);
      this.markDirty();
      return;
    }
    // Check before updatePointerFocus so a client the pointer just entered
    // never sees a stray hover enter/motion ahead of the DnD enter.
    // (startDesktopDrag already runs updateDragFocus once for this position.)
    if (this.maybeEscalateDesktopDrag()) {
      this.updateSsdPointerHover(false);
      return;
    }
    const popupHit = this.hitTestPopup(this.cursorX, this.cursorY);
    if (popupHit || this.hasGrabbedPopup()) {
      this.updateSsdPointerHover(false);
      this.updatePointerFocus(ev.timeMs, true, popupHit);
      return;
    }
    const shellHandled = this.shell?.onPointerMotion?.({
      x: this.cursorX,
      y: this.cursorY,
    });
    if (shellHandled) {
      this.updateSsdPointerHover(false);
      this.clearPointerFocusForShellOverlay();
      return;
    }
    if (this.updateSsdPointerHover(true)) {
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

  /** Update SSD hover only after compositor z-order says the chrome is visible. */
  private updateSsdPointerHover(allowHit: boolean): boolean {
    if (!this.shell?.onSsdPointerMotion) return false;
    const inside = allowHit && this.hitVisibleSsd(this.cursorX, this.cursorY) != null;
    return this.shell.onSsdPointerMotion({
      x: this.cursorX,
      y: this.cursorY,
      inside,
    });
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
      const surf = this.focusedToplevel.session.surfaceById(this.focusedToplevel.surfaceId);
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
    // SSD chrome is painted in its window's stack slot, so a newer client
    // surface can occlude it. Match that paint order for input: an obscured
    // titlebar must never drag, close, or resize through the surface above it.
    if (ev.value === 1 && !popupHit) {
      const action = this.hitVisibleSsd(this.cursorX, this.cursorY);
      if (action) {
        if (this.hasGrabbedPopup()) this.dismissGrabbedPopups();
        this.handleSsdAction(action);
        return;
      }
    }

    this.updatePointerFocus(ev.timeMs, false, popupHit || popupGrabbed ? popupHit : undefined);
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
      (e) => e.surfaceId === action.surfaceId && e.session.clientId === action.clientId,
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
      const closeX0 = w.contentW - SSD_TITLEBAR_BTN_PAD - SSD_TITLEBAR_BTN;
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

  /**
   * Resolve SSD input in the same interleaved order used by composite():
   * each window's client buffers, then its titlebar, bottom → top. A client
   * surface only occludes titlebars in lower stack slots; content underneath
   * the candidate titlebar must never veto it.
   */
  private hitVisibleSsd(x: number, y: number): SsdAction | null {
    this.ssdWindows = this.collectSsdWindows();
    const action = this.hitSsd(x, y);
    if (!action) return null;
    const candidateIndex = this.stack.findIndex(
      (entry) => entry.surfaceId === action.surfaceId && entry.session.clientId === action.clientId,
    );
    if (candidateIndex < 0) return null;
    for (let i = this.stack.length - 1; i > candidateIndex; i--) {
      if (this.hitTestStackEntry(this.stack[i]!, x, y)) return null;
    }
    return action;
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
        maximized: surf.maximized,
      });
    }
    return windows;
  }

  private onPointerAxis(ev: EvdevPointerAxis): void {
    if (
      !this.hitTestPopup(this.cursorX, this.cursorY) &&
      this.shell?.onPointerAxis?.({
        x: this.cursorX,
        y: this.cursorY,
        deltaY: ev.value,
      })
    ) {
      return;
    }
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
    let next = 0;
    if (this.grab?.kind === "resize") {
      next = this.grab.edges;
    } else if (!this.grab) {
      const hit = this.hitTest(this.cursorX, this.cursorY);
      const top = hit ? hit.session.toplevelFor(hit.surface.id) : null;
      if (top && !top.maximized && !top.fullscreen) {
        next = this.resizeEdgesAt(top, this.cursorX, this.cursorY);
      }
    }
    if (next === this.hoverEdges) return;
    this.hoverEdges = next;
    if (!this.syncHardwareCursor()) this.markDirty();
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
        g.session.configureToplevel(surf, gw, gh, [XDG_TOPLEVEL_STATE_ACTIVATED]);
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
      this.xwm?.configureWindow(surf.x11Wid, surf.x, contentY, size.w, size.h);
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
    const kms = this.getKmsSize();
    if (!g) return false;
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
  outputForSurface(surf: SurfaceState): DisplayOutput {
    const frame = this.frameBox(surf);
    const centerX = frame.x + frame.w / 2;
    const centerY = frame.y + frame.h / 2;
    return (
      outputContainingPoint(
        this.outputs.map((output) => ({
          id: String(output.kms.connectorId),
          x: output.x,
          y: output.y,
          width: outputLogicalWidth(output),
          height: outputLogicalHeight(output),
          output,
        })),
        centerX,
        centerY,
      )?.output ??
      this.outputs.find((output) => output.primary) ??
      this.outputs[0]!
    );
  }

  placeMaximized(surf: SurfaceState): DisplayOutput {
    const output = this.outputForSurface(surf);
    this.setGeometryPosition(surf, output.x, output.y);
    return output;
  }

  toggleMaximized(session: ClientSession, surfaceId: number, want: boolean): void {
    const surf = session.surfaceById(surfaceId);
    if (!surf || surf.role !== "toplevel") return;
    if (want && !surf.maximized) {
      const frame = this.frameBox(surf);
      const size = this.contentSize(surf);
      surf.savedX = frame.x;
      surf.savedY = frame.y;
      surf.savedW = size.w;
      surf.savedH = size.h;
      surf.maximized = true;
      surf.fullscreen = false;
      const output = this.placeMaximized(surf);
      const width = outputLogicalWidth(output);
      const height = outputLogicalHeight(output);
      const contentH = this.usesSsd(surf)
        ? Math.max(100, height - (output.primary ? SSD_PANEL_H : 0) - SSD_TITLEBAR_H)
        : height;
      session.configureToplevel(surf, width, contentH, [
        XDG_TOPLEVEL_STATE_MAXIMIZED,
        XDG_TOPLEVEL_STATE_ACTIVATED,
      ]);
    } else if (!want && surf.maximized) {
      surf.maximized = false;
      this.setGeometryPosition(surf, surf.savedX, surf.savedY);
      session.configureToplevel(surf, surf.savedW, surf.savedH, [XDG_TOPLEVEL_STATE_ACTIVATED]);
    }
  }

  toggleFullscreen(session: ClientSession, surfaceId: number, want: boolean): void {
    const surf = session.surfaceById(surfaceId);
    if (!surf || surf.role !== "toplevel") return;
    if (want && !surf.fullscreen) {
      if (!surf.maximized) {
        surf.savedX = surf.x + surf.geomX;
        surf.savedY = surf.y + surf.geomY;
        surf.savedW = surf.geomW > 0 ? surf.geomW : surf.width;
        surf.savedH = surf.geomH > 0 ? surf.geomH : surf.height;
      }
      surf.fullscreen = true;
      const output = this.placeMaximized(surf);
      session.configureToplevel(surf, outputLogicalWidth(output), outputLogicalHeight(output), [
        XDG_TOPLEVEL_STATE_FULLSCREEN,
        XDG_TOPLEVEL_STATE_ACTIVATED,
      ]);
    } else if (!want && surf.fullscreen) {
      surf.fullscreen = false;
      if (surf.maximized) {
        const output = this.placeMaximized(surf);
        session.configureToplevel(
          surf,
          outputLogicalWidth(output),
          Math.max(
            100,
            outputLogicalHeight(output) -
              (output.primary ? SSD_PANEL_H : 0) -
              (this.usesSsd(surf) ? SSD_TITLEBAR_H : 0),
          ),
          [XDG_TOPLEVEL_STATE_MAXIMIZED, XDG_TOPLEVEL_STATE_ACTIVATED],
        );
      } else {
        this.setGeometryPosition(surf, surf.savedX, surf.savedY);
        session.configureToplevel(surf, surf.savedW, surf.savedH, [XDG_TOPLEVEL_STATE_ACTIVATED]);
      }
    }
  }

  /** Topmost mapped surface under the cursor (last in stack wins). */
  private hitTest(x: number, y: number): { session: ClientSession; surface: SurfaceState } | null {
    // Popups sit above all toplevels.
    const popup = this.hitTestPopup(x, y);
    if (popup) return popup;

    // Walk top → bottom so the raised window wins.
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const entry = this.stack[i]!;
      const hit = this.hitTestStackEntry(entry, x, y);
      if (hit) return hit;
    }
    return null;
  }

  /** Hit only one toplevel stack slot, preserving its internal paint order. */
  private hitTestStackEntry(
    entry: { session: ClientSession; surfaceId: number },
    x: number,
    y: number,
  ): { session: ClientSession; surface: SurfaceState } | null {
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
          if (x >= cx && y >= cy && x < cx + size.w && y < cy + size.h) {
            return { session: entry.session, surface: surf };
          }
          continue;
        }
        const frame = this.frameBox(surf);
        if (x >= frame.x && y >= frame.y && x < frame.x + frame.w && y < frame.y + frame.h) {
          return { session: entry.session, surface: surf };
        }
        continue;
      }
      // Subsurfaces: full buffer bounds.
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
      if (x >= surf.x && y >= surf.y && x < surf.x + surf.width && y < surf.y + surf.height) {
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
    const hit = forcedHit === undefined ? this.hitTest(this.cursorX, this.cursorY) : forcedHit;
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
        hit.surface.role === "toplevel" && this.usesSsd(hit.surface) ? SSD_TITLEBAR_H : 0;
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
    let changed = false;
    const cc = this.clientCursor;
    if (cc && (!session || cc.session === session)) {
      const prev = cc.session.surfaceById(cc.surfaceId);
      if (prev?.role === "cursor") prev.role = "none";
      this.clientCursor = null;
      changed = true;
    }
    if (this.clientCursorShape && (!session || this.clientCursorShape.session === session)) {
      this.clientCursorShape = null;
      changed = true;
    }
    if (changed && !this.syncHardwareCursor()) this.markDirty();
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
      (this.clientCursor.session !== session || this.clientCursor.surfaceId !== surfaceId)
    ) {
      const prev = this.clientCursor.session.surfaceById(this.clientCursor.surfaceId);
      if (prev?.role === "cursor") prev.role = "none";
    }
    surf.role = "cursor";
    this.clientCursor = { session, surfaceId, hotspotX, hotspotY };
    this.clientCursorShape = null;
    if (!this.syncHardwareCursor()) this.markDirty();
  }

  setClientCursorShape(session: ClientSession, shape: number): void {
    if (this.pointerFocus?.session !== session) return;
    this.clearClientCursor(session);
    this.clientCursorShape = { session, shape };
    if (!this.syncHardwareCursor()) this.markDirty();
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
    destination?: { width: number; height: number },
    opaque = false,
  ): void {
    // Wayland wl_shm / linux-dmabuf ARGB8888 is premultiplied.
    const srcWords = new Uint32Array(src.buffer, src.byteOffset, src.byteLength >>> 2);
    const stridePx = srcStride >>> 2;
    const gx0 = geom?.x ?? 0;
    const gy0 = geom?.y ?? 0;
    const gx1 = geom ? geom.x + geom.w : srcW;
    const gy1 = geom ? geom.y + geom.h : srcH;

    const destW = destination?.width ?? srcW;
    const destH = destination?.height ?? srcH;
    // The overwhelmingly common XRGB, unscaled window case can be copied a
    // row at a time. Avoiding the JS per-pixel alpha loop is a substantial
    // software-reference win and mirrors the retained EGL `copy` path.
    if (opaque && destW === srcW && destH === srcH) {
      const sx0 = Math.max(0, -dx, geom ? gx0 : 0);
      const sy0 = Math.max(0, -dy, geom ? gy0 : 0);
      const sx1 = Math.min(srcW, fbW - dx, geom ? gx1 : srcW);
      const sy1 = Math.min(srcH, fbH - dy, geom ? gy1 : srcH);
      if (sx1 <= sx0 || sy1 <= sy0) return;
      for (let sourceRow = sy0; sourceRow < sy1; sourceRow++) {
        const sourceStart = sourceRow * stridePx + sx0;
        fb.set(
          srcWords.subarray(sourceStart, sourceStart + sx1 - sx0),
          (dy + sourceRow) * pitchPx + dx + sx0,
        );
      }
      return;
    }
    for (let row = 0; row < destH; row++) {
      const py = dy + row;
      if (py < 0 || py >= fbH) continue;
      const sourceRow = Math.min(srcH - 1, Math.floor((row * srcH) / destH));
      for (let col = 0; col < destW; col++) {
        const px = dx + col;
        if (px < 0 || px >= fbW) continue;
        const sourceCol = Math.min(srcW - 1, Math.floor((col * srcW) / destW));
        const si = sourceRow * stridePx + sourceCol;
        const pixel = srcWords[si]!;
        const inGeom =
          !geom || (sourceCol >= gx0 && sourceCol < gx1 && sourceRow >= gy0 && sourceRow < gy1);
        if (opaque) {
          if (inGeom) fb[py * pitchPx + px] = pixel;
          continue;
        }
        const a = (pixel >>> 24) & 0xff;
        if (a === 0) continue;
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
        const r = (((pixel >>> 16) & 0xff) + (((dst >>> 16) & 0xff) * inv) / 255) | 0;
        const g = (((pixel >>> 8) & 0xff) + (((dst >>> 8) & 0xff) * inv) / 255) | 0;
        const b = ((pixel & 0xff) + ((dst & 0xff) * inv) / 255) | 0;
        fb[di] = (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;
      }
    }
  }

  private paintDragPreview(fb: Uint32Array, pitchPx: number, width: number, height: number): void {
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
            surf.bufferWidth,
            surf.bufferHeight,
            surf.stride,
            undefined,
            { width: surf.width, height: surf.height },
            surf.opaque,
          );
          return;
        } catch (err) {
          console.warn("[dnd] icon blit failed:", err);
        }
      }
    }

    if (!drag && this.dragReturn) {
      const anim = this.dragReturn;
      const progress = Math.min(1, Math.max(0, (monotonicMs() - anim.startedMs) / anim.durationMs));
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

    const label = drag?.label || this.shell?.desktopDragLabel?.() || null;
    if (!label) return;

    try {
      this.shell?.paintDragPreview?.(fb, pitchPx, width, height, this.cursorX, this.cursorY, label);
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
    const semanticShape = this.clientCursorShape?.shape ?? 0;
    if (semanticShape === 9 || semanticShape === 10) {
      return {
        hotX: 4,
        hotY: 8,
        shape: [
          " XXXXXXX ",
          "    X    ",
          "    X    ",
          "    X    ",
          "    X    ",
          "    X    ",
          "    X    ",
          "    X    ",
          "    X    ",
          "    X    ",
          "    X    ",
          "    X    ",
          "    X    ",
          "    X    ",
          "    X    ",
          " XXXXXXX ",
        ],
      };
    }
    let edges = g?.kind === "resize" ? g.edges : this.hoverEdges;
    if (semanticShape >= 18 && semanticShape <= 29) {
      const semanticEdges: Record<number, number> = {
        18: XDG_TOPLEVEL_RESIZE_EDGE_RIGHT,
        19: XDG_TOPLEVEL_RESIZE_EDGE_TOP,
        20: XDG_TOPLEVEL_RESIZE_EDGE_TOP | XDG_TOPLEVEL_RESIZE_EDGE_RIGHT,
        21: XDG_TOPLEVEL_RESIZE_EDGE_TOP | XDG_TOPLEVEL_RESIZE_EDGE_LEFT,
        22: XDG_TOPLEVEL_RESIZE_EDGE_BOTTOM,
        23: XDG_TOPLEVEL_RESIZE_EDGE_BOTTOM | XDG_TOPLEVEL_RESIZE_EDGE_RIGHT,
        24: XDG_TOPLEVEL_RESIZE_EDGE_BOTTOM | XDG_TOPLEVEL_RESIZE_EDGE_LEFT,
        25: XDG_TOPLEVEL_RESIZE_EDGE_LEFT,
        26: XDG_TOPLEVEL_RESIZE_EDGE_LEFT | XDG_TOPLEVEL_RESIZE_EDGE_RIGHT,
        27: XDG_TOPLEVEL_RESIZE_EDGE_TOP | XDG_TOPLEVEL_RESIZE_EDGE_BOTTOM,
        28: XDG_TOPLEVEL_RESIZE_EDGE_TOP | XDG_TOPLEVEL_RESIZE_EDGE_RIGHT,
        29: XDG_TOPLEVEL_RESIZE_EDGE_TOP | XDG_TOPLEVEL_RESIZE_EDGE_LEFT,
      };
      edges = semanticEdges[semanticShape] ?? edges;
    }
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

  private hardwareCursorImage(): {
    image: KmsCursorImage;
    key: string;
    finish?: () => void;
  } {
    const clientCursor = this.clientCursor;
    if (clientCursor) {
      const surface = clientCursor.session.surfaceById(clientCursor.surfaceId);
      if (surface?.pixels && surface.bufferWidth > 0 && surface.bufferHeight > 0) {
        const scaleX = surface.bufferWidth / Math.max(1, surface.width);
        const scaleY = surface.bufferHeight / Math.max(1, surface.height);
        return {
          key: `client:${clientCursor.session.clientId}:${surface.id}:${surface.revision}:${clientCursor.hotspotX}:${clientCursor.hotspotY}`,
          image: {
            pixels: surface.pixels,
            width: surface.bufferWidth,
            height: surface.bufferHeight,
            stride: surface.stride,
            hotspotX: Math.round(clientCursor.hotspotX * scaleX),
            hotspotY: Math.round(clientCursor.hotspotY * scaleY),
          },
          finish: () => clientCursor.session.finishSurfaceFrame(surface),
        };
      }
    }

    const fallback = this.fallbackCursorShape();
    const width = Math.max(1, ...fallback.shape.map((line) => line.length));
    const height = fallback.shape.length;
    const key = `fallback:${fallback.hotX}:${fallback.hotY}:${fallback.shape.join("|")}`;
    let pixels = this.fallbackCursorPixels.get(key);
    if (!pixels) {
      pixels = new Uint8Array(width * height * 4);
      const words = new Uint32Array(pixels.buffer);
      for (let row = 0; row < height; row++) {
        const line = fallback.shape[row]!;
        for (let col = 0; col < line.length; col++) {
          const ch = line[col]!;
          if (ch !== " ") {
            words[row * width + col] = ch === "X" ? 0xff000000 : 0xffffffff;
          }
        }
      }
      this.fallbackCursorPixels.set(key, pixels);
    }
    return {
      key,
      image: {
        pixels,
        width,
        height,
        stride: width * 4,
        hotspotX: fallback.hotX,
        hotspotY: fallback.hotY,
      },
    };
  }

  /** Synchronize the cursor plane; false keeps the existing software path. */
  private syncHardwareCursor(): boolean {
    const output =
      this.outputs.find(
        (candidate) =>
          this.cursorX >= candidate.x &&
          this.cursorY >= candidate.y &&
          this.cursorX < candidate.x + outputLogicalWidth(candidate) &&
          this.cursorY < candidate.y + outputLogicalHeight(candidate),
      ) ??
      this.outputs.find((candidate) => candidate.primary) ??
      this.outputs[0];
    if (!output) return false;
    const logicalWidth = outputLogicalWidth(output);
    const logicalHeight = outputLogicalHeight(output);
    const physicalX = Math.round(((this.cursorX - output.x) * output.kms.width) / logicalWidth);
    const physicalY = Math.round(((this.cursorY - output.y) * output.kms.height) / logicalHeight);
    const descriptor = this.hardwareCursorImage();
    const previous = this.hardwareCursor;
    let active = false;
    if (previous?.connectorId === output.kms.connectorId && previous.imageKey === descriptor.key) {
      active = moveKmsCursor(output.kms, physicalX, physicalY);
    } else {
      for (const candidate of this.outputs) {
        if (candidate !== output) disableKmsCursor(candidate.kms);
      }
      active = setKmsCursor(output.kms, descriptor.image, physicalX, physicalY);
      if (active) descriptor.finish?.();
    }
    if (active) {
      this.hardwareCursor = {
        connectorId: output.kms.connectorId,
        imageKey: descriptor.key,
      };
      if (!previous) this.markDirty();
      return true;
    }
    for (const candidate of this.outputs) disableKmsCursor(candidate.kms);
    this.hardwareCursor = null;
    if (previous) this.markDirty();
    return false;
  }

  private disableHardwareCursor(): void {
    for (const output of this.outputs) disableKmsCursor(output.kms);
    this.hardwareCursor = null;
  }

  private drawCursor(fb: Uint32Array, pitchPx: number, width: number, height: number): void {
    if (this.syncHardwareCursor()) return;
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
          surf.bufferWidth,
          surf.bufferHeight,
          surf.stride,
          undefined,
          { width: surf.width, height: surf.height },
          surf.opaque,
        );
        cc.session.finishSurfaceFrame(surf);
        return;
      }
      if (surf) cc.session.finishSurfaceFrame(surf);
    }
    const fbShape = this.fallbackCursorShape();
    this.drawShapeCursor(fb, pitchPx, width, height, fbShape.shape, fbShape.hotX, fbShape.hotY);
  }

  /** Request a composite + present on the next loop tick. */
  markDirty(): void {
    this.needsComposite = true;
    const wake = this.compositeWakeResolver;
    this.compositeWakeResolver = null;
    wake?.();
  }

  private async loop(): Promise<void> {
    while (this.running) {
      this.prefsWatcher?.poll();
      if (this.shell?.needsRepaint?.()) this.markDirty();
      if (this.needsComposite) {
        const budget = this.frameBudgetMs();
        const now = monotonicMs();
        if (this.nextCompositeDeadlineMs > now) {
          await new Promise((resolve) => setTimeout(resolve, this.nextCompositeDeadlineMs - now));
          continue;
        }
        this.needsComposite = false;
        const startedAt = monotonicMs();
        // Advance an absolute deadline instead of sleeping for "remaining"
        // time after each frame. Timer overshoot is recovered by the next
        // interval rather than permanently lowering a 60 Hz output to ~56 Hz.
        this.nextCompositeDeadlineMs =
          this.nextCompositeDeadlineMs < startedAt - budget
            ? startedAt + budget
            : this.nextCompositeDeadlineMs + budget;
        try {
          await this.composite();
        } catch (err) {
          console.error("[composite]", err);
          this.markDirty();
        }
      } else {
        // Idle — native commits and shell invalidation wake us directly.
        await this.waitForCompositeWork(1_000);
      }
    }
  }

  private frameBudgetMs(): number {
    const primary = this.outputs.find((output) => output.primary) ?? this.outputs[0];
    const mode = primary?.kms.modes.find((candidate) => candidate.id === primary.kms.currentModeId);
    return mode?.refreshMilliHz ? 1_000_000 / mode.refreshMilliHz : 1000 / 60;
  }

  private waitForCompositeWork(timeoutMs: number): Promise<void> {
    if (this.needsComposite || !this.running) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.compositeWakeResolver === finish) {
          this.compositeWakeResolver = null;
        }
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      this.compositeWakeResolver = finish;
    });
  }

  /** Paint mapped xdg_popup surfaces above chrome and release their buffers. */
  private paintPopups(fb: Uint32Array, pitchPx: number, width: number, height: number): number {
    let painted = 0;
    for (const entry of this.popupStack) {
      const client = entry.session;
      const surf = client.surfaceById(entry.surfaceId);
      if (!surf || !surf.mapped || !surf.pixels) continue;
      this.layoutPopup(client, surf);
      client.updateSurfaceOutputs(surf);
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
            surf.bufferWidth,
            surf.bufferHeight,
            surf.stride,
            useGeom
              ? {
                  x: surf.geomX,
                  y: surf.geomY,
                  w: surf.geomW,
                  h: surf.geomH,
                }
              : undefined,
            { width: surf.width, height: surf.height },
            surf.opaque,
          );
          painted++;
        } catch (err) {
          console.error(`[composite] popup blit failed ${surf.width}x${surf.height}:`, err);
        }
      }
      client.finishSurfaceFrame(surf);
    }
    return painted;
  }

  private canUseRetainedComposition(renderer: CompositorOutputRenderer): boolean {
    if (!renderer.capabilities.retainedLayers || !renderer.beginComposition) return false;
    if (
      !this.shell?.desktopRaster ||
      !this.shell.chromeRaster ||
      !this.shell.ssdRaster ||
      (((this.drag != null && this.drag.iconId == null) ||
        (this.drag == null && this.shell.desktopDragLabel?.() != null)) &&
        !this.shell.dragRaster)
    ) {
      return false;
    }
    return true;
  }

  private finishPresentationFeedback(feedback?: KmsPresentationFeedback): void {
    const now = process.hrtime.bigint();
    const resolved = feedback ?? {
      sequence: 0,
      seconds: Number(now / 1_000_000_000n),
      nanoseconds: Number(now % 1_000_000_000n),
      vsync: false,
      hardwareClock: false,
      hardwareCompletion: false,
    };
    const primary = this.outputs.find((output) => output.primary) ?? this.outputs[0];
    const mode = primary?.kms.modes.find((candidate) => candidate.id === primary.kms.currentModeId);
    const refreshNs = mode?.refreshMilliHz
      ? Math.max(1, Math.round(1_000_000_000_000 / mode.refreshMilliHz))
      : 0;
    for (const client of this.clients) {
      for (const surface of client.surfaces()) {
        if (!surface.presentationReady) continue;
        surface.presentationReady = false;
        const feedbackIds = surface.readyPresentationFeedbacks;
        surface.readyPresentationFeedbacks = [];
        for (const feedbackId of feedbackIds) {
          client.sendPresentationPresented(feedbackId, resolved, refreshNs);
        }
      }
    }
  }

  private retainedCursorLayer(z: number): CompositionLayer | null {
    if (this.syncHardwareCursor()) return null;
    const clientCursor = this.clientCursor;
    if (clientCursor) {
      const surface = clientCursor.session.surfaceById(clientCursor.surfaceId);
      if (surface?.pixels && surface.width > 0 && surface.height > 0) {
        clientCursor.session.finishSurfaceFrame(surface);
        return {
          id: `cursor:${clientCursor.session.clientId}:${surface.id}`,
          z,
          source: {
            pixels: surface.pixels,
            width: surface.bufferWidth,
            height: surface.bufferHeight,
            stride: surface.stride,
            revision: surface.revision,
          },
          destination: {
            x: (this.cursorX | 0) - clientCursor.hotspotX,
            y: (this.cursorY | 0) - clientCursor.hotspotY,
            width: surface.width,
            height: surface.height,
          },
          sampling: "nearest",
        };
      }
      if (surface) clientCursor.session.finishSurfaceFrame(surface);
    }

    const fallback = this.fallbackCursorShape();
    const width = Math.max(1, ...fallback.shape.map((line) => line.length));
    const height = fallback.shape.length;
    const descriptor = this.hardwareCursorImage();
    const pixels = descriptor.image.pixels;
    return {
      id: "cursor:fallback",
      z,
      source: { pixels, width, height, stride: width * 4, revision: 1 },
      destination: {
        x: (this.cursorX | 0) - fallback.hotX,
        y: (this.cursorY | 0) - fallback.hotY,
        width,
        height,
      },
      sampling: "nearest",
    };
  }

  private retainedDragLayer(z: number): CompositionLayer | null {
    const drag = this.drag;
    if (drag?.iconId != null) {
      const surface = drag.sourceSession.surfaceById(drag.iconId);
      if (surface?.pixels && surface.width > 0 && surface.height > 0) {
        const layer: CompositionLayer = {
          id: `drag:${drag.sourceSession instanceof ClientSession ? drag.sourceSession.clientId : "shell"}:${surface.id}`,
          z,
          source: {
            pixels: surface.pixels,
            width: surface.bufferWidth,
            height: surface.bufferHeight,
            stride: surface.stride,
            revision: surface.revision,
          },
          destination: {
            x: (this.cursorX | 0) + surface.bufferOffsetX,
            y: (this.cursorY | 0) + surface.bufferOffsetY,
            width: surface.width,
            height: surface.height,
          },
          sampling: "nearest",
        };
        if (drag.sourceSession instanceof ClientSession) {
          drag.sourceSession.finishSurfaceFrame(surface);
        }
        return layer;
      }
    }

    if (!drag && this.dragReturn) {
      const animation = this.dragReturn;
      const progress = Math.min(
        1,
        Math.max(0, (monotonicMs() - animation.startedMs) / animation.durationMs),
      );
      if (progress >= 1) {
        this.dragReturn = null;
        return null;
      }
      const eased = 1 - Math.pow(1 - progress, 3);
      this.markDirty();
      return {
        id: "drag:return",
        z,
        source: {
          pixels: animation.pixels,
          width: animation.width,
          height: animation.height,
          stride: animation.stride,
          revision: 1,
        },
        destination: {
          x: Math.round(animation.fromX + (animation.toX - animation.fromX) * eased),
          y: Math.round(animation.fromY + (animation.toY - animation.fromY) * eased),
          width: animation.width,
          height: animation.height,
        },
        opacity: 0.92,
        sampling: "nearest",
      };
    }

    const label = drag?.label || this.shell?.desktopDragLabel?.() || null;
    if (label && this.shell?.dragRaster) {
      const raster = this.shell.dragRaster(this.cursorX, this.cursorY, label);
      if (raster) {
        return {
          id: raster.id,
          z,
          source: {
            pixels: raster.pixels,
            width: raster.width,
            height: raster.height,
            stride: raster.stride,
            revision: raster.revision,
          },
          destination: {
            x: raster.x,
            y: raster.y,
            width: raster.width,
            height: raster.height,
          },
          sampling: "nearest",
        };
      }
    }
    return null;
  }

  private async compositeRetained(
    renderer: CompositorOutputRenderer,
    frameStartedMs: number,
    width: number,
    height: number,
  ): Promise<void> {
    const layers: CompositionLayer[] = [];
    let z = 0;
    const wallPhase = (Date.now() / 60000) % 1;
    const phaseBucket = Math.floor(wallPhase * 20);
    const wallpaperKey = `${this.theme.name}:${width}x${height}:${phaseBucket}:${JSON.stringify(this.theme.wallpaper)}`;
    if (
      !this.retainedWallpaper ||
      this.retainedWallpaper.byteLength !== width * height * 4 ||
      this.retainedWallpaperKey !== wallpaperKey
    ) {
      this.retainedWallpaper = Buffer.alloc(width * height * 4);
      paintWallpaper(
        new Uint32Array(
          this.retainedWallpaper.buffer,
          this.retainedWallpaper.byteOffset,
          this.retainedWallpaper.byteLength >>> 2,
        ),
        width,
        width,
        height,
        this.theme,
        wallPhase,
      );
      this.retainedWallpaperKey = wallpaperKey;
      this.retainedWallpaperRevision++;
    }
    layers.push({
      id: "wallpaper",
      z: z++,
      source: {
        pixels: this.retainedWallpaper,
        width,
        height,
        stride: width * 4,
        revision: this.retainedWallpaperRevision,
      },
      destination: { x: 0, y: 0, width, height },
      blendMode: "copy",
      sampling: "nearest",
    });
    if (this.theme.wallpaper.mode === "atmosphere") this.markDirty();
    const wallpaperFinishedMs = monotonicMs();

    const primary = this.outputs.find((output) => output.primary) ?? this.outputs[0]!;
    this.shell?.setPrimaryOutput?.({
      x: primary.x,
      y: primary.y,
      width: outputLogicalWidth(primary),
      height: outputLogicalHeight(primary),
    });
    this.shell?.setTasks?.(this.collectTaskWindows());
    const desktop = this.shell?.desktopRaster?.(width, height);
    if (desktop) {
      layers.push({
        id: desktop.id,
        z: z++,
        source: desktop,
        destination: {
          x: desktop.x,
          y: desktop.y,
          width: desktop.width,
          height: desktop.height,
        },
      });
    }
    const desktopFinishedMs = monotonicMs();

    let painted = 0;
    this.shell?.beginSsdFrame?.();
    for (const entry of this.stack) {
      const client = entry.session;
      client.layout();
      const top = client.surfaceById(entry.surfaceId);
      if (top?.mapped && !client.isHidden(top) && this.usesSsd(top)) {
        const size = this.contentSize(top);
        if (size.w > 0 && size.h > 0) {
          layers.push({
            id: `window-shadow:${client.clientId}:${top.id}`,
            z: z++,
            source: {
              pixels: this.retainedEffectPixel,
              width: 1,
              height: 1,
              stride: 4,
              revision: 1,
            },
            destination: {
              x: top.x,
              y: top.y,
              width: size.w,
              height: size.h + SSD_TITLEBAR_H,
            },
            cornerRadius: this.theme.tokens.radiusWindow,
            effects: [
              {
                kind: "drop-shadow",
                offsetX: 0,
                offsetY: 8,
                blurRadius: 20,
                spread: 1,
                color: hexToArgb(this.theme.tokens.rimShade),
              },
            ],
          });
        }
      }
      for (const surface of client.paintTree(entry.surfaceId)) {
        client.updateSurfaceOutputs(surface);
        if (surface.mapped && surface.pixels && !client.isHidden(surface)) {
          const ssdY = surface.role === "toplevel" && this.usesSsd(surface) ? SSD_TITLEBAR_H : 0;
          const useGeometry =
            surface.role === "toplevel" &&
            surface.geomW > 0 &&
            surface.geomH > 0 &&
            !this.usesSsd(surface);
          layers.push({
            id: `surface:${client.clientId}:${surface.id}`,
            z: z++,
            source: {
              pixels: surface.pixels,
              width: surface.bufferWidth,
              height: surface.bufferHeight,
              stride: surface.stride,
              revision: surface.revision,
            },
            destination: {
              x: surface.x,
              y: surface.y + ssdY,
              width: surface.width,
              height: surface.height,
            },
            surfaceGeometry: useGeometry
              ? {
                  x: surface.geomX,
                  y: surface.geomY,
                  width: surface.geomW,
                  height: surface.geomH,
                }
              : undefined,
            sampling: "nearest",
            damage: surface.damage,
          });
          painted++;
        }
        client.finishSurfaceFrame(surface);
      }

      if (top?.mapped && !client.isHidden(top) && this.usesSsd(top) && this.shell?.ssdRaster) {
        const size = this.contentSize(top);
        if (size.w > 0 && size.h > 0) {
          const ssd = this.shell.ssdRaster({
            clientId: client.clientId,
            surfaceId: top.id,
            x: top.x,
            y: top.y,
            contentW: size.w,
            contentH: size.h,
            title: top.title || "Window",
            focused:
              this.focusedToplevel?.session === client && this.focusedToplevel.surfaceId === top.id,
            maximized: top.maximized,
          });
          layers.push({
            id: ssd.id,
            z: z++,
            source: ssd,
            destination: { x: ssd.x, y: ssd.y, width: ssd.width, height: ssd.height },
          });
        }
      }
    }
    const windowsFinishedMs = monotonicMs();

    this.ssdWindows = this.collectSsdWindows();
    const chrome = this.shell?.chromeRaster?.(width, height);
    if (chrome) {
      if (renderer.capabilities.backdropBlur) {
        const panelHeight = Math.max(this.theme.tokens.panelHeight, 46);
        layers.push({
          id: "shell:panel-material",
          z: z++,
          source: {
            pixels: this.retainedEffectPixel,
            width: 1,
            height: 1,
            stride: 4,
            revision: 1,
          },
          destination: {
            x: primary.x,
            y: primary.y + outputLogicalHeight(primary) - panelHeight,
            width: outputLogicalWidth(primary),
            height: panelHeight,
          },
          effects: [
            {
              kind: "backdrop-blur",
              radius: 18,
              saturation: 1.08,
              tint: hexToArgb(this.theme.tokens.panel, 0x24),
            },
          ],
        });
      }
      layers.push({
        id: chrome.id,
        z: z++,
        source: chrome,
        destination: { x: chrome.x, y: chrome.y, width: chrome.width, height: chrome.height },
      });
    }
    const chromeFinishedMs = monotonicMs();

    for (const entry of this.popupStack) {
      const client = entry.session;
      const surface = client.surfaceById(entry.surfaceId);
      if (!surface?.mapped || !surface.pixels || client.isHidden(surface)) continue;
      this.layoutPopup(client, surface);
      client.updateSurfaceOutputs(surface);
      layers.push({
        id: `popup:${client.clientId}:${surface.id}`,
        z: z++,
        source: {
          pixels: surface.pixels,
          width: surface.bufferWidth,
          height: surface.bufferHeight,
          stride: surface.stride,
          revision: surface.revision,
        },
        destination: {
          x: surface.x,
          y: surface.y,
          width: surface.width,
          height: surface.height,
        },
        surfaceGeometry:
          surface.geomW > 0 && surface.geomH > 0
            ? {
                x: surface.geomX,
                y: surface.geomY,
                width: surface.geomW,
                height: surface.geomH,
              }
            : undefined,
        sampling: "nearest",
        damage: surface.damage,
      });
      client.finishSurfaceFrame(surface);
      painted++;
    }
    const dragLayer = this.retainedDragLayer(z++);
    if (dragLayer) layers.push(dragLayer);
    const cursor = this.retainedCursorLayer(z++);
    if (cursor) layers.push(cursor);
    const sceneFinishedMs = monotonicMs();

    const scene: CompositionScene = {
      width,
      height,
      clearColor: hexToArgb(this.theme.tokens.bg),
      layers,
    };
    const outputPhaseStartedMs = monotonicMs();
    renderer.beginComposition!(scene);
    let frameRenderMs = monotonicMs() - outputPhaseStartedMs;
    let framePresentMs = 0;
    const pendingPresents: Promise<{
      duration: number;
      feedback?: KmsPresentationFeedback;
      primary: boolean;
    }>[] = [];
    for (const output of this.outputs) {
      const outputStartedMs = monotonicMs();
      const physical = output.kms;
      let target = this.outputStages.get(physical.connectorId);
      if (!target || target.byteLength !== physical.size) {
        target = Buffer.alloc(physical.size);
        this.outputStages.set(physical.connectorId, target);
      }
      const rendered = renderer.renderOutput({
        geometry: {
          id: physical.connectorName,
          x: output.x,
          y: output.y,
          width: outputLogicalWidth(output),
          height: outputLogicalHeight(output),
        },
        pixels: target,
        physicalWidth: physical.width,
        physicalHeight: physical.height,
        pitch: physical.pitch,
      });
      const renderedMs = monotonicMs();
      try {
        if (rendered.framebufferId != null) {
          const presentStartedMs = monotonicMs();
          pendingPresents.push(
            presentKmsFramebuffer(
              physical,
              rendered.framebufferId,
              this.readiness ?? undefined,
            ).then(
              (feedback) => ({
                duration: monotonicMs() - presentStartedMs,
                feedback,
                primary: output.primary,
              }),
              (error) => {
                console.error(`[composite] retained present ${physical.connectorName}:`, error);
                return {
                  duration: monotonicMs() - presentStartedMs,
                  primary: output.primary,
                };
              },
            ),
          );
        } else {
          flushMmap(physical.map, target, physical.size);
          presentKms(physical);
          framePresentMs += monotonicMs() - renderedMs;
        }
      } catch (error) {
        console.error(`[composite] retained present ${physical.connectorName}:`, error);
      }
      frameRenderMs += renderedMs - outputStartedMs;
    }
    const presented = await Promise.all(pendingPresents);
    framePresentMs += presented.reduce((total, result) => total + result.duration, 0);
    this.finishPresentationFeedback(
      presented.find((result) => result.primary)?.feedback ?? presented[0]?.feedback,
    );
    this.profileFrames++;
    this.profileSceneMs += sceneFinishedMs - frameStartedMs;
    this.profileWallpaperMs += wallpaperFinishedMs - frameStartedMs;
    this.profileDesktopMs += desktopFinishedMs - wallpaperFinishedMs;
    this.profileWindowsMs += windowsFinishedMs - desktopFinishedMs;
    this.profileChromeMs += chromeFinishedMs - windowsFinishedMs;
    this.profileTopMs += sceneFinishedMs - chromeFinishedMs;
    this.profileRenderMs += frameRenderMs;
    this.profilePresentMs += framePresentMs;
    this.maybeLogRenderProfile();
    if (painted > 0 && painted !== this.lastPainted) {
      console.log(`[composite] retained ${painted} surfaces in ${layers.length} layers`);
      this.lastPainted = painted;
    }
  }

  /** Paint wallpaper + all mapped surfaces into the KMS dumb buffer. */
  async composite(): Promise<void> {
    if (this.outputs.length === 0) return;
    const frameStartedMs = monotonicMs();
    const kms = this.getKmsSize();
    const renderer = this.outputRenderer;
    if (renderer && this.canUseRetainedComposition(renderer)) {
      try {
        await this.compositeRetained(renderer, frameStartedMs, kms.width, kms.height);
        return;
      } catch (error) {
        // Keep the flattened path as an in-frame compatibility fallback. An
        // extension/effect failure must not turn into a black desktop loop.
        console.error("[renderer] retained scene failed; rebuilding flat frame:", error);
      }
    }
    const stageSize = kms.width * kms.height * 4;

    if (!this.stage || this.stage.byteLength !== stageSize) {
      this.stage = Buffer.alloc(stageSize);
    }
    const stage = this.stage;
    const fb = new Uint32Array(stage.buffer, stage.byteOffset, stage.byteLength >>> 2);
    // Wallpaper from theme (atmosphere / gradient / image) — cached in @moire/theme.
    const pitchPx = kms.width;
    const wallPhase = (Date.now() / 60000) % 1; // ~60s period
    paintWallpaper(fb, pitchPx, kms.width, kms.height, this.theme, wallPhase);
    const wallpaperFinishedMs = monotonicMs();
    // Keep atmosphere drifting even when otherwise idle.
    if (this.theme.wallpaper.mode === "atmosphere") {
      this.markDirty();
    }

    try {
      const primary = this.outputs.find((output) => output.primary) ?? this.outputs[0]!;
      this.shell?.setPrimaryOutput?.({
        x: primary.x,
        y: primary.y,
        width: outputLogicalWidth(primary),
        height: outputLogicalHeight(primary),
      });
      this.shell?.setTasks?.(this.collectTaskWindows());
    } catch (err) {
      console.error("[shell] setTasks:", err);
    }

    // Desktop icons / DnD drop-zone overlay (after wallpaper, before windows).
    try {
      this.shell?.paintDesktop?.(fb, pitchPx, kms.width, kms.height);
    } catch (err) {
      console.error("[shell] paintDesktop:", err);
    }
    const desktopFinishedMs = monotonicMs();

    let painted = 0;
    let windowsFinishedMs = desktopFinishedMs;
    try {
      this.shell?.beginSsdFrame?.();
      // Bottom → top stack order so raised windows paint last.
      for (const entry of this.stack) {
        const client = entry.session;
        client.layout();
        for (const surf of client.paintTree(entry.surfaceId)) {
          client.updateSurfaceOutputs(surf);
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
              const ssdY = surf.role === "toplevel" && this.usesSsd(surf) ? SSD_TITLEBAR_H : 0;
              const useGeom =
                surf.role === "toplevel" && surf.geomW > 0 && surf.geomH > 0 && !this.usesSsd(surf);
              this.blitArgb(
                fb,
                pitchPx,
                kms.width,
                kms.height,
                surf.x,
                surf.y + ssdY,
                surf.pixels,
                surf.bufferWidth,
                surf.bufferHeight,
                surf.stride,
                useGeom
                  ? {
                      x: surf.geomX,
                      y: surf.geomY,
                      w: surf.geomW,
                      h: surf.geomH,
                    }
                  : undefined,
                { width: surf.width, height: surf.height },
                surf.opaque,
              );
              painted++;
            } catch (err) {
              console.error(
                `[composite] blit failed role=${surf.role} ${surf.width}x${surf.height}:`,
                err,
              );
            }
          }

          client.finishSurfaceFrame(surf);
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
              maximized: top.maximized,
            });
          }
        }
      }
      windowsFinishedMs = monotonicMs();
    } finally {
      try {
        this.ssdWindows = this.collectSsdWindows();
        // Fallback if shell only implements the bulk paintSsd API.
        if (!this.shell?.paintSsdWindow && this.shell?.paintSsd) {
          this.shell.paintSsd(fb, pitchPx, kms.width, kms.height, this.ssdWindows);
        }
        this.shell?.paint(fb, pitchPx, kms.width, kms.height);
      } catch (err) {
        console.error("[shell] paint:", err);
      }
      const chromeFinishedMs = monotonicMs();
      // Native menus/flyouts are the top interactive layer. They must remain
      // visible and clickable even when their bounds cross the bottom panel.
      try {
        painted += this.paintPopups(fb, pitchPx, kms.width, kms.height);
      } catch (err) {
        console.error("[composite] paintPopups:", err);
      }
      this.paintDragPreview(fb, pitchPx, kms.width, kms.height);
      this.drawCursor(fb, pitchPx, kms.width, kms.height);
      const sceneFinishedMs = monotonicMs();
      const renderer = this.outputRenderer;
      if (!renderer) throw new Error("Compositor output renderer is unavailable");
      const outputPhaseStartedMs = monotonicMs();
      renderer.beginFrame({
        pixels: stage,
        width: kms.width,
        height: kms.height,
        stride: kms.width * 4,
      });
      // Account for backend setup as well as each output. For EGL this
      // includes the logical-scene texture upload, which is intentionally
      // separate from per-output crop/scale/readback work.
      let frameRenderMs = monotonicMs() - outputPhaseStartedMs;
      let framePresentMs = 0;
      const pendingPresents: Promise<{
        duration: number;
        feedback?: KmsPresentationFeedback;
        primary: boolean;
      }>[] = [];
      // Crop/scale the logical desktop into each physical output through the
      // selected backend. EGL currently reads into the stable dumb scanout;
      // direct GBM scanout is the next presentation step, not a scene change.
      for (const output of this.outputs) {
        const outputStartedMs = monotonicMs();
        const physical = output.kms;
        let target = this.outputStages.get(physical.connectorId);
        if (!target || target.byteLength !== physical.size) {
          target = Buffer.alloc(physical.size);
          this.outputStages.set(physical.connectorId, target);
        }
        const rendered = renderer.renderOutput({
          geometry: {
            id: physical.connectorName,
            x: output.x,
            y: output.y,
            width: outputLogicalWidth(output),
            height: outputLogicalHeight(output),
          },
          pixels: target,
          physicalWidth: physical.width,
          physicalHeight: physical.height,
          pitch: physical.pitch,
        });
        const renderedMs = monotonicMs();
        // Parallels VIRTUAL DRM does not pick up dumb-buffer dirties until
        // SetCrtc is re-applied (or a page flip).
        try {
          if (rendered.framebufferId != null) {
            const presentStartedMs = monotonicMs();
            pendingPresents.push(
              presentKmsFramebuffer(
                physical,
                rendered.framebufferId,
                this.readiness ?? undefined,
              ).then(
                (feedback) => ({
                  duration: monotonicMs() - presentStartedMs,
                  feedback,
                  primary: output.primary,
                }),
                (error) => {
                  console.error(`[composite] presentKms ${physical.connectorName}:`, error);
                  return {
                    duration: monotonicMs() - presentStartedMs,
                    primary: output.primary,
                  };
                },
              ),
            );
          } else {
            flushMmap(physical.map, target, physical.size);
            presentKms(physical);
            framePresentMs += monotonicMs() - renderedMs;
          }
        } catch (err) {
          console.error(`[composite] presentKms ${physical.connectorName}:`, err);
        }
        frameRenderMs += renderedMs - outputStartedMs;
      }
      const presented = await Promise.all(pendingPresents);
      framePresentMs += presented.reduce((total, result) => total + result.duration, 0);
      this.finishPresentationFeedback(
        presented.find((result) => result.primary)?.feedback ?? presented[0]?.feedback,
      );
      this.profileFrames++;
      this.profileSceneMs += sceneFinishedMs - frameStartedMs;
      this.profileWallpaperMs += wallpaperFinishedMs - frameStartedMs;
      this.profileDesktopMs += desktopFinishedMs - wallpaperFinishedMs;
      this.profileWindowsMs += windowsFinishedMs - desktopFinishedMs;
      this.profileChromeMs += chromeFinishedMs - windowsFinishedMs;
      this.profileTopMs += sceneFinishedMs - chromeFinishedMs;
      this.profileRenderMs += frameRenderMs;
      this.profilePresentMs += framePresentMs;
      this.maybeLogRenderProfile();
    }

    if (painted > 0 && painted !== this.lastPainted) {
      console.log(`[composite] painted ${painted} surfaces`);
      this.lastPainted = painted;
    }
  }

  private maybeLogRenderProfile(): void {
    const now = monotonicMs();
    if (this.profileLastLogMs === 0) this.profileLastLogMs = now;
    if (this.profileFrames < 120 && now - this.profileLastLogMs < 5_000) return;
    const frames = Math.max(1, this.profileFrames);
    console.log(
      `[renderer/profile] backend=${this.outputRenderer?.id ?? "none"} frames=${frames} scene=${(this.profileSceneMs / frames).toFixed(2)}ms(wall=${(this.profileWallpaperMs / frames).toFixed(2)} desktop=${(this.profileDesktopMs / frames).toFixed(2)} windows=${(this.profileWindowsMs / frames).toFixed(2)} chrome=${(this.profileChromeMs / frames).toFixed(2)} top=${(this.profileTopMs / frames).toFixed(2)}) output=${(this.profileRenderMs / frames).toFixed(2)}ms present=${(this.profilePresentMs / frames).toFixed(2)}ms`,
    );
    this.profileFrames = 0;
    this.profileSceneMs = 0;
    this.profileWallpaperMs = 0;
    this.profileDesktopMs = 0;
    this.profileWindowsMs = 0;
    this.profileChromeMs = 0;
    this.profileTopMs = 0;
    this.profileRenderMs = 0;
    this.profilePresentMs = 0;
    this.profileLastLogMs = now;
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
  /** Bound primary-selection device object ids for this client. */
  private primaryDeviceIds = new Set<number>();
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

  configureToplevel(surface: SurfaceState, width: number, height: number, states: number[]): void {
    if (surface.xdgToplevelId == null || surface.xdgSurfaceId == null) return;
    const buf = Buffer.alloc(states.length * 4);
    for (let i = 0; i < states.length; i++) {
      buf.writeUInt32LE(states[i]!, i * 4);
    }
    this.send(surface.xdgToplevelId, EV.xdg_toplevel_configure, (b) => {
      b.int(width).int(height).array(buf);
    });
    const serial = this.serial++;
    this.send(surface.xdgSurfaceId, EV.xdg_surface_configure, (b) => b.uint(serial));
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
    console.log(`[ssd] close xdg client=${this.clientId} surface=${surface.id}`);
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
      console.log(`[xwayland_shell] get_xwayland_surface id=${id} wl_surface=${surfaceId}`);
      // Serial may already be waiting on the XWM side.
      this.server.tryPairOrphanXwaylandSurface(this, surfaceId);
    }
  }

  private handleXwaylandSurface(obj: WlObject, opcode: number, r: MessageReader): void {
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
        this.server.noteXwaylandSerial(this, obj.data.wlSurfaceId as number, serial);
        obj.data.pendingSerial = null;
      }
    } else {
      console.warn(`[xwayland_shell] unhandled xwayland_surface opcode=${opcode} id=${obj.id}`);
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
    // Frame callbacks deliberately precede output completion. Keep this
    // commit's feedback separate so a prompt next client commit cannot
    // discard feedback for pixels already included in the output frame.
    surf.readyPresentationFeedbacks.push(...surf.presentationFeedbacks);
    surf.presentationFeedbacks = [];
    surf.presentationReady = surf.readyPresentationFeedbacks.length > 0;
    surf.damage = [];
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
        if (buf?.kind === "dmabuf") {
          closeDmabufPlanes(buf.planes, this.server.getGbm());
        }
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
    const state = ev.value === 0 ? WL_KEYBOARD_KEY_STATE_RELEASED : WL_KEYBOARD_KEY_STATE_PRESSED;
    const serial = this.serial++;
    this.send(this.keyboardId, EV.keyboard_key, (b) => {
      b.uint(serial)
        .uint(ev.timeMs >>> 0)
        .uint(ev.code)
        .uint(state);
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
      b.uint(timeMs >>> 0)
        .fixed(sx)
        .fixed(sy);
    });
    this.send(this.pointerId, EV.pointer_frame, () => {});
  }

  pointerButton(ev: EvdevPointerButton): number | null {
    if (this.pointerId == null || this.pointerSurfaceId == null) return null;
    const state =
      ev.value === 0 ? WL_POINTER_BUTTON_STATE_RELEASED : WL_POINTER_BUTTON_STATE_PRESSED;
    const serial = this.serial++;
    this.lastInputSerial = serial;
    this.send(this.pointerId, EV.pointer_button, (b) => {
      b.uint(serial)
        .uint(ev.timeMs >>> 0)
        .uint(ev.code)
        .uint(state);
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
        obj?.iface === "zwp_primary_selection_offer_v1" &&
        header.opcode === OP.primary_offer_receive &&
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

  private dispatch(objectId: number, opcode: number, msg: Buffer, fds: number[]): void {
    const obj = this.objects.get(objectId);
    if (!obj) {
      console.warn(`[wl] unknown object id=${objectId} opcode=${opcode} size=${msg.length}`);
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
        break;
      case "wl_output":
        if (opcode === OP.output_release) this.releaseOutput(obj);
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
      case "zwp_primary_selection_device_manager_v1":
        this.handlePrimarySelectionManager(opcode, r);
        break;
      case "zwp_primary_selection_source_v1":
        this.handlePrimarySelectionSource(obj, opcode, r);
        break;
      case "zwp_primary_selection_device_v1":
        this.handlePrimarySelectionDevice(obj, opcode, r);
        break;
      case "zwp_primary_selection_offer_v1":
        this.handlePrimarySelectionOffer(obj, opcode, r);
        break;
      case "xdg_activation_v1":
        this.handleXdgActivation(opcode, r);
        break;
      case "xdg_activation_token_v1":
        this.handleXdgActivationToken(obj, opcode, r);
        break;
      case "wp_fractional_scale_manager_v1":
        this.handleFractionalScaleManager(opcode, r);
        break;
      case "wp_fractional_scale_v1":
        if (opcode === OP.fractional_scale_destroy) this.destroyObject(objectId);
        break;
      case "zxdg_output_manager_v1":
        this.handleXdgOutputManager(opcode, r);
        break;
      case "zxdg_output_v1":
        if (opcode === OP.xdg_output_destroy) this.destroyObject(objectId);
        break;
      case "wp_viewporter":
        this.handleViewporter(opcode, r);
        break;
      case "wp_viewport":
        this.handleViewport(obj, opcode, r);
        break;
      case "wp_presentation":
        this.handlePresentation(obj, opcode, r);
        break;
      case "wp_presentation_feedback":
        // Feedback objects have no requests and are destroyed by their
        // terminal presented/discarded event.
        break;
      case "wp_cursor_shape_manager_v1":
        this.handleCursorShapeManager(opcode, r);
        break;
      case "wp_cursor_shape_device_v1":
        this.handleCursorShapeDevice(obj, opcode, r);
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
        console.warn(`[wl] unhandled ${obj.iface} id=${objectId} opcode=${opcode}`);
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

  globalAdded(global: { name: number; iface: string; version: number }): void {
    for (const object of this.objects.values()) {
      if (object.iface !== "wl_registry") continue;
      this.send(object.id, EV.registry_global, (b) => {
        b.uint(global.name).string(global.iface).uint(global.version);
      });
    }
  }

  globalRemoved(globalName: number): void {
    for (const object of this.objects.values()) {
      if (object.iface !== "wl_registry") continue;
      this.send(object.id, EV.registry_global_remove, (b) => {
        b.uint(globalName);
      });
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
    const output = iface === "wl_output" ? this.server.displayOutputForGlobal(name) : null;
    this.objects.set(id, {
      id,
      iface,
      version,
      ...(output ? { data: { output } } : {}),
    });

    if (iface === "wl_shm") {
      this.send(id, EV.shm_format, (b) => b.uint(WL_SHM_FORMAT_ARGB8888));
      this.send(id, EV.shm_format, (b) => b.uint(WL_SHM_FORMAT_XRGB8888));
    } else if (iface === "zwp_linux_dmabuf_v1") {
      this.sendDmabufFormats(id);
    } else if (iface === "wp_presentation") {
      // Linux CLOCK_MONOTONIC. DRM page-flip timestamps and our fallback
      // process.hrtime clock share this monotonic domain.
      this.send(id, EV.presentation_clock_id, (b) => b.uint(1));
    } else if (iface === "wl_seat") {
      // Do not send seat_name — some clients (weston-simple-shm) lack that listener.
      const caps = this.server.getKeymap()
        ? WL_SEAT_CAPABILITY_POINTER | WL_SEAT_CAPABILITY_KEYBOARD
        : WL_SEAT_CAPABILITY_POINTER;
      this.send(id, EV.seat_capabilities, (b) => b.uint(caps));
    } else if (iface === "wl_output") {
      this.sendOutputEvents(id, output);
      this.updateAllSurfaceOutputs();
    } else if (iface === "wl_data_device_manager") {
      // no immediate events
    } else if (iface === "wl_drm") {
      this.sendDrmBind(id);
    } else if (iface === "xwayland_shell_v1") {
      if (!this.isXwayland) {
        console.warn(`[xwayland_shell] rejected bind from non-Xwayland client id=${this.clientId}`);
        this.objects.delete(id);
        this.sendError(WL_DISPLAY_ID, 0, `xwayland_shell_v1 is only for Xwayland`);
        return;
      }
      console.log(`[xwayland_shell] bound id=${id}`);
    }
  }

  /** wl_drm.bind — tell Mesa/Xwayland which render node to open. */
  private sendDrmBind(id: number): void {
    const path = this.server.getDmabufFeedback()?.device.path ?? "/dev/dri/renderD128";
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
        b.uint(format).uint(DRM_FORMAT_MOD_INVALID_HI).uint(DRM_FORMAT_MOD_INVALID_LO);
      });
    }
  }

  private sendOutputEvents(id: number, selectedOutput?: DisplayOutput | null): void {
    const output = selectedOutput ?? this.server.getDisplayOutputs()[0];
    if (!output) return;
    const { kms, x, y } = output;
    this.send(id, EV.output_geometry, (b) => {
      b.int(x)
        .int(y)
        .int(kms.physicalWidthMm)
        .int(kms.physicalHeightMm)
        .int(0) // unknown subpixel
        .string("Linux DRM")
        .string(kms.connectorName)
        .int(0); // transform normal
    });
    for (const mode of kms.modes) {
      let flags = 0;
      if (mode.id === kms.currentModeId) flags |= WL_OUTPUT_MODE_CURRENT;
      if (mode.preferred) flags |= WL_OUTPUT_MODE_PREFERRED;
      this.send(id, EV.output_mode, (b) => {
        b.uint(flags).int(mode.width).int(mode.height).int(mode.refreshMilliHz);
      });
    }
    this.send(id, EV.output_scale, (b) => b.int(Math.max(1, Math.ceil(output.scale120 / 120))));
    this.send(id, EV.output_done, () => {});
  }

  private releaseOutput(object: WlObject): void {
    for (const surface of this.surfaces()) {
      surface.enteredOutputIds.delete(object.id);
    }
    this.destroyObject(object.id);
  }

  outputChanged(): void {
    for (const object of this.objects.values()) {
      if (object.iface === "wl_output") {
        this.sendOutputEvents(object.id, object.data?.output as DisplayOutput | undefined);
      } else if (object.iface === "zxdg_output_v1") {
        const output = object.data?.output as DisplayOutput | undefined;
        if (output) this.sendXdgOutputEvents(object.id, output);
      }
    }
    this.updateAllSurfaceOutputs();
  }

  updateSurfaceOutputs(surface: SurfaceState): void {
    const available = [...this.objects.values()]
      .filter((object) => object.iface === "wl_output")
      .flatMap((object) => {
        const output = object.data?.output as DisplayOutput | undefined;
        return output
          ? [
              {
                id: String(object.id),
                objectId: object.id,
                x: output.x,
                y: output.y,
                width: outputLogicalWidth(output),
                height: outputLogicalHeight(output),
              },
            ]
          : [];
      });
    const desired =
      surface.mapped && surface.pixels && !this.isHidden(surface)
        ? new Set(
            outputsIntersectingRect(available, {
              x: surface.x,
              y:
                surface.y +
                (surface.role === "toplevel" && this.server.usesSsd(surface) ? SSD_TITLEBAR_H : 0),
              width: surface.width,
              height: surface.height,
            }).map((output) => output.objectId),
          )
        : new Set<number>();

    const membership = outputMembershipDelta(surface.enteredOutputIds, desired);
    for (const outputId of membership.left) {
      this.send(surface.id, EV.surface_leave, (b) => b.uint(outputId));
    }
    for (const outputId of membership.entered) {
      this.send(surface.id, EV.surface_enter, (b) => b.uint(outputId));
    }
    surface.enteredOutputIds = membership.next;
    this.updateSurfacePreferredScale(surface);
  }

  clearSurfaceOutputs(surface: SurfaceState): void {
    for (const outputId of surface.enteredOutputIds) {
      if (this.objects.has(outputId)) {
        this.send(surface.id, EV.surface_leave, (b) => b.uint(outputId));
      }
    }
    surface.enteredOutputIds.clear();
  }

  private updateAllSurfaceOutputs(): void {
    this.layout();
    for (const surface of this.surfaces()) this.updateSurfaceOutputs(surface);
  }

  outputRemoved(output: DisplayOutput): void {
    const removedIds = new Set(
      [...this.objects.values()]
        .filter((object) => object.iface === "wl_output" && object.data?.output === output)
        .map((object) => object.id),
    );
    for (const surface of this.surfaces()) {
      for (const outputId of removedIds) {
        if (!surface.enteredOutputIds.has(outputId)) continue;
        this.send(surface.id, EV.surface_leave, (b) => b.uint(outputId));
        surface.enteredOutputIds.delete(outputId);
      }
    }
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
    } else if (opcode === OP_SUBSURFACE.place_above || opcode === OP_SUBSURFACE.place_below) {
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
    const parent = this.objects.get(parentId)?.data?.surface as SurfaceState | undefined;
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
          b.uint(WL_KEYBOARD_KEYMAP_FORMAT_XKB_V1).fd(keymap.fd).uint(keymap.size);
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

  private handleCursorShapeManager(opcode: number, r: MessageReader): void {
    if (opcode === OP.cursor_shape_manager_get_pointer) {
      const id = r.newId();
      r.object(); // wl_pointer
      this.objects.set(id, {
        id,
        iface: "wp_cursor_shape_device_v1",
        version: 1,
      });
    } else if (opcode === OP.cursor_shape_manager_get_tablet_tool) {
      const id = r.newId();
      r.object();
      this.objects.set(id, {
        id,
        iface: "wp_cursor_shape_device_v1",
        version: 1,
      });
    }
  }

  private handleCursorShapeDevice(obj: WlObject, opcode: number, r: MessageReader): void {
    if (opcode === OP.cursor_shape_device_set_shape) {
      r.uint(); // enter serial
      this.server.setClientCursorShape(this, r.uint());
    } else if (opcode === OP.cursor_shape_device_destroy) {
      this.destroyObject(obj.id);
    }
  }

  private handleFractionalScaleManager(opcode: number, r: MessageReader): void {
    if (opcode === OP.fractional_scale_manager_get) {
      const id = r.newId();
      const surfaceId = r.object();
      this.objects.set(id, {
        id,
        iface: "wp_fractional_scale_v1",
        version: 1,
        data: { surfaceId, preferredScale: 0 },
      });
      this.sendPreferredScale(id, surfaceId);
    }
  }

  private sendPreferredScale(objectId: number, surfaceId: number): void {
    const object = this.objects.get(objectId);
    const surface = this.surfaceById(surfaceId);
    if (!object || !surface) return;
    const scale120 = this.server.outputForSurface(surface).scale120;
    if (object.data?.preferredScale === scale120) return;
    object.data = { ...object.data, preferredScale: scale120 };
    this.send(objectId, EV.fractional_scale_preferred_scale, (b) => b.uint(scale120));
  }

  private updateSurfacePreferredScale(surface: SurfaceState): void {
    for (const object of this.objects.values()) {
      if (object.iface === "wp_fractional_scale_v1" && object.data?.surfaceId === surface.id)
        this.sendPreferredScale(object.id, surface.id);
    }
  }

  private handleXdgOutputManager(opcode: number, r: MessageReader): void {
    if (opcode === OP.xdg_output_manager_destroy) return;
    if (opcode !== OP.xdg_output_manager_get) return;
    const id = r.newId();
    const wlOutputId = r.object();
    const wlOutput = this.objects.get(wlOutputId);
    const output = wlOutput?.data?.output as DisplayOutput | undefined;
    if (!output) {
      this.sendError(wlOutputId, 0, "zxdg_output requires a bound wl_output");
      return;
    }
    this.objects.set(id, {
      id,
      iface: "zxdg_output_v1",
      version: 3,
      data: { output },
    });
    this.sendXdgOutputEvents(id, output);
  }

  private sendXdgOutputEvents(id: number, output: DisplayOutput): void {
    this.send(id, EV.xdg_output_logical_position, (b) => b.int(output.x).int(output.y));
    this.send(id, EV.xdg_output_logical_size, (b) =>
      b.int(outputLogicalWidth(output)).int(outputLogicalHeight(output)),
    );
    this.send(id, EV.xdg_output_name, (b) => b.string(output.kms.connectorName));
    this.send(id, EV.xdg_output_description, (b) =>
      b.string(`${output.kms.identity.make} ${output.kms.identity.model}`.trim()),
    );
    this.send(id, EV.xdg_output_done, () => {});
  }

  private handleViewporter(opcode: number, r: MessageReader): void {
    if (opcode !== OP.viewporter_get_viewport) return;
    const id = r.newId();
    const surfaceId = r.object();
    this.objects.set(id, {
      id,
      iface: "wp_viewport",
      version: 1,
      data: { surfaceId },
    });
  }

  private handleViewport(obj: WlObject, opcode: number, r: MessageReader): void {
    if (opcode === OP.viewport_destroy) {
      this.destroyObject(obj.id);
    } else if (opcode === OP.viewport_set_source) {
      obj.data = {
        ...(obj.data ?? {}),
        source: [r.int(), r.int(), r.int(), r.int()],
      };
    } else if (opcode === OP.viewport_set_destination) {
      obj.data = {
        ...(obj.data ?? {}),
        destination: [r.int(), r.int()],
      };
    }
  }

  private handlePresentation(obj: WlObject, opcode: number, r: MessageReader): void {
    if (opcode === OP.presentation_destroy) {
      this.destroyObject(obj.id);
      return;
    }
    if (opcode !== OP.presentation_feedback) return;
    const surfaceId = r.object();
    const feedbackId = r.newId();
    this.objects.set(feedbackId, {
      id: feedbackId,
      iface: "wp_presentation_feedback",
      version: 1,
      data: { surfaceId },
    });
    const surface = this.surfaceById(surfaceId);
    if (!surface) {
      this.sendPresentationDiscarded(feedbackId);
      return;
    }
    surface.pendingPresentationFeedbacks.push(feedbackId);
  }

  private handleXdgActivation(opcode: number, r: MessageReader): void {
    if (opcode === OP.activation_get_token) {
      const id = r.newId();
      this.objects.set(id, {
        id,
        iface: "xdg_activation_token_v1",
        version: 1,
      });
    } else if (opcode === OP.activation_activate) {
      const token = r.string() ?? "";
      const surfaceId = r.object();
      this.server.activateWithToken(token, this, surfaceId);
    }
  }

  private handleXdgActivationToken(obj: WlObject, opcode: number, r: MessageReader): void {
    if (opcode === OP.activation_token_set_serial) {
      r.uint();
      r.object();
    } else if (opcode === OP.activation_token_set_app_id) {
      obj.data = { ...(obj.data ?? {}), appId: r.string() ?? "" };
    } else if (opcode === OP.activation_token_set_surface) {
      obj.data = { ...(obj.data ?? {}), surfaceId: r.object() };
    } else if (opcode === OP.activation_token_commit) {
      const token = this.server.issueActivationToken();
      this.send(obj.id, EV.activation_token_done, (b) => b.string(token));
    }
  }

  private handlePrimarySelectionManager(opcode: number, r: MessageReader): void {
    if (opcode === OP.primary_manager_create_source) {
      const id = r.newId();
      this.objects.set(id, {
        id,
        iface: "zwp_primary_selection_source_v1",
        version: 1,
        data: {
          source: { mimeTypes: [], dndActions: 0 } satisfies DataSourceState,
        },
      });
    } else if (opcode === OP.primary_manager_get_device) {
      const id = r.newId();
      r.object(); // wl_seat
      this.objects.set(id, {
        id,
        iface: "zwp_primary_selection_device_v1",
        version: 1,
      });
      this.primaryDeviceIds.add(id);
      this.sendPrimarySelection(this.server.getPrimarySelection(), id);
    }
  }

  private handlePrimarySelectionSource(obj: WlObject, opcode: number, r: MessageReader): void {
    const source = obj.data?.source as DataSourceState | undefined;
    if (opcode === OP.primary_source_offer) {
      const mime = r.string();
      if (mime && source && !source.mimeTypes.includes(mime)) {
        source.mimeTypes.push(mime);
      }
    } else if (opcode === OP.primary_source_destroy) {
      const selection = this.server.getPrimarySelection();
      if (selection?.sourceSession === this && selection.sourceId === obj.id) {
        this.server.clearPrimarySelection();
      }
      this.destroyObject(obj.id);
    }
  }

  private handlePrimarySelectionDevice(obj: WlObject, opcode: number, r: MessageReader): void {
    if (opcode === OP.primary_device_set_selection) {
      const sourceId = r.object();
      const serial = r.uint();
      this.server.setPrimarySelection(this, sourceId || null, serial);
    } else if (opcode === OP.primary_device_destroy) {
      this.primaryDeviceIds.delete(obj.id);
      this.destroyObject(obj.id);
    }
  }

  private handlePrimarySelectionOffer(obj: WlObject, opcode: number, r: MessageReader): void {
    const offer = obj.data?.offer as PrimaryOfferState | undefined;
    if (opcode === OP.primary_offer_receive) {
      const mime = r.string() ?? "";
      const fd = r.fd();
      const selection = this.server.getPrimarySelection();
      if (
        !offer ||
        !selection ||
        offer.sourceSession !== selection.sourceSession ||
        offer.sourceId !== selection.sourceId
      ) {
        try {
          closeFd(fd);
        } catch {
          // ok
        }
        return;
      }
      this.server.forwardPrimarySelectionReceive(mime, fd);
    } else if (opcode === OP.primary_offer_destroy) {
      this.destroyObject(obj.id);
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
        try {
          closeFd(fd);
        } catch {
          /* ok */
        }
        return;
      }
      if (offer.isDnd) {
        // DnD receive: relay to drag source.
        this.server.forwardDndReceive(offer.sourceSession, offer.sourceId, mime, fd);
      } else {
        // Clipboard receive: only allowed when offer matches current selection.
        const sel = this.server.getSelection();
        if (!sel || sel.sourceSession !== offer.sourceSession || sel.sourceId !== offer.sourceId) {
          try {
            closeFd(fd);
          } catch {
            /* ok */
          }
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
      (actions & WL_DND_ACTION_MOVE) !== 0 ? WL_DND_ACTION_MOVE : WL_DND_ACTION_COPY;
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
      b
        .uint(timeMs >>> 0)
        .fixed(x)
        .fixed(y),
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
  sendSelection(sel: ClipboardSelection | null, onlyDeviceId?: number): void {
    const devices = onlyDeviceId ? [onlyDeviceId] : [...this.dataDeviceIds];
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

  primarySourceMimes(sourceId: number): string[] | null {
    const object = this.objects.get(sourceId);
    if (object?.iface !== "zwp_primary_selection_source_v1") return null;
    const source = object.data?.source as DataSourceState | undefined;
    return source ? [...source.mimeTypes] : null;
  }

  sendPrimarySourceCancelled(sourceId: number): void {
    if (!this.objects.has(sourceId)) return;
    this.send(sourceId, EV.primary_source_cancelled, () => {});
  }

  sendPrimarySourceSend(sourceId: number, mime: string, fd: number): void {
    if (!this.objects.has(sourceId)) {
      try {
        closeFd(fd);
      } catch {
        // ok
      }
      return;
    }
    this.send(sourceId, EV.primary_source_send, (b) => {
      b.string(mime).fd(fd);
    });
    try {
      closeFd(fd);
    } catch {
      // ok
    }
  }

  sendPrimarySelection(selection: PrimarySelection | null, onlyDeviceId?: number): void {
    const devices = onlyDeviceId ? [onlyDeviceId] : [...this.primaryDeviceIds];
    for (const deviceId of devices) {
      if (!this.objects.has(deviceId)) continue;
      if (!selection) {
        this.send(deviceId, EV.primary_device_selection, (b) => b.object(0));
        continue;
      }
      const offerId = this.allocServerId();
      const offer: PrimaryOfferState = {
        sourceSession: selection.sourceSession,
        sourceId: selection.sourceId,
        mimeTypes: [...selection.mimeTypes],
        deviceId,
      };
      this.objects.set(offerId, {
        id: offerId,
        iface: "zwp_primary_selection_offer_v1",
        version: 1,
        data: { offer },
      });
      this.send(deviceId, EV.primary_device_data_offer, (b) => b.newId(offerId));
      for (const mime of selection.mimeTypes) {
        this.send(offerId, EV.primary_offer_offer, (b) => b.string(mime));
      }
      this.send(deviceId, EV.primary_device_selection, (b) => b.object(offerId));
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

  private handleXdgToplevelDecoration(obj: WlObject, opcode: number, r: MessageReader): void {
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
        console.log(`[deco] set_mode CLIENT toplevel=${toplevelId} surface=${surface?.id ?? "?"}`);
      } else {
        if (surface) surface.decoration = "server";
        this.send(obj.id, EV.xdg_toplevel_decoration_configure, (b) =>
          b.uint(XDG_DECORATION_MODE_SERVER),
        );
        console.log(`[deco] set_mode SERVER toplevel=${toplevelId} surface=${surface?.id ?? "?"}`);
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
        pendingDamage: [],
        damage: [],
        pendingPresentationFeedbacks: [],
        presentationFeedbacks: [],
        readyPresentationFeedbacks: [],
        presentationReady: false,
        mapped: false,
        enteredOutputIds: new Set(),
        x: 0,
        y: 0,
        subX: 0,
        subY: 0,
        width: 0,
        height: 0,
        bufferWidth: 0,
        bufferHeight: 0,
        bufferScale: 1,
        stride: 0,
        title: "",
        appId: "",
        pixels: null,
        revision: 0,
        opaque: false,
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
        this.server.markDirty();
        // Rootful Xwayland has no CSD — give it Moire SSD.
        if (surface.decoration === "none" && /^Xwayland\b/i.test(title)) {
          surface.decoration = "server";
        }
      }
    } else if (opcode === OP.xdg_toplevel_set_app_id) {
      const appId = r.string() ?? "";
      if (surface) {
        surface.appId = appId;
        this.server.markDirty();
      }
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
          surface.bufferWidth = buf.width;
          surface.bufferHeight = buf.height;
          surface.width = Math.max(1, Math.round(buf.width / surface.bufferScale));
          surface.height = Math.max(1, Math.round(buf.height / surface.bufferScale));
        }
      }
    } else if (opcode === OP.surface_damage || opcode === OP.surface_damage_buffer) {
      const x = r.int();
      const y = r.int();
      const width = r.int();
      const height = r.int();
      if (width > 0 && height > 0) {
        const scale = opcode === OP.surface_damage ? surface.bufferScale : 1;
        surface.pendingDamage.push({
          x: x * scale,
          y: y * scale,
          width: width * scale,
          height: height * scale,
        });
      }
    } else if (opcode === OP.surface_set_opaque_region || opcode === OP.surface_set_input_region) {
      r.object();
    } else if (opcode === OP.surface_set_buffer_transform) {
      r.int();
    } else if (opcode === OP.surface_set_buffer_scale) {
      surface.bufferScale = Math.max(1, r.int());
    } else if (opcode === OP.surface_frame) {
      const cbId = r.newId();
      this.objects.set(cbId, { id: cbId, iface: "wl_callback", version: 1 });
      surface.frameCallbacks.push(cbId);
    } else if (opcode === OP.surface_commit) {
      surface.damage.push(...surface.pendingDamage);
      surface.pendingDamage = [];
      // A new commit supersedes only a previous commit which has not yet been
      // composited. Feedback already moved to readyPresentationFeedbacks must
      // survive until the output presentation completes.
      for (const feedbackId of surface.presentationFeedbacks) {
        this.sendPresentationDiscarded(feedbackId);
      }
      surface.presentationFeedbacks = surface.pendingPresentationFeedbacks;
      surface.pendingPresentationFeedbacks = [];
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
          console.error(`[surface] commit missing buffer id=${surface.bufferId}`);
          surface.bufferAttached = false;
        } else {
          try {
            if (buf.kind === "shm") {
              const pool = buf.pool;
              if (!pool.map) {
                throw new Error(`shm pool gone poolId=${buf.poolId} buf=${surface.bufferId}`);
              }
              const byteLen = buf.stride * buf.height;
              surface.pixels = copyFromPool(pool, buf.offset, byteLen, surface.pixels);
              surface.stride = buf.stride;
              // wl_shm XRGB8888 leaves A=0 — blit skips those pixels.
              if (buf.format === WL_SHM_FORMAT_XRGB8888) {
                forceOpaqueAlpha(surface.pixels);
              }
              surface.opaque = buf.format === WL_SHM_FORMAT_XRGB8888;
            } else {
              const snapped = copyFromDmabuf(buf, this.server.getGbm(), surface.pixels);
              surface.pixels = snapped.pixels;
              surface.stride = snapped.stride;
              // DRM XRGB8888 (Xwayland Glamor) same issue — A unused/zero.
              if (buf.format === DRM_FORMAT_XRGB8888) {
                forceOpaqueAlpha(surface.pixels);
              }
              surface.opaque = buf.format === DRM_FORMAT_XRGB8888;
            }
            surface.revision++;
            surface.bufferWidth = buf.width;
            surface.bufferHeight = buf.height;
            const viewport = [...this.objects.values()].find(
              (item) => item.iface === "wp_viewport" && item.data?.surfaceId === surface.id,
            );
            const destination = viewport?.data?.destination as [number, number] | undefined;
            surface.width =
              destination && destination[0] > 0
                ? destination[0]
                : Math.max(1, Math.round(buf.width / surface.bufferScale));
            surface.height =
              destination && destination[1] > 0
                ? destination[1]
                : Math.max(1, Math.round(buf.height / surface.bufferScale));
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
              if (firstMap) this.server.fitToplevelToOutput(this, surface.id);
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
            if (surface.role !== "cursor" && process.env.MOIRE_DEBUG_SURFACE === "1") {
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
        // Explicit attach(null) unmaps the surface and leaves every output.
        surface.bufferAttached = false;
        surface.mapped = false;
        surface.pixels = null;
        surface.opaque = false;
        surface.revision++;
        this.clearSurfaceOutputs(surface);
      }
      this.updateSurfaceOutputs(surface);
      // Commits (buffer, frame callback, or xwayland serial) need a composite pass.
      this.server.markDirty();
    } else if (opcode === OP.surface_destroy) {
      if (surface.role === "toplevel") {
        this.server.unregisterToplevel(this, surface.id);
      } else if (surface.role === "popup") {
        this.server.dismissPopup(this, surface.id, false);
      }
      for (const feedbackId of [
        ...surface.pendingPresentationFeedbacks,
        ...surface.presentationFeedbacks,
        ...surface.readyPresentationFeedbacks,
      ]) {
        this.sendPresentationDiscarded(feedbackId);
      }
      surface.pendingPresentationFeedbacks = [];
      surface.presentationFeedbacks = [];
      surface.readyPresentationFeedbacks = [];
      surface.pendingDamage = [];
      surface.damage = [];
      this.finishSurfaceFrame(surface);
      surface.presentationReady = false;
      this.clearSurfaceOutputs(surface);
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
      const surface = this.objects.get(wlSurfaceId)?.data?.surface as SurfaceState | undefined;
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
        this.configureToplevel(surface, 0, 0, [XDG_TOPLEVEL_STATE_ACTIVATED]);
      }
    } else if (opcode === OP.xdg_surface_get_popup) {
      const id = r.newId();
      const parentXdgId = r.object(); // nullable
      const positionerId = r.object();
      const wlSurfaceId = obj.data!.wlSurfaceId as number;
      const parentXdg = parentXdgId ? this.objects.get(parentXdgId) : undefined;
      const parentWlId = (parentXdg?.data?.wlSurfaceId as number | undefined) ?? null;
      const posObj = this.objects.get(positionerId);
      const posSnap: PositionerState = {
        ...((posObj?.data?.positioner as PositionerState | undefined) ?? emptyPositioner()),
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

      const surface = this.objects.get(wlSurfaceId)?.data?.surface as SurfaceState | undefined;
      if (!surface || parentWlId == null) {
        console.warn(`[popup] get_popup missing surface/parent popup=${id} parent=${parentXdgId}`);
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
      const origin = parent ? this.server.windowGeomOrigin(parent) : { x: 0, y: 0 };
      const placed = placePopupRelative(posSnap, kms.width, kms.height, origin.x, origin.y);
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
        console.warn(`[popup] grab serial=${serial} ahead of lastInput=${last} — accepting`);
      }
      surface.popupGrabbed = true;
      this.server.registerPopup(this, surface.id);
      // Keyboard focus on the popup for arrow-key menu navigation.
      this.server.setFocusedSession(this);
      this.keyboardEnter(surface.id);
      console.log(`[popup] grab surface=${surface.id} serial=${serial} lastInput=${last}`);
    } else if (opcode === OP.xdg_popup_reposition) {
      const positionerId = r.object();
      const token = r.uint();
      if (!surface) return;
      const posObj = this.objects.get(positionerId);
      const posSnap: PositionerState = {
        ...((posObj?.data?.positioner as PositionerState | undefined) ?? emptyPositioner()),
      };
      const parent = surface.parentId ? this.surfaceById(surface.parentId) : null;
      const kms = this.server.getKmsSize();
      const origin = parent ? this.server.windowGeomOrigin(parent) : { x: 0, y: 0 };
      const placed = placePopupRelative(posSnap, kms.width, kms.height, origin.x, origin.y);
      surface.popupRelX = placed.x;
      surface.popupRelY = placed.y;
      surface.popupConfW = placed.w;
      surface.popupConfH = placed.h;
      this.server.layoutPopup(this, surface);
      this.send(obj.id, EV.xdg_popup_repositioned, (b) => b.uint(token));
      this.configurePopup(surface, placed.x, placed.y, placed.w, placed.h);
    }
  }

  configurePopup(surface: SurfaceState, x: number, y: number, width: number, height: number): void {
    if (surface.xdgPopupId == null || surface.xdgSurfaceId == null) return;
    this.send(surface.xdgPopupId, EV.xdg_popup_configure, (b) => {
      b.int(x).int(y).int(width).int(height);
    });
    const serial = this.serial++;
    this.send(surface.xdgSurfaceId, EV.xdg_surface_configure, (b) => b.uint(serial));
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

  sendPresentationPresented(
    id: number,
    feedback: KmsPresentationFeedback,
    refreshNs: number,
  ): void {
    if (!this.objects.has(id)) return;
    const seconds = BigInt(Math.max(0, Math.floor(feedback.seconds)));
    const sequence = BigInt(Math.max(0, Math.floor(feedback.sequence)));
    const flags =
      (feedback.vsync ? 1 : 0) |
      (feedback.hardwareClock ? 2 : 0) |
      (feedback.hardwareCompletion ? 4 : 0);
    this.send(id, EV.presentation_feedback_presented, (b) =>
      b
        .uint(Number((seconds >> 32n) & 0xffffffffn))
        .uint(Number(seconds & 0xffffffffn))
        .uint(feedback.nanoseconds)
        .uint(refreshNs)
        .uint(Number((sequence >> 32n) & 0xffffffffn))
        .uint(Number(sequence & 0xffffffffn))
        .uint(flags),
    );
    this.deleteId(id);
  }

  sendPresentationDiscarded(id: number): void {
    if (!this.objects.has(id)) return;
    this.send(id, EV.presentation_feedback_discarded, () => {});
    this.deleteId(id);
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

  private handleLinuxBufferParams(obj: WlObject, opcode: number, r: MessageReader): void {
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
        this.send(obj.id, EV.linux_buffer_params_created, (b) => b.uint(bufferId));
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
        closeDmabufPlanes(buf.planes, this.server.getGbm());
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

  private send(objectId: number, opcode: number, build: (b: MessageBuilder) => void): void {
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
