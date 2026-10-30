/**
 * Opt-in check against the session's real PipeWire (MOIRE_TEST_LIVE_AUDIO=1): reads devices and
 * defaults, writes the default output's current volume back unchanged, plays the alert, and meters
 * the default input for a second. Changes nothing a person would notice. See docs/audio.md.
 */
import assert from "node:assert/strict";
import { AudioControl } from "./control";
import { ALERT_SOUND_PATH } from "./alert";
import { playSound, recordLevels } from "./sound";

if (process.env.MOIRE_TEST_LIVE_AUDIO !== "1") {
  console.log("SKIP live audio: set MOIRE_TEST_LIVE_AUDIO=1 in a session with PipeWire");
  process.exit(0);
}

const control = new AudioControl();
try {
  const snapshot = await control.read();
  for (const node of snapshot.nodes)
    console.log(
      `${node.kind.padEnd(8)} ${String(node.id).padStart(4)} ${node.description || node.name} volume=${node.volume} muted=${node.muted}`,
    );
  for (const device of snapshot.devices)
    console.log(
      `device   ${String(device.id).padStart(4)} ${device.description} profile=${device.profile} routes=${device.routes.map((r) => r.name).join(",")}`,
    );
  console.log(`defaults sink=${snapshot.defaultSink} source=${snapshot.defaultSource}`);
  const sink = snapshot.nodes.find(
    (node) => node.kind === "sink" && node.name === snapshot.defaultSink,
  );
  if (sink?.volume != null) {
    const after = await control.setVolume(sink.id, Math.min(1, sink.volume));
    const readback = after.nodes.find((node) => node.id === sink.id)?.volume ?? null;
    assert.ok(
      readback !== null && Math.abs(readback - Math.min(1, sink.volume)) < 0.01,
      `readback ${readback}`,
    );
    console.log(`default output volume rewritten unchanged: ${readback}`);
  } else console.log("no default output with a volume; write check skipped");
} finally {
  control.close();
}

console.log("alert:", JSON.stringify(await playSound({ path: ALERT_SOUND_PATH }, { volume: 0.6 })));
const peaks: number[] = [];
const meter = recordLevels({
  onLevels: ({ peak }) => peaks.push(peak),
  onEnd: (message) => console.log("meter ended:", message),
});
if (meter.kind === "recording") {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  meter.recording.stop();
  console.log(`meter: ${peaks.length} ticks, max peak ${Math.max(0, ...peaks).toFixed(3)}`);
} else console.log("meter:", meter.kind, meter.message);
