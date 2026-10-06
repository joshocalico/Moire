import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createAudioStatusAdapter,
  executeAudioCommand,
  type AudioCommandExecutor,
  type AudioCommandResult,
  type AudioReady,
  type AudioStatus,
} from "./audio-status";

function ready(status: AudioStatus): AudioReady {
  assert.equal(status.kind, "ready", JSON.stringify(status));
  if (status.kind !== "ready") throw new Error("Expected ready audio state.");
  return status;
}
function reason(status: AudioStatus, expected: string) {
  assert.equal(status.kind, "error", JSON.stringify(status));
  if (status.kind === "error") assert.equal(status.reason, expected);
}
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-audio-status-"));
let cases = 0;
async function test(label: string, check: () => Promise<void>) {
  await check();
  cases++;
  console.log(`ok ${cases} ${label}`);
}

function backendFixture(backend: "wpctl" | "pactl" = "wpctl") {
  const calls: string[][] = [];
  const device = {
    id: "42",
    serial: "100",
    name: "alsa_output.test",
    description: "Test speakers",
    volume: 0.7,
    muted: false,
  };
  let intercept: ((args: readonly string[]) => AudioCommandResult | undefined) | undefined;
  const execute: AudioCommandExecutor = async (command, args, signal) => {
    calls.push([command, ...args]);
    if (signal.aborted) return { kind: "cancelled" };
    if (command !== backend) return { kind: "missing" };
    const intercepted = intercept?.(args);
    if (intercepted) return intercepted;
    switch (args[0]) {
      case "inspect":
        return {
          kind: "ok",
          stdout: `id ${device.id}, type PipeWire:Interface:Node\n  * media.class = "Audio/Sink"\n    node.name = "${device.name}"\n    node.description = "${device.description}"\n  * object.serial = "${device.serial}"\n`,
        };
      case "get-volume":
        assert.equal(args[1], device.id);
        return {
          kind: "ok",
          stdout: `Volume: ${device.volume.toFixed(2)}${device.muted ? " [MUTED]" : ""}\n`,
        };
      case "get-default-sink":
        return { kind: "ok", stdout: `${device.name}\n` };
      case "--format=json":
        return {
          kind: "ok",
          stdout: JSON.stringify([
            { index: Number(device.id), name: device.name, description: device.description },
          ]),
        };
      case "get-sink-volume":
        assert.equal(args[1], device.id);
        return {
          kind: "ok",
          stdout: `Volume: front-left: 32768 / ${Math.round(device.volume * 100)}% / -6.00 dB, front-right: 32768 / ${Math.round(device.volume * 100)}% / -6.00 dB\n`,
        };
      case "get-sink-mute":
        assert.equal(args[1], device.id);
        return { kind: "ok", stdout: `Mute: ${device.muted ? "yes" : "no"}\n` };
      case "set-volume":
      case "set-sink-volume":
        assert.equal(args[1], device.id);
        device.volume = Number(args[2]?.replace("%", "")) / 100;
        return { kind: "ok", stdout: "" };
      case "set-mute":
      case "set-sink-mute":
        assert.equal(args[1], device.id);
        device.muted = args[2] === "1";
        return { kind: "ok", stdout: "" };
      default:
        throw new Error(`Unexpected command ${command} ${args.join(" ")}`);
    }
  };
  return {
    device,
    calls,
    execute,
    intercept(value: typeof intercept) {
      intercept = value;
    },
  };
}

try {
  await test("wpctl observed description, amplified volume, separate mute and post-write readback", async () => {
    const fixture = backendFixture();
    fixture.device.volume = 1.25;
    fixture.device.muted = true;
    const adapter = createAudioStatusAdapter({ execute: fixture.execute });
    assert.equal(adapter.state.kind, "loading");
    const states: string[] = [];
    const unsubscribe = adapter.subscribe((state) => states.push(state.kind));
    const first = ready(await adapter.refresh());
    assert.equal(first.volume, 1.25);
    assert.equal(first.muted, true);
    assert.equal(first.sink.description, "Test speakers");
    const changed = ready(await adapter.setVolume(first, 0.33));
    assert.equal(changed.volume, 0.33);
    assert.equal(changed.muted, true, "changing volume must not invent unmuted state");
    const unmuted = ready(await adapter.setMute(changed, false));
    assert.equal(unmuted.muted, false);
    assert.equal(unmuted.volume, 0.33);
    assert.deepEqual(states, ["ready", "loading", "ready", "loading", "ready"]);
    assert(fixture.calls.some((call) => call.join(" ") === "wpctl set-volume 42 33%"));
    assert(fixture.calls.some((call) => call.join(" ") === "wpctl set-mute 42 0"));
    unsubscribe();
    adapter.dispose();
  });
  await test("unchanged wpctl and pactl polling preserves ready identity without events", async () => {
    for (const backend of ["wpctl", "pactl"] as const) {
      const fixture = backendFixture(backend);
      const adapter = createAudioStatusAdapter({ execute: fixture.execute });
      assert.equal(adapter.state.kind, "loading", "initial discovery remains loading");
      const first = ready(await adapter.refresh());
      const events: AudioStatus[] = [];
      adapter.subscribe((state) => events.push(state));
      for (let poll = 0; poll < 20; poll++) {
        assert.equal(await adapter.refresh(), first);
        assert.equal(adapter.state, first);
      }
      assert.equal(events.length, 0);
      assert(Object.isFrozen(first));
      const changed = ready(await adapter.setVolume(first, 0.35));
      assert.equal(changed.volume, 0.35, "retained unchanged observation is still actionable");
      assert.notEqual(changed, first);
      assert.deepEqual(
        events.map((state) => state.kind),
        ["loading", "ready"],
      );
      assert.equal(await adapter.refresh(), changed);
      assert.equal(events.length, 2);
      adapter.dispose();
    }
  });
  await test("each actual observed sink field, volume and mute change publishes once", async () => {
    const fixture = backendFixture();
    const adapter = createAudioStatusAdapter({ execute: fixture.execute });
    let previous = ready(await adapter.refresh());
    const events: AudioStatus[] = [];
    adapter.subscribe((state) => events.push(state));
    const changes = [
      () => {
        fixture.device.volume = 1.25;
      },
      () => {
        fixture.device.muted = true;
      },
      () => {
        fixture.device.description = "Renamed speakers";
      },
      () => {
        fixture.device.serial = "101";
      },
      () => {
        fixture.device.id = "43";
      },
      () => {
        fixture.device.name = "usb_output.test";
      },
    ];
    for (const change of changes) {
      change();
      const next = ready(await adapter.refresh());
      assert.notEqual(next, previous);
      assert.equal(events.at(-1), next);
      const count = events.length;
      assert.equal(await adapter.refresh(), next);
      assert.equal(events.length, count);
      reason(await adapter.setMute(previous, false), "stale");
      assert.equal(adapter.state, next);
      previous = next;
    }
    assert.equal(events.length, changes.length);
    assert(events.every((state) => state.kind === "ready"));
    adapter.dispose();
  });
  await test("backend replacement with equal displayed facts is a new observation", async () => {
    const wpctl = backendFixture(),
      pactl = backendFixture("pactl");
    let backend: "wpctl" | "pactl" = "wpctl";
    const adapter = createAudioStatusAdapter({
      execute: (command, args, signal) =>
        (backend === "wpctl" ? wpctl : pactl).execute(command, args, signal),
    });
    const first = ready(await adapter.refresh());
    const events: AudioStatus[] = [];
    adapter.subscribe((state) => events.push(state));
    backend = "pactl";
    const replacement = ready(await adapter.refresh());
    assert.equal(replacement.volume, first.volume);
    assert.equal(replacement.muted, first.muted);
    assert.equal(replacement.sink.description, first.sink.description);
    assert.equal(replacement.sink.backend, "pactl");
    assert.notEqual(replacement, first);
    assert.deepEqual(events, [replacement]);
    assert.equal(await adapter.refresh(), replacement);
    assert.equal(events.length, 1);
    reason(await adapter.setVolume(first, 0.4), "stale");
    adapter.dispose();
  });
  await test("unchanged unavailable and errors are quiet; failure changes and recovery publish", async () => {
    const fixture = backendFixture();
    let outcome: "missing" | "failed" | "timeout" | "ready" = "missing";
    let message = "Read failed";
    const adapter = createAudioStatusAdapter({
      execute: (command, args, signal) => {
        if (outcome === "ready") return fixture.execute(command, args, signal);
        return Promise.resolve(
          outcome === "failed" ? { kind: "failed", message, exitCode: 1 } : { kind: outcome },
        );
      },
    });
    const events: AudioStatus[] = [];
    adapter.subscribe((state) => events.push(state));
    const unavailable = await adapter.refresh();
    assert.equal(unavailable.kind, "unavailable");
    for (let poll = 0; poll < 10; poll++) assert.equal(await adapter.refresh(), unavailable);
    assert.deepEqual(events, [unavailable]);
    outcome = "failed";
    const failure = await adapter.refresh();
    reason(failure, "command");
    for (let poll = 0; poll < 10; poll++) assert.equal(await adapter.refresh(), failure);
    assert.equal(events.length, 2);
    message = "Changed failure";
    const changedFailure = await adapter.refresh();
    assert.notEqual(changedFailure, failure);
    assert.equal(events.length, 3);
    outcome = "timeout";
    reason(await adapter.refresh(), "command");
    assert.equal(events.length, 4);
    outcome = "ready";
    const recovered = ready(await adapter.refresh());
    assert.equal(events.length, 5);
    assert.equal(await adapter.refresh(), recovered);
    assert.equal(events.length, 5);
    adapter.dispose();
    const count = events.length;
    reason(await adapter.refresh(), "disposed");
    assert.equal(events.length, count);
  });
  await test("pending background read keeps observation; mutation supersedes its late completion", async () => {
    const fixture = backendFixture();
    let hold = false,
      release: ((result: AudioCommandResult) => void) | undefined;
    const adapter = createAudioStatusAdapter({
      execute: (command, args, signal) => {
        if (hold) {
          hold = false;
          return new Promise((resolve) => {
            release = resolve;
          });
        }
        return fixture.execute(command, args, signal);
      },
    });
    const first = ready(await adapter.refresh());
    const events: AudioStatus[] = [];
    adapter.subscribe((state) => events.push(state));
    hold = true;
    const pending = adapter.refresh();
    assert.equal(adapter.state, first);
    assert.equal(events.length, 0);
    const updated = ready(await adapter.setVolume(first, 0.52));
    assert.equal(updated.volume, 0.52);
    assert.deepEqual(
      events.map((state) => state.kind),
      ["loading", "ready"],
    );
    assert(release);
    release({ kind: "ok", stdout: "late malformed observation" });
    assert.equal(await pending, updated);
    assert.equal(adapter.state, updated);
    assert.equal(events.length, 2);
    adapter.dispose();
  });
  await test("missing tools unavailable without guessed volume", async () => {
    const adapter = createAudioStatusAdapter({ execute: async () => ({ kind: "missing" }) });
    assert.equal((await adapter.refresh()).kind, "unavailable");
    assert(!("volume" in adapter.state));
    adapter.dispose();
  });
  await test("pactl fallback reads all channels and mute, writes explicit numeric sink", async () => {
    const fixture = backendFixture("pactl");
    fixture.intercept((args) =>
      args[0] === "get-sink-volume"
        ? {
            kind: "ok",
            stdout:
              "Volume: front-left: 32768 / 50% / -6.00 dB, front-right: 49152 / 75% / -2.50 dB\n",
          }
        : undefined,
    );
    const adapter = createAudioStatusAdapter({ execute: fixture.execute });
    const first = ready(await adapter.refresh());
    assert.equal(first.volume, 0.75);
    assert.equal(first.sink.backend, "pactl");
    const muted = ready(await adapter.setMute(first, true));
    assert.equal(muted.muted, true);
    fixture.intercept(undefined);
    assert.equal(ready(await adapter.setVolume(muted, 0.4)).volume, 0.4);
    assert(fixture.calls.some((call) => call.join(" ") === "pactl set-sink-volume 42 40%"));
    adapter.dispose();
  });
  await test("wpctl connection failure permits real pactl fallback", async () => {
    const fixture = backendFixture("pactl");
    const adapter = createAudioStatusAdapter({
      execute: (command, args, signal) =>
        command === "wpctl"
          ? Promise.resolve({
              kind: "failed",
              exitCode: 2,
              message: "Could not connect to PipeWire",
            })
          : fixture.execute(command, args, signal),
    });
    assert.equal(ready(await adapter.refresh()).sink.backend, "pactl");
    adapter.dispose();
  });
  await test("missing default unavailable with backend diagnostic", async () => {
    const adapter = createAudioStatusAdapter({
      execute: async (command) =>
        command === "wpctl"
          ? { kind: "failed", exitCode: 3, message: "Object not found" }
          : { kind: "missing" },
    });
    const actual = await adapter.refresh();
    assert.equal(actual.kind, "unavailable");
    if (actual.kind === "unavailable") assert.match(actual.message, /Object not found/);
    adapter.dispose();
  });
  await test("malformed volume is an error, not ready NaN", async () => {
    const fixture = backendFixture();
    fixture.intercept((args) =>
      args[0] === "get-volume" ? { kind: "ok", stdout: "Volume: 0..5 [MUTED]" } : undefined,
    );
    const adapter = createAudioStatusAdapter({ execute: fixture.execute });
    reason(await adapter.refresh(), "invalid-output");
    adapter.dispose();
  });
  await test("pactl malformed mute and ambiguous metadata fail boundary", async () => {
    const fixture = backendFixture("pactl");
    const adapter = createAudioStatusAdapter({ execute: fixture.execute });
    fixture.intercept((args) =>
      args[0] === "get-sink-mute" ? { kind: "ok", stdout: "Mute: maybe" } : undefined,
    );
    reason(await adapter.refresh(), "invalid-output");
    fixture.intercept((args) =>
      args[0] === "--format=json"
        ? {
            kind: "ok",
            stdout:
              '[{"index":42,"name":"alsa_output.test"},{"index":43,"name":"alsa_output.test"}]',
          }
        : undefined,
    );
    reason(await adapter.refresh(), "invalid-output");
    adapter.dispose();
  });
  await test("default changes during read never produce ready mixed device data", async () => {
    const fixture = backendFixture();
    fixture.intercept((args) => {
      if (args[0] === "get-volume") fixture.device.serial = "101";
      return undefined;
    });
    const adapter = createAudioStatusAdapter({ execute: fixture.execute });
    reason(await adapter.refresh(), "default-changed");
    adapter.dispose();
  });
  await test("partial malformed channel information cannot hide behind one valid channel", async () => {
    const fixture = backendFixture("pactl");
    fixture.intercept((args) =>
      args[0] === "get-sink-volume"
        ? {
            kind: "ok",
            stdout:
              "Volume: front-left: 32768 / 50% / -6.00 dB, front-right: 0 / unknown / -inf dB\n",
          }
        : undefined,
    );
    const adapter = createAudioStatusAdapter({ execute: fixture.execute });
    reason(await adapter.refresh(), "invalid-output");
    adapter.dispose();
  });
  await test("ambiguous identity and oversized output cannot become ready", async () => {
    const fixture = backendFixture();
    const adapter = createAudioStatusAdapter({ execute: fixture.execute });
    fixture.intercept((args) =>
      args[0] === "inspect"
        ? {
            kind: "ok",
            stdout:
              'id 42, type PipeWire:Interface:Node\n media.class = "Audio/Sink"\n node.name = "one"\n node.name = "two"\n object.serial = "100"\n',
          }
        : undefined,
    );
    reason(await adapter.refresh(), "invalid-output");
    fixture.intercept(() => ({ kind: "ok", stdout: "x".repeat(64 * 1024 + 1) }));
    reason(await adapter.refresh(), "invalid-output");
    adapter.dispose();
  });
  await test("stale retained UI action cannot write or replace newer state", async () => {
    const fixture = backendFixture();
    const adapter = createAudioStatusAdapter({ execute: fixture.execute });
    const old = ready(await adapter.refresh());
    fixture.device.id = "43";
    fixture.device.name = "usb_output.test";
    const newer = ready(await adapter.refresh());
    const count = fixture.calls.length;
    reason(await adapter.setVolume(old, 0.1), "stale");
    assert.equal(fixture.calls.length, count);
    assert.equal(adapter.state, newer);
    adapter.dispose();
  });
  await test("default changes before action suppress mutation", async () => {
    const fixture = backendFixture();
    const adapter = createAudioStatusAdapter({ execute: fixture.execute });
    const first = ready(await adapter.refresh());
    fixture.device.serial = "102";
    reason(await adapter.setMute(first, true), "default-changed");
    assert(!fixture.calls.some((call) => call[1] === "set-mute"));
    adapter.dispose();
  });
  await test("set success followed by changed default cannot claim new default adjusted", async () => {
    const fixture = backendFixture();
    const adapter = createAudioStatusAdapter({ execute: fixture.execute });
    const first = ready(await adapter.refresh());
    fixture.intercept((args) => {
      if (args[0] === "set-volume") {
        fixture.device.volume = 0.2;
        fixture.device.serial = "104";
        return { kind: "ok", stdout: "" };
      }
      return undefined;
    });
    reason(await adapter.setVolume(first, 0.2), "default-changed");
    adapter.dispose();
  });
  await test("set failure and failed readback never return optimistic values", async () => {
    const fixture = backendFixture();
    const adapter = createAudioStatusAdapter({ execute: fixture.execute });
    const first = ready(await adapter.refresh());
    fixture.intercept((args) =>
      args[0] === "set-volume"
        ? { kind: "failed", exitCode: 1, message: "Permission denied" }
        : undefined,
    );
    reason(await adapter.setVolume(first, 0.2), "command");
    assert(!("volume" in adapter.state));
    fixture.intercept(undefined);
    const second = ready(await adapter.refresh());
    fixture.intercept((args) => (args[0] === "get-volume" ? { kind: "timeout" } : undefined));
    reason(await adapter.setMute(second, true), "command");
    assert.equal(fixture.device.muted, true, "actual write can occur before readback error");
    adapter.dispose();
  });
  await test("successful command acknowledgment does not substitute requested values for readback", async () => {
    const fixture = backendFixture();
    const adapter = createAudioStatusAdapter({ execute: fixture.execute });
    const first = ready(await adapter.refresh());
    fixture.intercept((args) =>
      args[0] === "set-volume" || args[0] === "set-mute" ? { kind: "ok", stdout: "" } : undefined,
    );
    const unchangedVolume = ready(await adapter.setVolume(first, 0.1));
    assert.equal(unchangedVolume.volume, 0.7);
    const unchangedMute = ready(await adapter.setMute(unchangedVolume, true));
    assert.equal(unchangedMute.muted, false);
    adapter.dispose();
  });
  await test("invalid public values do not spawn or poison current readback", async () => {
    const fixture = backendFixture();
    const adapter = createAudioStatusAdapter({ execute: fixture.execute });
    const first = ready(await adapter.refresh());
    const count = fixture.calls.length;
    for (const value of [NaN, Infinity, -0.1, 1.1])
      reason(await adapter.setVolume(first, value), "invalid-value");
    assert.equal(fixture.calls.length, count);
    assert.equal(adapter.state, first);
    adapter.dispose();
  });
  await test("cancelled request and late older completion cannot overwrite new observation", async () => {
    const fixture = backendFixture();
    let release: ((result: AudioCommandResult) => void) | undefined;
    let first = true;
    const adapter = createAudioStatusAdapter({
      execute: (command, args, signal) => {
        if (first) {
          first = false;
          return new Promise((resolve) => {
            release = resolve;
          });
        }
        return fixture.execute(command, args, signal);
      },
    });
    const older = adapter.refresh();
    const newest = ready(await adapter.refresh());
    assert(release);
    release({ kind: "ok", stdout: "late malformed result" });
    await older;
    assert.equal(adapter.state, newest);
    const controller = new AbortController();
    controller.abort();
    reason(await adapter.refresh(controller.signal), "cancelled");
    adapter.dispose();
    reason(await adapter.refresh(), "disposed");
  });
  await test("real children preserve exact args/session environment and classify missing/nonzero", async () => {
    const script = path.join(directory, "arguments.mjs");
    fs.writeFileSync(
      script,
      "console.log(JSON.stringify({args:process.argv.slice(2), locale:process.env.LC_ALL, session:process.env.MOIRE_TEST_AUDIO_SESSION}));",
    );
    const previous = process.env.MOIRE_TEST_AUDIO_SESSION;
    process.env.MOIRE_TEST_AUDIO_SESSION = "inherited-session";
    try {
      const result = await executeAudioCommand(
        process.execPath,
        [script, "$(touch must-not-exist)", "a 'quoted' sink"],
        new AbortController().signal,
      );
      assert.equal(result.kind, "ok");
      if (result.kind === "ok")
        assert.deepEqual(JSON.parse(result.stdout), {
          args: ["$(touch must-not-exist)", "a 'quoted' sink"],
          locale: "C",
          session: "inherited-session",
        });
      assert.equal(
        (
          await executeAudioCommand(
            path.join(directory, "missing"),
            [],
            new AbortController().signal,
          )
        ).kind,
        "missing",
      );
      const failed = await executeAudioCommand(
        process.execPath,
        ["-e", "process.stderr.write('exact failure'); process.exit(23)"],
        new AbortController().signal,
      );
      assert.equal(failed.kind, "failed");
      if (failed.kind === "failed") {
        assert.equal(failed.exitCode, 23);
        assert.equal(failed.message, "exact failure");
      }
    } finally {
      if (previous === undefined) delete process.env.MOIRE_TEST_AUDIO_SESSION;
      else process.env.MOIRE_TEST_AUDIO_SESSION = previous;
    }
  });
  await test("real hung subprocess deadline and output limit", async () => {
    const pidFile = path.join(directory, "timeout.pid");
    const script = path.join(directory, "hang.mjs");
    fs.writeFileSync(
      script,
      'import fs from "node:fs"; fs.writeFileSync(process.argv[2],String(process.pid)); setInterval(()=>{},1000);',
    );
    const started = performance.now();
    assert.equal(
      (await executeAudioCommand(process.execPath, [script, pidFile], new AbortController().signal))
        .kind,
      "timeout",
    );
    assert(performance.now() - started < 5000);
    assert.throws(() => process.kill(Number(fs.readFileSync(pidFile, "utf8")), 0), /ESRCH/);
    assert.equal(
      (
        await executeAudioCommand(
          process.execPath,
          ["-e", "process.stdout.write('x'.repeat(256*1024)); setInterval(()=>{},1000)"],
          new AbortController().signal,
        )
      ).kind,
      "output-limit",
    );
  });
  await test("real subprocess cancellation retires child", async () => {
    const pidFile = path.join(directory, "abort.pid");
    const controller = new AbortController();
    const result = executeAudioCommand(
      process.execPath,
      [path.join(directory, "hang.mjs"), pidFile],
      controller.signal,
    );
    const deadline = performance.now() + 1000;
    while (!fs.existsSync(pidFile) && performance.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert(fs.existsSync(pidFile));
    controller.abort();
    assert.equal((await result).kind, "cancelled");
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    const exitDeadline = performance.now() + 1000;
    let live = true;
    while (live && performance.now() < exitDeadline) {
      try {
        process.kill(pid, 0);
        await new Promise((resolve) => setTimeout(resolve, 5));
      } catch {
        live = false;
      }
    }
    assert.equal(live, false);
  });
  await test("actual CLI child protocol changes disk state and readback sees external actor", async () => {
    const stateFile = path.join(directory, "audio.json");
    fs.writeFileSync(stateFile, JSON.stringify({ volume: 0.65, muted: false }));
    const script = path.join(directory, "wpctl-fixture.mjs");
    fs.writeFileSync(
      script,
      `import fs from "node:fs";
const file=process.argv[2];const args=process.argv.slice(3);const state=JSON.parse(fs.readFileSync(file,'utf8'));
switch(args[0]){
case 'inspect': console.log('id 72, type PipeWire:Interface:Node\\n  * media.class = "Audio/Sink"\\n    node.name = "fixture.speakers"\\n    node.description = "Fixture speakers"\\n  * object.serial = "721"');break;
case 'get-volume': if(args[1]!=='72')process.exit(3);console.log('Volume: '+state.volume.toFixed(2)+(state.muted?' [MUTED]':''));break;
case 'set-volume': state.volume=Number(args[2].replace('%',''))/100;fs.writeFileSync(file,JSON.stringify(state));break;
case 'set-mute': state.muted=args[2]==='1';fs.writeFileSync(file,JSON.stringify(state));break;
default:process.exit(23);
}`,
    );
    const execute: AudioCommandExecutor = (command, args, signal) =>
      command === "wpctl"
        ? executeAudioCommand(process.execPath, [script, stateFile, ...args], signal)
        : Promise.resolve({ kind: "missing" });
    const adapter = createAudioStatusAdapter({ execute });
    const first = ready(await adapter.refresh());
    assert.equal(first.volume, 0.65);
    const second = ready(await adapter.setVolume(first, 0.35));
    assert.equal(second.volume, 0.35);
    const third = ready(await adapter.setMute(second, true));
    assert.equal(third.muted, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(stateFile, "utf8")), { volume: 0.35, muted: true });
    fs.writeFileSync(stateFile, JSON.stringify({ volume: 0.81, muted: false }));
    const external = ready(await adapter.refresh());
    assert.equal(external.volume, 0.81);
    assert.equal(external.muted, false);
    adapter.dispose();
  });
  if (process.env.MOIRE_TEST_LIVE_AUDIO === "1") {
    await test("opt-in actual audio tools default readback only", async () => {
      const adapter = createAudioStatusAdapter();
      const actual = await adapter.refresh();
      console.log(JSON.stringify({ actualAudioReadback: actual }));
      assert.equal(
        actual.kind,
        "ready",
        "opt-in live gate requires actual available server/default sink",
      );
      adapter.dispose();
    });
  }
  console.log(
    `Audio status: ${cases} cases passed. Live audio ${process.env.MOIRE_TEST_LIVE_AUDIO === "1" ? "readback exercised" : "not exercised"}.`,
  );
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
