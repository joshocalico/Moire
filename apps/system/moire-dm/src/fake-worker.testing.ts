/**
 * A real worker process (same runWorker, same fd 3 channel and blocking reads) with fake PAM,
 * a fake account database and a fake session launcher. Sessions are placeholder Node processes
 * that wait to be killed; each launch is appended to MOIRE_DM_FAKE_RECORD for the smoke.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { runWorker, type SessionAccount } from "./worker";
import { FAKE_PASSWORD, createFakePam } from "./fake-pam.testing";

const accounts: Record<string, SessionAccount> = {
  alice: { name: "alice", uid: 1000, gid: 100, home: "/home/alice", shell: "/bin/sh" },
  bob: { name: "bob", uid: 1001, gid: 100, home: "/home/bob", shell: "/bin/sh" },
  greeter: { name: "greeter", uid: 990, gid: 990, home: "/var/empty", shell: "/bin/nologin" },
  daemon: { name: "daemon", uid: 2, gid: 2, home: "/", shell: "/bin/nologin" },
};

const record = process.env.MOIRE_DM_FAKE_RECORD;
if (!record) process.exit(1);

process.exitCode = await runWorker({
  pam: createFakePam({
    alice: { password: FAKE_PASSWORD, notice: "Welcome back" },
    bob: { password: FAKE_PASSWORD, account: "expired-account" },
    mapped: { password: FAKE_PASSWORD, mappedUser: "daemon" },
    greeter: { password: "" },
  }),
  fd: 3,
  confdir: null,
  path: "/run/current-system/sw/bin",
  lookupAccount: (name) => accounts[name] ?? null,
  launchSession(plan) {
    const child = spawn(
      process.execPath,
      ["-e", "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1e6);"],
      { stdio: "ignore" },
    );
    if (child.pid === undefined) return null;
    fs.appendFileSync(
      record,
      JSON.stringify({ user: plan.account.name, argv: plan.argv, env: plan.env, pid: child.pid }) +
        "\n",
    );
    return {
      pid: child.pid,
      exited: new Promise((resolve) => child.once("exit", (code) => resolve(code))),
      terminate: () => child.kill("SIGTERM"),
    };
  },
});
