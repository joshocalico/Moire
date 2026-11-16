/**
 * Boot → compositor display handoff.
 *
 * The boot stage animates until the next stage is ready to take the display, then stops,
 * drops DRM master (its framebuffer stays on screen) and publishes its final frame and scene
 * clock. A compositor that is not yet ready to draw seeds its first scanout buffer with that
 * frame, so the modeset is invisible, and keeps it up until its own first frame.
 *
 * The scene's clock is CLOCK_MONOTONIC from
 * `startedAtMs`, so a later stage draws the same scene at the same moment. One that prepared its
 * renderer while the boot stage was presenting asks for no frame and does no modeset: the CRTC goes
 * on scanning out the boot stage's last frame until the next stage flips to its own.
 *
 * Protocol, all in one tmpfs directory:
 *   active.json    written by the boot stage once its first frame is on screen
 *   request        created by the compositor when it is ready to open KMS
 *   released.json  written by the boot stage after it dropped master (frame.bgra beside it)
 *   presented      created by the compositor after its first own frame; the boot stage exits
 */
import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const NO_FRAME = "no-frame";

export const BOOT_HANDOFF_DIR = process.env.MOIRE_BOOT_HANDOFF_DIR ?? "/run/moire-boot-handoff";

export type BootHandoffActive = {
  pid: number;
  scene: string;
  width: number;
  height: number;
  /** CLOCK_MONOTONIC milliseconds at scene time zero. */
  startedAtMs: number;
  /** The scene is on screen, so `startedAtMs`, `width` and `height` are final. */
  presenting?: boolean;
};

export type BootHandoffRelease = BootHandoffActive & {
  /** Scene time of the frame left on screen. */
  sceneSeconds: number;
  releasedAtMs: number;
  /** Tight BGRA (XRGB8888 memory order) of the final frame, when published. */
  frame: string | null;
};

export type BootHandoffFrame = { pixels: Uint8Array; width: number; height: number };

/** CLOCK_MONOTONIC in milliseconds (shared across processes on Linux). */
export function monotonicMs(): number {
  return Number(process.hrtime.bigint()) / 1e6;
}

function file(name: string, dir: string): string {
  return path.join(dir, name);
}

function writeAtomic(target: string, data: string | Uint8Array): void {
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, data, { mode: 0o644 });
  // Explicit: a writer with a strict umask (moire-dm's broker) would otherwise leave 0600, and the
  // next stage runs as another user. These files only ever hold the scene.
  fs.chmodSync(temporary, 0o644);
  fs.renameSync(temporary, target);
}

function readJson<T>(target: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(target, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Boot side: announce a live boot scene, clearing any previous handshake. */
export function publishBootActive(state: BootHandoffActive, dir = BOOT_HANDOFF_DIR): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
  for (const stale of ["request", "released.json", "presented", "frame.bgra"])
    fs.rmSync(file(stale, dir), { force: true });
  writeAtomic(file("active.json", dir), JSON.stringify(state));
}

/** Boot side: the scene's first frame is up. Leaves a pending release request in place. */
export function markBootPresenting(state: BootHandoffActive, dir = BOOT_HANDOFF_DIR): void {
  writeAtomic(file("active.json", dir), JSON.stringify({ ...state, presenting: true }));
}

/** The running boot stage's published state, if it is alive. */
export function readBootActive(dir = BOOT_HANDOFF_DIR): BootHandoffActive | null {
  const active = readJson<BootHandoffActive>(file("active.json", dir));
  if (!active) return null;
  try {
    process.kill(active.pid, 0);
  } catch (error) {
    // EPERM: alive, but owned by another user (the boot stage runs as root).
    if ((error as NodeJS.ErrnoException).code !== "EPERM") return null;
  }
  return active;
}

/** Compositor side: wait, bounded, for the boot stage's scene to be on screen. */
export async function waitForBootPresenting(
  timeoutMs: number,
  dir = BOOT_HANDOFF_DIR,
): Promise<BootHandoffActive | null> {
  const deadline = monotonicMs() + timeoutMs;
  for (;;) {
    const active = readBootActive(dir);
    if (!active) return null;
    if (active.presenting) return active;
    if (monotonicMs() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Watch for a handshake file to appear; returns a disposer. */
function watchFor(name: string, dir: string, onSeen: () => void): () => void {
  let done = false;
  const check = () => {
    if (done || !fs.existsSync(file(name, dir))) return;
    done = true;
    dispose();
    onSeen();
  };
  const watcher = fs.watch(dir, check);
  // fs.watch can miss events on some filesystems; a slow poll bounds the latency.
  const poll = setInterval(check, 50);
  poll.unref();
  const dispose = () => {
    done = true;
    watcher.close();
    clearInterval(poll);
  };
  queueMicrotask(check);
  return dispose;
}

export function watchBootReleaseRequest(onRequest: () => void, dir = BOOT_HANDOFF_DIR) {
  return watchFor("request", dir, onRequest);
}

export function watchBootPresented(onPresented: () => void, dir = BOOT_HANDOFF_DIR) {
  return watchFor("presented", dir, onPresented);
}

/** Boot side: whether the next stage asked for the final frame. It need not if it is prepared. */
export function bootReleaseWantsFrame(dir = BOOT_HANDOFF_DIR): boolean {
  try {
    return !fs.readFileSync(file("request", dir), "utf8").includes(NO_FRAME);
  } catch {
    return true;
  }
}

/** Boot side: master is dropped; publish the frame left on screen and the scene clock. */
export function completeBootRelease(
  release: Omit<BootHandoffRelease, "frame">,
  frame: BootHandoffFrame | null,
  dir = BOOT_HANDOFF_DIR,
): void {
  let frameName: string | null = null;
  if (frame && frame.pixels.byteLength === frame.width * frame.height * 4) {
    writeAtomic(file("frame.bgra", dir), frame.pixels);
    frameName = "frame.bgra";
  }
  writeAtomic(file("released.json", dir), JSON.stringify({ ...release, frame: frameName }));
  fs.rmSync(file("active.json", dir), { force: true });
}

/**
 * Compositor side: ask a live boot stage to release the display and wait (bounded) for it.
 * Resolves null when no boot stage is live or it did not answer in time.
 */
export async function requestBootRelease(
  timeoutMs = 2000,
  dir = BOOT_HANDOFF_DIR,
  options: { wantFrame?: boolean } = {},
): Promise<BootHandoffRelease | null> {
  if (!readBootActive(dir)) return null;
  try {
    const noFrame = options.wantFrame === false ? ` ${NO_FRAME}` : "";
    writeAtomic(file("request", dir), `${process.pid}${noFrame}`);
  } catch {
    return null;
  }
  const released = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      dispose();
      resolve(false);
    }, timeoutMs);
    const dispose = watchFor("released.json", dir, () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  lastRelease = released ? readBootRelease(dir) : null;
  return lastRelease;
}

let lastRelease: BootHandoffRelease | null = null;

/**
 * The release this process received (via requestBootRelease), if any: a later stage in the same
 * process (the greeter beside its compositor) continues the boot scene from its clock.
 */
export function lastBootRelease(): BootHandoffRelease | null {
  return lastRelease;
}

export function readBootRelease(dir = BOOT_HANDOFF_DIR): BootHandoffRelease | null {
  return readJson<BootHandoffRelease>(file("released.json", dir));
}

/** The released final frame, when its size matches the requested output. */
export function readBootFrame(
  release: BootHandoffRelease,
  width: number,
  height: number,
  dir = BOOT_HANDOFF_DIR,
): BootHandoffFrame | null {
  if (!release.frame || release.width !== width || release.height !== height) return null;
  try {
    const pixels = new Uint8Array(fs.readFileSync(file(release.frame, dir)));
    return pixels.byteLength === width * height * 4 ? { pixels, width, height } : null;
  } catch {
    return null;
  }
}

/** Compositor side: its own first frame is on screen; the boot stage may exit. */
export function markBootPresented(dir = BOOT_HANDOFF_DIR): void {
  try {
    fs.writeFileSync(file("presented", dir), String(process.pid));
  } catch {
    // No boot stage (or no handoff directory): nothing to tell.
  }
}

/**
 * Stage → stage handoff without a live predecessor (greeter → desktop): the greeter writes its
 * final frame here, leaves it on screen (retainKmsScanout) and exits; the desktop compositor
 * seeds its first modeset with it. World-readable, so it only ever holds the scene, never UI.
 */
export const STAGE_HANDOFF_DIR = process.env.MOIRE_STAGE_HANDOFF_DIR ?? "/run/moire-stage";

export function publishStageHandoff(
  release: Omit<BootHandoffRelease, "frame">,
  frame: BootHandoffFrame,
  dir = STAGE_HANDOFF_DIR,
): boolean {
  try {
    writeAtomic(file("frame.bgra", dir), frame.pixels);
    writeAtomic(file("released.json", dir), JSON.stringify({ ...release, frame: "frame.bgra" }));
    return true;
  } catch {
    return false;
  }
}

/** A stage handoff written within `maxAgeMs` (CLOCK_MONOTONIC), or null. */
export function readStageHandoff(
  maxAgeMs = 20_000,
  dir = STAGE_HANDOFF_DIR,
): BootHandoffRelease | null {
  const release = readJson<BootHandoffRelease>(file("released.json", dir));
  if (!release || monotonicMs() - release.releasedAtMs > maxAgeMs) return null;
  return release;
}

/**
 * Keep a DRM device open for a few seconds after this process exits. With no open file the
 * kernel restores its console mode ("last close") and blanks a retained frame before the next
 * stage opens the device. The holder owns only the fd (no master, no frames) and exits itself.
 */
export function holdDisplayAcrossExit(drmFd: number, seconds = 12): void {
  try {
    const holder = spawn(process.execPath, ["-e", `setTimeout(() => {}, ${seconds * 1000})`], {
      detached: true,
      stdio: ["ignore", "ignore", "ignore", drmFd],
    });
    holder.unref();
  } catch (error) {
    console.warn("[stage-handoff] display holder unavailable:", error);
  }
}
