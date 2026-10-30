/**
 * Date & time, accounts and automatic login for Settings. Each connects to the system bus
 * lazily, on first use. Administrator actions are authorized by polkit's prompt, not here
 * (docs/polkit-agent.md).
 */
import type { SessionBus } from "@moire/dbus";
import { attachAccountsSettings, createAccountsServiceBackend } from "./accounts-settings";
import { attachLoginSettings, createLoginManagerBackend } from "./login-settings";
import { createPasswdChanger } from "@moire/system-management/password-check";
import { attachTimeSettings, createTimedatedAdapter } from "./time-settings";

export async function attachSystemSettings(bus: SessionBus): Promise<{ dispose(): Promise<void> }> {
  const time = attachTimeSettings(bus, await createTimedatedAdapter());
  const accounts = attachAccountsSettings(bus, {
    backend: await createAccountsServiceBackend(),
    changeOwnPassword: createPasswdChanger(),
  });
  const login = attachLoginSettings(bus, { backend: await createLoginManagerBackend() });
  return {
    async dispose() {
      await Promise.allSettled([time.dispose(), login.dispose(), accounts.dispose()]);
    },
  };
}
