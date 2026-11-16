import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { BootGuardian, type GuardianResult } from "./guardian";
import { BOOT_SOURCE_BYTES } from "./assets";

/** Guardian entry never imports React, fonts, artwork pixels or a UI root. */
export type BootRunResult =
  | GuardianResult
  | { kind: "skipped"; reason: "console-requested" | "display-unavailable" };
/** Only the guardian main process may declare manager readiness. */
export function bootRendererEnvironment(environment: NodeJS.ProcessEnv, cardPath: string) {
  const childEnvironment: NodeJS.ProcessEnv = { ...environment, MOIRE_BOOT_CARD: cardPath };
  delete childEnvironment.NOTIFY_SOCKET;
  return childEnvironment;
}
export async function runBootGuardian(): Promise<BootRunResult> {
  if (process.platform !== "linux") throw new Error("Boot guardian requires Linux");
  const managed = process.env.MOIRE_BOOT_MANAGED === "1";
  if (process.env.MOIRE_BOOT_MANAGED && !managed)
    throw new Error("MOIRE_BOOT_MANAGED must be 1 when supplied");
  const notify = process.env.MOIRE_BOOT_NOTIFY === "1";
  if (process.env.MOIRE_BOOT_NOTIFY && !notify)
    throw new Error("MOIRE_BOOT_NOTIFY must be 1 when supplied");
  const notifySocket = process.env.NOTIFY_SOCKET;
  if (notify && (!managed || !notifySocket))
    throw new Error("Managed notify boot requires the manager's NOTIFY_SOCKET");
  const latchPath = process.env.MOIRE_BOOT_LATCH ?? "/run/moire-boot/console-requested";
  // Preserve the standalone console-request path before native module loading.
  if (!managed && fs.existsSync(latchPath)) return { kind: "skipped", reason: "console-requested" };
  const sys = await import("@moire/sys");

  const stateDirectory = process.env.MOIRE_BOOT_SERVICE_STATE ?? "/run/moire-boot/service";
  const service = managed ? sys.beginBootService(stateDirectory, sys.serviceIdentity()) : null;
  const skip = (reason: "console-requested" | "display-unavailable"): BootRunResult => {
    if (service)
      sys.writeBootServiceRecord(stateDirectory, "lease", { ...service, phase: "skipped", reason });
    return { kind: "skipped", reason };
  };
  const rendererPath = process.env.MOIRE_BOOT_RENDERER;
  const artworkPath = process.env.MOIRE_BOOT_ARTWORK;
  if (fs.existsSync(latchPath)) return skip("console-requested");
  if (!rendererPath || !path.isAbsolute(rendererPath) || !fs.statSync(rendererPath).isFile())
    throw new Error("Supply an installed absolute MOIRE_BOOT_RENDERER path");
  if (
    !artworkPath ||
    !path.isAbsolute(artworkPath) ||
    fs.statSync(artworkPath).size !== BOOT_SOURCE_BYTES
  )
    throw new Error("Supply the bounded installed MOIRE_BOOT_ARTWORK RGBA texture");
  const { openBootConsole, findConnectedCard, EvdevKeyboard, LinuxReadinessDispatcher } = sys;
  const cardPath = process.env.MOIRE_BOOT_CARD ?? findConnectedCard() ?? undefined;
  if (!cardPath) return skip("display-unavailable");
  const ttyPath = process.env.MOIRE_BOOT_TTY ?? "/dev/tty1";
  const lease = service
    ? sys.openManagedBootConsole({ ttyPath, stateDirectory, base: service })
    : openBootConsole({ ttyPath });
  let readiness: InstanceType<typeof LinuxReadinessDispatcher> | null = null;
  let keyboard: InstanceType<typeof EvdevKeyboard> | null = null;
  let guardian: BootGuardian | null = null;
  try {
    readiness = new LinuxReadinessDispatcher("boot-guardian");
    keyboard = new EvdevKeyboard(readiness);
    const input = keyboard;
    const owner = new BootGuardian({
      console: lease,
      observeEscape(handler) {
        let verified = false;
        const onKey = (event: { code: number; value: number }) => {
          if (event.code === 1 && event.value === 1) handler();
        };
        const onDevices = () => {
          if (verified && input.openedDevices.length === 0) owner.release("input-unavailable");
        };
        input.on("key", onKey);
        input.on("devicesChanged", onDevices);
        try {
          input.start(undefined, { requireEscape: true });
          if (input.openedDevices.length === 0)
            throw new Error("Boot graphics requires a verified Escape-capable keyboard");
          verified = true;
        } catch (error) {
          input.removeListener("key", onKey);
          input.removeListener("devicesChanged", onDevices);
          input.stop();
          throw error;
        }
        return () => {
          input.removeListener("key", onKey);
          input.removeListener("devicesChanged", onDevices);
          input.stop();
        };
      },
      startRenderer: () =>
        spawn(process.execPath, [...process.execArgv, rendererPath], {
          detached: true,
          stdio: ["ignore", "inherit", "inherit", "ipc"],
          env: bootRendererEnvironment(process.env, cardPath),
        }),
      onEscape() {
        fs.mkdirSync(path.dirname(latchPath), { recursive: true, mode: 0o700 });
        fs.writeFileSync(latchPath, "escape\n", { mode: 0o600 });
      },
      onScanoutAccepted: (feedback) => {
        console.log(
          "[boot] own React static scanout accepted; visibility/timing unverified; hardware animation unfinished",
          JSON.stringify(feedback),
        );
        if (notify && notifySocket) {
          sys.notifySystemdReady(notifySocket);
          console.log("[boot] guardian notified accepted scanout readiness");
        }
      },
      onDiagnostic: (error) => console.error("[boot/guardian]", error.message),
    });
    guardian = owner;
    const stop = () => {
      owner.release("stage-complete");
    };
    const interrupt = () => {
      owner.release("service-stop");
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", interrupt);
    try {
      owner.start();
      // A termination timeout keeps this pending. It is never permission to
      // restore against a live DRM owner or start the compositor over it.
      return await owner.result;
    } finally {
      process.removeListener("SIGTERM", stop);
      process.removeListener("SIGINT", interrupt);
    }
  } finally {
    keyboard?.stop();
    readiness?.stop();
    // Standalone restores after child exit. Managed mode only closes its handle;
    // the childless service cleanup proves all owners exited before restoring.
    if (!guardian) {
      if ("closeHandle" in lease) lease.closeHandle();
      else {
        try {
          lease.restore();
        } finally {
          lease.close();
        }
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runBootGuardian();
    if (result.kind === "failed") process.exitCode = 1;
    else if (result.kind === "skipped")
      console.log(`[boot] presentation skipped: ${result.reason}`);
  } catch (error) {
    console.error("[boot]", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
