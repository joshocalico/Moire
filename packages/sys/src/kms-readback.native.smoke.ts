/** Run on an exclusively owned DRM test card, with the compositor stopped by its owner. */
import assert from "node:assert/strict";
import koffi from "koffi";
import {
  closeKmsOutput,
  isKmsPresentationReady,
  openKmsOutput,
  presentKms,
  presentKmsPixels,
  setKmsMode,
} from "./kms";

const card = process.env.MOIRE_KMS_SMOKE_CARD;
if (!card) throw new Error("Set MOIRE_KMS_SMOKE_CARD to the exclusively owned DRM test card");
const output = openKmsOutput(card);
const originalMode = output.currentModeId;
const initialPixels = () => new Uint8Array(koffi.view(output.map, output.size)).slice();
const original = initialPixels();
const scene = (phase: number) => {
  const pixels = new Uint8Array(output.size);
  for (let y = 0; y < output.height; y++) {
    for (let x = 0; x < output.width; x++) {
      pixels.set(
        [(x + phase * 53) % 256, (y + phase * 31) % 256, (x + y + phase * 97) % 256, 255],
        y * output.pitch + x * 4,
      );
    }
  }
  return pixels;
};
try {
  const first = await presentKmsPixels(output, scene(0));
  assert.deepEqual(
    initialPixels(),
    original,
    "first readback wrote the initially active framebuffer",
  );
  const secondPixels = scene(1);
  const second = await presentKmsPixels(output, secondPixels);
  assert.deepEqual(
    initialPixels(),
    secondPixels,
    "second readback did not reuse the retired initial framebuffer",
  );
  const third = await presentKmsPixels(output, scene(2));
  assert.deepEqual(initialPixels(), secondPixels, "third readback modified active initial scanout");
  for (const feedback of [first, second, third]) {
    assert.equal(feedback.vsync, false, "unverified event claimed hardware retrace");
    assert.equal(feedback.hardwareCompletion, false, "unverified event claimed hardware start");
    assert.equal(feedback.hardwareClock, false, "unverified event claimed hardware timestamp");
    assert.ok(Number.isInteger(feedback.sequence) && feedback.sequence >= 0);
    assert.ok(Number.isInteger(feedback.seconds) && feedback.seconds >= 0);
    assert.ok(
      Number.isInteger(feedback.nanoseconds) &&
        feedback.nanoseconds >= 0 &&
        feedback.nanoseconds < 1_000_000_000,
    );
  }
  presentKms(output);
  await presentKmsPixels(output, scene(3));
  assert.deepEqual(
    initialPixels(),
    secondPixels,
    "confirmed durable handoff allowed active-buffer write",
  );
  assert.equal(isKmsPresentationReady(output), true);
  const alternateMode = output.modes.find((mode) => mode.id !== originalMode);
  if (alternateMode) {
    assert.equal(setKmsMode(output, alternateMode.id), true);
    const newInitial = initialPixels();
    await presentKmsPixels(output, scene(4));
    assert.deepEqual(
      initialPixels(),
      newInitial,
      "mode switch wrote new initial active framebuffer",
    );
    const newRetiredPixels = scene(5);
    await presentKmsPixels(output, newRetiredPixels);
    assert.deepEqual(
      initialPixels(),
      newRetiredPixels,
      "mode switch failed to reuse retired framebuffer",
    );
    assert.equal(setKmsMode(output, originalMode), true);
  }
  console.log(
    JSON.stringify({
      test: "kms-readback",
      card,
      mode: output.currentModeId,
      vsync: first.vsync,
      sequences: [first.sequence, second.sequence, third.sequence],
      feedback: [first, second, third],
      hardwareTiming: "unverified",
      immutableActiveScanout: true,
      modeSwitch: alternateMode?.id ?? "not advertised",
    }),
  );
} finally {
  closeKmsOutput(output);
  closeKmsOutput(output);
  assert.equal(isKmsPresentationReady(output), false);
}
