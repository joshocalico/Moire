/**
 * Minimal X11 window manager for rootless Xwayland.
 * Speaks X11 on the `-wm` socketpair fd (not /tmp/.X11-unix), pairs windows to
 * Wayland surfaces via WL_SURFACE_SERIAL, and drives map/configure/title.
 */
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import net from "node:net";

const require = createRequire(import.meta.url);
const x11 = require("x11") as {
  createClient: (
    opts: { display?: string; disableBigRequests?: boolean },
    cb: (err: Error | null, display: unknown) => void,
  ) => { init: (stream: net.Socket) => void };
  eventMask: Record<string, number>;
};

export type XwmWindowType =
  | "normal"
  | "dialog"
  | "utility"
  | "splash"
  | "menu"
  | "tooltip"
  | "dropdown"
  | "popup"
  | "notification"
  | "other";

export type XwmWindow = {
  wid: number;
  serial: bigint | null;
  mapped: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  title: string;
  overrideRedirect: boolean;
  /** ICCCM WM_TRANSIENT_FOR parent wid, if any. */
  transientFor: number | null;
  windowType: XwmWindowType;
  modal: boolean;
};

export type XwmEvents = {
  mapped: [win: XwmWindow];
  unmapped: [win: XwmWindow];
  destroyed: [win: XwmWindow];
  configured: [win: XwmWindow];
  title: [win: XwmWindow];
  serial: [win: XwmWindow, serial: bigint];
  /** Client requested activation via _NET_ACTIVE_WINDOW. */
  activate: [win: XwmWindow];
};

type XClient = {
  AllocID: () => number;
  GetAtomName: (atom: number, cb: (err: Error | null, name: string) => void) => void;
  InternAtom: (
    onlyIfExists: boolean,
    name: string,
    cb: (err: Error | null, atom: number) => void,
  ) => void;
  ChangeWindowAttributes: (
    wid: number,
    attrs: Record<string, unknown>,
  ) => void;
  GetWindowAttributes: (
    wid: number,
    cb: (err: Error | null, attrs: unknown) => void,
  ) => void;
  GetGeometry: (
    wid: number,
    cb: (
      err: Error | null,
      geom: { x: number; y: number; width: number; height: number },
    ) => void,
  ) => void;
  MapWindow: (wid: number) => void;
  ConfigureWindow: (wid: number, conf: Record<string, number>) => void;
  WarpPointer: (
    srcWid: number,
    dstWid: number,
    srcX: number,
    srcY: number,
    srcW: number,
    srcH: number,
    dstX: number,
    dstY: number,
  ) => void;
  GetProperty: (
    deleteAfter: number,
    wid: number,
    property: number,
    type: number,
    offset: number,
    length: number,
    cb: (err: Error | null, prop: { data: Buffer; type: number }) => void,
  ) => void;
  ChangeProperty: (
    mode: number,
    wid: number,
    property: number,
    type: number,
    units: number,
    data: Buffer,
  ) => void;
  CreateWindow: (
    id: number,
    parentId: number,
    x: number,
    y: number,
    width: number,
    height: number,
    borderWidth?: number,
    depth?: number,
    _class?: number,
    visual?: number,
    values?: Record<string, unknown>,
  ) => void;
  SendEvent: (
    destination: number,
    propagate: boolean,
    eventMask: number,
    eventRawData: Buffer,
  ) => void;
  DestroyWindow: (wid: number) => void;
  UnmapWindow: (wid: number) => void;
  event_consumers: Record<number, EventEmitter>;
  on: (ev: string, cb: (...args: unknown[]) => void) => void;
  terminate?: () => void;
  init: (stream: net.Socket) => void;
};

/** XA_ATOM — type of WM_PROTOCOLS / _NET_WM_WINDOW_TYPE values. */
const XA_ATOM = 4;
/** XA_WINDOW — type of WM_TRANSIENT_FOR / _NET_SUPPORTING_WM_CHECK. */
const XA_WINDOW = 33;
/** ChangeProperty mode Replace. */
const PROP_MODE_REPLACE = 0;

type XDisplay = {
  client: XClient;
  screen: Array<{ root: number; white_pixel: number }>;
};

const eventMask = x11.eventMask;

export class X11Wm extends EventEmitter {
  private X: XClient | null = null;
  private root = 0;
  private atoms: Record<string, number> = {};
  private windows = new Map<number, XwmWindow>();
  /** serial → wid waiting for Wayland surface (or already paired). */
  private bySerial = new Map<bigint, number>();
  /** EWMH supporting-WM-check child window. */
  private ewmhCheckWid = 0;

  /**
   * Connect as the Xwayland WM over the `-wm` socketpair fd.
   * `displayNum` is only used for the X11 handshake cookie lookup.
   */
  static async startFromWmFd(
    wmFd: number,
    displayNum: number,
  ): Promise<X11Wm> {
    const wm = new X11Wm();
    await wm.connectFd(wmFd, displayNum);
    return wm;
  }

  /** @deprecated Prefer startFromWmFd — /tmp/.X11-unix is not the WM channel. */
  static async start(display: string): Promise<X11Wm> {
    const wm = new X11Wm();
    await wm.connectDisplay(display);
    return wm;
  }

  private connectFd(wmFd: number, displayNum: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = new net.Socket({ fd: wmFd, readable: true, writable: true });
      // remoteAddress is undefined on fd sockets — node-x11 then uses os.hostname().

      const origCreate = net.createConnection;
      let restored = false;
      const restore = () => {
        if (!restored) {
          restored = true;
          (net as unknown as { createConnection: typeof origCreate }).createConnection =
            origCreate;
        }
      };

      // Hijack createConnection so createClient uses our already-open fd.
      (net as unknown as { createConnection: typeof origCreate }).createConnection =
        (() => {
          process.nextTick(() => sock.emit("connect"));
          return sock;
        }) as typeof origCreate;

      try {
        x11.createClient(
          { display: `:${displayNum}`, disableBigRequests: true },
          (err: Error | null, displayObj: unknown) => {
            restore();
            if (err || !displayObj) {
              reject(err ?? new Error("x11 createClient on wmFd failed"));
              return;
            }
            const d = displayObj as XDisplay;
            this.X = d.client;
            this.root = d.screen[0]!.root;
            this.bootstrap()
              .then(resolve)
              .catch(reject);
          },
        );
      } catch (err) {
        restore();
        reject(err);
      }
    });
  }

  private connectDisplay(display: string): Promise<void> {
    return new Promise((resolve, reject) => {
      x11.createClient({ display }, (err: Error | null, displayObj: unknown) => {
        if (err || !displayObj) {
          reject(err ?? new Error("x11 createClient failed"));
          return;
        }
        const d = displayObj as XDisplay;
        this.X = d.client;
        this.root = d.screen[0]!.root;
        this.bootstrap()
          .then(resolve)
          .catch(reject);
      });
    });
  }

  private intern(name: string): Promise<number> {
    const X = this.X!;
    return new Promise((resolve, reject) => {
      X.InternAtom(false, name, (err, atom) => {
        if (err) reject(err);
        else resolve(atom);
      });
    });
  }

  private async bootstrap(): Promise<void> {
    const X = this.X!;
    const names = [
      "WM_NAME",
      "WM_PROTOCOLS",
      "WM_DELETE_WINDOW",
      "WM_TRANSIENT_FOR",
      "_NET_WM_NAME",
      "_NET_SUPPORTED",
      "_NET_SUPPORTING_WM_CHECK",
      "_NET_WM_STATE",
      "_NET_WM_STATE_MODAL",
      "_NET_WM_STATE_MAXIMIZED_VERT",
      "_NET_WM_STATE_MAXIMIZED_HORZ",
      "_NET_WM_STATE_FULLSCREEN",
      "_NET_ACTIVE_WINDOW",
      "_NET_WM_WINDOW_TYPE",
      "_NET_WM_WINDOW_TYPE_NORMAL",
      "_NET_WM_WINDOW_TYPE_DIALOG",
      "_NET_WM_WINDOW_TYPE_UTILITY",
      "_NET_WM_WINDOW_TYPE_SPLASH",
      "_NET_WM_WINDOW_TYPE_MENU",
      "_NET_WM_WINDOW_TYPE_TOOLTIP",
      "_NET_WM_WINDOW_TYPE_DROPDOWN_MENU",
      "_NET_WM_WINDOW_TYPE_POPUP_MENU",
      "_NET_WM_WINDOW_TYPE_NOTIFICATION",
      "WL_SURFACE_SERIAL",
      "WL_SURFACE_ID",
      "UTF8_STRING",
      "STRING",
    ];
    for (const n of names) {
      this.atoms[n] = await this.intern(n);
    }

    // Claim SubstructureRedirect (become WM).
    await new Promise<void>((resolve, reject) => {
      try {
        X.ChangeWindowAttributes(this.root, {
          eventMask:
            eventMask.SubstructureRedirect |
            eventMask.SubstructureNotify |
            eventMask.PropertyChange |
            eventMask.StructureNotify,
        });
        setTimeout(resolve, 50);
      } catch (err) {
        reject(new Error(`XWM: failed to become WM: ${err}`));
      }
    });

    this.publishEwmh();

    // Rootless Xwayland only creates wl_surfaces for Composite-redirected
    // windows (RedirectDrawManual). Redirect all client subwindows.
    await new Promise<void>((resolve, reject) => {
      const client = X as XClient & {
        require?: (
          name: string,
          cb: (err: Error | null, ext: {
            Redirect: { Manual: number };
            RedirectSubwindows: (wid: number, mode: number) => void;
            QueryVersion: (a: number, b: number, cb: () => void) => void;
          }) => void,
        ) => void;
      };
      if (typeof client.require !== "function") {
        reject(new Error("x11 client has no require() for Composite"));
        return;
      }
      client.require("composite", (err, Composite) => {
        if (err || !Composite) {
          reject(err ?? new Error("Composite extension unavailable"));
          return;
        }
        Composite.QueryVersion(0, 4, () => {
          try {
            Composite.RedirectSubwindows(this.root, Composite.Redirect.Manual);
            console.log("[xwm] CompositeRedirectSubwindows(root, Manual)");
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    });

    X.on("event", (ev: unknown) => {
      const e = ev as Record<string, unknown>;
      if (e.name && e.name !== "PropertyNotify") {
        console.log(`[xwm] event ${String(e.name)} wid=${e.wid ?? e.parent ?? "?"}`);
      }
      this.onEvent(e);
    });
    X.on("error", (err: unknown) => {
      console.warn("[xwm] x11 error:", err);
    });

    console.log(`[xwm] ready on root=${this.root} (wm fd)`);
  }

  /** Minimal EWMH so toolkits recognize us as a modern WM. */
  private publishEwmh(): void {
    const X = this.X;
    if (!X) return;
    try {
      this.ewmhCheckWid = X.AllocID();
      X.CreateWindow(this.ewmhCheckWid, this.root, -1, -1, 1, 1, 0);
      const checkBuf = Buffer.alloc(4);
      checkBuf.writeUInt32LE(this.ewmhCheckWid >>> 0, 0);
      const checkAtom = this.atoms._NET_SUPPORTING_WM_CHECK!;
      X.ChangeProperty(
        PROP_MODE_REPLACE,
        this.root,
        checkAtom,
        XA_WINDOW,
        32,
        checkBuf,
      );
      X.ChangeProperty(
        PROP_MODE_REPLACE,
        this.ewmhCheckWid,
        checkAtom,
        XA_WINDOW,
        32,
        checkBuf,
      );
      const name = Buffer.from("Moire", "utf8");
      X.ChangeProperty(
        PROP_MODE_REPLACE,
        this.ewmhCheckWid,
        this.atoms._NET_WM_NAME!,
        this.atoms.UTF8_STRING!,
        8,
        name,
      );

      const supportedNames = [
        "_NET_SUPPORTED",
        "_NET_SUPPORTING_WM_CHECK",
        "_NET_WM_NAME",
        "_NET_WM_STATE",
        "_NET_WM_STATE_MODAL",
        "_NET_ACTIVE_WINDOW",
        "_NET_WM_WINDOW_TYPE",
        "_NET_WM_WINDOW_TYPE_NORMAL",
        "_NET_WM_WINDOW_TYPE_DIALOG",
        "_NET_WM_WINDOW_TYPE_UTILITY",
        "_NET_WM_WINDOW_TYPE_SPLASH",
        "_NET_WM_WINDOW_TYPE_MENU",
        "_NET_WM_WINDOW_TYPE_TOOLTIP",
        "_NET_WM_WINDOW_TYPE_DROPDOWN_MENU",
        "_NET_WM_WINDOW_TYPE_POPUP_MENU",
        "_NET_WM_WINDOW_TYPE_NOTIFICATION",
        "WM_DELETE_WINDOW",
      ];
      const atoms = supportedNames
        .map((n) => this.atoms[n])
        .filter((a): a is number => a != null);
      const list = Buffer.alloc(atoms.length * 4);
      for (let i = 0; i < atoms.length; i++) {
        list.writeUInt32LE(atoms[i]! >>> 0, i * 4);
      }
      X.ChangeProperty(
        PROP_MODE_REPLACE,
        this.root,
        this.atoms._NET_SUPPORTED!,
        XA_ATOM,
        32,
        list,
      );
      console.log(`[xwm] EWMH published (_NET_SUPPORTED=${atoms.length})`);
    } catch (err) {
      console.warn("[xwm] EWMH publish failed:", err);
    }
  }

  windowBySerial(serial: bigint): XwmWindow | null {
    const wid = this.bySerial.get(serial);
    if (wid == null) return null;
    return this.windows.get(wid) ?? null;
  }

  /** Oldest mapped window that has a serial and passes `isFree`. */
  takeUnpairedSerialWindow(
    isFree: (wid: number) => boolean = () => true,
  ): XwmWindow | null {
    for (const win of this.windows.values()) {
      if (win.serial != null && win.mapped && isFree(win.wid)) return win;
    }
    return null;
  }

  configureWindow(wid: number, x: number, y: number, w: number, h: number): void {
    const X = this.X;
    if (!X) return;
    X.ConfigureWindow(wid, {
      x: x | 0,
      y: y | 0,
      width: Math.max(1, w | 0),
      height: Math.max(1, h | 0),
    });
    const win = this.windows.get(wid);
    if (win) {
      win.x = x | 0;
      win.y = y | 0;
      win.width = Math.max(1, w | 0);
      win.height = Math.max(1, h | 0);
    }
  }

  /**
   * Keep X11 root pointer in sync with the Wayland cursor so apps that
   * XQueryPointer (xeyes) track globally, not only over X11 surfaces.
   */
  warpPointer(x: number, y: number): void {
    const X = this.X;
    if (!X || !this.root) return;
    try {
      X.WarpPointer(0, this.root, 0, 0, 0, 0, x | 0, y | 0);
    } catch {
      // ok — Xwayland may reject while unmapped
    }
  }

  /**
   * ICCCM close: if the client lists WM_DELETE_WINDOW in WM_PROTOCOLS, send
   * that ClientMessage; otherwise DestroyWindow. Never just Unmap — that hides
   * the surface without telling the app to quit.
   */
  closeWindow(wid: number): void {
    const X = this.X;
    if (!X) return;
    const protocols = this.atoms.WM_PROTOCOLS;
    const deleteAtom = this.atoms.WM_DELETE_WINDOW;
    if (protocols == null || deleteAtom == null) {
      this.destroyWindow(wid);
      return;
    }
    X.GetProperty(0, wid, protocols, XA_ATOM, 0, 64, (err, prop) => {
      if (err) {
        console.warn(`[xwm] close GetProperty WM_PROTOCOLS wid=${wid}`, err);
        this.destroyWindow(wid);
        return;
      }
      const data = prop?.data;
      let supportsDelete = false;
      if (data && data.length >= 4) {
        for (let i = 0; i + 4 <= data.length; i += 4) {
          if (data.readUInt32LE(i) === deleteAtom) {
            supportsDelete = true;
            break;
          }
        }
      }
      if (supportsDelete) {
        this.sendDeleteWindow(wid);
      } else {
        this.destroyWindow(wid);
      }
    });
  }

  private sendDeleteWindow(wid: number): void {
    const X = this.X;
    if (!X) return;
    const protocols = this.atoms.WM_PROTOCOLS!;
    const deleteAtom = this.atoms.WM_DELETE_WINDOW!;
    // XClientMessageEvent — 32 bytes, format 32.
    const ev = Buffer.alloc(32);
    ev.writeUInt8(33, 0); // ClientMessage
    ev.writeUInt8(32, 1); // format
    ev.writeUInt32LE(wid >>> 0, 4);
    ev.writeUInt32LE(protocols >>> 0, 8);
    ev.writeUInt32LE(deleteAtom >>> 0, 12); // data.l[0]
    ev.writeUInt32LE(0, 16); // data.l[1] = CurrentTime
    try {
      X.SendEvent(wid, false, 0, ev);
      console.log(`[xwm] close wid=${wid} via WM_DELETE_WINDOW`);
    } catch (err) {
      console.warn(`[xwm] SendEvent WM_DELETE_WINDOW wid=${wid}`, err);
      this.destroyWindow(wid);
    }
  }

  private destroyWindow(wid: number): void {
    const X = this.X;
    if (!X) return;
    try {
      X.DestroyWindow(wid);
      console.log(`[xwm] close wid=${wid} via DestroyWindow`);
    } catch (err) {
      console.warn(`[xwm] DestroyWindow wid=${wid}`, err);
    }
  }

  /** Publish _NET_ACTIVE_WINDOW on the root (EWMH focus hint). */
  setActiveWindow(wid: number | null): void {
    const X = this.X;
    const atom = this.atoms._NET_ACTIVE_WINDOW;
    if (!X || atom == null) return;
    try {
      const buf = Buffer.alloc(4);
      buf.writeUInt32LE((wid ?? 0) >>> 0, 0);
      X.ChangeProperty(
        PROP_MODE_REPLACE,
        this.root,
        atom,
        XA_WINDOW,
        32,
        buf,
      );
    } catch (err) {
      console.warn("[xwm] setActiveWindow failed:", err);
    }
  }

  stop(): void {
    try {
      this.X?.terminate?.();
    } catch {
      // ok
    }
    this.X = null;
  }

  private ensureWindow(wid: number): XwmWindow {
    let win = this.windows.get(wid);
    if (!win) {
      win = {
        wid,
        serial: null,
        mapped: false,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        title: "",
        overrideRedirect: false,
        transientFor: null,
        windowType: "normal",
        modal: false,
      };
      this.windows.set(wid, win);
    }
    return win;
  }

  private onEvent(ev: Record<string, unknown>): void {
    const name = String(ev.name ?? "");
    if (name === "CreateNotify") {
      this.onCreateNotify(ev.wid as number);
    } else if (name === "MapRequest") {
      this.onMapRequest(ev.wid as number);
    } else if (name === "ConfigureRequest") {
      this.onConfigureRequest(ev);
    } else if (name === "DestroyNotify") {
      this.onDestroy(ev.wid as number);
    } else if (name === "UnmapNotify") {
      this.onUnmap(ev.wid as number);
    } else if (name === "PropertyNotify") {
      this.onProperty(ev.wid as number, ev.atom as number);
    } else if (name === "ClientMessage") {
      this.onClientMessage(ev);
    }
  }

  private onCreateNotify(wid: number): void {
    const X = this.X!;
    this.ensureWindow(wid);
    try {
      X.ChangeWindowAttributes(wid, {
        eventMask:
          eventMask.StructureNotify |
          eventMask.PropertyChange |
          eventMask.SubstructureNotify,
      });
    } catch (err) {
      console.warn("[xwm] select events on", wid, err);
    }
  }

  private onMapRequest(wid: number): void {
    const X = this.X!;
    console.log(`[xwm] MapRequest wid=${wid}`);
    const win = this.ensureWindow(wid);
    X.GetWindowAttributes(wid, (err, attrs) => {
      if (err) console.warn("[xwm] GetWindowAttributes", err);
      const a = (attrs ?? {}) as { overrideRedirect?: number | boolean };
      win.overrideRedirect = !!a.overrideRedirect;
      X.GetGeometry(wid, (gerr, geom) => {
        if (gerr) console.warn("[xwm] GetGeometry", gerr);
        const g = (geom ?? {}) as {
          xPos?: number;
          yPos?: number;
          width?: number;
          height?: number;
          x?: number;
          y?: number;
        };
        win.x = g.xPos ?? g.x ?? 0;
        win.y = g.yPos ?? g.y ?? 0;
        win.width = g.width ?? 0;
        win.height = g.height ?? 0;
        void this.refreshHints(wid).then(() => {
          X.MapWindow(wid);
          win.mapped = true;
          console.log(
            `[xwm] mapped wid=${wid} ${win.width}x${win.height} @ ${win.x},${win.y} override=${win.overrideRedirect} transient=${win.transientFor ?? "-"} type=${win.windowType} modal=${win.modal ? 1 : 0}`,
          );
          this.readTitle(wid);
          this.emit("mapped", win);
        });
      });
    });
  }

  private refreshHints(wid: number): Promise<void> {
    return Promise.all([
      this.readTransientFor(wid),
      this.readWindowType(wid),
      this.readWmState(wid),
    ]).then(() => undefined);
  }

  private onConfigureRequest(ev: Record<string, unknown>): void {
    const X = this.X!;
    const wid = ev.wid as number;
    const conf: Record<string, number> = {};
    if (ev.x != null) conf.x = ev.x as number;
    if (ev.y != null) conf.y = ev.y as number;
    if (ev.width != null) conf.width = ev.width as number;
    if (ev.height != null) conf.height = ev.height as number;
    if (ev.borderWidth != null) conf.borderWidth = ev.borderWidth as number;
    if (ev.sibling != null) conf.sibling = ev.sibling as number;
    if (ev.stackMode != null) conf.stackMode = ev.stackMode as number;
    X.ConfigureWindow(wid, conf);
    const win = this.ensureWindow(wid);
    if (conf.x != null) win.x = conf.x;
    if (conf.y != null) win.y = conf.y;
    if (conf.width != null) win.width = conf.width;
    if (conf.height != null) win.height = conf.height;
    this.emit("configured", win);
  }

  private onDestroy(wid: number): void {
    const win = this.windows.get(wid);
    if (!win) return;
    if (win.serial != null) this.bySerial.delete(win.serial);
    this.windows.delete(wid);
    this.emit("destroyed", win);
  }

  private onUnmap(wid: number): void {
    const win = this.windows.get(wid);
    if (!win) return;
    win.mapped = false;
    this.emit("unmapped", win);
  }

  private onProperty(wid: number, atom: number): void {
    if (
      atom === this.atoms.WM_NAME ||
      atom === this.atoms._NET_WM_NAME
    ) {
      this.readTitle(wid);
    } else if (atom === this.atoms.WM_TRANSIENT_FOR) {
      void this.readTransientFor(wid);
    } else if (atom === this.atoms._NET_WM_WINDOW_TYPE) {
      void this.readWindowType(wid);
    } else if (atom === this.atoms._NET_WM_STATE) {
      void this.readWmState(wid);
    }
  }

  private readTransientFor(wid: number): Promise<void> {
    const X = this.X!;
    const atom = this.atoms.WM_TRANSIENT_FOR;
    if (atom == null) return Promise.resolve();
    return new Promise((resolve) => {
      X.GetProperty(0, wid, atom, XA_WINDOW, 0, 1, (err, prop) => {
        const win = this.ensureWindow(wid);
        if (!err) {
          const data = prop?.data;
          if (data && data.length >= 4) {
            const parent = data.readUInt32LE(0);
            win.transientFor = parent !== 0 ? parent : null;
          } else {
            win.transientFor = null;
          }
        }
        resolve();
      });
    });
  }

  private readWindowType(wid: number): Promise<void> {
    const X = this.X!;
    const atom = this.atoms._NET_WM_WINDOW_TYPE;
    if (atom == null) return Promise.resolve();
    return new Promise((resolve) => {
      X.GetProperty(0, wid, atom, XA_ATOM, 0, 16, (err, prop) => {
        const win = this.ensureWindow(wid);
        if (err || !prop?.data || prop.data.length < 4) {
          win.windowType = "normal";
          resolve();
          return;
        }
        const data = prop.data;
        let type: XwmWindowType = "other";
        for (let i = 0; i + 4 <= data.length; i += 4) {
          const a = data.readUInt32LE(i);
          if (a === this.atoms._NET_WM_WINDOW_TYPE_DIALOG) type = "dialog";
          else if (a === this.atoms._NET_WM_WINDOW_TYPE_UTILITY) type = "utility";
          else if (a === this.atoms._NET_WM_WINDOW_TYPE_SPLASH) type = "splash";
          else if (a === this.atoms._NET_WM_WINDOW_TYPE_MENU) type = "menu";
          else if (a === this.atoms._NET_WM_WINDOW_TYPE_TOOLTIP) type = "tooltip";
          else if (a === this.atoms._NET_WM_WINDOW_TYPE_DROPDOWN_MENU) {
            type = "dropdown";
          } else if (a === this.atoms._NET_WM_WINDOW_TYPE_POPUP_MENU) {
            type = "popup";
          } else if (a === this.atoms._NET_WM_WINDOW_TYPE_NOTIFICATION) {
            type = "notification";
          } else if (a === this.atoms._NET_WM_WINDOW_TYPE_NORMAL) type = "normal";
          else continue;
          break;
        }
        win.windowType = type;
        resolve();
      });
    });
  }

  private readWmState(wid: number): Promise<void> {
    const X = this.X!;
    const atom = this.atoms._NET_WM_STATE;
    if (atom == null) return Promise.resolve();
    return new Promise((resolve) => {
      X.GetProperty(0, wid, atom, XA_ATOM, 0, 32, (err, prop) => {
        const win = this.ensureWindow(wid);
        win.modal = false;
        if (!err && prop?.data && prop.data.length >= 4) {
          const modalAtom = this.atoms._NET_WM_STATE_MODAL;
          for (let i = 0; i + 4 <= prop.data.length; i += 4) {
            if (modalAtom != null && prop.data.readUInt32LE(i) === modalAtom) {
              win.modal = true;
              break;
            }
          }
        }
        resolve();
      });
    });
  }

  /** True when the window type should skip Moire SSD (menus/tooltips/splash). */
  static isUndecoratedType(type: XwmWindowType): boolean {
    return (
      type === "menu" ||
      type === "tooltip" ||
      type === "dropdown" ||
      type === "popup" ||
      type === "splash" ||
      type === "notification"
    );
  }

  private onClientMessage(ev: Record<string, unknown>): void {
    const type = ev.message_type as number | undefined;
    const wid = ev.wid as number;
    if (type == null || wid == null) return;
    console.log(
      `[xwm] ClientMessage wid=${wid} type=${type} data=${JSON.stringify(ev.data)}`,
    );
    if (type === this.atoms.WL_SURFACE_SERIAL) {
      const data = ev.data as number[] | undefined;
      const lo = (data?.[0] ?? 0) >>> 0;
      const hi = (data?.[1] ?? 0) >>> 0;
      const serial = (BigInt(hi) << 32n) | BigInt(lo);
      if (serial === 0n) return;
      const win = this.ensureWindow(wid);
      win.serial = serial;
      this.bySerial.set(serial, wid);
      console.log(`[xwm] WL_SURFACE_SERIAL wid=${wid} serial=${serial}`);
      this.emit("serial", win, serial);
    } else if (type === this.atoms._NET_ACTIVE_WINDOW) {
      // data.l[0]=source, [1]=timestamp, [2]=requestor — wid is the window.
      const win = this.ensureWindow(wid);
      if (win.mapped) this.emit("activate", win);
    }
  }

  private readTitle(wid: number): void {
    const X = this.X!;
    const netAtom = this.atoms._NET_WM_NAME;
    const utf8 = this.atoms.UTF8_STRING;
    X.GetProperty(0, wid, netAtom, utf8, 0, 1024, (err, prop) => {
      if (!err && prop?.data?.length) {
        const title = prop.data.toString("utf8").replace(/\0+$/, "");
        const win = this.ensureWindow(wid);
        if (title && title !== win.title) {
          win.title = title;
          this.emit("title", win);
        }
        return;
      }
      const wmName = this.atoms.WM_NAME;
      const str = this.atoms.STRING;
      X.GetProperty(0, wid, wmName, str, 0, 1024, (err2, prop2) => {
        if (err2 || !prop2?.data?.length) return;
        const title = prop2.data.toString("utf8").replace(/\0+$/, "");
        const win = this.ensureWindow(wid);
        if (title && title !== win.title) {
          win.title = title;
          this.emit("title", win);
        }
      });
    });
  }
}
