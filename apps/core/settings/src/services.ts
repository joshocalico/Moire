/**
 * The session services Settings reads and changes. Each is optional: a missing one hides its
 * Overview tile and shows its page's empty state, and the rest of Settings works.
 */
import { execFile, spawn } from "node:child_process";
import { SessionBus } from "@moire/dbus";
import {
  observeDesktopStatus,
  type DesktopStatusClient,
  type DesktopStatusState,
} from "@moire/system-management/desktop-status";
import { connectIndexStatus, type IndexClient } from "@moire/system-management/index-status";
import { connectStorageStatus, type StorageClient } from "@moire/system-management/storage-status";
import {
  connectTimeSettings,
  type TimeSettingsClient,
} from "@moire/system-management/time-settings";
import {
  observeAccountsSettings,
  type AccountsSettingsClient,
} from "@moire/system-management/accounts-settings";
import { createAccountAdminClient } from "@moire/system-management/account-admin";
import { compositorDismissalLookup } from "@moire/system-management/prompt-outcome";
import {
  createLoginSettingsClient,
  type LoginSettingsClient,
} from "@moire/system-management/login-settings";
import {
  connectInputSettings,
  type InputSettingsClient,
} from "@moire/system-management/input-settings";
import {
  connectPowerSettings,
  type PowerSettingsClient,
} from "@moire/system-management/power-settings";
import { connectBrightness, type BrightnessClient } from "@moire/system-management/brightness";
import { connectDisplayController, type DisplayController } from "./display-service";

/** The desktop controls Quick Settings uses, with a way to follow their state. */
export type DesktopStatusSource = {
  client: DesktopStatusClient;
  subscribe(listener: (state: DesktopStatusState) => void): () => void;
};

export type SettingsServices = {
  display: DisplayController | null;
  index: IndexClient | null;
  storage: StorageClient | null;
  desktop: DesktopStatusSource | null;
  time: TimeSettingsClient | null;
  accounts: AccountsSettingsClient | null;
  /** Automatic login: moire-dm-settings, called by Settings itself. */
  login: LoginSettingsClient | null;
  input: InputSettingsClient | null;
  power: PowerSettingsClient | null;
  brightness: BrightnessClient | null;
};

/** Start a program detached from Settings, reporting a failure to start. */
export type Launcher = (command: string, args?: readonly string[]) => Promise<void>;

export const launchDetached: Launcher = (command, args = []) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { detached: true, stdio: "ignore" });
    child.once("error", (error) =>
      reject(
        "code" in error && error.code === "ENOENT"
          ? new Error(`${command} isn't installed`)
          : error,
      ),
    );
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });

async function connectDesktopStatus(): Promise<{
  source: DesktopStatusSource;
  bus: SessionBus;
} | null> {
  try {
    const bus = await SessionBus.connect();
    const listeners = new Set<(state: DesktopStatusState) => void>();
    const client = await observeDesktopStatus(bus, (state) => {
      for (const listener of listeners) listener(state);
    });
    return {
      bus,
      source: {
        client,
        subscribe(listener) {
          listeners.add(listener);
          listener(client.state);
          return () => listeners.delete(listener);
        },
      },
    };
  } catch (error) {
    console.warn("[settings] desktop controls unavailable:", error);
    return null;
  }
}

/**
 * Accounts and automatic login, sharing one session-bus connection. Administrator changes to
 * accounts go from this process to moire-accounts, and automatic login to moire-dm-settings,
 * both on the system bus, so the system's password prompt names Settings; the compositor
 * answers this process, on this connection, why a prompt it asked for was dismissed.
 */
async function connectAccountServices(): Promise<{
  accounts: AccountsSettingsClient;
  login: LoginSettingsClient;
  dispose(): Promise<void>;
}> {
  const bus = await SessionBus.connect();
  const promptDismissal = compositorDismissalLookup(bus);
  const admin = createAccountAdminClient({ promptDismissal });
  const login = createLoginSettingsClient({ promptDismissal });
  try {
    const accounts = await observeAccountsSettings(bus, { admin });
    return {
      accounts,
      login,
      async dispose() {
        await Promise.allSettled([accounts.dispose(), login.dispose(), admin.dispose()]);
        bus.close();
      },
    };
  } catch (error) {
    void admin.dispose();
    void login.dispose();
    bus.close();
    throw error;
  }
}

/** Connect every service Settings uses; returns them and a function that disconnects them. */
export async function connectServices(): Promise<{
  services: SettingsServices;
  disconnect: () => void;
}> {
  const optional = <T>(connect: () => Promise<T>, name: string) =>
    connect().catch((error: unknown) => {
      console.warn(`[settings] ${name} unavailable:`, error);
      return null;
    });
  const [display, index, storage, desktop, time, accountServices, input, power, brightness] =
    await Promise.all([
      connectDisplayController(),
      connectIndexStatus().catch(() => null),
      connectStorageStatus().catch(() => null),
      connectDesktopStatus(),
      optional(connectTimeSettings, "date and time settings"),
      optional(connectAccountServices, "accounts settings"),
      optional(() => connectInputSettings(), "input settings"),
      optional(connectPowerSettings, "power settings"),
      optional(connectBrightness, "screen brightness"),
    ]);
  return {
    services: {
      display: display?.controller ?? null,
      index,
      storage,
      desktop: desktop?.source ?? null,
      time,
      accounts: accountServices?.accounts ?? null,
      login: accountServices?.login ?? null,
      input,
      power,
      brightness,
    },
    disconnect() {
      display?.bus.close();
      void index?.dispose();
      void storage?.dispose();
      if (desktop) void desktop.source.client.dispose().finally(() => desktop.bus.close());
      for (const client of [time, accountServices, input, power, brightness])
        void client?.dispose();
    },
  };
}

/** Copy text to the clipboard with wl-copy, which owns the Wayland selection. */
export function copyWithWlCopy(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile("wl-copy", ["--"], (error) => {
      if (!error) resolve();
      else if ((error as NodeJS.ErrnoException).code === "ENOENT")
        reject(new Error("Copying needs wl-copy (wl-clipboard), which isn't installed"));
      else reject(error);
    });
    child.stdin?.end(text);
  });
}
