/**
 * The native-protocol client against the fake PipeWire over a real Unix socket: registry, info
 * and params, cubic volume, device Route vs node Props writes, mute, defaults through metadata,
 * profiles, per-app streams, removal and id reuse, ping/pong, refusals, deadlines, aborts, a
 * missing server and reconnection after PipeWire restarts.
 */
import assert from "node:assert/strict";
import { AudioControl, type AudioSnapshot } from "./control";
import { PipeWireError } from "./connection";
import { pipewireSocketPath } from "./transport";
import { FakePipeWireServer } from "./testing";

let cases = 0;
async function test(label: string, check: () => Promise<void>) {
  await check();
  console.log(`ok ${++cases} ${label}`);
}
const close = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-4;
const node = (snapshot: AudioSnapshot, id: number) => {
  const found = snapshot.nodes.find((item) => item.id === id);
  assert.ok(found, `node ${id}`);
  return found;
};
async function withServer(
  check: (fake: FakePipeWireServer, control: AudioControl) => Promise<void>,
  options: { wireplumber?: boolean; timeoutMs?: number } = {},
) {
  const fake = FakePipeWireServer.standard(await FakePipeWireServer.start(options));
  const control = new AudioControl({ socketPath: fake.path, timeoutMs: options.timeoutMs });
  try {
    await check(fake, control);
  } finally {
    control.close();
    await fake.close();
  }
}
async function rejects(promise: Promise<unknown>, kind: PipeWireError["kind"], pattern?: RegExp) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof PipeWireError, String(error));
    assert.equal(error.kind, kind, error.message);
    if (pattern) assert.match(error.message, pattern);
    return true;
  });
}

await test("read: sinks, sources, app streams, defaults, routes and profiles", () =>
  withServer(async (fake, control) => {
    const snapshot = await control.read();
    assert.deepEqual(
      snapshot.nodes.map((item) => [item.id, item.kind, item.description]),
      [
        [52, "sink", "Speakers"],
        [53, "source", "Microphone"],
        [61, "sink", "Headset"],
        [62, "source", "Headset Microphone"],
        [74, "playback", "Firefox"],
        [90, "capture", "pw-record"],
      ],
    );
    const speakers = node(snapshot, 52);
    assert.ok(close(speakers.volume, 0.4), "linear 0.064 is slider 0.4");
    assert.deepEqual(
      [speakers.muted, speakers.channels, speakers.deviceId, speakers.profileDevice],
      [false, 2, 40, 4],
    );
    assert.equal(speakers.serial, "1052");
    const firefox = node(snapshot, 74);
    assert.deepEqual([firefox.app, firefox.media], ["Firefox", "YouTube"]);
    assert.ok(close(firefox.volume, 0.9));
    assert.equal(node(snapshot, 62).muted, true);
    assert.equal(snapshot.defaultSink, "alsa_output.pci-0000_00_1f.3.analog-stereo");
    assert.equal(snapshot.defaultSource, "alsa_input.pci-0000_00_1f.3.analog-stereo");
    assert.equal(snapshot.hasDefaults, true);
    const [card] = snapshot.devices;
    assert.equal(card!.description, "Built-in Audio");
    assert.deepEqual(
      card!.routes.map((r) => [r.index, r.device, r.direction]),
      [
        [1, 4, "output"],
        [2, 5, "input"],
      ],
    );
    assert.deepEqual(
      card!.availableRoutes.map((r) => [r.description, r.available]),
      [
        ["Speakers", true],
        ["Headphones", false],
        ["Microphone", true],
      ],
    );
    assert.deepEqual([card!.profile, card!.profiles.length], [1, 2]);
    assert.equal(fake.clients.size, 1);
    const [client] = fake.clients;
    assert.equal(client!.props["application.name"], "Moire");
    // A second read reuses the connection and binds nothing new.
    await control.read();
    assert.equal(fake.clients.size, 1);
  }));

await test("volume: device-backed sink via its Route (saved), others via Props", () =>
  withServer(async (fake, control) => {
    let snapshot = await control.setVolume(52, 0.5);
    assert.ok(close(node(snapshot, 52).volume, 0.5));
    snapshot = await control.setVolume(61, 0.25);
    assert.ok(close(node(snapshot, 61).volume, 0.25));
    snapshot = await control.setVolume(53, 0.3);
    snapshot = await control.setVolume(74, 1);
    assert.ok(close(node(snapshot, 74).volume, 1));
    assert.deepEqual(fake.calls, [
      "device 40 route 1/4 volume 0.5x2 save",
      "node 61 props volume 0.25x2",
      "device 40 route 2/5 volume 0.3x1 save",
      "node 74 props volume 1x2",
    ]);
    assert.ok(
      Math.abs(fake.devices.get(40)!.routes[0]!.volumes[0]! - 0.125) < 1e-6,
      "cubic on the wire",
    );
    await rejects(control.setVolume(52, 1.5), "error", /between 0 and 1/);
  }));

await test("mute: route for devices, Props for streams; readback is the server's", () =>
  withServer(async (fake, control) => {
    let snapshot = await control.setMute(53, true);
    assert.equal(node(snapshot, 53).muted, true);
    snapshot = await control.setMute(62, false);
    assert.equal(node(snapshot, 62).muted, false);
    snapshot = await control.setMute(74, true);
    assert.equal(node(snapshot, 74).muted, true);
    assert.deepEqual(fake.calls, [
      "device 40 route 2/5 mute true save",
      "node 62 props mute false",
      "node 74 props mute true",
    ]);
  }));

await test("a stream that applies late is waited for, within the settle time", () =>
  withServer(async (fake, control) => {
    fake.nodes.get(74)!.applyDelayMs = 80;
    const snapshot = await control.setVolume(74, 0.5);
    assert.ok(close(node(snapshot, 74).volume, 0.5), "readback after the app applied it");
    fake.nodes.get(74)!.applyDelayMs = 5000;
    const stale = await control.setMute(74, true);
    assert.equal(node(stale, 74).muted, false, "never reports what was asked, only what was read");
  }));

await test("defaults: configured key with WirePlumber's JSON, effective default followed", () =>
  withServer(async (fake, control) => {
    fake.defaultDelayMs = 60;
    let snapshot = await control.setDefault("sink", 61);
    assert.equal(snapshot.defaultSink, "bluez_output.headset");
    snapshot = await control.setDefault("source", 62);
    assert.equal(snapshot.defaultSource, "bluez_input.headset");
    assert.deepEqual(fake.calls, [
      'metadata default.configured.audio.sink {"name":"bluez_output.headset"}',
      'metadata default.configured.audio.source {"name":"bluez_input.headset"}',
    ]);
    await rejects(control.setDefault("sink", 53), "error", /no longer connected/);
    await rejects(control.setDefault("sink", 999), "error", /no longer connected/);
  }));

await test("profiles: set and saved", () =>
  withServer(async (fake, control) => {
    const snapshot = await control.setProfile(40, 0);
    assert.equal(snapshot.devices[0]!.profile, 0);
    assert.deepEqual(fake.calls, ["device 40 profile 0"]);
    await rejects(control.setProfile(40, 7), "error", /not available/);
  }));

await test("removal: gone from reads, writes refused, ids reused densely", () =>
  withServer(async (fake, control) => {
    await control.read();
    fake.remove(74);
    let snapshot = await control.read();
    assert.equal(
      snapshot.nodes.some((item) => item.id === 74),
      false,
    );
    await rejects(control.setVolume(74, 0.5), "error", /gone/);
    // New globals bind on the freed id; the fake rejects any gap like PipeWire's map does.
    fake.addNode(80, "Music", "Stream/Output/Audio", "", {
      extra: { "application.name": "Music" },
    });
    fake.addNode(81, "Game", "Stream/Output/Audio", "", { extra: { "application.name": "Game" } });
    snapshot = await control.read();
    assert.deepEqual(
      snapshot.nodes.filter((item) => item.kind === "playback").map((item) => item.app),
      ["Music", "Game"],
    );
    snapshot = await control.setVolume(81, 0.5);
    assert.ok(close(node(snapshot, 81).volume, 0.5));
  }));

await test("ping is answered with pong", () =>
  withServer(async (fake, control) => {
    await control.read();
    fake.ping(77);
    await control.read();
    assert.deepEqual(fake.pongs(), [77]);
  }));

await test("refused writes, deadlines and aborts are errors, not hangs", () =>
  withServer(
    async (fake, control) => {
      await control.read();
      fake.refuse = "Operation not permitted";
      await rejects(
        control.setVolume(61, 0.5),
        "error",
        /refused the change: Operation not permitted/,
      );
      fake.refuse = null;
      const aborted = new AbortController();
      aborted.abort();
      await rejects(control.read(aborted.signal), "cancelled");
      const later = new AbortController();
      fake.hang = true;
      const pending = control.read(later.signal);
      setTimeout(() => later.abort(), 20);
      await rejects(pending, "cancelled");
      const started = performance.now();
      await rejects(control.read(), "timeout");
      assert.ok(performance.now() - started < 1000, "deadline honoured");
    },
    { timeoutMs: 150 },
  ));

await test("no WirePlumber: no defaults, choosing one is unavailable", () =>
  withServer(
    async (_fake, control) => {
      const snapshot = await control.read();
      assert.deepEqual([snapshot.hasDefaults, snapshot.defaultSink], [false, null]);
      await rejects(control.setDefault("sink", 61), "unavailable", /WirePlumber/);
    },
    { wireplumber: false },
  ));

await test("missing server is unavailable; a restarted one is reconnected", async () => {
  const missing = new AudioControl({ socketPath: "/nonexistent/pipewire-0" });
  await rejects(missing.read(), "unavailable", /isn't running/);
  missing.close();
  assert.equal(pipewireSocketPath({}), null);
  assert.equal(
    pipewireSocketPath({ XDG_RUNTIME_DIR: "/run/user/1000" }),
    "/run/user/1000/pipewire-0",
  );
  assert.equal(
    pipewireSocketPath({
      XDG_RUNTIME_DIR: "/run/user/1000",
      PIPEWIRE_RUNTIME_DIR: "/run/pw",
      PIPEWIRE_REMOTE: "pipewire-1",
    }),
    "/run/pw/pipewire-1",
  );
  assert.equal(pipewireSocketPath({ PIPEWIRE_REMOTE: "/tmp/pw.sock" }), "/tmp/pw.sock");
  await withServer(async (fake, control) => {
    await control.read();
    fake.dropConnections();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const snapshot = await control.read();
    assert.equal(snapshot.nodes.length, 6);
    assert.equal(fake.clients.size, 1);
  });
});

await test("closed control refuses work", async () => {
  const control = new AudioControl({ socketPath: "/nonexistent" });
  control.close();
  await rejects(control.read(), "error", /closed/);
});

console.log(`Audio control: ${cases} cases passed against the fake PipeWire.`);
