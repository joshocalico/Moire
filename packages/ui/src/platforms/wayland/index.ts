/**
 * Wayland PlatformBackend — xdg_toplevel + wl_shm + seat.
 * Only platforms/wayland may import protocol / sys / OS APIs.
 */
import fs from "node:fs";
import { WindowRenderingTracker, type ClientSubmission } from "./rendering";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import {
  MessageReader,
  WL_HEADER_SIZE,
  decodeHeader,
  type EncodedWaylandMessage,
} from "@moire/protocol";
import {
  wlBuffer,
  wlCallback,
  wlCompositor,
  wlDataDevice,
  wlDataDeviceManager,
  wlDataOffer,
  wlDataSource,
  wlDisplay,
  wlKeyboard,
  wlPointer,
  wlRegistry,
  wlSeat,
  wlShm,
  wlShmPool,
  wlSurface,
  wpPresentation,
  wpPresentationFeedback,
  xdgPopup,
  xdgPositioner,
  xdgSurface,
  xdgToplevel,
  xdgWmBase,
  zwpLinuxBufferParamsV1,
  zwpLinuxDmabufV1,
  zxdgDecorationManagerV1,
  zxdgToplevelDecorationV1,
} from "@moire/protocol/generated";
import { moireSurfaceStateManagerV1, moireSurfaceStateV1 } from "@moire/protocol/surface-state";
import {
  EglOutputScaler,
  WaylandClientConn,
  assertLinux,
  closeFd,
  createMemfd,
  createInputFixtureTrace,
  createPipe,
  flushMmap,
  mmap,
  munmap,
  openPath,
  MAP_SHARED,
  O_CLOEXEC,
  O_RDWR,
  PROT_READ,
  PROT_WRITE,
  truncateFd,
  type InputFixtureTrace,
  type EglClientPresent,
  type WaylandChunk,
} from "@moire/sys";
import { createElement } from "react";
import {
  createShellRoot,
  rasterize,
  renderShell,
  Group,
  Rect,
  Text,
  type RetainedClip,
  type RetainedSceneFrame,
} from "@moire/react-host";
import { themePalette } from "#ui/theme";
import {
  type DndCapable,
  type PlatformBackend,
  type PlatformDiagnostics,
  type PersonalizationProfile,
  type PlatformPopupOpts,
  type PlatformWindow,
  type PlatformWindowOpts,
  type UiKeyEvent,
  type UiFrameEvent,
  type UiPresentationMode,
  type UiSurfaceVisibility,
  type UiRenderingState,
  type UiPointerEvent,
  platformPersonalization,
  type PointerButton,
} from "#ui/platform";
import {
  setDndBridge,
  notifyDrop,
  notifyDropHover,
  preferredDropMimes,
  notifyDragEnded,
  type DragPreviewSpec,
} from "#ui/widgets/dnd";
import { updateActiveWindowDropHover, clearActiveWindowDropHover } from "#ui/window";
import { Icon } from "#ui/widgets/icon";
import { GridItem } from "#ui/widgets/grid";
import { ListItem } from "#ui/widgets/list";
import { WaylandKeyboard } from "./keyboard";
import type { KeymapAvailability } from "./keymap-types";
import { classifyShmFrame, validateShmFrame, type ShmFrame } from "./shm-format";

const WL_DISPLAY_ID = 1;
const WL_SHM_FORMAT_ARGB8888 = wlShm.enums.format.argb8888;
const BTN_LEFT = 0x110;
const BTN_RIGHT = 0x111;
const BTN_MIDDLE = 0x112;
const XDG_DECORATION_MODE_CLIENT = zxdgToplevelDecorationV1.enums.mode.clientSide;
const XDG_DECORATION_MODE_SERVER = zxdgToplevelDecorationV1.enums.mode.serverSide;
const XDG_ANCHOR_TOP_LEFT = xdgPositioner.enums.anchor.topLeft;
const XDG_CONSTRAINT_SLIDE_X = xdgPositioner.enums.constraintAdjustment.slideX;
const XDG_CONSTRAINT_SLIDE_Y = xdgPositioner.enums.constraintAdjustment.slideY;

const EV = {
  display_error: wlDisplay.events.error.opcode,
  display_delete_id: wlDisplay.events.deleteId.opcode,
  registry_global: wlRegistry.events.global.opcode,
  callback_done: wlCallback.events.done.opcode,
  buffer_release: wlBuffer.events.release.opcode,
  linux_dmabuf_format: zwpLinuxDmabufV1.events.format.opcode,
  linux_dmabuf_modifier: zwpLinuxDmabufV1.events.modifier.opcode,
  seat_capabilities: wlSeat.events.capabilities.opcode,
  pointer_enter: wlPointer.events.enter.opcode,
  pointer_leave: wlPointer.events.leave.opcode,
  pointer_motion: wlPointer.events.motion.opcode,
  pointer_button: wlPointer.events.button.opcode,
  pointer_axis: wlPointer.events.axis.opcode,
  xdg_wm_base_ping: xdgWmBase.events.ping.opcode,
  xdg_surface_configure: xdgSurface.events.configure.opcode,
  xdg_toplevel_configure: xdgToplevel.events.configure.opcode,
  xdg_toplevel_close: xdgToplevel.events.close.opcode,
  xdg_popup_configure: xdgPopup.events.configure.opcode,
  xdg_popup_done: xdgPopup.events.popupDone.opcode,
  // wl_data_source events (compositor → client/source)
  data_source_send: wlDataSource.events.send.opcode,
  data_source_cancelled: wlDataSource.events.cancelled.opcode,
  data_source_dnd_drop_performed: wlDataSource.events.dndDropPerformed.opcode,
  data_source_dnd_finished: wlDataSource.events.dndFinished.opcode,
  // wl_data_device events (compositor → client/target)
  data_device_data_offer: wlDataDevice.events.dataOffer.opcode,
  data_device_enter: wlDataDevice.events.enter.opcode,
  data_device_leave: wlDataDevice.events.leave.opcode,
  data_device_motion: wlDataDevice.events.motion.opcode,
  data_device_drop: wlDataDevice.events.drop.opcode,
  data_device_selection: wlDataDevice.events.selection.opcode,
  // wl_data_offer events (compositor → client)
  data_offer_offer: wlDataOffer.events.offer.opcode,
  data_offer_source_actions: wlDataOffer.events.sourceActions.opcode,
  data_offer_action: wlDataOffer.events.action.opcode,
  presentation_clock_id: wpPresentation.events.clockId.opcode,
  presentation_feedback_sync_output: wpPresentationFeedback.events.syncOutput.opcode,
  presentation_feedback_presented: wpPresentationFeedback.events.presented.opcode,
  presentation_feedback_discarded: wpPresentationFeedback.events.discarded.opcode,
} as const;

/** DnD action bitmask constants. */
const WL_DND_ACTION_COPY = wlDataDeviceManager.enums.dndAction.copy;
const WL_DND_ACTION_MOVE = wlDataDeviceManager.enums.dndAction.move;

type GlobalInfo = { name: number; iface: string; version: number };

type ShmSlot = {
  fd: number;
  size: number;
  map: unknown;
  poolId: number;
  /** Geometry and format belong to this immutable wl_buffer object. */
  buffer: Readonly<{ id: number; frame: ShmFrame }>;
  busy: boolean;
  commitId: number;
  submittedAtMs: number;
};

type DmabufSlot = {
  frameId: string;
  bufferId: number;
  commitId: number;
  submittedAtMs: number;
};

function waylandSocketPath(): string {
  const runtime =
    process.env.XDG_RUNTIME_DIR ?? path.join(os.tmpdir(), `moire-${process.getuid?.() ?? 0}`);
  const display = process.env.WAYLAND_DISPLAY ?? "wayland-0";
  return path.join(runtime, display);
}

function memfdCreate(size: number): number {
  const fd = createMemfd("moire-ui-shm", 1);
  try {
    truncateFd(fd, size);
  } catch (error) {
    closeFd(fd);
    throw error;
  }
  return fd;
}

function buttonName(code: number): PointerButton | undefined {
  if (code === BTN_LEFT) return "left";
  if (code === BTN_RIGHT) return "right";
  if (code === BTN_MIDDLE) return "middle";
  return undefined;
}

type ClientCompositionPresent =
  | { kind: "dmabuf"; frame: EglClientPresent }
  | {
      kind: "shm";
      frame: ReturnType<EglOutputScaler["renderClientCompositionReadback"]>;
    };

const inputFixtureTrace = createInputFixtureTrace("app");
function stopUnexpectedInputFocus(): void {
  try {
    if (inputFixtureTrace.active()) inputFixtureTrace.stop("focus");
  } catch {
    // Diagnostic policy/IO failure cannot suppress a production focus/input event.
  }
}

export class WaylandPlatform implements PlatformBackend, DndCapable {
  readonly name = "wayland";
  private conn: WaylandClientConn | null = null;
  private nextId = 2;
  private buf = Buffer.alloc(0);
  private pendingFds: number[] = [];
  private globals = new Map<string, GlobalInfo>();
  private handlers = new Map<number, (opcode: number, r: MessageReader) => void>();
  private syncWaiters = new Map<number, () => void>();
  private registryId = 0;
  private compositorId = 0;
  private shmId = 0;
  private dmabufId = 0;
  private presentationId = 0;
  private surfaceStateManagerId = 0;
  private surfaceStateVersion = 0;
  private eglPresenter: EglOutputScaler | null = null;
  private eglFd = -1;
  private eglTransport: "dmabuf" | "readback" | "software" = "software";
  private renderNode: string | undefined;
  private fallbackReason: string | undefined;
  private retainedFrames = 0;
  private softwareFrames = 0;
  private dmabufFrames = 0;
  private shmFrames = 0;
  private wmBaseId = 0;
  private decoManagerId = 0;
  private seatId = 0;
  private seatVersion = 0;
  private pointerId = 0;
  private keyboardId = 0;
  private readonly retiredKeyboardIds = new Set<number>();
  private pressedKeys = new Set<number>();
  /** wl_data_device_manager object id. */
  private dataDeviceManagerId = 0;
  /** wl_data_device for the seat. */
  private dataDeviceId = 0;
  private clipboardSource: { sourceId: number; text: string } | null = null;
  private clipboardOfferId: number | null = null;
  private readonly dataOfferMimes = new Map<number, string[]>();
  /** Active drag: data source and payload resolver. */
  private activeDrag: {
    sourceId: number;
    iconSurfaceId: number;
    getPayload: (mime: string) => string | Buffer | null;
  } | null = null;
  /** Incoming DnD offer while this client is a drop target. */
  private incomingOffer: {
    offerId: number;
    mimes: string[];
    serial: number;
    /** Latest window-local drop position from enter/motion. */
    x: number;
    y: number;
  } | null = null;
  /** Latest seat input serial, usable for pointer and keyboard popup grabs. */
  private lastPointerSerial = 0;
  /** Surface id of the currently focused window for DnD origin. */
  private pointerSurfaceId = 0;
  private windows = new Set<WaylandWindow>();
  private surfaceToWindow = new Map<number, WaylandWindow>();
  private pointerFocus: WaylandWindow | null = null;
  private pointerX = 0;
  private pointerY = 0;
  private keyboard = new WaylandKeyboard({
    pressedKeys: this.pressedKeys,
    resolveSurface: (surfaceId) => this.surfaceToWindow.get(surfaceId) ?? null,
    emitKey: (window, event) => window.emitKey(event),
    onFocus: (type, surfaceId, window) => {
      if (window) window.observeInputFocus("keyboard", type, surfaceId);
      else stopUnexpectedInputFocus();
    },
    // Popup grabs accept the serial from either a pointer or keyboard action.
    onSerial: (serial) => {
      this.lastPointerSerial = serial;
    },
  });

  allocId(): number {
    return this.nextId++;
  }

  async connect(): Promise<void> {
    assertLinux("Wayland UI platform");
    const sockPath = waylandSocketPath();
    if (!fs.existsSync(sockPath)) {
      throw new Error(`Wayland socket not found: ${sockPath}`);
    }
    const sock = net.createConnection(sockPath);
    await once(sock, "connect");
    this.conn = new WaylandClientConn(sock);
    this.conn.on("message", (chunk: WaylandChunk) => this.onChunk(chunk));
    this.conn.on("close", () => {
      this.conn = null;
      if (this.keyboardId) this.handlers.delete(this.keyboardId);
      for (const id of this.retiredKeyboardIds) this.handlers.delete(id);
      this.retiredKeyboardIds.clear();
      this.keyboardId = 0;
      this.keyboard.disconnect();
      this.releasePendingInputFds();
      this.retireVisibilityObservations();
    });

    this.handlers.set(WL_DISPLAY_ID, (opcode, r) => {
      if (opcode === EV.display_error) {
        const event = wlDisplay.events.error.decodeReader(r);
        console.error(`[ui/wayland] display.error code=${event.code} ${event.message}`);
      } else if (opcode === EV.display_delete_id) {
        const { id } = wlDisplay.events.deleteId.decodeReader(r);
        if (this.retiredKeyboardIds.delete(id)) this.handlers.delete(id);
      }
    });

    this.registryId = this.allocId();
    this.handlers.set(this.registryId, (opcode, r) => {
      if (opcode !== EV.registry_global) return;
      const event = wlRegistry.events.global.decodeReader(r);
      const name = event.name;
      const iface = event.interfaceValue!;
      const version = event.version;
      this.globals.set(iface, { name, iface, version });
    });
    this.sendMessage(wlDisplay.requests.getRegistry.encode(WL_DISPLAY_ID, this.registryId));
    await this.roundtrip();

    this.compositorId = this.bindGlobal("wl_compositor", 4);
    this.shmId = this.bindGlobal("wl_shm", 1);
    this.handlers.set(this.shmId, () => {});
    if (this.globals.has(moireSurfaceStateManagerV1.name)) {
      this.surfaceStateVersion = Math.min(
        this.globals.get(moireSurfaceStateManagerV1.name)?.version ?? 1,
        2,
      );
      this.surfaceStateManagerId = this.bindGlobal(
        moireSurfaceStateManagerV1.name,
        this.surfaceStateVersion,
      );
    }
    if (this.globals.has("wp_presentation")) {
      this.presentationId = this.bindGlobal("wp_presentation", 1);
      this.handlers.set(this.presentationId, (opcode, r) => {
        if (opcode !== EV.presentation_clock_id) return;
        wpPresentation.events.clockId.decodeReader(r);
      });
    }
    if (this.globals.has("zwp_linux_dmabuf_v1")) {
      this.dmabufId = this.bindGlobal("zwp_linux_dmabuf_v1", 4);
      this.handlers.set(this.dmabufId, (opcode, r) => {
        if (opcode === EV.linux_dmabuf_format) {
          zwpLinuxDmabufV1.events.format.decodeReader(r);
        } else if (opcode === EV.linux_dmabuf_modifier) {
          zwpLinuxDmabufV1.events.modifier.decodeReader(r);
        }
      });
      this.tryCreateEglPresenter();
    }
    this.wmBaseId = this.bindGlobal("xdg_wm_base", 3);
    this.handlers.set(this.wmBaseId, (opcode, r) => {
      if (opcode === EV.xdg_wm_base_ping) {
        const { serial } = xdgWmBase.events.ping.decodeReader(r);
        this.sendMessage(xdgWmBase.requests.pong.encode(this.wmBaseId, serial));
      }
    });
    if (this.globals.has("zxdg_decoration_manager_v1")) {
      this.decoManagerId = this.bindGlobal("zxdg_decoration_manager_v1", 1);
    }

    if (this.globals.has("wl_seat")) {
      this.seatVersion = Math.min(this.globals.get("wl_seat")?.version ?? 0, 5);
      this.seatId = this.bindGlobal("wl_seat", 5);
      this.handlers.set(this.seatId, (opcode, r) => this.handleSeatCapabilities(opcode, r));
    }

    // Bind wl_data_device_manager and get a wl_data_device for the seat.
    if (this.globals.has("wl_data_device_manager") && this.seatId) {
      this.dataDeviceManagerId = this.bindGlobal("wl_data_device_manager", 3);
      this.handlers.set(this.dataDeviceManagerId, () => {});
      this.dataDeviceId = this.allocId();
      this.sendMessage(
        wlDataDeviceManager.requests.getDataDevice.encode(
          this.dataDeviceManagerId,
          this.dataDeviceId,
          this.seatId,
        ),
      );
      this.handlers.set(this.dataDeviceId, (op, rr) => this.handleDataDevice(op, rr));
    }

    await this.roundtrip();

    // Wire the DnD bridge so Draggable widgets call startDrag.
    setDndBridge({
      startDrag: (payload, mimeTypes, opts) => {
        const mime0 = mimeTypes[0];
        if (!mime0 || !this.conn) return;
        const label = opts.label;
        this.startDrag(
          mimeTypes,
          (mime) => {
            if (typeof payload === "string" || Buffer.isBuffer(payload)) {
              return payload;
            }
            if (Array.isArray(payload)) {
              if (mime === "text/uri-list") return payload.join("\r\n");
              if (mime === "text/plain") return payload.join("\n");
            }
            try {
              return JSON.stringify(payload);
            } catch {
              return null;
            }
          },
          this.lastPointerSerial,
          label,
          opts,
        );
      },
    });
  }

  startDrag(
    mimeTypes: string[],
    getPayload: (mime: string) => string | Buffer | null,
    serial: number,
    label?: string,
    preview?: DragPreviewSpec,
  ): void {
    if (!this.conn || !this.dataDeviceManagerId || !this.dataDeviceId) return;
    if (this.activeDrag) {
      try {
        this.sendMessage(wlDataSource.requests.destroy.encode(this.activeDrag.sourceId));
      } catch {
        /* ok */
      }
      this.destroyDragIcon(this.activeDrag.iconSurfaceId);
      this.activeDrag = null;
      // Preempted before the compositor ever sent cancelled/finished for it —
      // the old Draggable would otherwise never learn its drag ended and
      // stay stuck showing the dragging outline.
      notifyDragEnded();
    }

    const sourceId = this.allocId();
    this.sendMessage(
      wlDataDeviceManager.requests.createDataSource.encode(this.dataDeviceManagerId, sourceId),
    );
    for (const mime of mimeTypes) {
      this.sendMessage(wlDataSource.requests.offer.encode(sourceId, mime));
    }
    const actions = WL_DND_ACTION_COPY | WL_DND_ACTION_MOVE;
    this.sendMessage(wlDataSource.requests.setActions.encode(sourceId, actions));

    const chipLabel = (label && label.trim()) || "Item";
    const iconSurfaceId = this.createDragIconSurface(chipLabel, preview);

    this.activeDrag = { sourceId, iconSurfaceId, getPayload };

    this.handlers.set(sourceId, (op, rr) => this.handleDataSource(op, rr, sourceId));

    // start_drag(source, origin, icon, serial)
    this.sendMessage(
      wlDataDevice.requests.startDrag.encode(
        this.dataDeviceId,
        sourceId,
        this.pointerSurfaceId,
        iconSurfaceId,
        serial,
      ),
    );
    console.log(
      `[ui/dnd] startDrag source=${sourceId} icon=${iconSurfaceId} label=${chipLabel} serial=${serial}`,
    );
  }

  /**
   * Build a source-sized drag icon and anchor it at the original grab point.
   * The attach offset is the standard Wayland drag-icon hotspot mechanism;
   * Moire's compositor applies it only while painting this role-less surface.
   */
  private createDragIconSurface(label: string, preview?: DragPreviewSpec): number {
    const pal = themePalette();
    const root = createShellRoot();
    const icon = preview?.icon;
    const chipW = Math.max(24, Math.round(preview?.width ?? 96));
    const chipH = Math.max(24, Math.round(preview?.height ?? 40));
    const hotspotX = Math.max(0, Math.min(chipW, Math.round(preview?.hotspotX ?? 0)));
    const hotspotY = Math.max(0, Math.min(chipH, Math.round(preview?.hotspotY ?? 0)));

    if (icon) {
      const listLike = chipW > chipH * 2;
      const iconSize = listLike
        ? Math.max(16, Math.min(24, chipH - 12))
        : Math.max(24, Math.min(56, chipH - 38));
      renderShell(
        root,
        createElement(
          Group,
          { x: 0, y: 0, width: chipW, height: chipH, opacity: 0.68 },
          listLike
            ? createElement(ListItem, {
                width: chipW,
                height: chipH,
                title: label,
                selected: true,
                interactive: false,
                leading: createElement(Icon, {
                  name: icon.name,
                  size: iconSize,
                  color: icon.color,
                }),
              })
            : createElement(GridItem, {
                width: chipW,
                height: chipH,
                label,
                iconSize,
                selected: true,
                interactive: false,
                icon: createElement(Icon, {
                  name: icon.name,
                  size: iconSize,
                  color: icon.color,
                }),
              }),
        ),
      );
    } else {
      const text = label.length > 26 ? label.slice(0, 25) + "…" : label;
      const padX = 12;
      renderShell(
        root,
        createElement(
          Group,
          { x: 0, y: 0, width: chipW, height: chipH },
          createElement(Rect, {
            x: 0,
            y: 0,
            width: chipW,
            height: chipH,
            fill: (pal.surface & 0x00ffffff) | 0xf2000000,
          }),
          createElement(Rect, {
            x: 0,
            y: 0,
            width: chipW,
            height: 1,
            fill: pal.rimLight,
          }),
          createElement(Rect, {
            x: 0,
            y: 0,
            width: 3,
            height: chipH,
            fill: pal.accentLine,
          }),
          createElement(Text, {
            x: padX,
            y: 11,
            text,
            color: pal.text,
            fontSize: 13,
          }),
        ),
      );
    }
    const { pixels } = rasterize(root.container, chipW, chipH);
    const stride = chipW * 4;
    const size = stride * chipH;

    const surfaceId = this.allocId();
    this.sendMessage(wlCompositor.requests.createSurface.encode(this.compositorId, surfaceId));

    const fd = memfdCreate(size);
    const map = mmap(size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    flushMmap(map, pixels, size);

    const poolId = this.allocId();
    this.sendMessage(wlShm.requests.createPool.encode(this.shmId, poolId, fd, size));
    const bufferId = this.allocId();
    this.sendMessage(
      wlShmPool.requests.createBuffer.encode(
        poolId,
        bufferId,
        0,
        chipW,
        chipH,
        stride,
        WL_SHM_FORMAT_ARGB8888,
      ),
    );
    this.sendMessage(wlSurface.requests.attach.encode(surfaceId, bufferId, -hotspotX, -hotspotY));
    this.sendMessage(wlSurface.requests.damage.encode(surfaceId, 0, 0, chipW, chipH));
    this.sendMessage(wlSurface.requests.commit.encode(surfaceId));

    // Keep map alive for the duration of the drag (compositor may read async).
    (this as unknown as { _dragIconMaps?: unknown[] })._dragIconMaps ??= [];
    (this as unknown as { _dragIconMaps: unknown[] })._dragIconMaps.push({
      map,
      fd,
      poolId,
      bufferId,
      surfaceId,
      size,
    });
    return surfaceId;
  }

  private destroyDragIcon(surfaceId: number): void {
    if (!surfaceId) return;
    try {
      this.sendMessage(wlSurface.requests.destroy.encode(surfaceId));
    } catch {
      /* ok */
    }
    const bag = (
      this as unknown as {
        _dragIconMaps?: {
          surfaceId: number;
          map: ReturnType<typeof mmap>;
          fd: number;
          size: number;
        }[];
      }
    )._dragIconMaps;
    if (!bag) return;
    const idx = bag.findIndex((x) => x.surfaceId === surfaceId);
    if (idx < 0) return;
    const slot = bag.splice(idx, 1)[0]!;
    try {
      munmap(slot.map, slot.size);
    } catch {
      /* ok */
    }
    try {
      closeFd(slot.fd);
    } catch {
      /* ok */
    }
  }

  async writeClipboardText(text: string): Promise<void> {
    if (!this.conn || !this.dataDeviceManagerId || !this.dataDeviceId)
      throw new Error("Wayland seat clipboard unavailable");
    if (Buffer.byteLength(text, "utf8") > 8 * 1024 * 1024)
      throw new Error("Clipboard text exceeds 8 MiB");
    const sourceId = this.allocId();
    this.sendMessage(
      wlDataDeviceManager.requests.createDataSource.encode(this.dataDeviceManagerId, sourceId),
    );
    this.handlers.set(sourceId, (opcode, reader) => {
      if (opcode === EV.data_source_send) {
        const event = wlDataSource.events.send.decodeReader(reader);
        // The receiver may cancel while we send. Stream writes avoid blocking
        // the protocol dispatcher and contain EPIPE without killing the app.
        const transfer = fs.createWriteStream("", {
          fd: event.fd,
          autoClose: true,
        });
        transfer.on("error", () => {
          /* cancelled clipboard transfer */
        });
        transfer.end(Buffer.from(text, "utf8"));
      } else if (opcode === EV.data_source_cancelled) {
        if (this.clipboardSource?.sourceId === sourceId) this.clipboardSource = null;
        this.handlers.delete(sourceId);
        this.sendMessage(wlDataSource.requests.destroy.encode(sourceId));
      }
    });
    for (const mime of ["text/plain;charset=utf-8", "text/plain", "UTF8_STRING"])
      this.sendMessage(wlDataSource.requests.offer.encode(sourceId, mime));
    this.clipboardSource = { sourceId, text };
    this.sendMessage(
      wlDataDevice.requests.setSelection.encode(
        this.dataDeviceId,
        sourceId,
        this.lastPointerSerial,
      ),
    );
  }

  async readClipboardText(): Promise<string> {
    if (this.clipboardSource) return this.clipboardSource.text;
    if (!this.clipboardOfferId) return "";
    const mimes = this.dataOfferMimes.get(this.clipboardOfferId) ?? [];
    const mime = ["text/plain;charset=utf-8", "UTF8_STRING", "text/plain"].find((item) =>
      mimes.includes(item),
    );
    if (!mime) throw new Error("Clipboard selection does not contain text");
    return (await this.receiveOfferData(this.clipboardOfferId, mime)).toString("utf8");
  }

  private handleDataSource(opcode: number, r: MessageReader, sourceId: number): void {
    if (opcode === EV.data_source_send) {
      const event = wlDataSource.events.send.decodeReader(r);
      const mime = event.mimeType ?? "";
      const fd = event.fd;
      const drag = this.activeDrag;
      if (drag?.sourceId !== sourceId) {
        console.warn(
          `[ui/dnd] data_source_send for source=${sourceId} but activeDrag.sourceId=${drag?.sourceId ?? "(none)"} — dropping fd`,
        );
        try {
          closeFd(fd);
        } catch {
          /* ok */
        }
        return;
      }
      const data = drag.getPayload(mime);
      if (data == null) {
        console.warn(`[ui/dnd] data_source_send mime=${mime} getPayload returned null`);
        try {
          closeFd(fd);
        } catch {
          /* ok */
        }
        return;
      }
      // Write payload to the fd provided by the compositor, then close.
      try {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
        const written = Buffer.alloc(buf.length);
        buf.copy(written);
        fs.writeSync(fd, written);
        console.log(`[ui/dnd] data_source_send wrote ${written.length} bytes for mime=${mime}`);
      } catch (err) {
        console.warn("[ui/dnd] data_source_send write failed:", err);
      }
      try {
        closeFd(fd);
      } catch {
        /* ok */
      }
    } else if (opcode === EV.data_source_cancelled || opcode === EV.data_source_dnd_finished) {
      if (this.activeDrag?.sourceId === sourceId) {
        console.log(
          `[ui/dnd] source ${opcode === EV.data_source_cancelled ? "cancelled" : "finished"} source=${sourceId}`,
        );
        this.destroyDragIcon(this.activeDrag.iconSurfaceId);
        this.activeDrag = null;
        this.handlers.delete(sourceId);
        this.sendMessage(wlDataSource.requests.destroy.encode(sourceId));
        notifyDragEnded();
      }
    } else if (opcode === EV.data_source_dnd_drop_performed) {
      // The pointer gesture is over now. Keep the Wayland source and icon
      // resources alive until finished/cancelled, but clear widget visuals
      // immediately so transfer latency cannot leave or restore a preview.
      console.log(`[ui/dnd] drop performed source=${sourceId}`);
      if (this.activeDrag?.sourceId === sourceId) notifyDragEnded();
    }
  }

  private handleDataDevice(opcode: number, r: MessageReader): void {
    if (opcode === EV.data_device_data_offer) {
      const { id: offerId } = wlDataDevice.events.dataOffer.decodeReader(r);
      const mimes: string[] = [];
      this.dataOfferMimes.set(offerId, mimes);
      this.incomingOffer = { offerId, mimes, serial: 0, x: 0, y: 0 };
      this.handlers.set(offerId, (op, rr) => this.handleIncomingOffer(op, rr, offerId));
    } else if (opcode === EV.data_device_enter) {
      const event = wlDataDevice.events.enter.decodeReader(r);
      const { serial, x, y } = event;
      const offerId = event.id ?? 0;
      if (this.incomingOffer && this.incomingOffer.offerId === offerId) {
        this.incomingOffer.serial = serial;
        this.incomingOffer.x = x;
        this.incomingOffer.y = y;
      } else if (offerId) {
        this.incomingOffer = { offerId, mimes: [], serial, x, y };
      }
      const offer = this.incomingOffer;
      if (offer) {
        const preferred =
          preferredDropMimes().find((m) => offer.mimes.includes(m)) ??
          offer.mimes[0] ??
          "text/uri-list";
        this.sendMessage(wlDataOffer.requests.accept.encode(offer.offerId, serial, preferred));
        const actions = WL_DND_ACTION_COPY | WL_DND_ACTION_MOVE;
        this.sendMessage(
          wlDataOffer.requests.setActions.encode(offer.offerId, actions, WL_DND_ACTION_MOVE),
        );
        updateActiveWindowDropHover(x, y);
      }
      notifyDropHover(true);
    } else if (opcode === EV.data_device_leave) {
      wlDataDevice.events.leave.decodeReader(r);
      notifyDropHover(false);
      clearActiveWindowDropHover();
      if (this.incomingOffer) {
        try {
          this.sendMessage(wlDataOffer.requests.destroy.encode(this.incomingOffer.offerId));
        } catch {
          /* ok */
        }
        this.handlers.delete(this.incomingOffer.offerId);
        this.incomingOffer = null;
      }
    } else if (opcode === EV.data_device_motion) {
      const { x, y } = wlDataDevice.events.motion.decodeReader(r);
      if (this.incomingOffer) {
        this.incomingOffer.x = x;
        this.incomingOffer.y = y;
        updateActiveWindowDropHover(x, y);
      }
    } else if (opcode === EV.data_device_drop) {
      wlDataDevice.events.drop.decodeReader(r);
      const offer = this.incomingOffer;
      // Drop ends the hover gesture immediately. Payload transfer and the
      // filesystem operation may finish later and must not keep the target
      // preview visible in the meantime.
      notifyDropHover(false);
      clearActiveWindowDropHover();
      if (!offer) {
        return;
      }
      const mime =
        preferredDropMimes().find((m) => offer.mimes.includes(m)) ??
        offer.mimes[0] ??
        "text/uri-list";
      this.receiveOfferData(offer.offerId, mime)
        .then((buf) => {
          const text = buf.toString("utf8");
          notifyDrop(text, offer.mimes.length ? offer.mimes : [mime], offer.x, offer.y);
          try {
            this.sendMessage(wlDataOffer.requests.finish.encode(offer.offerId));
          } catch {
            /* ok */
          }
          try {
            this.sendMessage(wlDataOffer.requests.destroy.encode(offer.offerId));
          } catch {
            /* ok */
          }
          this.handlers.delete(offer.offerId);
          this.incomingOffer = null;
          notifyDropHover(false);
          clearActiveWindowDropHover();
        })
        .catch((err) => {
          console.warn("[ui/dnd] receive failed:", err);
          // This is still a terminal DnD path. Finish/destroy the offer so
          // the source receives dnd_finished and can release its drag icon.
          try {
            this.sendMessage(wlDataOffer.requests.finish.encode(offer.offerId));
          } catch {
            /* ok */
          }
          try {
            this.sendMessage(wlDataOffer.requests.destroy.encode(offer.offerId));
          } catch {
            /* ok */
          }
          this.handlers.delete(offer.offerId);
          this.incomingOffer = null;
        });
    } else if (opcode === EV.data_device_selection) {
      const event = wlDataDevice.events.selection.decodeReader(r);
      const previous = this.clipboardOfferId;
      this.clipboardOfferId = event.id ?? null;
      if (
        previous &&
        previous !== this.clipboardOfferId &&
        previous !== this.incomingOffer?.offerId
      ) {
        this.handlers.delete(previous);
        this.dataOfferMimes.delete(previous);
        this.sendMessage(wlDataOffer.requests.destroy.encode(previous));
      }
    }
  }

  private handleIncomingOffer(opcode: number, r: MessageReader, offerId: number): void {
    if (opcode === EV.data_offer_offer) {
      const { mimeType: mime = "" } = wlDataOffer.events.offer.decodeReader(r);
      if (mime) this.dataOfferMimes.get(offerId)?.push(mime);
    } else if (opcode === EV.data_offer_source_actions || opcode === EV.data_offer_action) {
      if (opcode === EV.data_offer_source_actions) {
        wlDataOffer.events.sourceActions.decodeReader(r);
      } else {
        wlDataOffer.events.action.decodeReader(r);
      }
    }
  }

  private receiveOfferData(offerId: number, mime: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const O_CLOEXEC = 0o2000000;
        const [readFd, writeFd] = createPipe(O_CLOEXEC);
        this.sendMessage(wlDataOffer.requests.receive.encode(offerId, mime, writeFd));
        try {
          closeFd(writeFd);
        } catch {
          /* ok */
        }
        const readable = fs.createReadStream("", {
          fd: readFd,
          autoClose: true,
        });
        const chunks: Buffer[] = [];
        let total = 0;
        const timeout = setTimeout(
          () => readable.destroy(new Error("Clipboard/data offer timed out")),
          10_000,
        );
        readable.on("data", (chunk: Buffer | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          total += bytes.length;
          if (total > 8 * 1024 * 1024)
            readable.destroy(new Error("Clipboard/data offer exceeds 8 MiB"));
          else chunks.push(bytes);
        });
        readable.on("close", () => clearTimeout(timeout));
        readable.on("end", () => resolve(Buffer.concat(chunks)));
        readable.on("error", (err) => reject(err));
      } catch (err) {
        reject(err);
      }
    });
  }

  createWindow(opts: PlatformWindowOpts): PlatformWindow {
    if (!this.conn) throw new Error("WaylandPlatform not connected");
    const win = new WaylandWindow(this, opts);
    this.windows.add(win);
    win.create();
    return win;
  }

  createPopup(opts: PlatformPopupOpts): PlatformWindow {
    if (!this.conn) throw new Error("WaylandPlatform not connected");
    if (!(opts.parent instanceof WaylandWindow)) {
      throw new Error("Wayland popup parent belongs to another platform");
    }
    const win = new WaylandWindow(
      this,
      {
        title: "Popup",
        appId: "moire.popup",
        width: opts.width,
        height: opts.height,
        resizable: false,
      },
      opts,
    );
    this.windows.add(win);
    win.create();
    return win;
  }

  pump(): void {
    // WaylandClientConn polls recvmsg on its timer.
  }

  getDiagnostics(): PlatformDiagnostics {
    const info = this.eglPresenter?.info;
    const accelerated = this.clientAccelerationAvailable();
    return {
      platform: "linux",
      displayServer: "wayland",
      transport: "moire-typescript-wire",
      presentation:
        this.eglTransport === "readback"
          ? "retained-egl-shm"
          : accelerated
            ? this.retainedFrames > 0 || this.softwareFrames === 0
              ? "retained-egl-dmabuf"
              : "software-egl-dmabuf"
            : "software-shm",
      requestedAcceleration: process.env.MOIRE_UI_ACCELERATION ?? "auto",
      accelerated,
      display: process.env.WAYLAND_DISPLAY ?? "wayland-0",
      renderNode: this.renderNode,
      eglVendor: info?.eglVendor,
      eglVersion: info?.eglVersion,
      glVendor: info?.glVendor,
      glRenderer: info?.glRenderer,
      glVersion: info?.glVersion,
      fallbackReason: this.fallbackReason,
      capabilities: [...this.globals.keys()].sort(),
      retainedFrames: this.retainedFrames,
      softwareFrames: this.softwareFrames,
      dmabufFrames: this.dmabufFrames,
      shmFrames: this.shmFrames,
    };
  }

  getPersonalization(): PersonalizationProfile {
    return platformPersonalization("linux", {
      platform: "wayland",
    });
  }

  noteRetainedDmabufFrame(): void {
    this.retainedFrames++;
    this.dmabufFrames++;
  }

  noteRetainedShmFrame(): void {
    this.retainedFrames++;
    this.shmFrames++;
  }

  noteSoftwareDmabufFrame(): void {
    this.softwareFrames++;
    this.dmabufFrames++;
  }

  noteSoftwareShmFrame(): void {
    this.softwareFrames++;
    this.shmFrames++;
  }

  disconnect(): void {
    this.clipboardSource = null;
    this.clipboardOfferId = null;
    this.dataOfferMimes.clear();
    for (const w of [...this.windows]) w.destroy();
    this.windows.clear();
    if (this.surfaceStateManagerId) {
      this.sendMessage(
        moireSurfaceStateManagerV1.requests.destroy.encode(this.surfaceStateManagerId),
      );
      this.surfaceStateManagerId = 0;
    }
    this.retireKeyboard();
    this.releasePendingInputFds();
    this.eglPresenter?.destroy();
    this.eglPresenter = null;
    this.eglTransport = "software";
    if (this.eglFd >= 0) {
      closeFd(this.eglFd);
      this.eglFd = -1;
    }
    this.conn?.close();
    this.conn = null;
  }

  private tryCreateEglPresenter(): void {
    const mode = (process.env.MOIRE_UI_ACCELERATION ?? "auto").trim().toLowerCase();
    if (mode === "software" || mode === "shm" || mode === "off") {
      this.fallbackReason = `acceleration disabled by MOIRE_UI_ACCELERATION=${mode}`;
      return;
    }
    const candidates = process.env.MOIRE_RENDER_NODE
      ? [process.env.MOIRE_RENDER_NODE]
      : ["/dev/dri/renderD128", "/dev/dri/renderD129"];
    let lastError: unknown = null;
    for (const candidate of candidates) {
      try {
        const fd = openPath(candidate, O_RDWR | O_CLOEXEC);
        try {
          this.eglPresenter = new EglOutputScaler(fd);
          this.eglTransport = "dmabuf";
          this.eglFd = fd;
          this.renderNode = candidate;
          this.fallbackReason = undefined;
          console.log(
            `[ui/wayland] retained EGL/dmabuf presentation on ${candidate} (${this.eglPresenter.info.glRenderer})`,
          );
          return;
        } catch (error) {
          closeFd(fd);
          lastError = error;
        }
      } catch (error) {
        lastError = error;
      }
    }
    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    this.fallbackReason = detail;
    if (mode === "dmabuf" || mode === "egl" || mode === "on") {
      console.warn(`[ui/wayland] requested dmabuf acceleration unavailable: ${detail}`);
    } else {
      console.log(`[ui/wayland] dmabuf acceleration unavailable; using wl_shm (${detail})`);
    }
  }

  renderClientFrame(
    channel: string,
    pixels: Uint8Array,
    width: number,
    height: number,
  ): EglClientPresent | null {
    if (this.eglTransport !== "dmabuf") return null;
    try {
      return this.eglPresenter?.renderClientFrame(channel, pixels, width, height) ?? null;
    } catch (error) {
      console.warn("[ui/wayland] EGL client frame failed; using wl_shm:", error);
      // A format/driver failure is not expected to heal during this session.
      // Keep the presenter alive so already-exported targets can receive their
      // wl_buffer.release events, but avoid retry/log storms on every tick.
      this.eglTransport = "readback";
      this.retireClientRendering();
      this.fallbackReason = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  renderClientComposition(
    channel: string,
    scene: RetainedSceneFrame,
  ): ClientCompositionPresent | null {
    if (!this.eglPresenter || this.eglTransport === "software") return null;
    if (this.eglTransport === "dmabuf") {
      try {
        const frame = this.eglPresenter.renderClientComposition(channel, scene);
        return frame ? { kind: "dmabuf", frame } : null;
      } catch (error) {
        console.warn("[ui/wayland] dmabuf allocation failed; retaining EGL through wl_shm:", error);
        this.eglTransport = "readback";
        this.retireClientRendering();
        this.fallbackReason = error instanceof Error ? error.message : String(error);
      }
    }
    try {
      return {
        kind: "shm",
        frame: this.eglPresenter.renderClientCompositionReadback(scene),
      };
    } catch (error) {
      console.warn("[ui/wayland] EGL readback failed; using software/wl_shm:", error);
      this.eglTransport = "software";
      this.retireClientRendering();
      this.fallbackReason = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  clientAccelerationAvailable(): boolean {
    return this.eglTransport !== "software";
  }

  createDmabufBuffer(frame: EglClientPresent, onRelease: () => void): number {
    if (!this.dmabufId) throw new Error("linux-dmabuf is not bound");
    const paramsId = this.allocId();
    this.sendMessage(zwpLinuxDmabufV1.requests.createParams.encode(this.dmabufId, paramsId));
    this.handlers.set(paramsId, () => {});
    const modifierHi = Number((frame.modifier >> 32n) & 0xffffffffn);
    const modifierLo = Number(frame.modifier & 0xffffffffn);
    this.sendMessage(
      zwpLinuxBufferParamsV1.requests.add.encode(
        paramsId,
        frame.fd,
        0,
        0,
        frame.stride,
        modifierHi,
        modifierLo,
      ),
    );
    const bufferId = this.allocId();
    this.sendMessage(
      zwpLinuxBufferParamsV1.requests.createImmed.encode(
        paramsId,
        bufferId,
        frame.width,
        frame.height,
        frame.format,
        0,
      ),
    );
    this.sendMessage(zwpLinuxBufferParamsV1.requests.destroy.encode(paramsId));
    this.handlers.delete(paramsId);
    this.handlers.set(bufferId, (opcode) => {
      if (opcode === EV.buffer_release) onRelease();
    });
    return bufferId;
  }

  hasClientFrame(id: string): boolean {
    return this.eglPresenter?.hasClientFrame(id) ?? false;
  }

  releaseClientFrame(id: string): void {
    this.eglPresenter?.releaseClientFrame(id);
  }

  dropClientChannel(channel: string): void {
    this.eglPresenter?.dropClientChannel(channel);
  }

  registerSurface(surfaceId: number, win: WaylandWindow): void {
    this.surfaceToWindow.set(surfaceId, win);
  }

  unregisterWindow(win: WaylandWindow): void {
    this.windows.delete(win);
    for (const [sid, w] of this.surfaceToWindow) {
      if (w === win) this.surfaceToWindow.delete(sid);
    }
    if (this.pointerFocus === win) this.pointerFocus = null;
    this.keyboard.forget(win);
  }

  getCompositorId(): number {
    return this.compositorId;
  }

  getShmId(): number {
    return this.shmId;
  }

  getPresentationId(): number {
    return this.presentationId;
  }

  getSurfaceStateVersion(): number {
    return this.surfaceStateVersion;
  }
  getClientExecution(): ClientSubmission["execution"] {
    return this.eglPresenter?.execution ?? "unknown";
  }
  retireClientRendering(): void {
    for (const window of this.surfaceToWindow.values()) window.demoteRendering();
  }

  getSurfaceStateManagerId(): number {
    return this.surfaceStateManagerId;
  }

  /** Transport loss removes the authority even if application teardown runs later. */
  retireVisibilityObservations(): void {
    for (const window of this.surfaceToWindow.values()) window.retireVisibilityObservation();
  }

  getWmBaseId(): number {
    return this.wmBaseId;
  }

  getDecoManagerId(): number {
    return this.decoManagerId;
  }

  getSeatId(): number {
    return this.seatId;
  }

  getLastPointerSerial(): number {
    return this.lastPointerSerial;
  }

  /** Send a request whose opcode and wire layout came from protocol XML. */
  sendMessage(message: EncodedWaylandMessage, fds: number[] = []): void {
    if (!this.conn) return;
    this.conn.send(message.data, [...fds, ...message.fds]);
  }

  setHandler(id: number, handler: (opcode: number, r: MessageReader) => void): void {
    this.handlers.set(id, handler);
  }

  clearHandler(id: number): void {
    this.handlers.delete(id);
  }

  async roundtrip(): Promise<void> {
    const cb = this.allocId();
    await new Promise<void>((resolve) => {
      this.syncWaiters.set(cb, resolve);
      this.handlers.set(cb, (opcode) => {
        if (opcode === EV.callback_done) {
          this.handlers.delete(cb);
          const done = this.syncWaiters.get(cb);
          this.syncWaiters.delete(cb);
          done?.();
        }
      });
      this.sendMessage(wlDisplay.requests.sync.encode(WL_DISPLAY_ID, cb));
    });
  }

  private bindGlobal(iface: string, version: number): number {
    const g = this.globals.get(iface);
    if (!g) throw new Error(`Wayland global missing: ${iface}`);
    const id = this.allocId();
    const ver = Math.min(version, g.version);
    this.sendMessage(wlRegistry.requests.bind.encode(this.registryId, g.name, iface, ver, id));
    return id;
  }

  private onChunk(chunk: WaylandChunk): void {
    this.pendingFds.push(...chunk.fds);
    this.buf = Buffer.concat([this.buf, chunk.data]);
    while (this.buf.length >= WL_HEADER_SIZE) {
      const header = decodeHeader(this.buf);
      if (header.size < WL_HEADER_SIZE || this.buf.length < header.size) break;
      const msg = Buffer.from(this.buf.subarray(0, header.size));
      this.buf = this.buf.subarray(header.size);

      const r = new MessageReader(msg, this.pendingFds.slice());
      const origFd = r.fd.bind(r);
      r.fd = () => {
        const fd = origFd();
        // Transfer ownership before dispatch, so teardown cannot close it twice.
        this.pendingFds.shift();
        return fd;
      };
      const handler = this.handlers.get(header.objectId);
      handler?.(header.opcode, r);
    }
  }

  private handlePointer(opcode: number, r: MessageReader): void {
    const now = Date.now();
    const modifiers = this.keyboard.modifiers();
    if (opcode === EV.pointer_enter) {
      const event = wlPointer.events.enter.decodeReader(r);
      const serial = event.serial;
      const surfaceId = event.surface;
      this.lastPointerSerial = serial;
      this.pointerSurfaceId = surfaceId;
      this.pointerX = event.surfaceX;
      this.pointerY = event.surfaceY;
      this.pointerFocus = this.surfaceToWindow.get(surfaceId) ?? null;
      if (this.pointerFocus) this.pointerFocus.observeInputFocus("pointer", "enter", surfaceId);
      else stopUnexpectedInputFocus();
      this.pointerFocus?.emitPointer({
        type: "move",
        x: this.pointerX,
        y: this.pointerY,
        modifiers,
        timeMs: now,
      });
    } else if (opcode === EV.pointer_leave) {
      const event = wlPointer.events.leave.decodeReader(r);
      this.surfaceToWindow.get(event.surface)?.observeInputFocus("pointer", "leave", event.surface);
      this.pointerFocus = null;
    } else if (opcode === EV.pointer_motion) {
      const event = wlPointer.events.motion.decodeReader(r);
      this.pointerX = event.surfaceX;
      this.pointerY = event.surfaceY;
      this.pointerFocus?.emitPointer({
        type: "move",
        x: this.pointerX,
        y: this.pointerY,
        modifiers,
        timeMs: now,
      });
    } else if (opcode === EV.pointer_button) {
      const event = wlPointer.events.button.decodeReader(r);
      const { serial, button, state } = event;
      this.lastPointerSerial = serial;
      this.pointerFocus?.emitPointer({
        type: state === 1 ? "down" : "up",
        x: this.pointerX,
        y: this.pointerY,
        button: buttonName(button),
        modifiers,
        timeMs: now,
      });
    } else if (opcode === EV.pointer_axis) {
      const { axis, value } = wlPointer.events.axis.decodeReader(r);
      if (axis === wlPointer.enums.axis.verticalScroll) {
        // Vertical scroll: positive = down (matches DOM deltaY convention)
        this.pointerFocus?.emitPointer({
          type: "wheel",
          x: this.pointerX,
          y: this.pointerY,
          deltaY: value,
          modifiers,
          timeMs: now,
        });
      }
    }
  }

  private handleKeyboard(opcode: number, r: MessageReader): void {
    this.keyboard.handle(opcode, r);
  }

  private handleSeatCapabilities(opcode: number, reader: MessageReader): void {
    if (opcode !== EV.seat_capabilities) return;
    const { capabilities: caps } = wlSeat.events.capabilities.decodeReader(reader);
    if ((caps & 1) !== 0 && !this.pointerId) {
      this.pointerId = this.allocId();
      this.sendMessage(wlSeat.requests.getPointer.encode(this.seatId, this.pointerId));
      this.handlers.set(this.pointerId, (op, rr) => this.handlePointer(op, rr));
    }
    if ((caps & 2) !== 0 && !this.keyboardId) {
      const keyboardId = this.allocId();
      this.keyboardId = keyboardId;
      this.sendMessage(wlSeat.requests.getKeyboard.encode(this.seatId, keyboardId));
      this.handlers.set(keyboardId, (op, rr) => {
        if (this.keyboardId === keyboardId) this.handleKeyboard(op, rr);
        else if (op === wlKeyboard.events.keymap.opcode) {
          // Queued maps keep FD ownership after seat removal but cannot replace the new map.
          try {
            const fd = rr.fd();
            fs.closeSync(fd);
          } catch {
            // Missing or already closed stale FDs cannot interrupt the active keyboard.
          }
        }
      });
    } else if ((caps & 2) === 0 && this.keyboardId) {
      this.retireKeyboard();
    }
  }

  getKeyboardMapping(): KeymapAvailability {
    return this.keyboard.keymapState();
  }

  private retireKeyboard(): void {
    const id = this.keyboardId;
    this.keyboardId = 0;
    this.keyboard.disconnect();
    if (id) {
      this.retiredKeyboardIds.add(id);
      if (this.seatVersion >= wlKeyboard.requests.release.since)
        this.sendMessage(wlKeyboard.requests.release.encode(id));
    }
  }

  private releasePendingInputFds(): void {
    const pending = this.pendingFds.splice(0);
    this.buf = Buffer.alloc(0);
    for (const fd of pending) {
      try {
        fs.closeSync(fd);
      } catch {
        // A failed close must not retain ownership or prevent the other closes.
      }
    }
  }
}

export class WaylandWindow implements PlatformWindow {
  private platform: WaylandPlatform;
  private title: string;
  private appId: string;
  private width: number;
  private height: number;
  private readonly preferredW: number;
  private readonly preferredH: number;
  private readonly resizable: boolean;
  private surfaceId = 0;
  private xdgSurfaceId = 0;
  private toplevelId = 0;
  private decorationId = 0;
  private popupId = 0;
  private positionerId = 0;
  private surfaceStateId = 0;
  private readonly rendering = new WindowRenderingTracker();
  private visibility: UiSurfaceVisibility = "unknown";
  private readonly visibilityCbs = new Set<(visibility: UiSurfaceVisibility) => void>();
  private readonly popupOpts: PlatformPopupOpts | null;
  private configured = false;
  private maximized = false;
  private fullscreen = false;
  private readonly initialFullscreen: boolean;
  private slots: ShmSlot[] = [];
  private dmabufSlots = new Map<string, DmabufSlot>();
  private configureCbs: Array<(w: number, h: number) => void> = [];
  private closeCbs: Array<() => void> = [];
  private pointerCbs: Array<(ev: UiPointerEvent) => void> = [];
  private keyCbs: Array<(ev: UiKeyEvent) => void> = [];
  private frameCbs: Array<(ev: UiFrameEvent) => void> = [];
  private readonly pendingFrameCallbacks = new Set<number>();
  private readonly pendingPresentationFeedbacks = new Set<number>();
  /** wl_surface.frame is the submission gate: never queue more than one. */
  private framePending = false;
  /** A draw requested while gated; retry once the compositor grants a frame. */
  private retryAfterFrame = false;
  /** Scene reconciliation advances damage even when submission is gated.
   * Carry those regions until a later commit actually transfers the pixels. */
  private deferredDamage: RetainedClip | undefined;
  private deferredFullDamage = false;
  private nextCommitId = 1;
  private presentationMode: UiPresentationMode = "auto";
  private retainedBackpressured = false;
  private alive = true;
  private readonly decorated: boolean;

  constructor(
    platform: WaylandPlatform,
    opts: PlatformWindowOpts,
    popupOpts: PlatformPopupOpts | null = null,
    private readonly diagnosticTrace: InputFixtureTrace = inputFixtureTrace,
  ) {
    this.platform = platform;
    this.title = opts.title;
    this.appId = opts.appId;
    this.preferredW = opts.width;
    this.preferredH = opts.height;
    this.width = opts.width;
    this.height = opts.height;
    this.resizable = opts.resizable !== false;
    this.decorated = opts.decorated !== false;
    this.initialFullscreen = opts.fullscreen === true;
    this.popupOpts = popupOpts;
  }

  create(): void {
    const p = this.platform;
    this.surfaceId = p.allocId();
    p.sendMessage(wlCompositor.requests.createSurface.encode(p.getCompositorId(), this.surfaceId));
    p.registerSurface(this.surfaceId, this);
    const stateManager = p.getSurfaceStateManagerId();
    if (stateManager) {
      this.surfaceStateId = p.allocId();
      p.setHandler(this.surfaceStateId, (opcode, reader) => {
        if (!this.alive || !this.surfaceStateId) return;
        if (
          opcode === moireSurfaceStateV1.events.rendering.opcode &&
          p.getSurfaceStateVersion() >= 2
        ) {
          const event = moireSurfaceStateV1.events.rendering.decodeReader(reader);
          const states = moireSurfaceStateV1.enums.rendering;
          const accepted =
            event.rendering === states.hardwareRetained
              ? "hardwareRetained"
              : event.rendering === states.software
                ? "software"
                : event.rendering === states.virtual
                  ? "virtual"
                  : event.rendering === states.retainedUnknown
                    ? "retainedUnknown"
                    : "unknown";
          if (this.rendering.observe(event.token, accepted)) {
            this.emitFrame(
              accepted === "software" || accepted === "virtual"
                ? { type: "output-accepted", commitId: event.token, execution: accepted }
                : { type: "output-revoked", commitId: event.token },
            );
          }
          return;
        }
        if (opcode !== moireSurfaceStateV1.events.state.opcode) return;
        const event = moireSurfaceStateV1.events.state.decodeReader(reader);
        const states = moireSurfaceStateV1.enums.visibility;
        const visibility =
          event.visibility === states.visible
            ? "visible"
            : event.visibility === states.hidden
              ? "hidden"
              : "unknown";
        if (visibility === this.visibility) return;
        this.visibility = visibility;
        for (const cb of this.visibilityCbs) cb(visibility);
      });
      p.sendMessage(
        moireSurfaceStateManagerV1.requests.getSurfaceState.encode(
          stateManager,
          this.surfaceStateId,
          this.surfaceId,
        ),
      );
    }

    this.xdgSurfaceId = p.allocId();
    p.sendMessage(
      xdgWmBase.requests.getXdgSurface.encode(p.getWmBaseId(), this.xdgSurfaceId, this.surfaceId),
    );
    p.setHandler(this.xdgSurfaceId, (opcode, r) => {
      if (opcode === EV.xdg_surface_configure) {
        const { serial } = xdgSurface.events.configure.decodeReader(r);
        this.configured = true;
        p.sendMessage(xdgSurface.requests.ackConfigure.encode(this.xdgSurfaceId, serial));
        for (const cb of this.configureCbs) cb(this.width, this.height);
      }
    });

    if (this.popupOpts) {
      this.createPopupRole();
      p.sendMessage(wlSurface.requests.commit.encode(this.surfaceId));
      return;
    }

    this.toplevelId = p.allocId();
    p.sendMessage(xdgSurface.requests.getToplevel.encode(this.xdgSurfaceId, this.toplevelId));
    p.setHandler(this.toplevelId, (opcode, r) => {
      if (opcode === EV.xdg_toplevel_configure) {
        const { width: w, height: h, states } = xdgToplevel.events.configure.decodeReader(r);
        this.maximized = false;
        this.fullscreen = false;
        for (let offset = 0; offset + 4 <= states.length; offset += 4) {
          if (states.readUInt32LE(offset) === xdgToplevel.enums.state.maximized)
            this.maximized = true;
          if (states.readUInt32LE(offset) === xdgToplevel.enums.state.fullscreen)
            this.fullscreen = true;
        }
        if (this.fullscreen || this.maximized) {
          // Output geometry governs fullscreen/maximized surfaces even when
          // the ordinary window has a fixed preferred allocation.
          if (w > 0) this.width = w;
          if (h > 0) this.height = h;
        } else if (!this.resizable) {
          // Moire initially configures new toplevels to 800×600; min==max then
          // reconfigures to our preferred size. Ignore mismatched interim hints.
          if (w === this.preferredW && h === this.preferredH) {
            this.width = w;
            this.height = h;
          } else if (w <= 0 || h <= 0) {
            this.width = this.preferredW;
            this.height = this.preferredH;
          } else {
            this.width = this.preferredW;
            this.height = this.preferredH;
          }
        } else if (w > 0 || h > 0) {
          if (w > 0) this.width = w;
          if (h > 0) this.height = h;
        } else {
          this.width = this.preferredW;
          this.height = this.preferredH;
        }
      } else if (opcode === EV.xdg_toplevel_close) {
        xdgToplevel.events.close.decodeReader(r);
        for (const cb of this.closeCbs) cb();
      }
    });

    p.sendMessage(xdgToplevel.requests.setTitle.encode(this.toplevelId, this.title));
    p.sendMessage(xdgToplevel.requests.setAppId.encode(this.toplevelId, this.appId));
    // The initial 0×0 configure lets the client choose its preferred size.
    // Resizable windows must not advertise that preference as their minimum.
    // Fixed windows use min==max to keep their requested allocation.
    p.sendMessage(
      xdgToplevel.requests.setMinSize.encode(
        this.toplevelId,
        this.resizable ? 0 : this.preferredW,
        this.resizable ? 0 : this.preferredH,
      ),
    );
    if (this.resizable) {
      p.sendMessage(xdgToplevel.requests.setMaxSize.encode(this.toplevelId, 0, 0));
    } else {
      p.sendMessage(
        xdgToplevel.requests.setMaxSize.encode(this.toplevelId, this.preferredW, this.preferredH),
      );
    }
    const decoMgr = p.getDecoManagerId();
    if (decoMgr) {
      const decoId = p.allocId();
      this.decorationId = decoId;
      p.sendMessage(
        zxdgDecorationManagerV1.requests.getToplevelDecoration.encode(
          decoMgr,
          decoId,
          this.toplevelId,
        ),
      );
      p.sendMessage(
        zxdgToplevelDecorationV1.requests.setMode.encode(
          decoId,
          this.decorated ? XDG_DECORATION_MODE_SERVER : XDG_DECORATION_MODE_CLIENT,
        ),
      );
      p.setHandler(decoId, () => {
        // configure — mode already requested
      });
    }
    if (this.initialFullscreen) this.setFullscreen(true);
    p.sendMessage(wlSurface.requests.commit.encode(this.surfaceId));
  }

  private createPopupRole(): void {
    const opts = this.popupOpts;
    const parent = opts?.parent;
    if (!opts || !(parent instanceof WaylandWindow)) return;
    const p = this.platform;
    this.positionerId = p.allocId();
    p.sendMessage(xdgWmBase.requests.createPositioner.encode(p.getWmBaseId(), this.positionerId));
    p.sendMessage(
      xdgPositioner.requests.setSize.encode(this.positionerId, this.width, this.height),
    );
    p.sendMessage(
      xdgPositioner.requests.setAnchorRect.encode(
        this.positionerId,
        opts.anchorX,
        opts.anchorY,
        1,
        1,
      ),
    );
    p.sendMessage(xdgPositioner.requests.setAnchor.encode(this.positionerId, XDG_ANCHOR_TOP_LEFT));
    p.sendMessage(xdgPositioner.requests.setGravity.encode(this.positionerId, XDG_ANCHOR_TOP_LEFT));
    p.sendMessage(
      xdgPositioner.requests.setConstraintAdjustment.encode(
        this.positionerId,
        XDG_CONSTRAINT_SLIDE_X | XDG_CONSTRAINT_SLIDE_Y,
      ),
    );

    this.popupId = p.allocId();
    p.sendMessage(
      xdgSurface.requests.getPopup.encode(
        this.xdgSurfaceId,
        this.popupId,
        parent.getXdgSurfaceId(),
        this.positionerId,
      ),
    );
    p.setHandler(this.popupId, (opcode, r) => {
      if (opcode === EV.xdg_popup_configure) {
        const { width: w, height: h } = xdgPopup.events.configure.decodeReader(r);
        if (w > 0) this.width = w;
        if (h > 0) this.height = h;
      } else if (opcode === EV.xdg_popup_done) {
        xdgPopup.events.popupDone.decodeReader(r);
        for (const cb of this.closeCbs) cb();
      }
    });
    if (opts.grab !== false && p.getSeatId()) {
      p.sendMessage(
        xdgPopup.requests.grab.encode(this.popupId, p.getSeatId(), p.getLastPointerSerial()),
      );
    }
    p.sendMessage(xdgPositioner.requests.destroy.encode(this.positionerId));
    this.positionerId = 0;
  }

  getXdgSurfaceId(): number {
    return this.xdgSurfaceId;
  }

  setTitle(title: string): void {
    this.title = title;
    if (this.toplevelId) {
      this.platform.sendMessage(xdgToplevel.requests.setTitle.encode(this.toplevelId, title));
    }
  }

  setSize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    for (const cb of this.configureCbs) cb(this.width, this.height);
  }

  setPresentationMode(mode: UiPresentationMode): void {
    this.presentationMode = mode;
    if (mode === "shm") this.demoteRendering();
  }

  getRenderingState(): UiRenderingState {
    return this.rendering.get();
  }
  onRenderingChange(cb: (state: UiRenderingState) => void): () => void {
    return this.rendering.subscribe(cb);
  }
  demoteRendering(): void {
    this.rendering.backendLost();
  }

  getVisibility(): UiSurfaceVisibility {
    return this.visibility;
  }

  onVisibilityChange(cb: (visibility: UiSurfaceVisibility) => void): () => void {
    if (this.alive) this.visibilityCbs.add(cb);
    return () => {
      this.visibilityCbs.delete(cb);
    };
  }

  /** Retire wire authority on native teardown or transport loss, independently of application close. */
  retireVisibilityObservation(): void {
    this.demoteRendering();
    if (this.surfaceStateId) {
      const id = this.surfaceStateId;
      this.surfaceStateId = 0;
      this.platform.clearHandler(id);
      this.platform.sendMessage(moireSurfaceStateV1.requests.destroy.encode(id));
    }
    if (this.visibility !== "unknown") {
      this.visibility = "unknown";
      for (const cb of this.visibilityCbs) cb("unknown");
    }
    this.visibilityCbs.clear();
  }

  present(
    pixels: Uint8Array,
    width: number,
    height: number,
    damage?: readonly RetainedClip[],
  ): void {
    if (!this.alive || !this.configured) return;
    if (this.framePending) {
      this.retryAfterFrame = true;
      this.deferDamage(damage);
      return;
    }
    validateShmFrame(pixels, width, height);
    this.width = width;
    this.height = height;
    const channel = `surface-${this.surfaceId}`;
    const accelerated =
      this.presentationMode === "shm"
        ? null
        : this.platform.renderClientFrame(channel, pixels, width, height);
    if (accelerated) {
      this.commitAcceleratedFrame(accelerated, width, height, damage);
      this.platform.noteSoftwareDmabufFrame();
      return;
    }
    this.commitShmFrame(pixels, width, height, damage);
    this.platform.noteSoftwareShmFrame();
  }

  private commitShmFrame(
    pixels: Uint8Array,
    width: number,
    height: number,
    damage?: readonly RetainedClip[],
    submissionPath: ClientSubmission["path"] = "software",
  ): void {
    const frame = classifyShmFrame(pixels, width, height);
    const { size } = frame;
    let slot = this.slots.find((s) => !s.busy && s.size >= size);
    if (!slot) {
      slot = this.allocSlot(frame);
    } else if (
      slot.buffer.frame.width !== width ||
      slot.buffer.frame.height !== height ||
      slot.buffer.frame.format !== frame.format
    ) {
      this.recreateBuffer(slot, frame);
    }
    const copyStartedAt = performance.now();
    flushMmap(slot.map, pixels, size);
    const copyMs = performance.now() - copyStartedAt;
    slot.busy = true;
    const commit = this.commitBuffer(
      slot.buffer.id,
      width,
      height,
      "shm",
      copyMs,
      damage,
      submissionPath,
    );
    slot.commitId = commit.commitId;
    slot.submittedAtMs = commit.submittedAtMs;
  }

  presentScene(scene: RetainedSceneFrame): boolean {
    if (!this.alive || !this.configured) return false;
    if (this.presentationMode === "shm") return false;
    if (this.framePending) {
      this.retryAfterFrame = true;
      this.deferDamage(scene.damage);
      return true;
    }
    const accelerated = this.platform.renderClientComposition(`surface-${this.surfaceId}`, scene);
    if (!accelerated) {
      if (this.platform.clientAccelerationAvailable()) {
        this.retainedBackpressured = true;
        this.deferDamage(scene.damage);
        return true;
      }
      return false;
    }
    this.width = scene.width;
    this.height = scene.height;
    switch (accelerated.kind) {
      case "dmabuf":
        this.commitAcceleratedFrame(
          accelerated.frame,
          scene.width,
          scene.height,
          accelerated.frame.damage,
          "retained-dmabuf",
        );
        this.platform.noteRetainedDmabufFrame();
        break;
      case "shm":
        this.commitShmFrame(
          accelerated.frame.pixels,
          scene.width,
          scene.height,
          undefined,
          "retained-readback",
        );
        this.platform.noteRetainedShmFrame();
        break;
      default: {
        const exhaustive: never = accelerated;
        return exhaustive;
      }
    }
    return true;
  }

  private retireDmabufSlots(): void {
    for (const [id, slot] of this.dmabufSlots) {
      if (this.platform.hasClientFrame(id)) continue;
      this.platform.clearHandler(slot.bufferId);
      this.platform.sendMessage(wlBuffer.requests.destroy.encode(slot.bufferId));
      this.dmabufSlots.delete(id);
    }
  }

  private commitAcceleratedFrame(
    frame: EglClientPresent,
    width: number,
    height: number,
    damage: readonly RetainedClip[] = frame.damage,
    submissionPath: ClientSubmission["path"] = "flat-dmabuf",
  ): void {
    this.retireDmabufSlots();
    let slot = this.dmabufSlots.get(frame.id);
    if (!slot) {
      const frameId = frame.id;
      const bufferId = this.platform.createDmabufBuffer(frame, () => {
        if (!this.alive) return;
        const released = this.dmabufSlots.get(frameId);
        const receivedAtMs = performance.now();
        this.platform.releaseClientFrame(frameId);
        this.retireDmabufSlots();
        const retrySuggested = this.retainedBackpressured;
        this.retainedBackpressured = false;
        if (released?.commitId) {
          this.emitFrame({
            type: "buffer-release",
            commitId: released.commitId,
            transport: "dmabuf",
            latencyMs: Math.max(0, receivedAtMs - released.submittedAtMs),
            receivedAtMs,
            retrySuggested,
          });
        }
      });
      slot = { frameId, bufferId, commitId: 0, submittedAtMs: 0 };
      this.dmabufSlots.set(frameId, slot);
    }
    const commit = this.commitBuffer(
      slot.bufferId,
      width,
      height,
      "dmabuf",
      0,
      damage,
      submissionPath,
    );
    slot.commitId = commit.commitId;
    slot.submittedAtMs = commit.submittedAtMs;
  }

  private deferDamage(damage: readonly RetainedClip[] | undefined): void {
    if (!damage) {
      this.deferredFullDamage = true;
      return;
    }
    for (const rect of damage) {
      const previous = this.deferredDamage;
      const left = previous ? Math.min(previous.x, rect.x) : rect.x;
      const top = previous ? Math.min(previous.y, rect.y) : rect.y;
      const right = previous
        ? Math.max(previous.x + previous.width, rect.x + rect.width)
        : rect.x + rect.width;
      const bottom = previous
        ? Math.max(previous.y + previous.height, rect.y + rect.height)
        : rect.y + rect.height;
      this.deferredDamage = { x: left, y: top, width: right - left, height: bottom - top };
    }
  }

  private commitBuffer(
    bufferId: number,
    width: number,
    height: number,
    transport: "dmabuf" | "shm",
    copyMs: number,
    damage?: readonly RetainedClip[],
    submissionPath: ClientSubmission["path"] = "software",
  ): { commitId: number; submittedAtMs: number } {
    const p = this.platform;
    const commitId = this.nextCommitId;
    this.nextCommitId = (commitId + 1) >>> 0 || 1;
    // All entry points coalesce while this is true. Keeping this invariant at
    // the protocol boundary prevents unrelated application wakes from ever
    // building a wl_surface.frame callback backlog.
    this.framePending = true;
    const frameCallbackId = p.allocId();
    this.pendingFrameCallbacks.add(frameCallbackId);
    p.setHandler(frameCallbackId, (opcode, r) => {
      if (opcode !== EV.callback_done) return;
      const { callbackData } = wlCallback.events.done.decodeReader(r);
      this.pendingFrameCallbacks.delete(frameCallbackId);
      p.clearHandler(frameCallbackId);
      this.framePending = false;
      const retrySuggested = this.retryAfterFrame;
      this.retryAfterFrame = false;
      this.emitFrame({
        type: "compositor-frame",
        commitId,
        timestampMs: callbackData,
        receivedAtMs: performance.now(),
        retrySuggested,
      });
    });
    p.sendMessage(wlSurface.requests.frame.encode(this.surfaceId, frameCallbackId));
    const presentationId = p.getPresentationId();
    if (presentationId) {
      const feedbackId = p.allocId();
      this.pendingPresentationFeedbacks.add(feedbackId);
      p.setHandler(feedbackId, (opcode, r) => {
        if (opcode === EV.presentation_feedback_sync_output) {
          wpPresentationFeedback.events.syncOutput.decodeReader(r);
          return;
        }
        const receivedAtMs = performance.now();
        if (opcode === EV.presentation_feedback_presented) {
          const event = wpPresentationFeedback.events.presented.decodeReader(r);
          const seconds = (BigInt(event.tvSecHi) << 32n) | BigInt(event.tvSecLo);
          const sequence = (BigInt(event.seqHi) << 32n) | BigInt(event.seqLo);
          this.emitFrame({
            type: "presented",
            commitId,
            timestampNs: seconds * 1_000_000_000n + BigInt(event.tvNsec),
            refreshNs: event.refresh,
            sequence,
            flags: event.flags,
            receivedAtMs,
          });
        } else if (opcode === EV.presentation_feedback_discarded) {
          wpPresentationFeedback.events.discarded.decodeReader(r);
          this.emitFrame({ type: "discarded", commitId, receivedAtMs });
        } else {
          return;
        }
        this.pendingPresentationFeedbacks.delete(feedbackId);
        p.clearHandler(feedbackId);
      });
      p.sendMessage(
        wpPresentation.requests.feedback.encode(presentationId, this.surfaceId, feedbackId),
      );
    }
    // Window geometry = content box (excludes SSD); matches buffer for our clients.
    p.sendMessage(
      xdgSurface.requests.setWindowGeometry.encode(this.xdgSurfaceId, 0, 0, width, height),
    );
    p.sendMessage(wlSurface.requests.attach.encode(this.surfaceId, bufferId, 0, 0));
    const full = [{ x: 0, y: 0, width, height }];
    const committedDamage = this.deferredFullDamage
      ? full
      : [...(damage ?? full), ...(this.deferredDamage ? [this.deferredDamage] : [])];
    const clippedDamage = committedDamage
      .map((rect) => {
        const x = Math.max(0, Math.floor(rect.x));
        const y = Math.max(0, Math.floor(rect.y));
        const right = Math.min(width, Math.ceil(rect.x + rect.width));
        const bottom = Math.min(height, Math.ceil(rect.y + rect.height));
        return {
          x,
          y,
          width: Math.max(0, right - x),
          height: Math.max(0, bottom - y),
        };
      })
      .filter((rect) => rect.width > 0 && rect.height > 0);
    for (const rect of clippedDamage) {
      p.sendMessage(
        wlSurface.requests.damageBuffer.encode(
          this.surfaceId,
          rect.x,
          rect.y,
          rect.width,
          rect.height,
        ),
      );
    }
    if (this.surfaceStateId && p.getSurfaceStateVersion() >= 2)
      p.sendMessage(moireSurfaceStateV1.requests.submission.encode(this.surfaceStateId, commitId));
    p.sendMessage(wlSurface.requests.commit.encode(this.surfaceId));
    this.deferredDamage = undefined;
    this.deferredFullDamage = false;
    this.rendering.submitted({
      token: commitId,
      path: submissionPath,
      execution: p.getClientExecution(),
    });
    const submittedAtMs = performance.now();
    this.emitFrame({
      type: "submitted",
      commitId,
      transport,
      submittedAtMs,
      copyMs,
      damagedPixels: clippedDamage.reduce((total, rect) => total + rect.width * rect.height, 0),
      totalPixels: width * height,
    });
    return { commitId, submittedAtMs };
  }

  onConfigure(cb: (w: number, h: number) => void): void {
    this.configureCbs.push(cb);
  }

  beginMove(): void {
    if (!this.alive || !this.toplevelId) return;
    const seatId = this.platform.getSeatId();
    const serial = this.platform.getLastPointerSerial();
    if (!seatId || !serial) return;
    this.platform.sendMessage(xdgToplevel.requests.move.encode(this.toplevelId, seatId, serial));
  }

  setMaximized(maximized: boolean): void {
    if (!this.alive || !this.toplevelId) return;
    const request = maximized
      ? xdgToplevel.requests.setMaximized
      : xdgToplevel.requests.unsetMaximized;
    this.platform.sendMessage(request.encode(this.toplevelId));
  }

  isMaximized(): boolean {
    return this.maximized;
  }

  setFullscreen(fullscreen: boolean): void {
    if (!this.alive || !this.toplevelId) return;
    const request = fullscreen
      ? xdgToplevel.requests.setFullscreen.encode(this.toplevelId, 0)
      : xdgToplevel.requests.unsetFullscreen.encode(this.toplevelId);
    this.platform.sendMessage(request);
  }

  isFullscreen(): boolean {
    return this.fullscreen;
  }

  minimize(): void {
    if (!this.alive || !this.toplevelId) return;
    this.platform.sendMessage(xdgToplevel.requests.setMinimized.encode(this.toplevelId));
  }

  onClose(cb: () => void): void {
    this.closeCbs.push(cb);
  }

  onPointer(cb: (ev: UiPointerEvent) => void): void {
    this.pointerCbs.push(cb);
  }

  onKey(cb: (ev: UiKeyEvent) => void): void {
    this.keyCbs.push(cb);
  }

  onFrame(cb: (ev: UiFrameEvent) => void): void {
    this.frameCbs.push(cb);
  }

  private emitFrame(ev: UiFrameEvent): void {
    for (const cb of this.frameCbs) cb(ev);
  }

  private observeInput(observe: () => void): void {
    try {
      if (!this.diagnosticTrace.active()) return;
      if (!this.alive || this.appId !== "org.moire.Screenshot") {
        this.diagnosticTrace.stop("focus");
        return;
      }
      observe();
    } catch {
      // Diagnostic IO/policy failure must not affect delivery of the original event.
      try {
        this.diagnosticTrace.stop("io-error");
      } catch {
        /* observer is already unusable */
      }
    }
  }

  observeInputFocus(
    device: "keyboard" | "pointer",
    type: "enter" | "leave",
    surfaceId: number,
  ): void {
    this.observeInput(() => {
      this.diagnosticTrace.write({ layer: "client-focus", device, type, surfaceId });
      // A fixture is scoped to one uninterrupted keyboard focus lifetime.
      // Pointer leave is normal while that keyboard focus remains unchanged.
      if (device === "keyboard" && type === "leave") this.diagnosticTrace.stop("focus");
    });
  }

  emitPointer(ev: UiPointerEvent): void {
    this.observeInput(() => {
      const ordinal = this.diagnosticTrace.write({
        layer: "client-pointer",
        type: ev.type,
        x: ev.x,
        y: ev.y,
        timeMs: ev.timeMs,
        button: ev.button ?? null,
        modifiers: ev.modifiers ?? { ctrl: false, alt: false, shift: false, meta: false },
      });
      this.diagnosticTrace.link(ev, ordinal);
    });
    for (const cb of this.pointerCbs) cb(ev);
  }

  emitKey(ev: UiKeyEvent): void {
    this.observeInput(() => {
      const ordinal = this.diagnosticTrace.write({
        layer: "client-key",
        type: ev.type,
        code: ev.code,
        timeMs: ev.timeMs,
        modifiers: ev.modifiers ?? { ctrl: false, alt: false, shift: false, meta: false },
      });
      this.diagnosticTrace.link(ev, ordinal);
    });
    for (const cb of this.keyCbs) cb(ev);
  }

  destroy(): void {
    if (!this.alive) return;
    this.alive = false;
    this.rendering.destroy();
    const p = this.platform;
    this.retireVisibilityObservation();
    for (const slot of this.slots) this.freeSlot(slot);
    this.slots = [];
    for (const slot of this.dmabufSlots.values()) {
      try {
        p.sendMessage(wlBuffer.requests.destroy.encode(slot.bufferId));
      } catch {
        // ok
      }
      p.clearHandler(slot.bufferId);
    }
    this.dmabufSlots.clear();
    for (const id of this.pendingFrameCallbacks) p.clearHandler(id);
    for (const id of this.pendingPresentationFeedbacks) p.clearHandler(id);
    this.pendingFrameCallbacks.clear();
    this.pendingPresentationFeedbacks.clear();
    this.framePending = false;
    this.retryAfterFrame = false;
    this.deferredDamage = undefined;
    this.deferredFullDamage = false;
    p.dropClientChannel(`surface-${this.surfaceId}`);
    if (this.popupId) {
      p.sendMessage(xdgPopup.requests.destroy.encode(this.popupId));
      p.clearHandler(this.popupId);
      this.popupId = 0;
    }
    if (this.toplevelId) {
      if (this.decorationId) {
        p.sendMessage(zxdgToplevelDecorationV1.requests.destroy.encode(this.decorationId));
        p.clearHandler(this.decorationId);
        this.decorationId = 0;
      }
      p.sendMessage(xdgToplevel.requests.destroy.encode(this.toplevelId));
      p.clearHandler(this.toplevelId);
    }
    if (this.xdgSurfaceId) {
      p.sendMessage(xdgSurface.requests.destroy.encode(this.xdgSurfaceId));
      p.clearHandler(this.xdgSurfaceId);
    }
    if (this.surfaceId) {
      p.sendMessage(wlSurface.requests.destroy.encode(this.surfaceId));
    }
    p.unregisterWindow(this);
    this.configureCbs = [];
    this.closeCbs = [];
    this.pointerCbs = [];
    this.keyCbs = [];
    this.frameCbs = [];
  }

  private allocSlot(frame: ShmFrame): ShmSlot {
    const p = this.platform;
    const { width, height, stride, size, format } = frame;
    const fd = memfdCreate(size);
    const map = mmap(size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    const poolId = p.allocId();
    p.sendMessage(wlShm.requests.createPool.encode(p.getShmId(), poolId, fd, size));
    const bufferId = p.allocId();
    p.sendMessage(
      wlShmPool.requests.createBuffer.encode(poolId, bufferId, 0, width, height, stride, format),
    );
    p.setHandler(bufferId, (opcode) => {
      if (opcode === EV.buffer_release) {
        const s = this.slots.find((x) => x.buffer.id === bufferId);
        if (s) {
          s.busy = false;
          const receivedAtMs = performance.now();
          if (s.commitId) {
            this.emitFrame({
              type: "buffer-release",
              commitId: s.commitId,
              transport: "shm",
              latencyMs: Math.max(0, receivedAtMs - s.submittedAtMs),
              receivedAtMs,
            });
          }
        }
      }
    });
    const slot: ShmSlot = {
      fd,
      size,
      map,
      poolId,
      buffer: { id: bufferId, frame },
      busy: false,
      commitId: 0,
      submittedAtMs: 0,
    };
    this.slots.push(slot);
    return slot;
  }

  private recreateBuffer(slot: ShmSlot, frame: ShmFrame): void {
    const p = this.platform;
    // Selection only hands us an idle slot with sufficient storage. Changing
    // format cannot mutate the existing protocol object, even at the same size.
    const { width, height, stride, format } = frame;
    p.sendMessage(wlBuffer.requests.destroy.encode(slot.buffer.id));
    p.clearHandler(slot.buffer.id);
    const bufferId = p.allocId();
    slot.buffer = { id: bufferId, frame };
    p.sendMessage(
      wlShmPool.requests.createBuffer.encode(
        slot.poolId,
        bufferId,
        0,
        width,
        height,
        stride,
        format,
      ),
    );
    p.setHandler(bufferId, (opcode) => {
      if (opcode === EV.buffer_release && slot.buffer.id === bufferId) {
        slot.busy = false;
        const receivedAtMs = performance.now();
        if (slot.commitId) {
          this.emitFrame({
            type: "buffer-release",
            commitId: slot.commitId,
            transport: "shm",
            latencyMs: Math.max(0, receivedAtMs - slot.submittedAtMs),
            receivedAtMs,
          });
        }
      }
    });
  }

  private freeSlot(slot: ShmSlot): void {
    const p = this.platform;
    try {
      p.sendMessage(wlBuffer.requests.destroy.encode(slot.buffer.id));
    } catch {
      // ok
    }
    p.clearHandler(slot.buffer.id);
    try {
      p.sendMessage(wlShmPool.requests.destroy.encode(slot.poolId));
    } catch {
      // ok
    }
    try {
      munmap(slot.map, slot.size);
    } catch {
      // ok
    }
    try {
      closeFd(slot.fd);
    } catch {
      // ok
    }
  }
}
