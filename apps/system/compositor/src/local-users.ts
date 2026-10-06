/** Read-only AccountsService adapter. No service activation/configuration is performed here. */
import type { SessionBus } from "@moire/dbus";
// oxlint-disable-next-line import/no-relative-parent-imports -- Trusted native entries share the presentation metadata contract.
import type { LocalLoginUser, LocalUserProvider } from "../../greeter/src/native/local-users";

const SERVICE = "org.freedesktop.Accounts";
const ROOT = "/org/freedesktop/Accounts";
const USER = `${SERVICE}.User`;
const PROPERTIES = "org.freedesktop.DBus.Properties";
const OPTIONS = { timeoutMs: 3000 };
function variant(value: unknown, signature: string): unknown {
  if (
    !value ||
    typeof value !== "object" ||
    !("signature" in value) ||
    !("value" in value) ||
    value.signature !== signature
  )
    throw new Error("Invalid account metadata.");
  return value.value;
}
function boolean(value: unknown): boolean {
  const data = variant(value, "b");
  if (typeof data !== "boolean") throw new Error("Invalid account metadata.");
  return data;
}
function text(value: unknown, limit: number): string {
  const data = variant(value, "s");
  if (typeof data !== "string" || data.length > limit || /[\p{Cc}\p{Cf}]/u.test(data))
    throw new Error("Invalid account metadata.");
  return data;
}

export function createLocalUserProvider(bus: Pick<SessionBus, "call">): LocalUserProvider {
  return {
    async list(signal) {
      signal = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
      const reply = await bus.call(
        {
          destination: SERVICE,
          path: ROOT,
          interface: SERVICE,
          member: "ListCachedUsers",
        },
        { ...OPTIONS, signal },
      );
      const paths = reply.body?.[0];
      const owner = reply.sender;
      if (
        !owner ||
        !/^:[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(owner) ||
        !Array.isArray(paths) ||
        paths.length > 128 ||
        !paths.every(
          (value): value is string =>
            typeof value === "string" && /^\/org\/freedesktop\/Accounts\/User[0-9]+$/.test(value),
        ) ||
        new Set(paths).size !== paths.length
      )
        throw new Error("Invalid account catalog.");
      const get = async (path: string, property: string) => {
        const result = await bus.call(
          {
            destination: owner,
            path,
            interface: PROPERTIES,
            member: "Get",
            signature: "ss",
            body: [USER, property],
          },
          { ...OPTIONS, signal },
        );
        return result.body?.[0];
      };
      const users: LocalLoginUser[] = [];
      // Keep requests bounded and addressed to one unique daemon owner. A restart fails safely.
      for (const path of paths) {
        signal.throwIfAborted();
        const [system, locked, local] = await Promise.all([
          get(path, "SystemAccount"),
          get(path, "Locked"),
          get(path, "LocalAccount"),
        ]);
        if (boolean(system) || boolean(locked) || !boolean(local)) continue;
        const [id, login, name, shell] = await Promise.all([
          get(path, "Uid"),
          get(path, "UserName"),
          get(path, "RealName"),
          get(path, "Shell"),
        ]);
        const uid = variant(id, "t");
        if (typeof uid !== "bigint" || uid < 0n || uid > 4294967295n)
          throw new Error("Invalid account metadata.");
        if (uid === 0n) continue;
        const username = text(login, 64),
          displayName = text(name, 128).trim();
        if (!/^[a-zA-Z_][a-zA-Z0-9_.-]*\$?$/.test(username))
          throw new Error("Invalid account metadata.");
        const command = text(shell, 4096);
        if (!command.startsWith("/") || /\/(?:nologin|false)$/.test(command)) continue;
        if (users.some((user) => user.uid === uid || user.username === username))
          throw new Error("Invalid account catalog.");
        users.push(Object.freeze({ uid, username, displayName: displayName || username }));
      }
      signal.throwIfAborted();
      const currentOwner = await bus.call(
        {
          destination: "org.freedesktop.DBus",
          path: "/org/freedesktop/DBus",
          interface: "org.freedesktop.DBus",
          member: "GetNameOwner",
          signature: "s",
          body: [SERVICE],
        },
        { ...OPTIONS, signal },
      );
      if (currentOwner.body?.[0] !== owner) throw new Error("Account service changed.");
      return Object.freeze(
        users.sort(
          (a, b) =>
            a.displayName.localeCompare(b.displayName) || a.username.localeCompare(b.username),
        ),
      );
    },
  };
}
