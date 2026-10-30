import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { CompositorServer } from "@moire/core";
import {
  holdDisplayAcrossExit,
  lastBootRelease,
  monotonicMs,
  openLogindSeat,
  type LogindSeat,
} from "@moire/sys";
import { SessionBus } from "@moire/dbus";
import { createLocalUserProvider } from "./local-users";
// oxlint-disable-next-line import/no-relative-parent-imports -- The installed trusted entry reuses the frozen native frontend.
import { runNativeGreeter } from "../../greeter/src/native/main";
// oxlint-disable-next-line import/no-relative-parent-imports -- Greeter scene ships with its entry.
import { greeterSceneBackdrop } from "../../greeter/src/native/scene";
// oxlint-disable-next-line import/no-relative-parent-imports -- The greeter picks greetd or moire-dm by its session's socket variable.
import { connectLoginClient, loginBackend } from "../../greeter/src/native/login-client";

/** Invoked only by the packaged entry with its immutable fixed probe executable. */
export async function runPreLogin(
  sessionExecutable: string,
  sessionLabel = "Moire session probe",
  discoverLocalUsers = false,
): Promise<0 | 1> {
  const runtime = process.env.XDG_RUNTIME_DIR;
  const backend = loginBackend(process.env);
  if (!runtime || !path.isAbsolute(runtime) || !backend || process.getuid?.() === 0)
    throw new Error("A non-root greetd or moire-dm runtime is required");
  const display = "moire-greeter";
  let seat: LogindSeat | undefined;
  let server: CompositorServer | undefined;
  let accountBus: SessionBus | undefined;
  let retired = false;
  let handedOff = false;
  let setupComplete = false;
  let status: 0 | 1 = 1;
  const retire = (revoked = false) => {
    if (retired) return;
    retired = true;
    const errors: unknown[] = [];
    try {
      accountBus?.close();
    } catch (error) {
      errors.push(error);
    }
    accountBus = undefined;
    try {
      server?.stop();
    } catch (error) {
      errors.push(error);
    }
    try {
      // A handed-off frame stays on screen only while the VT stays in graphics mode.
      if (!handedOff) seat?.setGraphics(false);
    } catch (error) {
      errors.push(error);
    }
    if (revoked) {
      try {
        seat?.acknowledgeDisable();
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      seat?.shutdown();
    } catch (error) {
      errors.push(error);
    }
    console.log(
      `[pre-login] owner=${process.pid} retired release=${errors.length ? "failed" : "complete"}`,
    );
    if (errors.length) throw new AggregateError(errors, "Pre-login release failed");
  };
  const stop = () => {
    try {
      retire();
    } finally {
      process.exit(1);
    }
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    console.log("[pre-login] stage=acquire-seat");
    seat = await openLogindSeat(() => {
      try {
        retire(true);
      } finally {
        process.exit(1);
      }
    });
    console.log("[pre-login] stage=verify-session");
    const identity = Object.fromEntries(
      execFileSync(
        "/run/current-system/systemd/bin/loginctl",
        [
          "show-session",
          "self",
          "--property=Id",
          "--property=User",
          "--property=Name",
          "--property=Class",
          "--property=Seat",
          "--property=Active",
          "--property=Leader",
          "--property=Scope",
        ],
        { encoding: "utf8", timeout: 5000, maxBuffer: 8192 },
      )
        .trim()
        .split("\n")
        .map((line) => {
          const at = line.indexOf("=");
          return [line.slice(0, at), line.slice(at + 1)];
        }),
    );
    console.log(JSON.stringify({ preLoginIdentity: identity, pid: process.pid }));
    if (
      identity.Class !== "greeter" ||
      identity.Seat !== "seat0" ||
      identity.Active !== "yes" ||
      identity.User !== String(process.getuid?.())
    )
      throw new Error("Unexpected greeter session identity");
    console.log("[pre-login] stage=set-terminal-mode");
    seat.setGraphics(true);
    const cards = fs
      .readdirSync("/dev/dri")
      .filter((name) => /^card\d+$/.test(name))
      .sort();
    if (!cards.length) throw new Error("No DRM card is available");
    // The greeter is a single-output owner. No independent render-node opens or desktop services.
    server = new CompositorServer(runtime, display, {
      mode: "greeter",
      devices: seat,
      clientPid: process.pid,
    });
    server.onFatalError(stop);
    // The compositor draws the greeter's backdrop, continuing the boot scene where the boot
    // stage released the display (resolved at the first frame, after that handoff).
    server.setSceneBackdrop(() => {
      const boot = lastBootRelease();
      const fresh = boot && monotonicMs() - boot.releasedAtMs < 30_000;
      return greeterSceneBackdrop(
        fresh ? () => boot.sceneSeconds + (monotonicMs() - boot.releasedAtMs) / 1000 : undefined,
      );
    });
    console.log("[pre-login] stage=start-compositor");
    await server.start(`/dev/dri/${cards[0]}`);
    process.env.WAYLAND_DISPLAY = display;
    // Build-time desktop candidate opt-in. No CLI/environment service or launch override.
    if (discoverLocalUsers)
      accountBus = await SessionBus.connect("unix:path=/run/dbus/system_bus_socket", {
        timeoutMs: 3000,
      });
    // Detailed setup diagnostics stop before connecting to the credential transport.
    setupComplete = true;
    console.log("[pre-login] stage=connect-login-service");
    const client = await connectLoginClient(backend, sessionExecutable, 30000);
    console.log(`[pre-login] owner=${process.pid} display=ready authority=frontend-only`);
    const result = await runNativeGreeter({
      client,
      platform: "wayland",
      sessionLabel,
      backdrop: server.sceneBackdropAvailable ? "compositor" : "own",
      users: accountBus ? createLocalUserProvider(accountBus) : undefined,
    });
    status = result.exitCode;
    // Signed in over the scene: leave its frame on screen for the desktop to dissolve out of.
    if (status === 0 && server.sceneBackdropAvailable)
      handedOff = await server.handOffDisplay("greeter");
    if (handedOff) holdDisplayAcrossExit(server.getKms().fd);
  } catch (error) {
    if (!setupComplete) console.error("[pre-login] setup failed before authentication", error);
    throw error;
  } finally {
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
    retire();
  }
  return status;
}
