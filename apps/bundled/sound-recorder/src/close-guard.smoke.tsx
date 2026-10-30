import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import React from "react";
import { Window, installUiFonts, getFontEngine } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { windowControl } from "@moire/app-tools/testing";
import { SoundRecorderApp, type RecorderControls } from "./main";
import type { RecordingState } from "./backend";

function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
/** A controllable recorder boundary; no capture process or microphone is started. */
class FixtureRecorder implements RecorderControls {
  readonly starting = gate();
  readonly stopping = gate();
  readonly saving = gate();
  readonly discarding = gate();
  state: RecordingState = { kind: "idle" };
  holdStop = false;
  holdSave = false;
  holdDiscard = false;
  failSave = false;
  closed = false;
  closeCalls = 0;
  constructor(
    readonly file: string,
    readonly change: (state: RecordingState) => void,
  ) {}
  publish(state: RecordingState) {
    this.state = state;
    this.change(state);
  }
  snapshot(): RecordingState {
    return this.state;
  }
  async start(): Promise<void> {
    this.publish({ kind: "starting" });
    // Disposable take bytes let the test verify save/discard preservation exactly.
    await fs.writeFile(this.file, Buffer.from("disposable recorder take"));
    await this.starting.promise;
    this.publish({ kind: "recording", startedAt: Date.now() });
  }
  async stop(): Promise<void> {
    if (this.holdStop) await this.stopping.promise;
    this.publish({ kind: "ready", file: this.file, seconds: 1 });
  }
  async save(destination: string): Promise<string> {
    if (this.holdSave) await this.saving.promise;
    if (this.failSave) throw new Error("Fixture save failed");
    await fs.link(this.file, destination);
    return destination;
  }
  async discard(): Promise<void> {
    if (this.holdDiscard) await this.discarding.promise;
    await fs.rm(this.file, { force: true });
    this.publish({ kind: "idle" });
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.closeCalls++;
    await fs.rm(this.file, { force: true });
  }
}

await installUiFonts();
const engine = await getFontEngine();
const originalDraw = engine.draw;
const visibleText: string[] = [];
engine.draw = (...args) => {
  visibleText.push(args[6]);
  originalDraw.call(engine, ...args);
};
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-recorder-close-"));
let number = 0;
async function fixture(
  work: (fixture: {
    recorder: FixtureRecorder;
    window: Window;
    click: (control: string) => void;
    settle: () => Promise<void>;
    blockClose: () => void;
    allowClose: () => void;
  }) => Promise<void>,
): Promise<void> {
  const backend = new HeadlessPlatform();
  await backend.connect();
  const window = new Window({ title: "Recorder close guard", width: 860, height: 620 });
  let recorder: FixtureRecorder | undefined;
  let closes = 0;
  window.onClose(() => {
    closes++;
  });
  window.setContent((size) => (
    <SoundRecorderApp
      {...size}
      onCloseGuard={(guard) => window.setCloseGuard(guard)}
      recordingsFolder={path.join(directory, "Recordings")}
      probeInput={async () => ({ kind: "ready", name: "Fixture input" })}
      recorderFactory={(change) => {
        recorder = new FixtureRecorder(path.join(directory, `private-${number++}.wav`), change);
        return recorder;
      }}
    />
  ));
  window.mount(backend);
  await Promise.resolve();
  window.tick();
  const native = backend.getWindows()[0];
  assert.ok(native);
  assert.ok(recorder);
  const current = recorder;
  // Controls are located in the live scene: "recorder:record" toggles Record/Stop, the take card
  // carries "recorder:save" and "recorder:discard".
  const press = (x: number, y: number) => {
    native.injectPointer({ type: "down", x, y, button: "left", timeMs: 1 });
    native.injectPointer({ type: "up", x, y, button: "left", timeMs: 2 });
    window.tick();
  };
  const click = (control: string) => {
    window.tick();
    const { x, y } = windowControl(window, { focusId: control });
    press(x, y);
  };
  // A few frames: the fixture's file writes must finish on a busy machine too.
  const settle = async () => {
    for (let frame = 0; frame < 5; frame++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      window.tick();
    }
  };
  try {
    await work({
      recorder: current,
      window,
      click,
      settle,
      blockClose: () => {
        visibleText.length = 0;
        native.requestClose();
        window.tick();
        assert.equal(closes, 0, "native close must be rejected");
        assert.equal(window.isClosed(), false);
        assert.equal(current.closeCalls, 0, "blocked close must preserve the take/backend");
        assert.ok(
          visibleText.some((text) => text.includes("Close blocked:")),
          "native close paints visible guidance",
        );
        const guidance = visibleText.join(" ");
        assert.ok(
          guidance.includes("Save") && guidance.includes("Discard take"),
          "close guidance names the available resolution controls",
        );
      },
      allowClose: () => {
        native.requestClose();
        assert.equal(closes, 1, "native close must be accepted after resolving the take");
        assert.equal(window.isClosed(), true);
      },
    });
  } finally {
    window.destroy();
    await current.close();
    backend.disconnect();
  }
}
try {
  await fixture(async ({ allowClose }) => {
    allowClose();
  });
  await fixture(async ({ recorder, click, settle, blockClose, allowClose }) => {
    click("recorder:record");
    blockClose(); // Includes the same turn before the start promise completes.
    assert.equal(recorder.snapshot().kind, "starting");
    recorder.starting.release();
    await settle();
    assert.equal(recorder.snapshot().kind, "recording");
    blockClose();
    recorder.holdStop = true;
    click("recorder:record");
    blockClose();
    recorder.stopping.release();
    await settle();
    assert.equal(recorder.snapshot().kind, "ready");
    blockClose();
    const take = await fs.readFile(recorder.file);
    recorder.failSave = true;
    click("recorder:save");
    await settle();
    blockClose();
    assert.deepEqual(await fs.readFile(recorder.file), take, "failed save preserves unsaved audio");
    recorder.failSave = false;
    recorder.holdSave = true;
    click("recorder:save");
    blockClose();
    recorder.saving.release();
    await settle();
    // Save puts the take in the recordings folder under its automatic, dated name.
    const [saved] = await fs.readdir(path.join(directory, "Recordings"));
    assert.match(saved ?? "", /^Recording \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.\d{2}\.wav$/);
    assert.deepEqual(await fs.readFile(path.join(directory, "Recordings", saved!)), take);
    allowClose();
  });
  await fixture(async ({ recorder, click, settle, blockClose, allowClose }) => {
    click("recorder:record");
    recorder.starting.release();
    await settle();
    click("recorder:record");
    await settle();
    blockClose();
    recorder.holdDiscard = true;
    click("recorder:discard");
    blockClose();
    recorder.discarding.release();
    await settle();
    assert.equal(recorder.snapshot().kind, "idle");
    await assert.rejects(fs.stat(recorder.file), { code: "ENOENT" });
    allowClose();
  });
  console.log(
    "[sound-recorder/close-guard] actual native close protects starting/recording/stop/save/discard/unsaved take; saved/discarded/idle close accepted",
  );
} finally {
  engine.draw = originalDraw;
  await fs.rm(directory, { recursive: true, force: true });
}
