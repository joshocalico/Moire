/**
 * moire-accounts entry: administrator changes to accounts on the system bus. Started by
 * moire-accounts.service as its own unprivileged account; see account-admin.ts for the policy.
 */
import fs from "node:fs";
import { SessionBus } from "@moire/dbus";
import { ACCOUNT_ADMIN_BUS } from "@moire/system-management/account-admin";
import { attachAccountAdmin, polkitAuthorizer } from "./account-admin";
import { SYSTEM_BUS_ADDRESS, createAccountsServiceBackend } from "./accounts-service";
import { hashNewPassword } from "./sha512-crypt";

const ACCOUNT = "moire-accounts";
const DBUS = "org.freedesktop.DBus";
/** RequestName: fail rather than queue behind another owner. */
const DO_NOT_QUEUE = 4;
const PRIMARY_OWNER = 1;

function fatal(message: string): never {
  console.error(`moire-accounts: ${message}`);
  process.exit(1);
}

/** Login name for a uid from passwd(5) text. */
function passwdName(uid: number): string | null {
  for (const line of fs.readFileSync("/etc/passwd", "utf8").split("\n")) {
    const fields = line.split(":");
    if (fields.length >= 7 && /^\d+$/.test(fields[2]!) && Number(fields[2]) === uid)
      return fields[0]!;
  }
  return null;
}

// Its own account, never root: polkit grants that account user-administration and nothing else
// (nix/moire-accounts.rules), and root would make AccountsService read any file for an icon.
const uid = process.getuid?.() ?? 0;
if (uid === 0 || passwdName(uid) !== ACCOUNT) fatal(`must run as ${ACCOUNT}`);

const bus = await SessionBus.connect(SYSTEM_BUS_ADDRESS);
bus.onDisconnect(() => fatal("system bus disconnected"));

// Exported before the name is taken, so no caller ever finds the name without the object.
attachAccountAdmin(bus, {
  async callerUid(sender) {
    const reply = await bus.call({
      destination: DBUS,
      path: "/org/freedesktop/DBus",
      interface: DBUS,
      member: "GetConnectionUnixUser",
      signature: "s",
      body: [sender],
    });
    const value = reply.body?.[0];
    if (reply.signature !== "u" || typeof value !== "number") throw new Error("bad reply");
    return value;
  },
  authorize: polkitAuthorizer(bus),
  // The same connection: AccountsService sees moire-accounts as its caller.
  backend: await createAccountsServiceBackend({ connect: async () => bus, selfUid: -1 }),
  hash: (password) => hashNewPassword(password),
  log: (line) => console.log(line),
});
if ((await bus.requestName(ACCOUNT_ADMIN_BUS, DO_NOT_QUEUE)) !== PRIMARY_OWNER)
  fatal("bus name is taken");
process.on("SIGTERM", () => process.exit(0));
console.log("moire-accounts: code=ready");
