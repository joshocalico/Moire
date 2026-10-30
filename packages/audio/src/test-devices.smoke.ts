/**
 * The VM's PipeWire test devices (nix/moire-sound-test-devices.json, enabled by
 * `moire.sound.testDevices` in nix/moire-sound-services.nix): the config's content, that only the
 * VM image turns it on, and that nodes with exactly those properties are listed, chosen and
 * driven by Moire's adapters (against the fake PipeWire; the real null devices need the VM).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createAudioDevicesAdapter, type AudioDevicesReady } from "./audio-devices";
import { createAudioStatusAdapter, type AudioReady } from "./audio-status";
import { AudioControl } from "./control";
import { FakePipeWireServer } from "./testing";

const nix = new URL("../../../nix/", import.meta.url);
const read = (name: string) => fs.readFileSync(new URL(name, nix), "utf8");
let cases = 0;

// The config: two null-audio-sink adapters, an Audio/Sink and an Audio/Source, nothing else.
type ConfigObject = { factory: string; args: Record<string, unknown> };
const config = JSON.parse(read("moire-sound-test-devices.json")) as Record<string, unknown>;
assert.deepEqual(Object.keys(config), ["context.objects"]);
const objects = config["context.objects"] as ConfigObject[];
assert.equal(objects.length, 2);
const byClass = new Map(objects.map((object) => [object.args["media.class"], object]));
const expected = [
  { mediaClass: "Audio/Sink", name: "moire_test_output", description: "Moire Test Output" },
  { mediaClass: "Audio/Source", name: "moire_test_input", description: "Moire Test Input" },
];
for (const { mediaClass, name, description } of expected) {
  const object = byClass.get(mediaClass);
  assert.ok(object, `${mediaClass} node`);
  assert.equal(object.factory, "adapter");
  assert.equal(object.args["factory.name"], "support.null-audio-sink");
  assert.equal(object.args["node.name"], name);
  assert.equal(object.args["node.description"], description);
  assert.equal(object.args["object.linger"], true, "outlives the config's client");
  assert.deepEqual(object.args["audio.position"], ["FL", "FR"]);
}
cases++;

// Only the VM image enables it; the option defaults off for hardware images.
const module = read("moire-sound-services.nix");
assert.match(module, /options\.moire\.sound\.testDevices = lib\.mkOption \{[^}]*default = false;/s);
assert.match(
  module,
  /extraConfig\.pipewire = lib\.mkIf config\.moire\.sound\.testDevices \{\s*"90-moire-test-devices" =\s*builtins\.fromJSON \(builtins\.readFile \.\/moire-sound-test-devices\.json\);/,
);
assert.match(read("moire-native-desktop-image.nix"), /moire\.sound\.testDevices = true;/);
const enabledIn = fs
  .readdirSync(nix)
  .filter((name) => name.endsWith(".nix") && /testDevices = true/.test(read(name)));
assert.deepEqual(enabledIn, ["moire-native-desktop-image.nix"], "no other image turns them on");
cases++;

// Moire lists and drives nodes with those properties (no device.id: Props, not a Route).
const fake = await FakePipeWireServer.start();
const ids = { "Audio/Sink": 80, "Audio/Source": 81 } as Record<string, number>;
for (const object of objects) {
  const args = object.args;
  const mediaClass = String(args["media.class"]);
  fake.addNode(
    ids[mediaClass]!,
    String(args["node.name"]),
    mediaClass,
    String(args["node.description"]),
    {
      volumes: [1, 1],
      extra: { "factory.name": String(args["factory.name"]) },
    },
  );
}
// WirePlumber makes them the defaults: with `-audio none` they are the only devices.
fake.setMetadata("default.audio.sink", JSON.stringify({ name: "moire_test_output" }));
fake.setMetadata("default.audio.source", JSON.stringify({ name: "moire_test_input" }));
const control = new AudioControl({ socketPath: fake.path });
try {
  const devices = createAudioDevicesAdapter({ control });
  const listed = (await devices.refresh()) as AudioDevicesReady;
  assert.equal(listed.kind, "ready", JSON.stringify(listed));
  assert.deepEqual(listed.outputs, [{ id: "80", name: "Moire Test Output", isDefault: true }]);
  assert.deepEqual(listed.inputs, [{ id: "81", name: "Moire Test Input", isDefault: true }]);
  const input = (await devices.setInputVolume(0.5)) as AudioDevicesReady;
  assert.equal(Math.round(input.input!.volume * 1000) / 1000, 0.5);
  devices.dispose();

  // Quick Settings' and Settings' output: the default sink, its volume and mute (the chime
  // plays to the default sink, so it goes into the test output).
  const status = createAudioStatusAdapter({ control });
  const output = (await status.refresh()) as AudioReady;
  assert.equal(output.kind, "ready", JSON.stringify(output));
  assert.equal(output.sink.name, "moire_test_output");
  assert.equal(output.sink.description, "Moire Test Output");
  const quieter = (await status.setVolume(output, 0.3)) as AudioReady;
  assert.ok(Math.abs(quieter.volume - 0.3) < 1e-4);
  assert.equal(((await status.setMute(quieter, true)) as AudioReady).muted, true);
  assert.deepEqual(fake.calls, [
    "node 81 props volume 0.5x2",
    "node 80 props volume 0.3x2",
    "node 80 props mute true",
  ]);
  status.dispose();
  cases++;
} finally {
  control.close();
  await fake.close();
}

console.log(`[audio/test-devices] ${cases} cases PASS`);
