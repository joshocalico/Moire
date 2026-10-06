import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";
const scope = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(scope, "../../..");
const app = process.argv[2];
assert.ok(["calendar", "clock", "colors"].includes(app));
const spec = {
  calendar: ["events.ts", "CalendarStore"],
  clock: ["time.ts", "AlarmStore"],
  colors: ["palettes.ts", "PaletteStore"],
}[app];
const module = await import(path.join(repository, `apps/bundled/${app}/src/${spec[0]}`));
const { StorageConflictError } = await import("@moire/app-tools/local-store");
const Store = module[spec[1]];
const now = Date.parse("2026-10-03T00:00:00Z");
function item(id) {
  if (app === "calendar")
    return {
      id,
      title: `Event ${id}`,
      startMs: now + 3600000,
      endMs: now + 7200000,
      timeZone: "UTC",
      notes: "",
    };
  if (app === "clock")
    return { id, label: `Alarm ${id}`, time: "07:30", enabled: true, nextAtMs: now + 27000000 };
  return {
    id,
    name: `Palette ${id}`,
    swatches: [{ id: `${id}-swatch`, name: "Draft red", hex: "#FF0000" }],
  };
}
if (process.argv[3] === "child") {
  const store = new Store(process.argv[4]);
  if (process.argv[5] === "hold") {
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (to === store.file) {
        fs.writeFileSync(process.argv[6], "ready");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      }
      return rename(from, to);
    };
  }
  store.write(
    [...store.load(now).items, item(process.argv[5] === "hold" ? "held-child" : "child")],
    store.load(now).revision,
    now,
  );
  process.exit(0);
}
const temp = fs.mkdtempSync(path.join(os.tmpdir(), `moire-${app}-concurrent-`));
let child;
let childDone;
const rows = [];
try {
  const file = path.join(temp, "data.json"),
    store = new Store(file),
    other = new Store(file);
  let state = store.write([item("initial")], store.load(now).revision, now);
  const stale = other.load(now);
  state = store.write([...state.items, item("first")], state.revision, now);
  const firstBytes = fs.readFileSync(file);
  other.read(now);
  other.load(now);
  assert.throws(
    () => other.write([...stale.items, item("stale")], stale.revision, now),
    StorageConflictError,
  );
  assert.deepEqual(
    fs.readFileSync(file),
    firstBytes,
    "observer reads do not authorize stale writes",
  );
  rows.push("independent instances: stale revision and observer read blocked");
  async function launch(mode) {
    child = spawn(
      process.execPath,
      [
        ...process.execArgv,
        fileURLToPath(import.meta.url),
        app,
        "child",
        file,
        mode,
        path.join(temp, "ready"),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (out += b));
    childDone = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal, out }));
    });
    return child;
  }
  const beforeChild = store.load(now);
  await launch("commit");
  const committed = await childDone;
  assert.equal(committed.code, 0, committed.out);
  const childBytes = fs.readFileSync(file);
  assert.throws(
    () => store.write([...beforeChild.items, item("parent-stale")], beforeChild.revision, now),
    StorageConflictError,
  );
  assert.deepEqual(fs.readFileSync(file), childBytes);
  rows.push("real independent process commit preserved from stale parent");
  await launch("hold");
  const deadline = performance.now() + 3000;
  while (!fs.existsSync(path.join(temp, "ready"))) {
    assert.ok(performance.now() < deadline, "writer reaches real pre-rename boundary");
    await pause(10);
  }
  const beforeHeld = fs.readFileSync(file),
    locked = store.load(now),
    start = performance.now();
  assert.throws(
    () => store.write([...locked.items, item("blocked")], locked.revision, now),
    /Storage is busy/,
  );
  assert.ok(performance.now() - start < 500, "live writer lock fails boundedly");
  assert.deepEqual(fs.readFileSync(file), beforeHeld);
  child.kill("SIGKILL");
  const killed = await childDone;
  assert.equal(killed.signal, "SIGKILL");
  state = store.write([...locked.items, item("recovered")], locked.revision, now);
  assert.equal(state.items.at(-1).id, "recovered");
  assert.ok(!fs.existsSync(`${file}.write-lock`));
  rows.push("real live lock blocks; SIGKILL abandoned private staging recovered");
  fs.mkdirSync(`${file}.write-lock`);
  assert.throws(() => store.write(state.items, state.revision, now), /Storage is busy/);
  assert.ok(fs.existsSync(`${file}.write-lock`), "unknown empty lock never deleted");
  fs.writeFileSync(path.join(`${file}.write-lock`, "foreign"), "unknown");
  assert.throws(() => store.write(state.items, state.revision, now), /Storage is busy/);
  assert.equal(fs.readFileSync(path.join(`${file}.write-lock`, "foreign"), "utf8"), "unknown");
  fs.rmSync(`${file}.write-lock`, { recursive: true });
  rows.push("unknown lock retained and bounded explicit error");
  const bytes = fs.readFileSync(file);
  fs.writeFileSync(file, "malformed external bytes");
  assert.throws(() => store.write(state.items, state.revision, now));
  assert.equal(fs.readFileSync(file, "utf8"), "malformed external bytes");
  fs.writeFileSync(file, bytes);
  state = store.load(now);
  const rename = fs.renameSync;
  try {
    fs.renameSync = (from, to) => {
      if (to === file)
        throw Object.assign(new Error("fixture EIO before publish"), { code: "EIO" });
      return rename(from, to);
    };
    assert.throws(
      () => store.write([...state.items, item("failed")], state.revision, now),
      /fixture EIO/,
    );
  } finally {
    fs.renameSync = rename;
  }
  assert.deepEqual(fs.readFileSync(file), bytes);
  assert.ok(!fs.existsSync(`${file}.write-lock`));
  rows.push("malformed and failed publication preserve exact saved bytes");
  const open = fs.openSync;
  try {
    fs.openSync = (name, ...args) => {
      if (typeof name === "string" && name.endsWith(".owner"))
        throw new Error("fixture owner creation EIO");
      return open(name, ...args);
    };
    assert.throws(
      () => store.write([...state.items, item("owner-failed")], state.revision, now),
      /fixture owner creation EIO/,
    );
  } finally {
    fs.openSync = open;
  }
  assert.ok(
    !fs.existsSync(`${file}.write-lock`),
    "our own unpublished empty lock is cleaned after synchronous owner failure",
  );
  assert.deepEqual(fs.readFileSync(file), bytes);
  rows.push("own lock creation failure cleans only known empty lock");

  if (app === "calendar")
    assert.throws(
      () =>
        store.write([{ ...item("invalid"), startMs: 1e100, endMs: 1e100 }], state.revision, now),
      /invalid/,
    );
  if (app === "clock") {
    const runtime = store.write(
      [{ ...item("snooze"), nextAtMs: now + 300001 }],
      state.revision,
      now,
    );
    assert.equal(runtime.items[0].nextAtMs, now + 300001, "save preserves live snooze deadline");
  }
  console.log(
    JSON.stringify(
      {
        app,
        scope:
          "actual checkout or installed source and dependencies; real independent processes/private filesystem only",
        cases: rows,
      },
      null,
      2,
    ),
  );
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await childDone.catch(() => {});
  }
  fs.rmSync(temp, { recursive: true, force: true });
}
