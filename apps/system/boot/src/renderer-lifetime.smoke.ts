import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = await mkdtemp(path.join(tmpdir(), "moire-ipc-review-"));
const fixture = fileURLToPath(
  new URL(
    import.meta.url.endsWith(".mjs")
      ? "./renderer-lifetime-child.mjs"
      : "./renderer-lifetime.child.ts",
    import.meta.url,
  ),
);
const completed: string[] = [];
const orphanPids = new Set<number>();
function terminateOrphan(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error;
  }
}

async function run(mode: string, stop: "disconnect" | "term" | "both" | "kill-guardian" | "none") {
  const report = path.join(directory, `${mode}-${completed.length}.json`);
  const child = spawn(process.execPath, [...process.execArgv, fixture, mode, report], {
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const childStdout = child.stdout;
  const childStderr = child.stderr;
  assert.ok(childStdout && childStderr);
  let stderr = "";
  let stdout = "";
  childStderr.on("data", (data: Buffer) => {
    stderr += data.toString();
  });
  const deadline = setTimeout(() => {
    child.kill("SIGKILL");
  }, 7_000);
  const streamsEnded = Promise.all([
    new Promise<void>((resolve) => childStdout.once("end", () => resolve())),
    new Promise<void>((resolve) => childStderr.once("end", () => resolve())),
  ]);
  try {
    const exit = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code));
    });
    if (stop !== "none") {
      const ready = await new Promise<number>((resolve, reject) => {
        childStdout.on("data", (data: Buffer) => {
          stdout += data.toString();
          for (const line of stdout.split("\n")) {
            if (!line) continue;
            try {
              const parsed: unknown = JSON.parse(line);
              if (
                typeof parsed === "object" &&
                parsed !== null &&
                "ready" in parsed &&
                parsed.ready === true &&
                "pid" in parsed &&
                typeof parsed.pid === "number"
              )
                resolve(parsed.pid);
            } catch {
              /* A stdout chunk can end in an incomplete JSON line. */
            }
          }
        });
        child.once("exit", (code) =>
          reject(new Error(`Child exited before ready: ${code}; ${stderr}`)),
        );
      });
      if (stop === "kill-guardian") {
        orphanPids.add(ready);
        child.kill("SIGKILL");
      } else if (stop === "term") child.kill("SIGTERM");
      else if (mode === "first-send-race") {
        child.send("go", (error) => {
          assert.equal(error, null);
          if (child.connected) child.disconnect();
        });
      } else {
        child.disconnect();
        if (stop === "both") child.kill("SIGTERM");
      }
    }
    const code = await exit;
    await streamsEnded;
    if (mode === "baseline" || mode === "closed-send-unguarded") {
      assert.equal(code, 1);
      assert.match(stderr, mode === "baseline" ? /ERR_IPC_DISCONNECTED/ : /ERR_IPC_CHANNEL_CLOSED/);
      assert.match(stderr, /Emitted 'error' event on process instance/);
    } else if (stop === "kill-guardian") assert.equal(code, null);
    else assert.equal(code, 0, stderr);

    // The killed guardian cannot report renderer completion: read the child's own artifact.
    let raw = "";
    for (let retry = 0; retry < 100; retry++) {
      try {
        raw = await readFile(report, "utf8");
        break;
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      }
    }
    assert.notEqual(raw, "", "Renderer never released its ordinary resource");
    const result: unknown = JSON.parse(raw);
    assert.ok(typeof result === "object" && result !== null && "released" in result);
    assert.equal(result.released, true);
    if (
      mode !== "baseline" &&
      mode !== "closed-send-callback" &&
      mode !== "closed-send-unguarded"
    ) {
      assert.ok("stopped" in result && "connected" in result && "listenersRestored" in result);
      assert.equal(result.stopped, true);
      assert.equal(result.connected, false);
      assert.equal(result.listenersRestored, true);
      assert.equal(stderr, "");
    }
    completed.push(`${mode}/${stop}`);
    if (stop === "kill-guardian") orphanPids.clear();
  } finally {
    clearTimeout(deadline);
    if (child.connected) child.disconnect();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}

try {
  await run("baseline", "disconnect");
  await run("fixed", "disconnect");
  await run("already-disconnected", "disconnect");
  await run("fixed", "term");
  await run("fixed", "both");
  await run("guardian", "kill-guardian");
  await run("closed-send-callback", "disconnect");
  await run("closed-send-unguarded", "disconnect");
  for (let repeat = 0; repeat < 4; repeat++) await run("first-send-race", "disconnect");
  for (let repeat = 0; repeat < 8; repeat++) await run("send-race", "disconnect");
  await run("serialization-error", "none");
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        cases: completed,
        result: "PASS",
        graphicsAccess: false,
      },
      null,
      2,
    ),
  );
} finally {
  for (const pid of orphanPids) {
    terminateOrphan(pid);
  }
  await rm(directory, { recursive: true, force: true });
}
