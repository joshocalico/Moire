/**
 * Sound devices, the default input and app streams against the fake PipeWire: listing, choosing
 * defaults, input volume and mute, per-app volume and mute, stale targets, names cleaned, and
 * PipeWire missing. Behaviour carried over from the wpctl/pactl adapter's smoke.
 */
import assert from "node:assert/strict";
import {
  createAudioDevicesAdapter,
  type AudioDevicesReady,
  type AudioDevicesStatus,
} from "./audio-devices";
import { AudioControl } from "./control";
import { FakePipeWireServer } from "./testing";

let cases = 0;
async function test(label: string, check: () => Promise<void>) {
  await check();
  console.log(`ok ${++cases} ${label}`);
}
function ready(status: AudioDevicesStatus): AudioDevicesReady {
  assert.equal(status.kind, "ready", JSON.stringify(status));
  return status as AudioDevicesReady;
}
async function world(check: (fake: FakePipeWireServer, control: AudioControl) => Promise<void>) {
  const fake = FakePipeWireServer.standard(await FakePipeWireServer.start());
  const control = new AudioControl({ socketPath: fake.path });
  try {
    await check(fake, control);
  } finally {
    control.close();
    await fake.close();
  }
}
const rounded = (value: number) => Math.round(value * 1000) / 1000;

await test("lists, default input level, per-app volume; recording streams left out", () =>
  world(async (_fake, control) => {
    const adapter = createAudioDevicesAdapter({ control });
    const state = ready(await adapter.refresh());
    assert.equal(state.backend, "pipewire");
    assert.deepEqual(state.outputs, [
      { id: "52", name: "Speakers", isDefault: true },
      { id: "61", name: "Headset", isDefault: false },
    ]);
    assert.deepEqual(state.inputs, [
      { id: "53", name: "Microphone", isDefault: true },
      { id: "62", name: "Headset Microphone", isDefault: false },
    ]);
    assert.deepEqual(
      { ...state.input!, volume: rounded(state.input!.volume) },
      { id: "53", volume: 1, muted: false },
    );
    assert.deepEqual(
      state.streams.map((stream) => ({ ...stream, volume: rounded(stream.volume) })),
      [{ id: "74", app: "Firefox", title: "YouTube", volume: 0.9, muted: false }],
    );
    adapter.dispose();
  }));

await test("choosing defaults, input volume and mute, app volume and mute", () =>
  world(async (fake, control) => {
    const adapter = createAudioDevicesAdapter({ control });
    await adapter.refresh();
    let state = ready(await adapter.setDefault("output", "61"));
    assert.equal(state.outputs.find((item) => item.isDefault)?.id, "61");
    state = ready(await adapter.setDefault("input", "62"));
    assert.equal(state.input?.id, "62");
    assert.equal(state.input?.muted, true);
    state = ready(await adapter.setInputMute(false));
    assert.equal(state.input?.muted, false);
    state = ready(await adapter.setInputVolume(0.25));
    assert.equal(rounded(state.input!.volume), 0.25);
    state = ready(await adapter.setStreamVolume("74", 0.5));
    assert.equal(rounded(state.streams[0]!.volume), 0.5);
    state = ready(await adapter.setStreamMute("74", true));
    assert.equal(state.streams[0]!.muted, true);
    assert.deepEqual(fake.calls, [
      'metadata default.configured.audio.sink {"name":"bluez_output.headset"}',
      'metadata default.configured.audio.source {"name":"bluez_input.headset"}',
      "node 62 props mute false",
      "node 62 props volume 0.25x1",
      "node 74 props volume 0.5x2",
      "node 74 props mute true",
    ]);
    adapter.dispose();
  }));

await test("a gone target or a bad value is an error value; the list stays ready", () =>
  world(async (fake, control) => {
    const adapter = createAudioDevicesAdapter({ control });
    await adapter.refresh();
    fake.remove(74);
    const gone = await adapter.setStreamVolume("74", 0.5);
    assert.deepEqual(gone, { kind: "error", message: "That app stopped playing." });
    assert.equal(adapter.state.kind, "ready", "the list is re-read, not replaced by the error");
    assert.equal(ready(adapter.state).streams.length, 0);
    assert.deepEqual(await adapter.setDefault("output", "99"), {
      kind: "error",
      message: "That output is no longer connected.",
    });
    assert.deepEqual(await adapter.setInputVolume(2), {
      kind: "error",
      message: "Volume must be between 0 and 1.",
    });
    assert.deepEqual(fake.calls, []);
    adapter.dispose();
  }));

await test("names are cleaned and bounded; nameless apps get a fallback", () =>
  world(async (fake, control) => {
    fake.addNode(80, "x", "Stream/Output/Audio", "", {
      extra: { "application.name": "Bad\u0007Name\u001b " + "z".repeat(400) },
    });
    fake.addNode(81, "", "Stream/Output/Audio", "");
    const adapter = createAudioDevicesAdapter({ control });
    const state = ready(await adapter.refresh());
    const bad = state.streams.find((item) => item.id === "80")!;
    assert.ok(![...bad.app].some((c) => c.charCodeAt(0) < 32));
    assert.equal(bad.app.length, 256);
    assert.equal(state.streams.find((item) => item.id === "81")!.app, "App 81");
    adapter.dispose();
  }));

await test("PipeWire missing is unavailable, not an error", async () => {
  const adapter = createAudioDevicesAdapter({
    control: new AudioControl({ socketPath: "/nonexistent/pipewire-0" }),
  });
  const state = await adapter.refresh();
  assert.equal(state.kind, "unavailable");
  adapter.dispose();
  assert.deepEqual(await adapter.refresh(), { kind: "error", message: "Audio adapter is closed." });
});

console.log(`Audio devices: ${cases} cases passed against the fake PipeWire.`);
