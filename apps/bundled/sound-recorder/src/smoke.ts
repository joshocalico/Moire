import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { withFixture } from "@moire/app-tools/testing";
import { Recorder, type RecordingState } from "./backend";
await withFixture(async (directory) => {
  let state: RecordingState = { kind: "idle" };
  const recorder = new Recorder(
    (value) => {
      state = value;
    },
    path.join(directory, "missing-pw-record"),
  );
  try {
    await assert.rejects(recorder.start(), /PipeWire recording backend unavailable/);
    assert.equal(state.kind, "error");
    await assert.rejects(recorder.stop(), /no active recording/);
    await assert.rejects(recorder.save(path.join(directory, "not-recorded.wav")), /captured audio/);
  } finally {
    await recorder.close();
  }
  if (process.env.MOIRE_TEST_AUDIO_INPUT === "1") {
    const capture = new Recorder((value) => {
      state = value;
    });
    try {
      await capture.start();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await capture.stop();
      const get = () => state;
      assert.equal(get().kind, "ready", "the disposable PipeWire input must deliver audio");
      const output = path.join(directory, "saved.wav");
      await capture.save(output);
      assert.ok((await fs.stat(output)).size > 44);
      const original = await fs.readFile(output);
      await assert.rejects(capture.save(output), { code: "EEXIST" });
      assert.deepEqual(await fs.readFile(output), original);
      await capture.discard();
      assert.equal(get().kind, "idle");
      console.log(
        "[sound-recorder] real PipeWire start/stop, valid audio, save/no-overwrite/discard passed",
      );
    } finally {
      await capture.close();
    }
  } else
    console.log(
      "[sound-recorder] real missing-process launch and invalid stop/save states passed; actual capture requires MOIRE_TEST_AUDIO_INPUT=1 with a disposable PipeWire input",
    );
});
