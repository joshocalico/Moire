import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import {
  clearCloexec,
  closeFd,
  socketpairUnixStream,
} from "@moire/sys";

export type XwaylandHandle = {
  /** e.g. ":2" */
  display: string;
  displayNum: number;
  child: ChildProcess;
  rootless: boolean;
  /** Compositor end of the `-wm` socketpair (rootless only). */
  wmFd: number | null;
  stop(): void;
};

function displayInUse(n: number): boolean {
  return (
    fs.existsSync(`/tmp/.X${n}-lock`) ||
    fs.existsSync(path.join("/tmp/.X11-unix", `X${n}`))
  );
}

/** Pick a free X11 display number (skip :0 — often system/gdm). */
export function findFreeXDisplay(start = 1, end = 63): number {
  for (let n = start; n <= end; n++) {
    if (!displayInUse(n)) return n;
  }
  throw new Error("no free X11 display number");
}

function waitForXSocket(n: number, timeoutMs: number): Promise<void> {
  const sockPath = path.join("/tmp/.X11-unix", `X${n}`);
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (fs.existsSync(sockPath)) {
        const s = net.createConnection({ path: sockPath });
        s.once("connect", () => {
          s.end();
          resolve();
        });
        s.once("error", () => {
          if (Date.now() - start > timeoutMs) {
            reject(new Error(`X${n} socket exists but not accepting`));
          } else {
            setTimeout(tick, 50);
          }
        });
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`timed out waiting for ${sockPath}`));
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

/**
 * Start Xwayland as a Wayland client.
 * - rootless (default): per-window surfaces via `-rootless` + `-wm` fd
 * - rootful (`MOIRE_XWAYLAND=rootful`): one xdg_toplevel for the whole X screen
 */
export async function startXwayland(opts: {
  waylandDisplay: string;
  runtimeDir: string;
  /** Optional WxH for rootful X screen. */
  geometry?: string;
  rootless?: boolean;
  extraArgs?: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<XwaylandHandle> {
  const bin = process.env.MOIRE_XWAYLAND_BIN ?? "Xwayland";
  // Rootless unless explicitly asked for the nested-screen rootful mode.
  const rootless =
    opts.rootless ?? process.env.MOIRE_XWAYLAND !== "rootful";
  const n = findFreeXDisplay();
  const display = `:${n}`;

  let wmParentFd: number | null = null;
  let wmChildFd: number | null = null;
  if (rootless) {
    const pair = socketpairUnixStream();
    wmParentFd = pair[0];
    wmChildFd = pair[1];
    clearCloexec(wmChildFd);
  }

  const args = [display];
  if (rootless) {
    args.push("-rootless", "-wm", "3");
  } else if (opts.geometry) {
    args.push("-geometry", opts.geometry);
  }
  // CPU compositor needs CPU-readable buffers. Glamor/PRIME dmabufs often
  // import but fail gbm_bo_map on Parallels/virgl → black X11 windows.
  // Override with MOIRE_XWAYLAND_GLAMOR=1 to try hardware buffers again.
  if (process.env.MOIRE_XWAYLAND_GLAMOR !== "1") {
    args.push("-shm");
  }
  if (opts.extraArgs) args.push(...opts.extraArgs);

  console.log(`[xwayland] starting ${bin} ${args.join(" ")}`);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WAYLAND_DISPLAY: opts.waylandDisplay,
    XDG_RUNTIME_DIR: opts.runtimeDir,
    ...opts.env,
  };
  delete env.DISPLAY;

  const stdio: Array<"ignore" | "pipe" | number> = ["ignore", "pipe", "pipe"];
  if (wmChildFd != null) stdio.push(wmChildFd);

  const child = spawn(bin, args, {
    env,
    stdio,
    detached: false,
  });

  if (wmChildFd != null) {
    try {
      closeFd(wmChildFd);
    } catch {
      // ok
    }
    wmChildFd = null;
  }

  child.stdout?.on("data", (buf: Buffer) => {
    const line = buf.toString().trim();
    if (line) console.log(`[xwayland:out] ${line}`);
  });
  child.stderr?.on("data", (buf: Buffer) => {
    const line = buf.toString().trim();
    if (line) console.log(`[xwayland:err] ${line}`);
  });
  child.on("exit", (code, signal) => {
    console.log(`[xwayland] exited code=${code} signal=${signal}`);
  });

  try {
    await waitForXSocket(n, 15_000);
  } catch (err) {
    child.kill("SIGTERM");
    if (wmParentFd != null) {
      try {
        closeFd(wmParentFd);
      } catch {
        // ok
      }
    }
    throw err;
  }

  console.log(
    `[xwayland] ready DISPLAY=${display} mode=${rootless ? "rootless" : "rootful"}`,
  );

  // Session scripts / terminals read this so X11 clients get a DISPLAY.
  try {
    const marker = path.join(opts.runtimeDir, "moire-display");
    fs.writeFileSync(marker, `${display}\n`, { mode: 0o644 });
  } catch (err) {
    console.warn("[xwayland] could not write moire-display marker:", err);
  }

  return {
    display,
    displayNum: n,
    child,
    rootless,
    wmFd: wmParentFd,
    stop() {
      try {
        child.kill("SIGTERM");
      } catch {
        // ok
      }
      // wmFd is owned by X11Wm after startFromWmFd — do not close here.
      try {
        fs.unlinkSync(path.join(opts.runtimeDir, "moire-display"));
      } catch {
        // ok
      }
    },
  };
}
