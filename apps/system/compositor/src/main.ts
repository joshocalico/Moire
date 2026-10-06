import {
  CompositorServer,
  MOIRE,
  spawnDesktopApp,
  startXwayland,
  X11Wm,
  type XwaylandHandle,
} from "@moire/core";
import { createShell, type ShellBridge } from "@moire/shell";
import {
  observeDesktopStatus,
  type DesktopStatusClient,
} from "@moire/system-management/desktop-status";
import { SessionBus } from "@moire/dbus";
import { loadSettings, saveSettings } from "@moire/prefs";
import { isLinux, listDrmConnectors, type LogindSeat } from "@moire/sys";
import { acquireNativeDesktopSeat } from "./native-session";
import { OwnedDesktopApps } from "./owned-apps";
import path from "node:path";
import os from "node:os";
import { writeScreenshot } from "./capture";
import { StartupDesktop } from "./startup";

async function main() {
  console.log(`${MOIRE.name} compositor ${MOIRE.version}`);

  if (!isLinux()) {
    console.log("Not on Linux — run inside MoireDev (see docs/dev-vm.md).");
    process.exit(0);
  }

  const native = process.env.MOIRE_NATIVE_SESSION === "1";
  let seat: LogindSeat | undefined;
  let nativeCard: string | undefined;
  let revoked = false;
  let nativeStop: (() => void) | undefined;
  if (native) {
    const acquired = await acquireNativeDesktopSeat(() => {
      revoked = true;
      nativeStop?.();
    });
    seat = acquired.seat;
    nativeCard = acquired.cardPath;
    if (revoked) {
      seat.shutdown();
      throw new Error("Seat revoked during acquisition");
    }
  }
  const connectors = nativeCard
    ? [{ connection: "connected", cardPath: nativeCard }]
    : listDrmConnectors();
  const connected = connectors.filter((c) => c.connection === "connected");
  if (connected.length === 0) {
    console.error("No connected DRM connector.");
    process.exit(1);
  }
  const cardPath = connected[0]!.cardPath;

  const runtimeDir =
    process.env.XDG_RUNTIME_DIR ?? path.join(os.tmpdir(), `moire-${process.getuid?.() ?? 0}`);
  const display = process.env.WAYLAND_DISPLAY ?? "wayland-1";

  const server = new CompositorServer(
    runtimeDir,
    display,
    seat ? { mode: "desktop", devices: seat } : undefined,
  );
  const ownedApps = new OwnedDesktopApps();
  const spawnApp = native ? ownedApps.spawn.bind(ownedApps) : spawnDesktopApp;
  let xwayland: XwaylandHandle | null = null;
  let xwm: X11Wm | null = null;
  let displayBus: SessionBus | null = null;
  let desktopControls: DesktopStatusClient | null = null;
  let shell: ShellBridge | null = null;
  let removeDisplayListener: (() => void) | null = null;
  let removeFatalListener: (() => void) | null = null;
  let stopping = false;

  const clientEnv = (): NodeJS.ProcessEnv => ({
    WAYLAND_DISPLAY: display,
    XDG_RUNTIME_DIR: runtimeDir,
    ...(xwayland ? { DISPLAY: xwayland.display, MOIRE_XWAYLAND: "1" } : {}),
  });

  const desktop = new StartupDesktop(() => {
    shell = createShell(
      (opts) =>
        spawnApp({
          exec: opts.exec,
          env: clientEnv(),
        }),
      (task) => server.toggleTask(task.clientId, task.surfaceId),
      {
        setVolume: async (value) => {
          if (!desktopControls) throw new Error("Sound controls unavailable");
          await desktopControls.setVolume(value);
        },
        setMute: async (value) => {
          if (!desktopControls) throw new Error("Sound controls unavailable");
          await desktopControls.setMute(value);
        },
        setDoNotDisturb: async (value) => {
          if (!desktopControls) throw new Error("Notification controls unavailable");
          await desktopControls.setDoNotDisturb(value);
        },
        refreshWifi: async () => {
          if (!desktopControls) throw new Error("Desktop controls unavailable");
          return desktopControls.refreshWifi();
        },
        connectWifi: async (...args: Parameters<DesktopStatusClient["connectWifi"]>) => {
          if (!desktopControls) throw new Error("Desktop controls unavailable");
          return desktopControls.connectWifi(...args);
        },
        cancelWifi: async () => {
          if (!desktopControls) throw new Error("Desktop controls unavailable");
          return desktopControls.cancelWifi();
        },
        refreshBluetooth: async () => {
          if (!desktopControls) throw new Error("Desktop controls unavailable");
          return desktopControls.refreshBluetooth();
        },
        setBluetoothConnected: async (
          ...args: Parameters<DesktopStatusClient["setBluetoothConnected"]>
        ) => {
          if (!desktopControls) throw new Error("Desktop controls unavailable");
          return desktopControls.setBluetoothConnected(...args);
        },
        dismiss: async (id, revision) => {
          if (!desktopControls) throw new Error("Notification controls unavailable");
          await desktopControls.dismiss(id, revision);
        },
        dismissMany: async (pairs) => {
          if (!desktopControls) throw new Error("Notification controls unavailable");
          return desktopControls.dismissMany(pairs);
        },
        invokeAction: async (id, key, revision) => {
          if (!desktopControls) throw new Error("Notification controls unavailable");
          await desktopControls.invokeAction(id, key, revision);
        },
      },
      server.scrollObserver,
      native
        ? () => {
            void stop();
          }
        : undefined,
    );
    if (desktopControls) shell.setDesktopStatus(desktopControls.state);
    server.setShell(shell);
    console.log("[session] desktop shell attached");
  });
  if (!native && process.env.MOIRE_GREETER !== "1") desktop.start();

  async function stop(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    console.log("\nShutting down…");
    let status = exitCode;
    try {
      try {
        await desktopControls?.dispose();
        await ownedApps.stop();
      } catch (error) {
        status = 1;
        console.error("[session] app retirement failed:", error);
      }
      for (const close of [
        () => xwm?.stop(),
        () => xwayland?.stop(),
        () => removeDisplayListener?.(),
        () => removeFatalListener?.(),
        () => displayBus?.close(),
        () => server.stop(),
        () => seat?.setGraphics(false),
        () => {
          if (revoked) seat?.acknowledgeDisable();
        },
        () => seat?.shutdown(),
      ]) {
        try {
          close();
        } catch (error) {
          status = 1;
          console.error("[session] shutdown failed:", error);
        }
      }
    } finally {
      if (native)
        console.log(
          `[native-desktop] owner=${process.pid} retired release=${status ? "failed" : "complete"}`,
        );
      process.exit(status);
    }
  }
  nativeStop = () => {
    void stop(1);
  };
  process.on("SIGINT", () => {
    void stop();
  });
  process.on("SIGTERM", () => {
    void stop();
  });
  removeFatalListener = server.onFatalError((error) => {
    console.error("[session] compositor lost input ownership:", error);
    void stop(1);
  });

  try {
    await server.start(cardPath);
    if (native) {
      desktop.start();
      console.log(`[native-desktop] owner=${process.pid} display=ready`);
      spawnApp({ exec: "moire-management", env: clientEnv() });
      spawnApp({ exec: "moire-files", env: { ...clientEnv(), MOIRE_UI_PLATFORM: "wayland" } });
    }
  } catch (error) {
    console.error("[session] compositor startup failed:", error);
    void stop(1);
    return;
  }

  try {
    displayBus = await SessionBus.connect();
    displayBus.exportObject("/org/moire/Display1", {
      name: "org.moire.Display1",
      methods: {
        ...(!native
          ? {
              StartDesktop: {
                inSignature: "",
                outSignature: "b",
                handler: () => ({ body: [desktop.start()] }),
              },
            }
          : {}),
        CaptureScreenshot: {
          inSignature: "",
          outSignature: "s",
          handler: async () => ({
            body: [await writeScreenshot(server.capturePrimaryOutput(), runtimeDir)],
          }),
        },
        GetModes: {
          inSignature: "",
          outSignature: "asss",
          handler: () => ({
            body: [
              server.listDisplayModes().map((mode) => mode.id),
              server.currentDisplayMode(),
              server.listDisplayModes().find((mode) => mode.preferred)?.id ?? "",
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
          outSignature: "a(ssssssiiiiib)",
          handler: () => ({
            body: [
              server
                .getDisplayOutputs()
                .map(({ kms, x, y, scale120, primary }) => [
                  kms.identity.id,
                  kms.connectorName,
                  kms.identity.make,
                  kms.identity.model,
                  kms.identity.serial,
                  kms.currentModeId,
                  x,
                  y,
                  Math.max(1, Math.round((kms.width * 120) / scale120)),
                  Math.max(1, Math.round((kms.height * 120) / scale120)),
                  scale120,
                  primary,
                ]),
            ],
          }),
        },
        SetLayout: {
          inSignature: "a(siiub)",
          outSignature: "b",
          handler: ({ body }) => {
            const rows = Array.isArray(body[0]) ? body[0] : [];
            const result = server.beginDisplayLayoutChange(
              rows.filter(Array.isArray).map((row) => ({
                id: String(row[0] ?? ""),
                x: Number(row[1] ?? 0),
                y: Number(row[2] ?? 0),
                scale120: Number(row[3] ?? 120),
                primary: row[4] === true,
              })),
            );
            return { body: [result.changed] };
          },
        },
        ConfirmLayout: {
          inSignature: "",
          outSignature: "b",
          handler: () => {
            if (!server.confirmDisplayLayout()) return { body: [false] };
            const displayOutputs = Object.fromEntries(
              server
                .getDisplayOutputs()
                .map(({ kms, x, y, scale120, primary }) => [
                  kms.identity.id,
                  { x, y, scale120, primary, mode: kms.currentModeId },
                ]),
            );
            saveSettings({ ...loadSettings(), displayOutputs });
            return { body: [true] };
          },
        },
        RevertLayout: {
          inSignature: "",
          outSignature: "b",
          handler: () => ({ body: [server.revertDisplayLayout()] }),
        },
        SetMode: {
          inSignature: "s",
          outSignature: "b",
          handler: ({ body }) => {
            const result = server.beginDisplayModeChange(String(body[0] ?? ""));
            return { body: [result.changed] };
          },
        },
        ConfirmMode: {
          inSignature: "",
          outSignature: "b",
          handler: () => {
            const confirmedMode = server.confirmDisplayMode();
            if (confirmedMode) {
              const current = loadSettings();
              const output = server.getDisplayOutputs().find(({ kms }) => kms === server.getKms());
              const displayOutputs = output
                ? {
                    ...current.displayOutputs,
                    [output.kms.identity.id]: {
                      x: output.x,
                      y: output.y,
                      scale120: output.scale120,
                      primary: output.primary,
                      mode: confirmedMode,
                    },
                  }
                : current.displayOutputs;
              saveSettings({
                ...current,
                displayMode: confirmedMode,
                displayOutputs,
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
    desktopControls = await observeDesktopStatus(displayBus, (state) =>
      shell?.setDesktopStatus(state),
    );
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
    // A welcome presentation must never strand this already authorized session.
    if (!native) desktop.start();
  }

  // Xwayland — rootless by default (MOIRE_XWAYLAND=rootful for nested screen).
  if (!native && process.env.MOIRE_XWAYLAND !== "0") {
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
  console.log(`Try:   WAYLAND_DISPLAY=${display} moire-terminal\n`);

  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
