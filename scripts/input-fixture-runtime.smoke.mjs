import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
// Direct Node ESM execution requires the explicit .mjs extension.
// oxlint-disable-next-line no-restricted-imports
import { parseProcessStat, linuxDeviceNumbers } from "./prepare-input-fixture.mjs";
// oxlint-disable-next-line no-restricted-imports, no-relative-parent-imports
import { readProcessEntryPoint } from "../packages/sys/src/input-fixture-process-identity.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function argument(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw new Error(`Missing ${name}`);
  return args[index + 1];
}
const sourceRoot = path.resolve(argument("--root", path.dirname(scriptRoot)));
const loader = argument("--loader");
const keyboard = argument("--keyboard"),
  pointer = argument("--pointer");
const output = argument("--output");
const hash = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

// These are inert metadata actors. Observer calls below never reach a production input route.
const childSource = `
import fs from 'node:fs';
const nativeOpen=fs.openSync;
fs.openSync=(file,...args)=>{if(String(file).startsWith('/dev/'))throw new Error('Device open prohibited');return nativeOpen(file,...args);};
const {createInputFixtureTrace,INPUT_FIXTURE_VALUE}=await import(process.argv[2]);
const role=process.argv[3];let focus={peerPid:null,appId:null},trace=null;
const stop=()=>{trace?.stop('closed');clearTimeout(deadline);process.removeAllListeners('message');if(process.connected)process.disconnect();};
const deadline=setTimeout(stop,15000);
process.on('message',message=>{try{
 let result=null;
 if(message.command==='focus')focus=message.value;
 if(message.command==='retitle')process.title='inert metadata actor identity changed';
 if(message.command==='init'){trace=role==='compositor'?createInputFixtureTrace(role,{focus:()=>focus}):createInputFixtureTrace(role);result=trace.active();}
 if(message.command==='active')result=trace.active();
 if(message.command==='write'){const before=JSON.stringify(message.value);const ordinal=trace.write(message.value,7);trace.link(message.value,ordinal);result={ordinal,source:trace.sourceOf(message.value),unchanged:before===JSON.stringify(message.value)};}
 if(message.command==='value'){trace.value('submit',INPUT_FIXTURE_VALUE);result=trace.active();}
 if(message.command==='stop'){trace.stop('closed');result=trace.active();}
 if(message.command==='exit'){process.send({id:message.id,result:true},stop);return;}
 process.send({id:message.id,result});
 }catch(error){process.send({id:message.id,error:error.message});}});
process.send({ready:true,pid:process.pid,uid:process.getuid(),cwd:process.cwd()});
`;

async function actor(childFile, role, cwd, manifest, traceSource) {
  const child = spawn(
    process.execPath,
    ["--import", loader, childFile, pathToFileURL(traceSource).href, role],
    {
      cwd,
      env: { ...process.env, MOIRE_INPUT_FIXTURE_TRACE: manifest },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    },
  );
  let stdout = "",
    stderr = "",
    nextId = 0,
    closed = false;
  child.stdout.on("data", (chunk) => {
    stdout = (stdout + chunk).slice(-16384);
  });
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-16384);
  });
  const exit = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      closed = true;
      resolve({ code, signal });
    });
    child.once("error", (error) => {
      closed = true;
      resolve({ error: error.message });
    });
  });
  const waitMessage = (predicate, send) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`${role} reply timeout: ${stderr}`)), 10000);
      const receive = (message) => {
        if (predicate(message)) finish(null, message);
      };
      const fail = (error) => finish(error);
      const gone = () => finish(new Error(`${role} exited before reply: ${stderr}`));
      const finish = (error, value) => {
        clearTimeout(timer);
        child.off("message", receive);
        child.off("error", fail);
        child.off("close", gone);
        if (error) reject(error);
        else resolve(value);
      };
      child.on("message", receive);
      child.once("error", fail);
      child.once("close", gone);
      if (send)
        child.send(send, (error) => {
          if (error) finish(error);
        });
    });
  try {
    const ready = await waitMessage((message) => message.ready === true);
    const stat = parseProcessStat(fs.readFileSync(`/proc/${child.pid}/stat`, "utf8"), child.pid);
    return {
      identity: {
        pid: child.pid,
        uid: ready.uid,
        startTicks: stat.startTicks,
        cwd: ready.cwd,
        entryPoint: readProcessEntryPoint(child.pid, ready.cwd),
      },
      async call(command, value) {
        const id = ++nextId,
          reply = await waitMessage((message) => message.id === id, { id, command, value });
        if (reply.error) throw new Error(reply.error);
        return reply.result;
      },
      async close() {
        if (!closed) {
          try {
            await this.call("exit");
          } catch {
            child.kill("SIGKILL");
          }
        }
        let timer;
        const result = await Promise.race([
          exit,
          new Promise((resolve) => {
            timer = setTimeout(() => {
              if (!closed) child.kill("SIGKILL");
              resolve({ timeout: true });
            }, 2000);
          }),
        ]);
        clearTimeout(timer);
        assert.equal(result.timeout, undefined, `${role} did not exit`);
        assert.equal(result.code, 0, `${role} abnormal exit ${JSON.stringify(result)}`);
        return { ...result, stdout, stderr };
      },
    };
  } catch (error) {
    child.kill("SIGKILL");
    await exit;
    throw error;
  }
}

async function run() {
  if (process.platform !== "linux")
    throw new Error("Linux-only runtime fixture; no native operations on this host");
  if (!loader || !keyboard || !pointer || keyboard === pointer)
    throw new Error(
      "Required: --loader <tsx loader.mjs> --keyboard <known eventN> --pointer <different known eventN> [--root repo] [--output new-directory]",
    );
  if (
    args.length % 2 ||
    args.some(
      (arg, index) =>
        index % 2 === 0 &&
        !["--root", "--loader", "--keyboard", "--pointer", "--output"].includes(arg),
    )
  )
    throw new Error("Unknown runtime fixture arguments");
  fs.statSync(loader);
  const traceSource = path.join(sourceRoot, "packages/sys/src/input-fixture-trace.ts");
  const preparer = path.join(scriptRoot, "prepare-input-fixture.mjs");
  const evidence = output
    ? path.resolve(output)
    : fs.mkdtempSync(path.join(os.tmpdir(), "moire-input-runtime-evidence-"));
  if (output) fs.mkdirSync(evidence, { mode: 0o700 });
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "moire-input-runtime-work-")));
  const devices = [
    [keyboard, "keyboard"],
    [pointer, "pointer"],
  ].map(([device, kind]) => {
    assert.match(device, /^\/dev\/input\/event\d+$/);
    const stat = fs.lstatSync(device, { bigint: true });
    assert.ok(stat.isCharacterDevice());
    const { major, minor } = linuxDeviceNumbers(stat.rdev);
    return {
      path: device,
      kind,
      rdev: String(stat.rdev),
      sysfs: fs.realpathSync(`/sys/dev/char/${major}:${minor}`),
    };
  });
  const receipt = {
    scope:
      "Actual Linux proc/sysfs/device metadata and trace factory; inert actor processes and synthetic observer calls, no native input or device FD opens",
    uid: process.getuid(),
    bootId: fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
    sourceSha256: {
      preparer: hash(preparer),
      trace: hash(traceSource),
      processIdentity: hash(
        path.join(sourceRoot, "packages/sys/src/input-fixture-process-identity.mjs"),
      ),
      harness: hash(fileURLToPath(import.meta.url)),
      loader: hash(loader),
    },
    devices,
    cases: [],
  };
  const save = () =>
    fs.writeFileSync(path.join(evidence, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n", {
      mode: 0o600,
    });
  const raw = {
    layer: "raw-keyboard",
    device: { path: keyboard, rdev: devices[0].rdev, fd: 17 },
    type: 1,
    code: 20,
    value: 1,
    timeMs: 123,
  };
  const key = {
    layer: "client-key",
    type: "down",
    code: 20,
    timeMs: 123,
    modifiers: { ctrl: false, alt: false, shift: false, meta: false },
  };
  let failed = false;
  try {
    for (const name of [
      "secure-records-and-close",
      "pending-publication-1",
      "pending-publication-2",
      "pending-publication-3",
      "wrong-focus",
      "process-exit",
      "process-entry-point-change",
      "device-mismatch",
      "manifest-replacement",
      "expired-manifest",
      "existing-output",
    ]) {
      const caseDir = path.join(evidence, name);
      fs.mkdirSync(caseDir, { mode: 0o700 });
      const id = randomUUID(),
        directory = `/tmp/moire-input-fixture-${id}`,
        manifest = `${directory}/manifest.json`;
      let compositor, app, directoryIdentity;
      const normalCase =
        name === "secure-records-and-close" || name.startsWith("pending-publication-");
      const entry = { name, result: null, actors: null, shutdown: [], assertions: [] };
      receipt.cases.push(entry);
      save();
      try {
        for (const suffix of ["apps/system/compositor/src", "apps/bundled/screenshot/src", "home"])
          fs.mkdirSync(path.join(work, id, suffix), { recursive: true, mode: 0o700 });
        fs.writeFileSync(path.join(work, id, "package.json"), '{"type":"module"}\n', {
          flag: "wx",
          mode: 0o600,
        });
        const compositorScript = path.join(work, id, "apps/system/compositor/src/main.ts");
        const appScript = path.join(work, id, "apps/bundled/screenshot/src/main.tsx");
        for (const script of [compositorScript, appScript])
          fs.writeFileSync(script, childSource, { flag: "wx", mode: 0o600 });
        compositor = await actor(
          compositorScript,
          "compositor",
          path.join(work, id, "home"),
          manifest,
          traceSource,
        );
        app = await actor(
          "src/main.tsx",
          "app",
          path.join(work, id, "apps/bundled/screenshot"),
          manifest,
          traceSource,
        );
        entry.actors = { compositor: compositor.identity, app: app.identity };
        assert.equal(compositor.identity.cwd, path.join(work, id, "home"));
        assert.equal(compositor.identity.entryPoint, compositorScript);
        assert.equal(app.identity.entryPoint, appScript);
        entry.assertions.push(
          "Home-cwd absolute compositor and app-cwd relative Screenshot resolve exact role scripts",
        );
        await compositor.call("focus", {
          peerPid: app.identity.pid,
          appId: "org.moire.Screenshot",
        });
        if (name.startsWith("pending-publication-")) {
          assert.equal(await compositor.call("init"), false);
          assert.equal(await app.call("init"), false);
          entry.assertions.push("actual factory waits for future manifest before helper arms");
        }
        const spec = {
          version: 2,
          runId: id,
          bootId: receipt.bootId,
          scenario: "keys",
          compositor: compositor.identity,
          app: app.identity,
          appId: "org.moire.Screenshot",
          devices,
        };
        const specFile = path.join(caseDir, "declaration.json");
        fs.writeFileSync(specFile, JSON.stringify(spec), { flag: "wx", mode: 0o600 });
        const prepared = spawnSync(
          process.execPath,
          [preparer, "--manifest", manifest, "--spec", specFile],
          { encoding: "utf8", timeout: 5000, maxBuffer: 64 * 1024 },
        );
        fs.writeFileSync(
          path.join(caseDir, "preparer.json"),
          JSON.stringify({
            status: prepared.status,
            signal: prepared.signal,
            stdout: prepared.stdout,
            stderr: prepared.stderr,
          }),
          { flag: "wx", mode: 0o600 },
        );
        assert.equal(prepared.status, 0, prepared.stderr);
        directoryIdentity = fs.lstatSync(directory, { bigint: true });
        entry.assertions.push("actual helper exit0");
        if (name === "device-mismatch" || name === "expired-manifest") {
          const value = JSON.parse(fs.readFileSync(manifest));
          if (name === "device-mismatch")
            value.devices[0].rdev = String(
              value.devices.reduce(
                (max, device) => (BigInt(device.rdev) > max ? BigInt(device.rdev) : max),
                0n,
              ) + 1n,
            );
          else value.armedAtMonoNs = String(process.hrtime.bigint() - 91_000_000_000n);
          fs.writeFileSync(manifest, JSON.stringify(value));
        }
        if (name === "existing-output")
          fs.writeFileSync(`${directory}/compositor.jsonl`, "FOREIGN", { flag: "wx", mode: 0o600 });
        if (["device-mismatch", "expired-manifest", "existing-output"].includes(name)) {
          assert.equal(await compositor.call("init"), false);
          entry.assertions.push("factory rejected actual invalid scope");
          if (name === "existing-output")
            assert.equal(fs.readFileSync(`${directory}/compositor.jsonl`, "utf8"), "FOREIGN");
          else if (name === "device-mismatch")
            assert.equal(fs.existsSync(`${directory}/compositor.jsonl`), false);
        } else {
          assert.equal(await compositor.call("init"), true);
          assert.equal(await app.call("init"), true);
          const observed = await compositor.call("write", raw);
          assert.deepEqual(observed, { ordinal: 1, source: 1, unchanged: true });
          if (normalCase) {
            assert.deepEqual(await app.call("write", key), {
              ordinal: 1,
              source: 1,
              unchanged: true,
            });
            assert.equal(await app.call("value"), true);
            await compositor.call("stop");
            await app.call("stop");
          }
          if (name === "wrong-focus") {
            await compositor.call("focus", {
              peerPid: app.identity.pid + 1,
              appId: "org.other.App",
            });
            assert.equal(await compositor.call("active"), false);
          }
          if (name === "process-entry-point-change") {
            await app.call("retitle");
            assert.equal(await compositor.call("active"), false);
            assert.equal(await app.call("active"), false);
            entry.assertions.push(
              "same PID/start ticks/UID/cwd cannot retain scope after actual cmdline changes",
            );
          }
          if (name === "process-exit") {
            entry.shutdown.push(await app.close());
            app = null;
            assert.equal(await compositor.call("active"), false);
          }
          if (name === "manifest-replacement") {
            const replacement = `${directory}/replacement`;
            fs.writeFileSync(replacement, fs.readFileSync(manifest), { flag: "wx", mode: 0o600 });
            fs.renameSync(replacement, manifest);
            assert.equal(await compositor.call("active"), false);
          }
          assert.deepEqual(await compositor.call("write", raw), {
            ordinal: null,
            source: null,
            unchanged: true,
          });
          entry.assertions.push("ended recorder emits no later observation");
        }
        entry.result = 0;
      } catch (error) {
        failed = true;
        entry.result = 1;
        entry.error = error.stack;
      } finally {
        for (const child of [app, compositor])
          if (child) {
            try {
              entry.shutdown.push(await child.close());
            } catch (error) {
              failed = true;
              entry.result = 1;
              entry.shutdown.push({ error: error.stack });
            }
          }
        try {
          if (fs.existsSync(directory)) {
            const current = fs.lstatSync(directory, { bigint: true });
            if (
              !directoryIdentity ||
              current.dev !== directoryIdentity.dev ||
              current.ino !== directoryIdentity.ino
            ) {
              failed = true;
              entry.result = 1;
              entry.error = "Runtime fixture directory identity changed; preserved";
            } else {
              assert.equal(Number(current.uid), receipt.uid);
              assert.equal(Number(current.mode & 0o777n), 0o700);
              entry.outputMetadata = {};
              for (const file of fs.readdirSync(directory)) {
                const stat = fs.lstatSync(path.join(directory, file));
                if (stat.isFile()) {
                  assert.equal(stat.uid, receipt.uid);
                  assert.equal(stat.mode & 0o777, 0o600);
                  entry.outputMetadata[file] = {
                    uid: stat.uid,
                    mode: stat.mode & 0o777,
                    dev: stat.dev,
                    ino: stat.ino,
                    sha256: hash(path.join(directory, file)),
                  };
                  fs.copyFileSync(
                    path.join(directory, file),
                    path.join(caseDir, file),
                    fs.constants.COPYFILE_EXCL,
                  );
                }
              }
              if (entry.result === 0) fs.rmSync(directory, { recursive: true });
            }
          }
        } catch (error) {
          failed = true;
          entry.result = 1;
          entry.error = error.stack;
        }
        try {
          if (entry.result === 0 && !["device-mismatch", "existing-output"].includes(name)) {
            const records = fs
              .readFileSync(path.join(caseDir, "compositor.jsonl"), "utf8")
              .trim()
              .split("\n")
              .map((line) => JSON.parse(line));
            const expected =
              name === "wrong-focus"
                ? "focus"
                : normalCase
                  ? "closed"
                  : name === "expired-manifest"
                    ? "deadline"
                    : "identity";
            assert.equal(records.at(-1).reason, expected);
            assert.equal(records.filter((item) => item.stage === "end").length, 1);
            for (const file of ["manifest.json", "compositor.jsonl", "app.jsonl"])
              if (fs.existsSync(path.join(caseDir, file))) {
                const stat = fs.statSync(path.join(caseDir, file));
                assert.equal(stat.uid, receipt.uid);
                assert.equal(stat.mode & 0o777, 0o600);
              }
            if (normalCase) {
              assert.deepEqual(records.find((item) => item.stage === "event").event, raw);
              assert.equal(records.find((item) => item.stage === "event").sourceSequence, 7);
              const appRecords = fs
                .readFileSync(path.join(caseDir, "app.jsonl"), "utf8")
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line));
              assert.equal(appRecords.find((item) => item.stage === "value").expected, true);
              assert.deepEqual(appRecords.find((item) => item.stage === "event").event, key);
              assert.equal(
                appRecords.find((item) => item.stage === "value").sha256,
                createHash("sha256").update("/tmp/c36-trace.png").digest("hex"),
              );
              assert.ok(
                !fs
                  .readFileSync(path.join(caseDir, "app.jsonl"), "utf8")
                  .includes("/tmp/c36-trace.png"),
              );
            }
            entry.assertions.push("actual private records and exact end reason verified");
          }
        } catch (error) {
          failed = true;
          entry.result = 1;
          entry.error = error.stack;
        }
        save();
      }
      if (failed) break;
    }
    receipt.result = failed ? 1 : 0;
    save();
    console.log(JSON.stringify({ evidence, result: receipt.result, cases: receipt.cases.length }));
    if (failed) throw new Error(`Runtime fixture failed; first failure preserved at ${evidence}`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

if (args.length === 1 && args[0] === "--check-child") {
  const result = spawnSync(process.execPath, ["--check", "--input-type=module"], {
    input: childSource,
    encoding: "utf8",
  });
  if (result.status !== 0) process.stderr.write(result.stderr);
  process.exitCode = result.status ?? 1;
  console.log(
    JSON.stringify({ scope: "embedded inert actor syntax only", result: process.exitCode }),
  );
} else {
  run().catch((error) => {
    console.error(error.stack);
    process.exitCode = 1;
  });
}
