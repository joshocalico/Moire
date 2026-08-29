/**
 * Wayland PlatformBackend — xdg_toplevel + wl_shm + seat.
 * Only platforms/wayland may import protocol / sys / OS APIs.
 */
import fs from "node:fs";
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
import {
  EglOutputScaler,
  WaylandClientConn,
  assertLinux,
  closeFd,
  createMemfd,
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
  keyFromEvdev,
  modifiersFromPressed,
  type DndCapable,
  type PlatformBackend,
  type PlatformDiagnostics,
  type PlatformPopupOpts,
  type PlatformWindow,
  type PlatformWindowOpts,
  type UiKeyEvent,
  type UiFrameEvent,
  type UiPresentationMode,
  type UiPointerEvent,
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

const WL_DISPLAY_ID = 1;
const WL_SHM_FORMAT_ARGB8888 = wlShm.enums.format.argb8888;
const BTN_LEFT = 0x110;
const BTN_RIGHT = 0x111;
const BTN_MIDDLE = 0x112;
const KEY_PRESSED = wlKeyboard.enums.keyState.pressed;
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
  keyboard_keymap: wlKeyboard.events.keymap.opcode,
  keyboard_key: wlKeyboard.events.key.opcode,
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
  bufferId: number;
  width: number;
  height: number;
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
  private eglPresenter: EglOutputScaler | null = null;
  private eglFd = -1;
  private eglPresentationFailed = false;
  private renderNode: string | undefined;
  private fallbackReason: string | undefined;
  private retainedFrames = 0;
  private softwareFrames = 0;
  private dmabufFrames = 0;
  private shmFrames = 0;
  private wmBaseId = 0;
  private decoManagerId = 0;
  private seatId = 0;
  private pointerId = 0;
  private keyboardId = 0;
  private pressedKeys = new Set<number>();
  /** wl_data_device_manager object id. */
  private dataDeviceManagerId = 0;
  /** wl_data_device for the seat. */
  private dataDeviceId = 0;
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
  /** Last pointer-button event serial from compositor. */
  private lastPointerSerial = 0;
  /** Surface id of the currently focused window for DnD origin. */
  private pointerSurfaceId = 0;
  private windows = new Set<WaylandWindow>();
  private surfaceToWindow = new Map<number, WaylandWindow>();
  private pointerFocus: WaylandWindow | null = null;
  private pointerX = 0;
  private pointerY = 0;

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
    });

    this.handlers.set(WL_DISPLAY_ID, (opcode, r) => {
      if (opcode === EV.display_error) {
        const event = wlDisplay.events.error.decodeReader(r);
        console.error(`[ui/wayland] display.error code=${event.code} ${event.message}`);
      } else if (opcode === EV.display_delete_id) {
        wlDisplay.events.deleteId.decodeReader(r);
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
      this.seatId = this.bindGlobal("wl_seat", 5);
      this.handlers.set(this.seatId, (opcode, r) => {
        if (opcode !== EV.seat_capabilities) return;
        const { capabilities: caps } = wlSeat.events.capabilities.decodeReader(r);
        if ((caps & 1) !== 0 && !this.pointerId) {
          this.pointerId = this.allocId();
          this.sendMessage(wlSeat.requests.getPointer.encode(this.seatId, this.pointerId));
          this.handlers.set(this.pointerId, (op, rr) => this.handlePointer(op, rr));
        }
        if ((caps & 2) !== 0 && !this.keyboardId) {
          this.keyboardId = this.allocId();
          this.sendMessage(wlSeat.requests.getKeyboard.encode(this.seatId, this.keyboardId));
          this.handlers.set(this.keyboardId, (op, rr) => this.handleKeyboard(op, rr));
        }
      });
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
      this.incomingOffer = { offerId, mimes: [], serial: 0, x: 0, y: 0 };
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
      wlDataDevice.events.selection.decodeReader(r);
    }
  }

  private handleIncomingOffer(opcode: number, r: MessageReader, offerId: number): void {
    if (opcode === EV.data_offer_offer) {
      const { mimeType: mime = "" } = wlDataOffer.events.offer.decodeReader(r);
      if (this.incomingOffer?.offerId === offerId && mime) {
        this.incomingOffer.mimes.push(mime);
      }
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
        readable.on("data", (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
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
    const accelerated = Boolean(this.eglPresenter && !this.eglPresentationFailed);
    return {
      platform: "linux",
      displayServer: "wayland",
      transport: "moire-typescript-wire",
      presentation: accelerated
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

  noteRetainedDmabufFrame(): void {
    this.retainedFrames++;
    this.dmabufFrames++;
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
    for (const w of [...this.windows]) w.destroy();
    this.windows.clear();
    this.eglPresenter?.destroy();
    this.eglPresenter = null;
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
    if (this.eglPresentationFailed) return null;
    try {
      return this.eglPresenter?.renderClientFrame(channel, pixels, width, height) ?? null;
    } catch (error) {
      console.warn("[ui/wayland] EGL client frame failed; using wl_shm:", error);
      // A format/driver failure is not expected to heal during this session.
      // Keep the presenter alive so already-exported targets can receive their
      // wl_buffer.release events, but avoid retry/log storms on every tick.
      this.eglPresentationFailed = true;
      this.fallbackReason = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  renderClientComposition(channel: string, scene: RetainedSceneFrame): EglClientPresent | null {
    if (this.eglPresentationFailed) return null;
    try {
      return this.eglPresenter?.renderClientComposition(channel, scene) ?? null;
    } catch (error) {
      console.warn("[ui/wayland] retained EGL scene failed; using software/wl_shm:", error);
      this.eglPresentationFailed = true;
      this.fallbackReason = error instanceof Error ? error.message : String(error);
      return null;
    }
  }

  clientAccelerationAvailable(): boolean {
    return Boolean(this.eglPresenter && !this.eglPresentationFailed);
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

      let consumed = 0;
      const r = new MessageReader(msg, this.pendingFds);
      const origFd = r.fd.bind(r);
      r.fd = () => {
        const fd = origFd();
        consumed++;
        return fd;
      };
      const handler = this.handlers.get(header.objectId);
      handler?.(header.opcode, r);
      if (consumed > 0) this.pendingFds.splice(0, consumed);
    }
  }

  private handlePointer(opcode: number, r: MessageReader): void {
    const now = Date.now();
    const modifiers = modifiersFromPressed(this.pressedKeys);
    if (opcode === EV.pointer_enter) {
      const event = wlPointer.events.enter.decodeReader(r);
      const serial = event.serial;
      const surfaceId = event.surface;
      this.lastPointerSerial = serial;
      this.pointerSurfaceId = surfaceId;
      this.pointerX = event.surfaceX;
      this.pointerY = event.surfaceY;
      this.pointerFocus = this.surfaceToWindow.get(surfaceId) ?? null;
      this.pointerFocus?.emitPointer({
        type: "move",
        x: this.pointerX,
        y: this.pointerY,
        modifiers,
        timeMs: now,
      });
    } else if (opcode === EV.pointer_leave) {
      wlPointer.events.leave.decodeReader(r);
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
    if (opcode === EV.keyboard_keymap) {
      const { fd } = wlKeyboard.events.keymap.decodeReader(r);
      try {
        closeFd(fd);
      } catch {
        // ok
      }
      return;
    }
    if (opcode === EV.keyboard_key) {
      const { key, state } = wlKeyboard.events.key.decodeReader(r);
      const repeat = state === KEY_PRESSED && this.pressedKeys.has(key);
      if (state === KEY_PRESSED) this.pressedKeys.add(key);
      else this.pressedKeys.delete(key);
      const modifiers = modifiersFromPressed(this.pressedKeys);
      const logical = keyFromEvdev(key, modifiers);
      const win = this.pointerFocus ?? [...this.windows][0] ?? null;
      win?.emitKey({
        type: repeat ? "repeat" : state === KEY_PRESSED ? "down" : "up",
        code: key,
        key: logical.key,
        text: logical.text,
        modifiers,
        timeMs: Date.now(),
      });
    }
  }
}

class WaylandWindow implements PlatformWindow {
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
  private popupId = 0;
  private positionerId = 0;
  private readonly popupOpts: PlatformPopupOpts | null;
  private configured = false;
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
  private nextCommitId = 1;
  private presentationMode: UiPresentationMode = "auto";
  private retainedBackpressured = false;
  private alive = true;
  private readonly decorated: boolean;

  constructor(
    platform: WaylandPlatform,
    opts: PlatformWindowOpts,
    popupOpts: PlatformPopupOpts | null = null,
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
    this.popupOpts = popupOpts;
  }

  create(): void {
    const p = this.platform;
    this.surfaceId = p.allocId();
    p.sendMessage(wlCompositor.requests.createSurface.encode(p.getCompositorId(), this.surfaceId));
    p.registerSurface(this.surfaceId, this);

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
        const { width: w, height: h } = xdgToplevel.events.configure.decodeReader(r);
        if (!this.resizable) {
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
    // Ask for our preferred size. Fixed windows use min==max so Moire
    // reconfigures away from its default 800×600 slot hint.
    p.sendMessage(
      xdgToplevel.requests.setMinSize.encode(this.toplevelId, this.preferredW, this.preferredH),
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
      return;
    }
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
    const stride = width * 4;
    const size = stride * height;
    let slot = this.slots.find((s) => !s.busy && s.size >= size);
    if (!slot) {
      slot = this.allocSlot(size);
    } else if (slot.width !== width || slot.height !== height) {
      this.recreateBuffer(slot, width, height, stride);
    }
    const copyStartedAt = performance.now();
    flushMmap(slot.map, pixels, size);
    const copyMs = performance.now() - copyStartedAt;
    slot.busy = true;
    const commit = this.commitBuffer(slot.bufferId, width, height, "shm", copyMs, damage);
    slot.commitId = commit.commitId;
    slot.submittedAtMs = commit.submittedAtMs;
    this.platform.noteSoftwareShmFrame();
  }

  presentScene(scene: RetainedSceneFrame): boolean {
    if (!this.alive || !this.configured) return false;
    if (this.presentationMode === "shm") return false;
    if (this.framePending) {
      this.retryAfterFrame = true;
      return true;
    }
    const accelerated = this.platform.renderClientComposition(`surface-${this.surfaceId}`, scene);
    if (!accelerated) {
      if (this.platform.clientAccelerationAvailable()) {
        this.retainedBackpressured = true;
        return true;
      }
      return false;
    }
    this.width = scene.width;
    this.height = scene.height;
    this.commitAcceleratedFrame(accelerated, scene.width, scene.height);
    this.platform.noteRetainedDmabufFrame();
    return true;
  }

  private commitAcceleratedFrame(
    frame: EglClientPresent,
    width: number,
    height: number,
    damage: readonly RetainedClip[] = frame.damage,
  ): void {
    let slot = this.dmabufSlots.get(frame.id);
    if (!slot) {
      const frameId = frame.id;
      const bufferId = this.platform.createDmabufBuffer(frame, () => {
        const released = this.dmabufSlots.get(frameId);
        const receivedAtMs = performance.now();
        this.platform.releaseClientFrame(frameId);
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
    const commit = this.commitBuffer(slot.bufferId, width, height, "dmabuf", 0, damage);
    slot.commitId = commit.commitId;
    slot.submittedAtMs = commit.submittedAtMs;
  }

  private commitBuffer(
    bufferId: number,
    width: number,
    height: number,
    transport: "dmabuf" | "shm",
    copyMs: number,
    damage?: readonly RetainedClip[],
  ): { commitId: number; submittedAtMs: number } {
    const p = this.platform;
    const commitId = this.nextCommitId++;
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
    const clippedDamage = (damage ?? [{ x: 0, y: 0, width, height }])
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
    p.sendMessage(wlSurface.requests.commit.encode(this.surfaceId));
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

  emitPointer(ev: UiPointerEvent): void {
    for (const cb of this.pointerCbs) cb(ev);
  }

  emitKey(ev: UiKeyEvent): void {
    for (const cb of this.keyCbs) cb(ev);
  }

  destroy(): void {
    if (!this.alive) return;
    this.alive = false;
    const p = this.platform;
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
    p.dropClientChannel(`surface-${this.surfaceId}`);
    if (this.popupId) {
      p.sendMessage(xdgPopup.requests.destroy.encode(this.popupId));
      p.clearHandler(this.popupId);
      this.popupId = 0;
    }
    if (this.toplevelId) {
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

  private allocSlot(size: number): ShmSlot {
    const p = this.platform;
    const fd = memfdCreate(size);
    const map = mmap(size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    const poolId = p.allocId();
    p.sendMessage(wlShm.requests.createPool.encode(p.getShmId(), poolId, fd, size));
    const bufferId = p.allocId();
    const width = this.width;
    const height = this.height;
    const stride = width * 4;
    p.sendMessage(
      wlShmPool.requests.createBuffer.encode(
        poolId,
        bufferId,
        0,
        width,
        height,
        stride,
        WL_SHM_FORMAT_ARGB8888,
      ),
    );
    p.setHandler(bufferId, (opcode) => {
      if (opcode === EV.buffer_release) {
        const s = this.slots.find((x) => x.bufferId === bufferId);
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
      bufferId,
      width,
      height,
      busy: false,
      commitId: 0,
      submittedAtMs: 0,
    };
    this.slots.push(slot);
    return slot;
  }

  private recreateBuffer(slot: ShmSlot, width: number, height: number, stride: number): void {
    const p = this.platform;
    const need = stride * height;
    if (need > slot.size) {
      this.freeSlot(slot);
      const idx = this.slots.indexOf(slot);
      if (idx >= 0) this.slots.splice(idx, 1);
      const neu = this.allocSlot(need);
      Object.assign(slot, neu);
      if (!this.slots.includes(slot)) this.slots.push(slot);
      return;
    }
    p.sendMessage(wlBuffer.requests.destroy.encode(slot.bufferId));
    p.clearHandler(slot.bufferId);
    slot.bufferId = p.allocId();
    slot.width = width;
    slot.height = height;
    p.sendMessage(
      wlShmPool.requests.createBuffer.encode(
        slot.poolId,
        slot.bufferId,
        0,
        width,
        height,
        stride,
        WL_SHM_FORMAT_ARGB8888,
      ),
    );
    p.setHandler(slot.bufferId, (opcode) => {
      if (opcode === EV.buffer_release) {
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
      p.sendMessage(wlBuffer.requests.destroy.encode(slot.bufferId));
    } catch {
      // ok
    }
    p.clearHandler(slot.bufferId);
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
