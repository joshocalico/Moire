/**
 * The portal backend on a throwaway session bus, for smokes: a private dbus-daemon, a scratch
 * home (settings, desktop entries, MIME associations) and a connection that owns
 * org.freedesktop.portal.Desktop, standing in for xdg-desktop-portal.
 */
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SessionBus, type DbusMessage } from "@moire/dbus";
import { FRONTEND_NAME, PORTAL_NAME, PORTAL_PATH } from "./common";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function until(check: () => boolean, label: string, timeoutMs = 5000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${label}`);
    await delay(10);
  }
}

export type PortalFixture = {
  /** The scratch home; XDG config, data and state live under it. */
  home: string;
  configHome: string;
  dataHome: string;
  /** Stands in for xdg-desktop-portal: the only caller the backend interfaces accept. */
  frontend: SessionBus;
  connect(): Promise<SessionBus>;
  /** Start the backend (after any services it should find are on the bus). */
  start(): Promise<void>;
  /** Call a backend interface on the portal object as the frontend. */
  call(
    iface: string,
    member: string,
    signature: string,
    body: unknown[],
    from?: SessionBus,
  ): Promise<DbusMessage>;
  /** Collect a portal signal's bodies. */
  signals(iface: string, member: string): Promise<unknown[][]>;
  requestHandle(name: string): string;
  closeRequest(handle: string, from?: SessionBus): Promise<DbusMessage>;
  close(): Promise<void>;
};

export async function startPortalFixture(prefix: string): Promise<PortalFixture> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `moire-portal-${prefix}-`));
  const configHome = path.join(home, "config");
  const dataHome = path.join(home, "data");
  for (const directory of [configHome, dataHome, path.join(home, "state")])
    fs.mkdirSync(directory, { recursive: true });
  const daemon = spawn(
    process.env.MOIRE_TEST_DBUS_DAEMON ?? "dbus-daemon",
    [
      process.env.MOIRE_TEST_DBUS_CONFIG
        ? `--config-file=${process.env.MOIRE_TEST_DBUS_CONFIG}`
        : "--session",
      "--nofork",
      "--nopidfile",
      `--address=unix:path=${path.join(home, "bus")}`,
      "--print-address=1",
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const address = await new Promise<string>((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error("dbus-daemon did not start")), 5000);
    daemon.once("error", reject);
    daemon.stdout.on("data", (chunk) => {
      output += String(chunk);
      if (!output.includes("\n")) return;
      clearTimeout(timer);
      resolve(output.trim());
    });
  });
  const buses: SessionBus[] = [];
  const connect = async () => {
    const bus = await SessionBus.connect(address, { timeoutMs: 5000 });
    buses.push(bus);
    return bus;
  };
  const frontend = await connect();
  if ((await frontend.requestName(FRONTEND_NAME, 4)) !== 1)
    throw new Error("Could not own the frontend name");
  let portal: ChildProcess | null = null;
  // Nor may a failed assertion: the exit handler runs however the smoke ends.
  process.once("exit", () => {
    portal?.kill("SIGTERM");
    daemon.kill("SIGTERM");
  });
  // A smoke stopped from outside (a timeout) must not leave its daemon behind.
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => {
      portal?.kill("SIGTERM");
      daemon.kill("SIGTERM");
      process.exit(1);
    });
  return {
    home,
    configHome,
    dataHome,
    frontend,
    connect,
    async start() {
      portal = spawn(
        process.execPath,
        [
          "--import",
          path.join(root, "apps/system/compositor/node_modules/tsx/dist/loader.mjs"),
          path.join(root, "apps/system/portal/src/main.tsx"),
        ],
        {
          env: {
            ...process.env,
            HOME: home,
            XDG_CONFIG_HOME: configHome,
            XDG_DATA_HOME: dataHome,
            XDG_DATA_DIRS: dataHome,
            XDG_CONFIG_DIRS: path.join(home, "xdg"),
            XDG_STATE_HOME: path.join(home, "state"),
            XDG_CURRENT_DESKTOP: "Moire",
            DBUS_SESSION_BUS_ADDRESS: address,
            MOIRE_UI_PLATFORM: "headless",
          },
          stdio: "inherit",
        },
      );
      let owned = false;
      for (let attempt = 0; attempt < 400 && !owned; attempt++) {
        if (portal.exitCode !== null) throw new Error("The portal backend exited");
        try {
          await frontend.call({
            destination: "org.freedesktop.DBus",
            path: "/org/freedesktop/DBus",
            interface: "org.freedesktop.DBus",
            member: "GetNameOwner",
            signature: "s",
            body: [PORTAL_NAME],
          });
          owned = true;
        } catch {
          await delay(25);
        }
      }
      if (!owned) throw new Error("The portal backend did not own its name");
    },
    call: (iface, member, signature, body, from = frontend) =>
      from.call(
        { destination: PORTAL_NAME, path: PORTAL_PATH, interface: iface, member, signature, body },
        { timeoutMs: 15000 },
      ),
    async signals(iface, member) {
      const received: unknown[][] = [];
      await frontend.subscribeSignal(
        { sender: PORTAL_NAME, path: PORTAL_PATH, interface: iface, member },
        (message) => received.push(message.body ?? []),
      );
      return received;
    },
    requestHandle: (name) => `/org/freedesktop/portal/desktop/request/smoke/${name}`,
    closeRequest: (handle, from = frontend) =>
      from.call({
        destination: PORTAL_NAME,
        path: handle,
        interface: "org.freedesktop.impl.portal.Request",
        member: "Close",
      }),
    async close() {
      for (const bus of buses) bus.close();
      portal?.kill("SIGTERM");
      daemon.kill("SIGTERM");
      // The portal may still be writing chooser state as it exits.
      await delay(50);
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}
