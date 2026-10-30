/**
 * The default-output adapter against the fake PipeWire: readback, publication only on change,
 * stale and default-changed protection, invalid values, cancellation, unavailability and
 * disposal. Behaviour carried over from the wpctl/pactl adapter's smoke.
 */
import assert from "node:assert/strict";
import { createAudioStatusAdapter, type AudioReady, type AudioStatus } from "./audio-status";
import { AudioControl } from "./control";
import { FakePipeWireServer } from "./testing";

let cases = 0;
async function test(label: string, check: () => Promise<void>) {
  await check();
  console.log(`ok ${++cases} ${label}`);
}
function ready(status: AudioStatus): AudioReady {
  assert.equal(status.kind, "ready", JSON.stringify(status));
  return status as AudioReady;
}
async function world(
  check: (fake: FakePipeWireServer, control: AudioControl) => Promise<void>,
  wireplumber = true,
) {
  const fake = FakePipeWireServer.standard(await FakePipeWireServer.start({ wireplumber }));
  const control = new AudioControl({ socketPath: fake.path, timeoutMs: 300 });
  try {
    await check(fake, control);
  } finally {
    control.close();
    await fake.close();
  }
}

await test("observed name, description, cubic volume, mute; writes read back", () =>
  world(async (fake, control) => {
    const adapter = createAudioStatusAdapter({ control });
    const first = ready(await adapter.refresh());
    assert.deepEqual(first.sink, {
      backend: "pipewire",
      id: "52",
      identity: "52:1052:alsa_output.pci-0000_00_1f.3.analog-stereo",
      name: "alsa_output.pci-0000_00_1f.3.analog-stereo",
      description: "Speakers",
    });
    assert.ok(Math.abs(first.volume - 0.4) < 1e-4);
    assert.equal(first.muted, false);
    const louder = ready(await adapter.setVolume(first, 0.33));
    assert.ok(Math.abs(louder.volume - 0.33) < 1e-4);
    const muted = ready(await adapter.setMute(louder, true));
    assert.equal(muted.muted, true);
    assert.deepEqual(fake.calls, [
      "device 40 route 1/4 volume 0.33x2 save",
      "device 40 route 1/4 mute true save",
    ]);
    adapter.dispose();
  }));

await test("amplified volume is reported as read, above 1", () =>
  world(async (fake, control) => {
    fake.nodes.get(52)!.volumes = [1.728, 1.728];
    const adapter = createAudioStatusAdapter({ control });
    assert.ok(Math.abs(ready(await adapter.refresh()).volume - 1.2) < 1e-4);
    adapter.dispose();
  }));

await test("unchanged polling keeps the same state object and publishes nothing", () =>
  world(async (fake, control) => {
    const adapter = createAudioStatusAdapter({ control });
    const published: AudioStatus[] = [];
    adapter.subscribe((state) => published.push(state));
    const first = await adapter.refresh();
    assert.equal(await adapter.refresh(), first);
    assert.equal(await adapter.refresh(), first);
    assert.equal(published.length, 1);
    fake.nodes.get(52)!.mute = true;
    assert.equal(ready(await adapter.refresh()).muted, true);
    assert.equal(published.length, 2);
    adapter.dispose();
  }));

await test("the default moving to another node is a new observation", () =>
  world(async (fake, control) => {
    const adapter = createAudioStatusAdapter({ control });
    const first = ready(await adapter.refresh());
    fake.setMetadata("default.audio.sink", JSON.stringify({ name: "bluez_output.headset" }));
    const second = ready(await adapter.refresh());
    assert.notEqual(second.sink.identity, first.sink.identity);
    assert.equal(second.sink.description, "Headset");
    adapter.dispose();
  }));

await test("a stale snapshot cannot write; a changed default suppresses the write", () =>
  world(async (fake, control) => {
    const adapter = createAudioStatusAdapter({ control });
    const first = ready(await adapter.refresh());
    fake.nodes.get(52)!.mute = true;
    await adapter.refresh();
    const stale = await adapter.setVolume(first, 0.9);
    assert.deepEqual(stale.kind === "error" && stale.reason, "stale");
    const current = ready(adapter.state);
    fake.setMetadata("default.audio.sink", JSON.stringify({ name: "bluez_output.headset" }));
    const moved = await adapter.setVolume(current, 0.9);
    assert.deepEqual(moved.kind === "error" && moved.reason, "default-changed");
    assert.deepEqual(fake.calls, [], "nothing written to either node");
    adapter.dispose();
  }));

await test("a default that changes during the write is not claimed as adjusted", () =>
  world(async (fake, control) => {
    const adapter = createAudioStatusAdapter({ control });
    const first = ready(await adapter.refresh());
    fake.onCall = () =>
      fake.setMetadata("default.audio.sink", JSON.stringify({ name: "bluez_output.headset" }));
    const result = await adapter.setVolume(first, 0.5);
    assert.deepEqual(result.kind === "error" && result.reason, "default-changed");
    adapter.dispose();
  }));

await test("invalid values never reach PipeWire; refused writes are errors with readback kept", () =>
  world(async (fake, control) => {
    const adapter = createAudioStatusAdapter({ control });
    const first = ready(await adapter.refresh());
    for (const bad of [-0.1, 1.01, Number.NaN]) {
      const result = await adapter.setVolume(first, bad);
      assert.deepEqual(result.kind === "error" && result.reason, "invalid-value");
    }
    assert.deepEqual(
      (await adapter.setMute(first, "yes" as unknown as boolean)).kind === "error",
      true,
    );
    assert.equal(adapter.state, first, "current readback untouched");
    fake.refuse = "Permission denied";
    const refused = await adapter.setVolume(first, 0.2);
    assert.equal(refused.kind, "error");
    assert.match(refused.kind === "error" ? refused.message : "", /Permission denied/);
    adapter.dispose();
  }));

await test("a later request cancels an earlier one; late completions can't overwrite", () =>
  world(async (fake, control) => {
    const adapter = createAudioStatusAdapter({ control });
    await adapter.refresh();
    fake.hang = true;
    const slow = adapter.refresh();
    fake.hang = false;
    const fast = adapter.refresh();
    const [older, newer] = await Promise.all([slow, fast]);
    assert.equal(newer.kind, "ready");
    assert.equal(adapter.state, newer, "older result did not replace the newer one");
    assert.ok(
      older === newer ||
        older.kind === "ready" ||
        (older.kind === "error" && older.reason === "cancelled"),
    );
    const external = new AbortController();
    external.abort();
    const cancelled = await adapter.refresh(external.signal);
    assert.deepEqual(cancelled.kind === "error" && cancelled.reason, "cancelled");
    adapter.dispose();
  }));

await test("no default output, no WirePlumber or no PipeWire: unavailable, never a guessed volume", async () => {
  await world(async (fake, control) => {
    fake.setMetadata("default.audio.sink", null);
    const adapter = createAudioStatusAdapter({ control });
    const state = await adapter.refresh();
    assert.deepEqual(state, { kind: "unavailable", message: "There is no sound output." });
    adapter.dispose();
  });
  await world(async (_fake, control) => {
    const adapter = createAudioStatusAdapter({ control });
    assert.equal((await adapter.refresh()).kind, "unavailable");
    adapter.dispose();
  }, false);
  const adapter = createAudioStatusAdapter({
    control: new AudioControl({ socketPath: "/nonexistent/pipewire-0" }),
  });
  const state = await adapter.refresh();
  assert.equal(state.kind, "unavailable");
  assert.match(state.kind === "unavailable" ? state.message : "", /isn't running/);
  adapter.dispose();
});

await test("disposed adapters refuse work and close a control they made", async () => {
  const fake = FakePipeWireServer.standard(await FakePipeWireServer.start());
  const previous = process.env.PIPEWIRE_REMOTE;
  process.env.PIPEWIRE_REMOTE = fake.path;
  try {
    const adapter = createAudioStatusAdapter();
    ready(await adapter.refresh());
    assert.equal(fake.clients.size, 1);
    adapter.dispose();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(fake.clients.size, 0, "owned connection closed");
    const after = await adapter.refresh();
    assert.deepEqual(after.kind === "error" && after.reason, "disposed");
  } finally {
    if (previous === undefined) delete process.env.PIPEWIRE_REMOTE;
    else process.env.PIPEWIRE_REMOTE = previous;
    await fake.close();
  }
});

console.log(`Audio status: ${cases} cases passed against the fake PipeWire.`);
