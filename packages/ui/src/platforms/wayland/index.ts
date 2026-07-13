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
  MessageBuilder,
  MessageReader,
  WL_HEADER_SIZE,
  decodeHeader,
} from "@moire/protocol";
import {
  WaylandClientConn,
  assertLinux,
  closeFd,
  flushMmap,
  getLibc,
  mmap,
  munmap,
  MAP_SHARED,
  PROT_READ,
  PROT_WRITE,
  type WaylandChunk,
} from "@moire/sys";
import type {
  PlatformBackend,
  PlatformWindow,
  PlatformWindowOpts,
  UiKeyEvent,
  UiPointerEvent,
  PointerButton,
  DndCapable,
} from "../../platform.js";
import { setDndBridge, notifyDrop, notifyDropHover, preferredDropMimes } from "../../widgets/dnd.js";

const WL_DISPLAY_ID = 1;
const WL_SHM_FORMAT_ARGB8888 = 0;
const BTN_LEFT = 0x110;
const BTN_RIGHT = 0x111;
const BTN_MIDDLE = 0x112;
const KEY_PRESSED = 1;
const XDG_DECORATION_MODE_SERVER = 2;

const OP = {
  display_sync: 0,
  display_get_registry: 1,
  registry_bind: 0,
  compositor_create_surface: 0,
  shm_create_pool: 0,
  shm_pool_create_buffer: 0,
  shm_pool_destroy: 1,
  surface_destroy: 0,
  surface_attach: 1,
  surface_damage: 2,
  surface_commit: 6,
  buffer_destroy: 0,
  seat_get_pointer: 0,
  seat_get_keyboard: 1,
  xdg_wm_base_get_xdg_surface: 2,
  xdg_wm_base_pong: 3,
  xdg_surface_destroy: 0,
  xdg_surface_get_toplevel: 1,
  xdg_surface_set_window_geometry: 3,
  xdg_surface_ack_configure: 4,
  xdg_toplevel_destroy: 0,
  xdg_toplevel_set_title: 2,
  xdg_toplevel_set_app_id: 3,
  xdg_toplevel_set_max_size: 7,
  xdg_toplevel_set_min_size: 8,
  xdg_decoration_manager_get_toplevel_decoration: 1,
  xdg_toplevel_decoration_set_mode: 1,
  // wl_data_device_manager
  data_device_manager_create_data_source: 0,
  data_device_manager_get_data_device: 1,
  // wl_data_source
  data_source_offer: 0,
  data_source_destroy: 1,
  data_source_set_actions: 2,
  // wl_data_device
  data_device_start_drag: 0,
  data_device_release: 2,
  // wl_data_offer
  data_offer_accept: 0,
  data_offer_receive: 1,
  data_offer_destroy: 2,
  data_offer_finish: 3,
  data_offer_set_actions: 4,
} as const;

const EV = {
  display_error: 0,
  display_delete_id: 1,
  registry_global: 0,
  callback_done: 0,
  buffer_release: 0,
  seat_capabilities: 0,
  pointer_enter: 0,
  pointer_leave: 1,
  pointer_motion: 2,
  pointer_button: 3,
  pointer_axis: 4,
  keyboard_keymap: 0,
  keyboard_key: 3,
  xdg_wm_base_ping: 0,
  xdg_surface_configure: 0,
  xdg_toplevel_configure: 0,
  xdg_toplevel_close: 1,
  // wl_data_source events (compositor → client/source)
  data_source_send: 1,
  data_source_cancelled: 2,
  data_source_dnd_drop_performed: 3,
  data_source_dnd_finished: 4,
  // wl_data_device events (compositor → client/target)
  data_device_data_offer: 0,
  data_device_enter: 1,
  data_device_leave: 2,
  data_device_motion: 3,
  data_device_drop: 4,
  data_device_selection: 5,
  // wl_data_offer events (compositor → client)
  data_offer_offer: 0,
  data_offer_source_actions: 1,
  data_offer_action: 2,
} as const;

/** DnD action bitmask constants. */
const WL_DND_ACTION_COPY = 1;
const WL_DND_ACTION_MOVE = 2;

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
};

function waylandSocketPath(): string {
  const runtime =
    process.env.XDG_RUNTIME_DIR ??
    path.join(os.tmpdir(), `moire-${process.getuid?.() ?? 0}`);
  const display = process.env.WAYLAND_DISPLAY ?? "wayland-0";
  return path.join(runtime, display);
}

function memfdCreate(size: number): number {
  const libc = getLibc();
  const memfd_create = libc.func(
    "int memfd_create(const char *name, unsigned int flags)",
  );
  const ftruncate = libc.func("int ftruncate(int fd, long length)");
  const fd = memfd_create("moire-ui-shm", 1) as number;
  if (fd < 0) throw new Error("memfd_create failed");
  if ((ftruncate(fd, size) as number) !== 0) {
    closeFd(fd);
    throw new Error("ftruncate failed");
  }
  return fd;
}

function readFixed(r: MessageReader): number {
  return r.int() / 256;
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
  private handlers = new Map<
    number,
    (opcode: number, r: MessageReader) => void
  >();
  private syncWaiters = new Map<number, () => void>();
  private registryId = 0;
  private compositorId = 0;
  private shmId = 0;
  private wmBaseId = 0;
  private decoManagerId = 0;
  private seatId = 0;
  private pointerId = 0;
  private keyboardId = 0;
  /** wl_data_device_manager object id. */
  private dataDeviceManagerId = 0;
  /** wl_data_device for the seat. */
  private dataDeviceId = 0;
  /** Active drag: data source and payload resolver. */
  private activeDrag: {
    sourceId: number;
    getPayload: (mime: string) => string | Buffer | null;
  } | null = null;
  /** Incoming DnD offer while this client is a drop target. */
  private incomingOffer: {
    offerId: number;
    mimes: string[];
    serial: number;
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
        r.object();
        const code = r.uint();
        const msg = r.string();
        console.error(`[ui/wayland] display.error code=${code} ${msg}`);
      } else if (opcode === EV.display_delete_id) {
        r.uint();
      }
    });

    this.registryId = this.allocId();
    this.handlers.set(this.registryId, (opcode, r) => {
      if (opcode !== EV.registry_global) return;
      const name = r.uint();
      const iface = r.string()!;
      const version = r.uint();
      this.globals.set(iface, { name, iface, version });
    });
    this.send(WL_DISPLAY_ID, OP.display_get_registry, (b) =>
      b.newId(this.registryId),
    );
    await this.roundtrip();

    this.compositorId = this.bindGlobal("wl_compositor", 4);
    this.shmId = this.bindGlobal("wl_shm", 1);
    this.handlers.set(this.shmId, () => {});
    this.wmBaseId = this.bindGlobal("xdg_wm_base", 3);
    this.handlers.set(this.wmBaseId, (opcode, r) => {
      if (opcode === EV.xdg_wm_base_ping) {
        const serial = r.uint();
        this.send(this.wmBaseId, OP.xdg_wm_base_pong, (b) => b.uint(serial));
      }
    });
    if (this.globals.has("zxdg_decoration_manager_v1")) {
      this.decoManagerId = this.bindGlobal("zxdg_decoration_manager_v1", 1);
    }

    if (this.globals.has("wl_seat")) {
      this.seatId = this.bindGlobal("wl_seat", 5);
      this.handlers.set(this.seatId, (opcode, r) => {
        if (opcode !== EV.seat_capabilities) return;
        const caps = r.uint();
        if ((caps & 1) !== 0 && !this.pointerId) {
          this.pointerId = this.allocId();
          this.send(this.seatId, OP.seat_get_pointer, (b) =>
            b.newId(this.pointerId),
          );
          this.handlers.set(this.pointerId, (op, rr) =>
            this.handlePointer(op, rr),
          );
        }
        if ((caps & 2) !== 0 && !this.keyboardId) {
          this.keyboardId = this.allocId();
          this.send(this.seatId, OP.seat_get_keyboard, (b) =>
            b.newId(this.keyboardId),
          );
          this.handlers.set(this.keyboardId, (op, rr) =>
            this.handleKeyboard(op, rr),
          );
        }
      });
    }

    // Bind wl_data_device_manager and get a wl_data_device for the seat.
    if (this.globals.has("wl_data_device_manager") && this.seatId) {
      this.dataDeviceManagerId = this.bindGlobal("wl_data_device_manager", 3);
      this.handlers.set(this.dataDeviceManagerId, () => {});
      this.dataDeviceId = this.allocId();
      this.send(
        this.dataDeviceManagerId,
        OP.data_device_manager_get_data_device,
        (b) => b.newId(this.dataDeviceId).object(this.seatId),
      );
      this.handlers.set(this.dataDeviceId, (op, rr) =>
        this.handleDataDevice(op, rr),
      );
    }

    await this.roundtrip();

    // Wire the DnD bridge so Draggable widgets call startDrag.
    setDndBridge({
      startDrag: (payload, mimeTypes) => {
        const mime0 = mimeTypes[0];
        if (!mime0 || !this.conn) return;
        this.startDrag(mimeTypes, (mime) => {
          if (typeof payload === "string" || Buffer.isBuffer(payload)) {
            return payload;
          }
          if (Array.isArray(payload)) {
            if (mime === "text/uri-list") return payload.join("\r\n");
            if (mime === "text/plain") return payload.join("\n");
          }
          try { return JSON.stringify(payload); } catch { return null; }
        }, this.lastPointerSerial);
      },
    });
  }

  startDrag(
    mimeTypes: string[],
    getPayload: (mime: string) => string | Buffer | null,
    serial: number,
  ): void {
    if (!this.conn || !this.dataDeviceManagerId || !this.dataDeviceId) return;
    if (this.activeDrag) {
      // Cancel previous drag source if still alive.
      try {
        this.send(this.activeDrag.sourceId, OP.data_source_destroy, () => {});
      } catch { /* ok */ }
      this.activeDrag = null;
    }

    const sourceId = this.allocId();
    this.send(
      this.dataDeviceManagerId,
      OP.data_device_manager_create_data_source,
      (b) => b.newId(sourceId),
    );
    for (const mime of mimeTypes) {
      this.send(sourceId, OP.data_source_offer, (b) => b.string(mime));
    }
    // Prefer move so file managers move items instead of copying.
    const actions = WL_DND_ACTION_COPY | WL_DND_ACTION_MOVE;
    this.send(sourceId, OP.data_source_set_actions, (b) => b.uint(actions));

    this.activeDrag = { sourceId, getPayload };

    this.handlers.set(sourceId, (op, rr) =>
      this.handleDataSource(op, rr, sourceId),
    );

    // start_drag(source, origin, icon, serial)
    this.send(this.dataDeviceId, OP.data_device_start_drag, (b) =>
      b.object(sourceId).object(this.pointerSurfaceId).object(0).uint(serial),
    );
    console.log(
      `[ui/dnd] startDrag source=${sourceId} mimes=${mimeTypes.join(",")} serial=${serial}`,
    );
  }

  private handleDataSource(
    opcode: number,
    r: MessageReader,
    sourceId: number,
  ): void {
    if (opcode === EV.data_source_send) {
      const mime = r.string() ?? "";
      const fd = r.fd();
      const drag = this.activeDrag;
      if (drag?.sourceId !== sourceId) {
        try { closeFd(fd); } catch { /* ok */ }
        return;
      }
      const data = drag.getPayload(mime);
      if (data == null) {
        try { closeFd(fd); } catch { /* ok */ }
        return;
      }
      // Write payload to the fd provided by the compositor, then close.
      try {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
        const written = Buffer.alloc(buf.length);
        buf.copy(written);
        fs.writeSync(fd, written);
      } catch { /* target closed early — ignore */ }
      try { closeFd(fd); } catch { /* ok */ }
    } else if (
      opcode === EV.data_source_cancelled ||
      opcode === EV.data_source_dnd_finished
    ) {
      if (this.activeDrag?.sourceId === sourceId) {
        console.log(
          `[ui/dnd] source ${opcode === EV.data_source_cancelled ? "cancelled" : "finished"} source=${sourceId}`,
        );
        this.activeDrag = null;
        this.handlers.delete(sourceId);
        this.send(sourceId, OP.data_source_destroy, () => {});
      }
    } else if (opcode === EV.data_source_dnd_drop_performed) {
      // Drop occurred — we'll wait for finished/cancelled.
      console.log(`[ui/dnd] drop performed source=${sourceId}`);
    }
  }

  private handleDataDevice(opcode: number, r: MessageReader): void {
    if (opcode === EV.data_device_data_offer) {
      const offerId = r.uint();
      this.incomingOffer = { offerId, mimes: [], serial: 0 };
      this.handlers.set(offerId, (op, rr) =>
        this.handleIncomingOffer(op, rr, offerId),
      );
    } else if (opcode === EV.data_device_enter) {
      const serial = r.uint();
      r.object(); // surface
      readFixed(r); // x
      readFixed(r); // y
      const offerId = r.object();
      if (this.incomingOffer && this.incomingOffer.offerId === offerId) {
        this.incomingOffer.serial = serial;
      } else if (offerId) {
        this.incomingOffer = { offerId, mimes: [], serial };
      }
      const offer = this.incomingOffer;
      if (offer) {
        const preferred =
          preferredDropMimes().find((m) => offer.mimes.includes(m)) ??
          offer.mimes[0] ??
          "text/uri-list";
        this.send(offer.offerId, OP.data_offer_accept, (b) =>
          b.uint(serial).string(preferred),
        );
        const actions = WL_DND_ACTION_COPY | WL_DND_ACTION_MOVE;
        this.send(offer.offerId, OP.data_offer_set_actions, (b) =>
          b.uint(actions).uint(WL_DND_ACTION_MOVE),
        );
      }
      notifyDropHover(true);
    } else if (opcode === EV.data_device_leave) {
      notifyDropHover(false);
      if (this.incomingOffer) {
        try {
          this.send(this.incomingOffer.offerId, OP.data_offer_destroy, () => {});
        } catch {
          /* ok */
        }
        this.handlers.delete(this.incomingOffer.offerId);
        this.incomingOffer = null;
      }
    } else if (opcode === EV.data_device_motion) {
      r.uint(); // time
      readFixed(r); // x
      readFixed(r); // y
    } else if (opcode === EV.data_device_drop) {
      const offer = this.incomingOffer;
      if (!offer) {
        notifyDropHover(false);
        return;
      }
      const mime =
        preferredDropMimes().find((m) => offer.mimes.includes(m)) ??
        offer.mimes[0] ??
        "text/uri-list";
      this.receiveOfferData(offer.offerId, mime)
        .then((buf) => {
          const text = buf.toString("utf8");
          notifyDrop(text, offer.mimes.length ? offer.mimes : [mime]);
          try {
            this.send(offer.offerId, OP.data_offer_finish, () => {});
          } catch {
            /* ok */
          }
          try {
            this.send(offer.offerId, OP.data_offer_destroy, () => {});
          } catch {
            /* ok */
          }
          this.handlers.delete(offer.offerId);
          this.incomingOffer = null;
          notifyDropHover(false);
        })
        .catch((err) => {
          console.warn("[ui/dnd] receive failed:", err);
          notifyDropHover(false);
          this.incomingOffer = null;
        });
    } else if (opcode === EV.data_device_selection) {
      r.object(); // offer id (clipboard selection — not used by widgets yet)
    }
  }

  private handleIncomingOffer(
    opcode: number,
    r: MessageReader,
    offerId: number,
  ): void {
    if (opcode === EV.data_offer_offer) {
      const mime = r.string() ?? "";
      if (this.incomingOffer?.offerId === offerId && mime) {
        this.incomingOffer.mimes.push(mime);
      }
    } else if (
      opcode === EV.data_offer_source_actions ||
      opcode === EV.data_offer_action
    ) {
      r.uint();
    }
  }

  private receiveOfferData(offerId: number, mime: string): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      try {
        const libc = getLibc();
        const pipe2 = libc.func("int pipe2(int *pipefd, int flags)") as (
          pipefd: Buffer,
          flags: number,
        ) => number;
        const O_CLOEXEC = 0o2000000;
        const pfds = Buffer.alloc(8);
        if (pipe2(pfds, O_CLOEXEC) !== 0) {
          reject(new Error("pipe2 failed"));
          return;
        }
        const readFd = pfds.readInt32LE(0);
        const writeFd = pfds.readInt32LE(4);
        this.send(offerId, OP.data_offer_receive, (b) =>
          b.string(mime).fd(writeFd),
        );
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

  pump(): void {
    // WaylandClientConn polls recvmsg on its timer.
  }

  disconnect(): void {
    for (const w of [...this.windows]) w.destroy();
    this.windows.clear();
    this.conn?.close();
    this.conn = null;
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

  getWmBaseId(): number {
    return this.wmBaseId;
  }

  getDecoManagerId(): number {
    return this.decoManagerId;
  }

  send(
    objectId: number,
    opcode: number,
    build: (b: MessageBuilder) => void,
    fds: number[] = [],
  ): void {
    if (!this.conn) return;
    const b = new MessageBuilder();
    build(b);
    const { data, fds: more } = b.build(objectId, opcode);
    this.conn.send(data, [...fds, ...more]);
  }

  setHandler(
    id: number,
    handler: (opcode: number, r: MessageReader) => void,
  ): void {
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
      this.send(WL_DISPLAY_ID, OP.display_sync, (b) => b.newId(cb));
    });
  }

  private bindGlobal(iface: string, version: number): number {
    const g = this.globals.get(iface);
    if (!g) throw new Error(`Wayland global missing: ${iface}`);
    const id = this.allocId();
    const ver = Math.min(version, g.version);
    this.send(this.registryId, OP.registry_bind, (b) => {
      b.uint(g.name).string(iface).uint(ver).newId(id);
    });
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
    if (opcode === EV.pointer_enter) {
      const serial = r.uint();
      const surfaceId = r.object();
      this.lastPointerSerial = serial;
      this.pointerSurfaceId = surfaceId;
      this.pointerX = readFixed(r);
      this.pointerY = readFixed(r);
      this.pointerFocus = this.surfaceToWindow.get(surfaceId) ?? null;
      this.pointerFocus?.emitPointer({
        type: "move",
        x: this.pointerX,
        y: this.pointerY,
        timeMs: now,
      });
    } else if (opcode === EV.pointer_leave) {
      r.uint();
      r.object();
      this.pointerFocus = null;
    } else if (opcode === EV.pointer_motion) {
      r.uint();
      this.pointerX = readFixed(r);
      this.pointerY = readFixed(r);
      this.pointerFocus?.emitPointer({
        type: "move",
        x: this.pointerX,
        y: this.pointerY,
        timeMs: now,
      });
    } else if (opcode === EV.pointer_button) {
      const serial = r.uint();
      r.uint();
      const button = r.uint();
      const state = r.uint();
      this.lastPointerSerial = serial;
      this.pointerFocus?.emitPointer({
        type: state === 1 ? "down" : "up",
        x: this.pointerX,
        y: this.pointerY,
        button: buttonName(button),
        timeMs: now,
      });
    } else if (opcode === EV.pointer_axis) {
      r.uint(); // time
      const axis = r.uint(); // 0 = vertical, 1 = horizontal
      const value = readFixed(r); // scroll amount in surface coordinates
      if (axis === 0) {
        // Vertical scroll: positive = down (matches DOM deltaY convention)
        this.pointerFocus?.emitPointer({
          type: "wheel",
          x: this.pointerX,
          y: this.pointerY,
          deltaY: value,
          timeMs: now,
        });
      }
    }
  }

  private handleKeyboard(opcode: number, r: MessageReader): void {
    if (opcode === EV.keyboard_keymap) {
      r.uint();
      const fd = r.fd();
      r.uint();
      try {
        closeFd(fd);
      } catch {
        // ok
      }
      return;
    }
    if (opcode === EV.keyboard_key) {
      r.uint();
      r.uint();
      const key = r.uint();
      const state = r.uint();
      const win = this.pointerFocus ?? [...this.windows][0] ?? null;
      win?.emitKey({
        type: state === KEY_PRESSED ? "down" : "up",
        code: key,
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
  private configured = false;
  private slots: ShmSlot[] = [];
  private configureCbs: Array<(w: number, h: number) => void> = [];
  private closeCbs: Array<() => void> = [];
  private pointerCbs: Array<(ev: UiPointerEvent) => void> = [];
  private keyCbs: Array<(ev: UiKeyEvent) => void> = [];
  private alive = true;

  constructor(platform: WaylandPlatform, opts: PlatformWindowOpts) {
    this.platform = platform;
    this.title = opts.title;
    this.appId = opts.appId;
    this.preferredW = opts.width;
    this.preferredH = opts.height;
    this.width = opts.width;
    this.height = opts.height;
    this.resizable = opts.resizable !== false;
  }

  create(): void {
    const p = this.platform;
    this.surfaceId = p.allocId();
    p.send(p.getCompositorId(), OP.compositor_create_surface, (b) =>
      b.newId(this.surfaceId),
    );
    p.registerSurface(this.surfaceId, this);

    this.xdgSurfaceId = p.allocId();
    p.send(p.getWmBaseId(), OP.xdg_wm_base_get_xdg_surface, (b) =>
      b.newId(this.xdgSurfaceId).object(this.surfaceId),
    );
    p.setHandler(this.xdgSurfaceId, (opcode, r) => {
      if (opcode === EV.xdg_surface_configure) {
        const serial = r.uint();
        this.configured = true;
        p.send(this.xdgSurfaceId, OP.xdg_surface_ack_configure, (b) =>
          b.uint(serial),
        );
        for (const cb of this.configureCbs) cb(this.width, this.height);
      }
    });

    this.toplevelId = p.allocId();
    p.send(this.xdgSurfaceId, OP.xdg_surface_get_toplevel, (b) =>
      b.newId(this.toplevelId),
    );
    p.setHandler(this.toplevelId, (opcode, r) => {
      if (opcode === EV.xdg_toplevel_configure) {
        const w = r.int();
        const h = r.int();
        r.array();
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
        for (const cb of this.closeCbs) cb();
      }
    });

    p.send(this.toplevelId, OP.xdg_toplevel_set_title, (b) =>
      b.string(this.title),
    );
    p.send(this.toplevelId, OP.xdg_toplevel_set_app_id, (b) =>
      b.string(this.appId),
    );
    // Ask for our preferred size. Fixed windows use min==max so Moire
    // reconfigures away from its default 800×600 slot hint.
    p.send(this.toplevelId, OP.xdg_toplevel_set_min_size, (b) =>
      b.int(this.preferredW).int(this.preferredH),
    );
    if (this.resizable) {
      p.send(this.toplevelId, OP.xdg_toplevel_set_max_size, (b) =>
        b.int(0).int(0),
      );
    } else {
      p.send(this.toplevelId, OP.xdg_toplevel_set_max_size, (b) =>
        b.int(this.preferredW).int(this.preferredH),
      );
    }
    const decoMgr = p.getDecoManagerId();
    if (decoMgr) {
      const decoId = p.allocId();
      p.send(decoMgr, OP.xdg_decoration_manager_get_toplevel_decoration, (b) =>
        b.newId(decoId).object(this.toplevelId),
      );
      p.send(decoId, OP.xdg_toplevel_decoration_set_mode, (b) =>
        b.uint(XDG_DECORATION_MODE_SERVER),
      );
      p.setHandler(decoId, () => {
        // configure — mode already requested
      });
    }
    p.send(this.surfaceId, OP.surface_commit, () => {});
  }

  setTitle(title: string): void {
    this.title = title;
    if (this.toplevelId) {
      this.platform.send(this.toplevelId, OP.xdg_toplevel_set_title, (b) =>
        b.string(title),
      );
    }
  }

  setSize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    for (const cb of this.configureCbs) cb(this.width, this.height);
  }

  present(pixels: Uint8Array, width: number, height: number): void {
    if (!this.alive || !this.configured) return;
    this.width = width;
    this.height = height;
    const stride = width * 4;
    const size = stride * height;
    let slot = this.slots.find((s) => !s.busy && s.size >= size);
    if (!slot) {
      slot = this.allocSlot(size);
    } else if (slot.width !== width || slot.height !== height) {
      this.recreateBuffer(slot, width, height, stride);
    }
    flushMmap(slot.map, pixels, size);
    slot.busy = true;
    const p = this.platform;
    // Window geometry = content box (excludes SSD); matches buffer for our clients.
    p.send(this.xdgSurfaceId, OP.xdg_surface_set_window_geometry, (b) =>
      b.int(0).int(0).int(width).int(height),
    );
    p.send(this.surfaceId, OP.surface_attach, (b) =>
      b.object(slot!.bufferId).int(0).int(0),
    );
    p.send(this.surfaceId, OP.surface_damage, (b) =>
      b.int(0).int(0).int(width).int(height),
    );
    p.send(this.surfaceId, OP.surface_commit, () => {});
  }

  onConfigure(cb: (w: number, h: number) => void): void {
    this.configureCbs.push(cb);
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
    if (this.toplevelId) {
      p.send(this.toplevelId, OP.xdg_toplevel_destroy, () => {});
      p.clearHandler(this.toplevelId);
    }
    if (this.xdgSurfaceId) {
      p.send(this.xdgSurfaceId, OP.xdg_surface_destroy, () => {});
      p.clearHandler(this.xdgSurfaceId);
    }
    if (this.surfaceId) {
      p.send(this.surfaceId, OP.surface_destroy, () => {});
    }
    p.unregisterWindow(this);
    this.configureCbs = [];
    this.closeCbs = [];
    this.pointerCbs = [];
    this.keyCbs = [];
  }

  private allocSlot(size: number): ShmSlot {
    const p = this.platform;
    const fd = memfdCreate(size);
    const map = mmap(size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    const poolId = p.allocId();
    p.send(p.getShmId(), OP.shm_create_pool, (b) =>
      b.newId(poolId).fd(fd).int(size),
    );
    const bufferId = p.allocId();
    const width = this.width;
    const height = this.height;
    const stride = width * 4;
    p.send(poolId, OP.shm_pool_create_buffer, (b) =>
      b
        .newId(bufferId)
        .int(0)
        .int(width)
        .int(height)
        .int(stride)
        .uint(WL_SHM_FORMAT_ARGB8888),
    );
    p.setHandler(bufferId, (opcode) => {
      if (opcode === EV.buffer_release) {
        const s = this.slots.find((x) => x.bufferId === bufferId);
        if (s) s.busy = false;
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
    };
    this.slots.push(slot);
    return slot;
  }

  private recreateBuffer(
    slot: ShmSlot,
    width: number,
    height: number,
    stride: number,
  ): void {
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
    p.send(slot.bufferId, OP.buffer_destroy, () => {});
    p.clearHandler(slot.bufferId);
    slot.bufferId = p.allocId();
    slot.width = width;
    slot.height = height;
    p.send(slot.poolId, OP.shm_pool_create_buffer, (b) =>
      b
        .newId(slot.bufferId)
        .int(0)
        .int(width)
        .int(height)
        .int(stride)
        .uint(WL_SHM_FORMAT_ARGB8888),
    );
    p.setHandler(slot.bufferId, (opcode) => {
      if (opcode === EV.buffer_release) slot.busy = false;
    });
  }

  private freeSlot(slot: ShmSlot): void {
    const p = this.platform;
    try {
      p.send(slot.bufferId, OP.buffer_destroy, () => {});
    } catch {
      // ok
    }
    p.clearHandler(slot.bufferId);
    try {
      p.send(slot.poolId, OP.shm_pool_destroy, () => {});
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
