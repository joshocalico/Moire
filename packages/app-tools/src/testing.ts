import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runTool } from "./index";
import { PlaybackSession, type PlaybackState } from "./playback";
export async function withFixture(work: (directory: string) => Promise<void>): Promise<void> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-app-workflow-"));
  const previous = {
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    TMPDIR: process.env.TMPDIR,
  };
  await fs.mkdir(path.join(directory, "tmp"));
  process.env.TMPDIR = path.join(directory, "tmp");
  process.env.HOME = directory;
  process.env.XDG_CONFIG_HOME = path.join(directory, "config");
  process.env.XDG_DATA_HOME = path.join(directory, "data");
  try {
    await work(directory);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
}
export async function playbackSmoke(video: boolean): Promise<void> {
  await withFixture(async (directory) => {
    const file = path.join(directory, video ? "test.mp4" : "test.wav");
    await runTool(
      "ffmpeg",
      video
        ? [
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=64x32:d=3",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=3",
            "-shortest",
            "-c:v",
            "mpeg4",
            file,
          ]
        : ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", file],
    );
    assert.ok(
      Number(
        (
          await runTool("ffprobe", [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            file,
          ])
        ).trim(),
      ) >= 3,
    );
    let missing: PlaybackState = { kind: "idle" };
    const unavailable = new PlaybackSession(
      (value) => {
        missing = value;
      },
      { binary: path.join(directory, "no-mpv") },
    );
    await unavailable.open(file);
    await unavailable.close();
    assert.equal(missing.kind, "error", "a missing playback process is an explicit error");
    let available = true;
    try {
      await runTool("mpv", ["--version"]);
    } catch {
      available = false;
    }
    if (!available) {
      console.log(
        `[${video ? "video" : "music"}] real media fixture/probe and missing-backend state passed; mpv playback unavailable on this host`,
      );
      return;
    }
    let state: PlaybackState = { kind: "idle" };
    const session = new PlaybackSession(
      (value) => {
        state = value;
      },
      { video, extraArgs: ["--ao=null", "--vo=null"] },
    );
    try {
      await session.open(file);
      const get = () => state;
      const opened = get();
      assert.equal(opened.kind, "ready");
      assert.ok(
        opened.kind === "ready" && opened.duration >= 3,
        "open resolves with loaded media metadata",
      );
      const duration = await session.command(["get_property", "duration"]);
      assert.ok(typeof duration === "number" && duration >= 3);
      if (video) {
        assert.equal(
          await session.command(["get_property", "video-params/w"]),
          64,
          "video stream is actually decoded by mpv",
        );
      }
      await session.control(["set_property", "pause", false]);
      const waitFor = async (property: string, condition: (value: unknown) => boolean) => {
        const deadline = Date.now() + 5_000;
        while (Date.now() < deadline) {
          const value = await session.command(["get_property", property]);
          if (condition(value)) return value;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error(`mpv property ${property} did not reach the expected state.`);
      };
      const position = await waitFor("time-pos", (value) => typeof value === "number" && value > 0);
      assert.ok(typeof position === "number" && position > 0);
      await session.control(["set_property", "pause", true]);
      assert.equal(await session.command(["get_property", "pause"]), true);
      await session.control(["seek", 1, "absolute+exact"]);
      const seek = await waitFor(
        "time-pos",
        (value) => typeof value === "number" && Math.abs(value - 1) < 0.5,
      );
      assert.ok(typeof seek === "number" && Math.abs(seek - 1) < 0.5);
      await session.control(["set_property", "volume", 37]);
      assert.equal(await session.command(["get_property", "volume"]), 37);
    } finally {
      await session.close();
    }
    console.log(
      `[${video ? "video" : "music"}] real mpv pause/play/seek/volume/stop passed with null audio/video output`,
    );
  });
}
