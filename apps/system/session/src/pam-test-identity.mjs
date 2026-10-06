/** Native read-only identity observation for the isolated public-password PAM test. */
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
const systemd = "/run/current-system/systemd/bin/";
const manager = "/org/freedesktop/login1";
async function bus(args) {
  const { stdout } = await execute(systemd + "busctl", ["--system", "--json=short", ...args], {
    timeout: 5000,
    maxBuffer: 8192,
  });
  const reply = JSON.parse(stdout);
  return args[0] === "call" ? reply.data[0] : reply.data;
}
async function session(pid) {
  return bus([
    "call",
    "org.freedesktop.login1",
    manager,
    "org.freedesktop.login1.Manager",
    "GetSessionByPID",
    "u",
    String(pid),
  ]);
}
async function property(object, name) {
  return bus([
    "get-property",
    "org.freedesktop.login1",
    object,
    "org.freedesktop.login1.Session",
    name,
  ]);
}
try {
  const mode = process.argv[2];
  if (
    process.platform !== "linux" ||
    process.getuid() !== 1000 ||
    !["login", "unit"].includes(mode)
  )
    throw new Error("Invalid isolated test identity");
  const pid = process.ppid;
  const cgroup = await fs.readFile(`/proc/${pid}/cgroup`, "utf8");
  const receipt = {
    component: "moire-pam-test-identity",
    qualification: "native-observation",
    mode,
    observedPid: pid,
    observerPid: process.pid,
    actualUid: process.getuid(),
    actualGid: process.getgid(),
    actualGroups: process.getgroups(),
    cgroup: cgroup.trim(),
  };
  if (mode === "login") {
    const object = await session(pid);
    if (object !== (await session(process.pid))) throw new Error("Session identity mismatch");
    const values = await Promise.all(
      ["Id", "User", "Name", "Seat", "Scope", "Class", "Type", "State", "Leader"].map((key) =>
        property(object, key),
      ),
    );
    const [id, user, name, seat, scope, sessionClass, type, state, leader] = values;
    if (user[0] !== process.getuid() || name !== "moire-pam-test" || sessionClass !== "user")
      throw new Error("Wrong login session");
    Object.assign(receipt, {
      sessionObject: object,
      sessionId: id,
      sessionUser: user,
      name,
      seat,
      scope,
      sessionClass,
      type,
      state,
      leader,
    });
  } else {
    const unit = cgroup.match(/(moire-session-[0-9a-f-]{36}\.service)(?:\n|$)/)?.[1];
    if (!unit) throw new Error("Missing owned user service");
    Object.assign(receipt, { ownedUnit: unit, pamSessionIdentityClaimed: false });
  }
  // logger carries public metadata only. It supplies a real journal message from this UID.
  await execute(
    "/run/current-system/sw/bin/logger",
    ["--tag", "moire-pam-test-identity", "--", JSON.stringify(receipt)],
    { timeout: 5000, maxBuffer: 8192 },
  );
} catch {
  process.stderr.write("Moire PAM test identity observation failed\n");
  process.exitCode = 1;
}
