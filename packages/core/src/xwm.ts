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
};

export type XwmEvents = {
  mapped: [win: XwmWindow];
  unmapped: [win: XwmWindow];
  destroyed: [win: XwmWindow];
  configured: [win: XwmWindow];
  title: [win: XwmWindow];
  serial: [win: XwmWindow, serial: bigint];
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
  event_consumers: Record<number, EventEmitter>;
  on: (ev: string, cb: (...args: unknown[]) => void) => void;
  terminate?: () => void;
  init: (stream: net.Socket) => void;
};

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
      "_NET_WM_NAME",
      "_NET_SUPPORTED",
      "_NET_SUPPORTING_WM_CHECK",
      "_NET_WM_STATE",
      "_NET_ACTIVE_WINDOW",
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

  closeWindow(wid: number): void {
    const X = this.X;
    if (!X) return;
    try {
      (X as unknown as { UnmapWindow?: (id: number) => void }).UnmapWindow?.(wid);
    } catch {
      // ok
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
        X.MapWindow(wid);
        win.mapped = true;
        console.log(
          `[xwm] mapped wid=${wid} ${win.width}x${win.height} @ ${win.x},${win.y} override=${win.overrideRedirect}`,
        );
        this.readTitle(wid);
        this.emit("mapped", win);
      });
    });
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
    }
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
