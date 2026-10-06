/** Fresh Node processes exercise real queue publication; no media decoding claim. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MusicQueueStore } from "./queue-store";

const phase = process.argv.find((arg) => arg.startsWith("--phase="))?.slice(8);
const fixture = process.argv.find((arg) => arg.startsWith("--fixture="))?.slice(10);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function track(directory, name) {
  const file = path.join(directory, name);
  return {
    id: hash(file),
    path: file,
    title: name,
    artist: "Private fixture",
    album: "Queue",
    year: "2026",
    number: 1,
    duration: 20,
    addedAt: 1,
  };
}
function runPhase(directory, step) {
  const store = new MusicQueueStore(path.join(directory, "data"));
  switch (step) {
    case "seed": {
      const a = track(directory, "a.flac"),
        b = track(directory, "b.flac");
      fs.writeFileSync(a.path, "fixture A (not decoded)");
      fs.writeFileSync(b.path, "fixture B (not decoded)");
      store.save({
        entries: [
          { id: "first-a", track: a },
          { id: "second-a", track: a },
          { id: "third-b", track: b },
        ],
        currentEntryId: "second-a",
        position: 3.25,
        revision: null,
      });
      break;
    }
    case "reopen": {
      const saved = store.load();
      assert.deepEqual(
        saved.entries.map((entry) => entry.id),
        ["first-a", "second-a", "third-b"],
      );
      assert.equal(saved.entries[0].track.id, saved.entries[1].track.id);
      assert.equal(saved.currentEntryId, "second-a");
      assert.equal(saved.position, 3.25);
      assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
      fs.writeFileSync(path.join(directory, "stale.json"), JSON.stringify(saved));
      break;
    }
    case "newer":
      store.save({ ...store.load(), position: 7.5 });
      break;
    case "stale": {
      const before = fs.readFileSync(store.file);
      const stale = JSON.parse(fs.readFileSync(path.join(directory, "stale.json"), "utf8"));
      assert.throws(() => store.save({ ...stale, position: 1 }), /changed|conflict/i);
      assert.deepEqual(fs.readFileSync(store.file), before);
      assert.equal(store.load().position, 7.5);
      break;
    }
    case "publication-fault": {
      const before = fs.readFileSync(store.file),
        saved = store.load();
      const rename = fs.renameSync;
      fs.renameSync = (source, target) => {
        if (target === store.file)
          throw Object.assign(new Error("private prepublication fixture"), { code: "EIO" });
        return rename(source, target);
      };
      try {
        assert.throws(() => store.save({ ...saved, position: 2 }), /prepublication/);
      } finally {
        fs.renameSync = rename;
      }
      assert.deepEqual(fs.readFileSync(store.file), before);
      assert.equal(store.load().position, 7.5);
      break;
    }
    case "malformed": {
      const before = fs.readFileSync(store.file);
      const malformed = Buffer.from('[{"version":1,"entries":"invalid"}]');
      fs.writeFileSync(store.file, malformed);
      try {
        assert.throws(() => store.load(), /invalid/);
        assert.throws(
          () => store.save({ entries: [], currentEntryId: null, position: 0, revision: null }),
          /invalid/,
        );
        assert.deepEqual(fs.readFileSync(store.file), malformed);
      } finally {
        fs.writeFileSync(store.file, before);
      }
      break;
    }
    case "missing": {
      fs.unlinkSync(path.join(directory, "a.flac"));
      const saved = store.load();
      assert.equal(saved.entries.length, 3);
      assert.equal(saved.currentEntryId, "second-a");
      assert.equal(saved.position, 7.5);
      assert.equal(
        fs.readFileSync(path.join(directory, "b.flac"), "utf8"),
        "fixture B (not decoded)",
      );
      break;
    }
    default:
      throw new Error(`Unknown child phase ${step}`);
  }
  process.stdout.write(`${JSON.stringify({ phase: step, pid: process.pid, actualCode: 0 })}\n`);
}
if (phase) {
  assert.ok(fixture && path.isAbsolute(fixture));
  runPhase(fixture, phase);
} else {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-music-queue-process-"));
  const phases = ["seed", "reopen", "newer", "stale", "publication-fault", "malformed", "missing"];
  const pids = new Set();
  try {
    for (const step of phases) {
      const result = spawnSync(
        process.execPath,
        [
          ...process.execArgv,
          fileURLToPath(import.meta.url),
          `--phase=${step}`,
          `--fixture=${directory}`,
        ],
        {
          encoding: "utf8",
          timeout: 15000,
          env: {
            ...process.env,
            HOME: directory,
            XDG_DATA_HOME: path.join(directory, "xdg"),
            XDG_CONFIG_HOME: path.join(directory, "config"),
            TMPDIR: directory,
          },
        },
      );
      assert.equal(result.error, undefined, `${step}: ${result.error}`);
      assert.equal(result.status, 0, `${step}: ${result.stderr}\n${result.stdout}`);
      const receipt = JSON.parse(result.stdout.trim());
      assert.equal(receipt.phase, step);
      assert.equal(receipt.actualCode, 0);
      pids.add(receipt.pid);
    }
    assert.equal(pids.size, phases.length, "every checkpoint is a fresh process");
    process.stdout.write(
      `${JSON.stringify({ actualCode: 0, phases: phases.length, independentProcesses: pids.size, scope: "private filesystem and fresh processes; no media decode" })}\n`,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
