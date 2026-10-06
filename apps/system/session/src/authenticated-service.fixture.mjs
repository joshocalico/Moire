/** Command-boundary fixture. No systemd, PAM, login1, cgroup or native seat implementation. */
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
const root = process.env.MOIRE_SERVICE_FIXTURE_ROOT;
const role = process.env.MOIRE_SERVICE_FIXTURE_ROLE;
const scenario = process.env.MOIRE_SERVICE_FIXTURE_SCENARIO;
const args = process.argv.slice(2);
let fixtureWorkload = null;
let fixtureWorkloadClosed = Promise.resolve();
// An assertion failure must not leave either mocked CLI running indefinitely.
setTimeout(() => {
  void (async () => {
    fixtureWorkload?.kill("SIGTERM");
    await fixtureWorkloadClosed;
    process.exit(70);
  })();
}, 10_000);
const event = async (value) =>
  fs.appendFile(
    path.join(root, "events.jsonl"),
    JSON.stringify({ role, pid: process.pid, ...value }) + "\n",
  );
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exists = (file) =>
  fs.stat(file).then(
    () => true,
    () => false,
  );
if (role === "stop") {
  const unit = args.at(-1);
  await event({ event: "stop", args, unit });
  if (scenario === "stop-reject") process.exit(7);
  if (scenario === "stop-hangs") {
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
  } else {
    if (await exists(path.join(root, "active"))) await fs.writeFile(path.join(root, "stop"), unit);
    // Controlled successful no-op for the late-registration test.
    if (scenario === "late-registration")
      await fs.writeFile(path.join(root, "release-registration"), "release");
    process.exit(0);
  }
} else if (role === "run") {
  const unit = args.find((value) => value.startsWith("--unit=")).slice(7);
  await event({ event: "run", args, unit });
  if (scenario === "late-registration")
    while (!(await exists(path.join(root, "release-registration")))) await sleep(5);
  // Complete the actual fixed probe before signalling test readiness. This
  // avoids leaving a probe child unobserved when interruption triggers retire.
  const probe = spawn(args[args.indexOf("--") + 1], [], { stdio: "ignore" });
  await new Promise((resolve) => probe.once("close", resolve));
  await event({ event: "fixed-probe-executed", unit });
  const workload = spawn(
    process.execPath,
    ["-e", "setTimeout(()=>process.exit(0),5000);setInterval(()=>{},1000)"],
    { stdio: "ignore" },
  );
  const closed = new Promise((resolve) => workload.once("close", resolve));
  fixtureWorkload = workload;
  fixtureWorkloadClosed = closed;
  await fs.writeFile(path.join(root, "active"), unit);
  let retiring = false;
  async function retire(code) {
    if (retiring) return;
    retiring = true;
    workload.kill("SIGTERM");
    await closed;
    await fs.rm(path.join(root, "active"), { force: true });
    await event({ event: "deactivated", unit, code, workloadClosed: true });
    process.exit(code);
  }
  if (scenario === "run-ignores-term") process.on("SIGTERM", () => {});
  else
    process.on("SIGTERM", () => {
      void retire(0);
    });
  await event({ event: "registered", unit, workloadPid: workload.pid });
  if (scenario === "normal") await retire(0);
  if (scenario === "command-fails") await retire(23);
  if (scenario === "exec-fails") await retire(203);
  while (true) {
    if (
      (await exists(path.join(root, "stop"))) &&
      (await fs.readFile(path.join(root, "stop"), "utf8")) === unit &&
      scenario !== "run-ignores-term"
    )
      await retire(0);
    await sleep(5);
  }
} else {
  process.exit(64);
}
