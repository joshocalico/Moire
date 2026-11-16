/**
 * moire-dm-settings entry: the unprivileged automatic-login writer on the system bus. Started by
 * moire-dm-settings.service as its own account; see login-manager.ts for the policy.
 */
import fs from "node:fs";
import { SessionBus, variant } from "@moire/dbus";
import { AUTOLOGIN_PATH, loadAutologin, writeAutologinFile } from "./autologin-file";
import { parseConfig } from "./config";
import {
  LOGIN_MANAGER_BUS,
  SET_AUTOLOGIN_ACTION,
  attachLoginManager,
  passwdName,
} from "./login-manager";

const CONFIG_PATH = "/etc/moire-dm/config.json";
const SYSTEM_BUS = "unix:path=/run/dbus/system_bus_socket";
const ACCOUNT = "moire-dm-settings";
const DBUS = "org.freedesktop.DBus";
const POLKIT = "org.freedesktop.PolicyKit1";
const AUTHORITY = { destination: POLKIT, path: "/org/freedesktop/PolicyKit1/Authority" };
/** CheckAuthorization flag: polkit may ask the user, through their session's agent. */
const ALLOW_USER_INTERACTION = 1;
/**
 * The prompt gives up after 120 s without input (docs/polkit-agent.md); Settings, which calls
 * this service itself, waits 170 s. In between, so the answer still has someone to go to.
 */
const INTERACTIVE_CHECK_MS = 140_000;
let checks = 0;
/** RequestName: fail rather than queue behind another owner. */
const DO_NOT_QUEUE = 4;
const PRIMARY_OWNER = 1;

function fatal(message: string): never {
  console.error(`moire-dm-settings: ${message}`);
  process.exit(1);
}

const uid = process.getuid?.() ?? 0;
const passwd = () => fs.readFileSync("/etc/passwd", "utf8");
if (uid === 0 || passwdName(passwd(), uid) !== ACCOUNT) fatal(`must run as ${ACCOUNT}`);

let config = null;
try {
  config = parseConfig(fs.readFileSync(CONFIG_PATH, "utf8"));
} catch {
  // Reported below.
}
if (!config) fatal("configuration is missing or invalid");
const dmConfig = config;

const bus = await SessionBus.connect(SYSTEM_BUS);
bus.onDisconnect(() => fatal("system bus disconnected"));

// Exported before the name is taken, so no caller ever finds the name without the object.
attachLoginManager(bus, {
  config: dmConfig,
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
  async authorize(sender, interactive) {
    // The rule answers "an administrator's password". With interaction, polkit raises the
    // prompt in the caller's session and this waits for it; without, the answer is no.
    const cancellation = `moire-dm-settings-${++checks}`;
    let reply;
    try {
      reply = await bus.call(
        {
          ...AUTHORITY,
          interface: `${POLKIT}.Authority`,
          member: "CheckAuthorization",
          signature: "(sa{sv})sa{ss}us",
          body: [
            ["system-bus-name", { name: variant("s", sender) }],
            SET_AUTOLOGIN_ACTION,
            {},
            interactive ? ALLOW_USER_INTERACTION : 0,
            cancellation,
          ],
        },
        { timeoutMs: interactive ? INTERACTIVE_CHECK_MS : 10_000 },
      );
    } catch (error) {
      if (!(error instanceof Error) || !/timed out/i.test(error.message)) throw error;
      // Nobody answered in time: withdraw the question, so no prompt outlives this call.
      void bus
        .call({
          ...AUTHORITY,
          interface: `${POLKIT}.Authority`,
          member: "CancelCheckAuthorization",
          signature: "s",
          body: [cancellation],
        })
        .catch(() => {});
      return "dismissed";
    }
    const result = reply.signature === "(bba{ss})" ? reply.body?.[0] : null;
    if (!Array.isArray(result)) return "no";
    if (result[0] === true) return "yes";
    const details = result[2];
    return details && typeof details === "object" && "polkit.dismissed" in details
      ? "dismissed"
      : "no";
  },
  accountName: (target) => passwdName(passwd(), target),
  read() {
    const state = loadAutologin(dmConfig, AUTOLOGIN_PATH, uid);
    if (state.kind === "enabled")
      return { kind: "enabled", user: state.user, session: state.session.id };
    return state;
  },
  write: (record) => writeAutologinFile(dmConfig, AUTOLOGIN_PATH, record, uid),
  log: (line) => console.log(line),
});
if ((await bus.requestName(LOGIN_MANAGER_BUS, DO_NOT_QUEUE)) !== PRIMARY_OWNER)
  fatal("bus name is taken");
// Every write is already on disk when its call returns; nothing to flush.
process.on("SIGTERM", () => process.exit(0));
console.log("moire-dm-settings: code=ready");
