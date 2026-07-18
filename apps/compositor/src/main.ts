import {
  CompositorServer,
  MOIRE,
  spawnDesktopApp,
  startXwayland,
  X11Wm,
  type XwaylandHandle,
} from "@moire/core";
import { createShell } from "@moire/shell";
import { SessionBus } from "@moire/dbus";
import { loadSettings, saveSettings } from "@moire/prefs";
import { isLinux, listDrmConnectors } from "@moire/sys";
import path from "node:path";
import os from "node:os";

async function main() {
  console.log(`${MOIRE.name} compositor ${MOIRE.version}`);

  if (!isLinux()) {
    console.log("Not on Linux — run inside MoireDev (see docs/dev-vm.md).");
    process.exit(0);
  }

  const connectors = listDrmConnectors();
  const connected = connectors.filter((c) => c.connection === "connected");
  if (connected.length === 0) {
    console.error("No connected DRM connector.");
    process.exit(1);
  }
  const cardPath = connected[0]!.cardPath;

  const runtimeDir =
    process.env.XDG_RUNTIME_DIR ??
    path.join(os.tmpdir(), `moire-${process.getuid?.() ?? 0}`);
  const display = process.env.WAYLAND_DISPLAY ?? "wayland-1";

  const server = new CompositorServer(runtimeDir, display);
  let xwayland: XwaylandHandle | null = null;
  let xwm: X11Wm | null = null;
  let displayBus: SessionBus | null = null;
  let removeDisplayListener: (() => void) | null = null;

  const clientEnv = (): NodeJS.ProcessEnv => ({
    WAYLAND_DISPLAY: display,
    XDG_RUNTIME_DIR: runtimeDir,
    ...(xwayland
      ? { DISPLAY: xwayland.display, MOIRE_XWAYLAND: "1" }
      : {}),
  });

  server.setShell(
    createShell((opts) =>
      spawnDesktopApp({
        exec: opts.exec,
        env: clientEnv(),
      }),
      (task) => server.toggleTask(task.clientId, task.surfaceId),
    ),
  );

  const stop = () => {
    console.log("\nShutting down…");
    xwm?.stop();
    xwayland?.stop();
    removeDisplayListener?.();
    removeDisplayListener = null;
    displayBus?.close();
    server.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  await server.start(cardPath);

  try {
    displayBus = await SessionBus.connect();
    displayBus.exportObject("/org/moire/Display1", {
      name: "org.moire.Display1",
      methods: {
        GetModes: {
          inSignature: "",
          outSignature: "asss",
          handler: () => ({
            body: [
              server.listDisplayModes().map((mode) => mode.id),
              server.currentDisplayMode(),
              server.listDisplayModes().find((mode) => mode.preferred)?.id ??
                "",
            ],
          }),
        },
        GetOutputInfo: {
          inSignature: "",
          outSignature: "sii",
          handler: () => {
            const output = server.displayOutputInfo();
            return { body: [output.name, output.widthMm, output.heightMm] };
          },
        },
        ListOutputs: {
          inSignature: "",
          outSignature: "a(ssiiii)",
          handler: () => ({
            body: [
              server.getDisplayOutputs().map(({ kms, x, y }) => [
                kms.connectorName,
                kms.currentModeId,
                x,
                y,
                kms.width,
                kms.height,
              ]),
            ],
          }),
        },
        SetMode: {
          inSignature: "s",
          outSignature: "b",
          handler: ({ body }) => {
            const result = server.beginDisplayModeChange(
              String(body[0] ?? ""),
            );
            return { body: [result.changed] };
          },
        },
        ConfirmMode: {
          inSignature: "",
          outSignature: "b",
          handler: () => {
            const confirmedMode = server.confirmDisplayMode();
            if (confirmedMode) {
              saveSettings({
                ...loadSettings(),
                displayMode: confirmedMode,
              });
            }
            return { body: [confirmedMode != null] };
          },
        },
        RevertMode: {
          inSignature: "",
          outSignature: "b",
          handler: () => ({ body: [server.revertDisplayMode()] }),
        },
      },
    });
    const ownership = await displayBus.requestName("org.moire.Display1");
    if (ownership !== 1) {
      throw new Error(`name ownership result ${ownership}`);
    }
    console.log("[display] D-Bus org.moire.Display1 ready");
    removeDisplayListener = server.onDisplayChanged(() => {
      if (!displayBus) return;
      const modes = server.listDisplayModes();
      const output = server.displayOutputInfo();
      displayBus.emitSignal({
        path: "/org/moire/Display1",
        interface: "org.moire.Display1",
        member: "Changed",
        signature: "assssii",
        body: [
          modes.map((mode) => mode.id),
          server.currentDisplayMode(),
          modes.find((mode) => mode.preferred)?.id ?? "",
          output.name,
          output.widthMm,
          output.heightMm,
        ],
      });
    });
  } catch (error) {
    removeDisplayListener?.();
    removeDisplayListener = null;
    displayBus?.close();
    displayBus = null;
    console.warn("[display] D-Bus control unavailable:", error);
  }

  // Xwayland — rootless by default (MOIRE_XWAYLAND=rootful for nested screen).
  if (process.env.MOIRE_XWAYLAND !== "0") {
    try {
      const kms = server.getKms();
      xwayland = await startXwayland({
        waylandDisplay: display,
        runtimeDir,
        geometry: `${kms.width}x${Math.max(400, kms.height - 40)}`,
      });
      process.env.DISPLAY = xwayland.display;
      process.env.MOIRE_XWAYLAND = xwayland.rootless ? "1" : "rootful";
      if (xwayland.rootless) {
        if (xwayland.wmFd == null) {
          throw new Error("rootless Xwayland started without -wm fd");
        }
        xwm = await X11Wm.startFromWmFd(xwayland.wmFd, xwayland.displayNum);
        server.attachXwm(xwm);
      }
      console.log(
        `[xwayland] session DISPLAY=${xwayland.display} mode=${xwayland.rootless ? "rootless" : "rootful"}`,
      );
    } catch (err) {
      console.warn("[xwayland] unavailable:", err);
    }
  }

  console.log("\nShell: Super / Apps — launcher; Esc dismisses");
  if (xwayland) {
    console.log(`X11:   DISPLAY=${xwayland.display} xeyes`);
  }
  console.log(`Try:   WAYLAND_DISPLAY=${display} foot\n`);

  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
