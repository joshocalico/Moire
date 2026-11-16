/**
 * Date & time and the session user's own account for Settings. Each connects to the system bus
 * lazily, on first use. Administrator actions don't pass through this service at all: Settings
 * calls moire-accounts and moire-dm-settings (automatic login) itself, so the system's password
 * prompt names Settings (docs/polkit-agent.md, "One prompt per change").
 */
import type { SessionBus } from "@moire/dbus";
import { attachAccountsSettings, createAccountsServiceBackend } from "./accounts-settings";
import { createPasswdChanger } from "@moire/system-management/password-check";
import { attachTimeSettings, createTimedatedAdapter } from "./time-settings";

export async function attachSystemSettings(bus: SessionBus): Promise<{ dispose(): Promise<void> }> {
  const time = attachTimeSettings(bus, await createTimedatedAdapter());
  const accounts = attachAccountsSettings(bus, {
    backend: await createAccountsServiceBackend(),
    changeOwnPassword: createPasswdChanger(),
  });
  return {
    async dispose() {
      await Promise.allSettled([time.dispose(), accounts.dispose()]);
    },
  };
}
