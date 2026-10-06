/** Real decoder/EOF plus public Window controls. Null AO/VO only; no audible, visible-video or native presentation acceptance. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import React from "react";
import { Window, installUiFonts } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { runTool } from "./index";
import { withFixture } from "./testing";
import { PlayerApp } from "./player";
import { PlaybackSession } from "./playback";

const observedOpens: { session: PlaybackSession; file: string; resolved: boolean }[] = [];

type Reply = { request_id: number; error: string; data?: unknown };
function isReply(value: unknown): value is Reply {
  return (
    !!value &&
    typeof value === "object" &&
    "request_id" in value &&
    typeof value.request_id === "number" &&
    "error" in value &&
    typeof value.error === "string"
  );
}
class MpvObserver {
  private socket: net.Socket;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private nextId = 1;
  readonly events: { event: string; reason?: string }[] = [];
  readonly connected: Promise<void>;
  closed = false;
  constructor(readonly endpoint: string) {
    this.socket = net.createConnection(endpoint);
    this.connected = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket.destroy();
        reject(new Error("Real mpv observer connection timed out."));
      }, 1500);
      this.socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    let input = "";
    this.socket.on("data", (chunk) => {
      input += String(chunk);
      if (input.length > 256 * 1024) {
        this.socket.destroy(new Error("Observer input limit exceeded."));
        return;
      }
      for (let n = input.indexOf("\n"); n >= 0; n = input.indexOf("\n")) {
        const value: unknown = JSON.parse(input.slice(0, n));
        input = input.slice(n + 1);
        if (isReply(value)) {
          const request = this.pending.get(value.request_id);
          if (!request) continue;
          clearTimeout(request.timer);
          this.pending.delete(value.request_id);
          if (value.error !== "success") request.reject(new Error(value.error));
          else request.resolve(value.data);
        } else if (
          value &&
          typeof value === "object" &&
          "event" in value &&
          typeof value.event === "string"
        ) {
          if (this.events.length < 256)
            this.events.push({
              event: value.event,
              ...("reason" in value && typeof value.reason === "string"
                ? { reason: value.reason }
                : {}),
            });
        }
      }
    });
    const stop = (error: Error) => {
      this.closed = true;
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(error);
      }
      this.pending.clear();
    };
    this.socket.on("error", stop);
    this.socket.on("close", () => stop(new Error("Real mpv observer closed.")));
  }
  async property(name: string): Promise<unknown> {
    await this.connected;
    if (this.closed) throw new Error("Real mpv observer closed.");
    const request_id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request_id);
        reject(new Error(`mpv property ${name} timed out.`));
      }, 1200);
      this.pending.set(request_id, { resolve, reject, timer });
      this.socket.write(
        JSON.stringify({ command: ["get_property", name], request_id }) + "\n",
        (error) => {
          if (error) {
            clearTimeout(timer);
            this.pending.delete(request_id);
            reject(error);
          }
        },
      );
    });
  }
  close() {
    this.socket.destroy();
  }
}
async function prerequisites(): Promise<string | null> {
  if (process.env.MOIRE_TEST_REAL_MPV !== "1") {
    console.error(
      JSON.stringify({
        status: "unexecuted",
        reason: "Explicit MOIRE_TEST_REAL_MPV=1 required; no IPC fixture fallback.",
      }),
    );
    process.exitCode = 2;
    return null;
  }
  try {
    return (
      (
        await promisify(execFile)("mpv", ["--version"], { timeout: 5000, maxBuffer: 64 * 1024 })
      ).stdout.split("\n")[0] ?? "mpv"
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      console.error(
        JSON.stringify({
          status: "unexecuted",
          reason: "Real mpv executable is absent; install/fixture fallback is not authorized.",
        }),
      );
      process.exitCode = 2;
      return null;
    }
    throw error;
  }
}
async function workflow(version: string) {
  await installUiFonts();
  await withFixture(async (directory) => {
    // The explicit extraArgs remain authoritative for the proposed Player.
    // These identical private defaults keep a later original-source negative
    // run device-free even if that older component ignores playbackOptions.
    const config = path.join(directory, "config", "mpv");
    await fs.mkdir(config, { recursive: true });
    await fs.writeFile(path.join(config, "mpv.conf"), "vo=null\nao=null\nhwdec=no\n");
    const first = path.join(directory, "first.mp4"),
      second = path.join(directory, "second.mp4");
    for (const [file, color, frequency] of [
      [first, "blue", 330],
      [second, "red", 550],
    ] as const)
      await runTool(
        "ffmpeg",
        [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          `color=c=${color}:s=64x32:d=3`,
          "-f",
          "lavfi",
          "-i",
          `sine=frequency=${frequency}:duration=3`,
          "-shortest",
          "-c:v",
          "mpeg4",
          "-pix_fmt",
          "yuv420p",
          file,
        ],
        AbortSignal.timeout(10_000),
      );
    const original = new Map(
      await Promise.all(
        [first, second].map(
          async (file) =>
            [
              file,
              createHash("sha256")
                .update(await fs.readFile(file))
                .digest("hex"),
            ] as const,
        ),
      ),
    );
    const backend = new HeadlessPlatform();
    await backend.connect();
    const window = new Window({ title: "Real mpv queue", width: 860, height: 620 });
    window.setContent((size) => (
      <PlayerApp
        {...size}
        video
        initialPaths={[first, second, second]}
        playbackOptions={{ extraArgs: ["--vo=null", "--ao=null", "--hwdec=no", "--no-config"] }}
      />
    ));
    let scheduled = false;
    const stopWake = window.onInvalidated(() => {
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          if (!window.isClosed()) window.tick();
        });
      }
    });
    window.mount(backend);
    window.tick();
    const native = backend.getWindows()[0];
    assert.ok(native);
    const observers: MpvObserver[] = [],
      pids: number[] = [],
      phases: unknown[] = [];
    const wait = async (condition: () => Promise<boolean>, label: string, timeout = 6000) => {
      const end = performance.now() + timeout;
      while (performance.now() < end) {
        if (await condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error(`Real mpv workflow timed out: ${label}`);
    };
    const endpoints = async () => {
      const candidates = await fs.readdir(path.join(directory, "tmp"));
      const result: string[] = [];
      for (const name of candidates.filter((name) => name.startsWith("mp-"))) {
        const endpoint = path.join(directory, "tmp", name, "s");
        try {
          if ((await fs.lstat(endpoint)).isSocket()) result.push(endpoint);
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        }
      }
      return result;
    };
    const attach = async (file: string, phase: string) => {
      let endpoint: string | undefined;
      await wait(async () => {
        endpoint = (await endpoints()).find(
          (value) => !observers.some((observer) => observer.endpoint === value),
        );
        return !!endpoint;
      }, `${phase} fresh session`);
      assert.ok(endpoint);
      const observer = new MpvObserver(endpoint);
      observers.push(observer);
      await observer.connected;
      await wait(async () => {
        try {
          return (
            (await observer.property("path")) === file &&
            typeof (await observer.property("duration")) === "number"
          );
        } catch (error) {
          if (observer.closed) throw error;
          return false;
        }
      }, `${phase} loaded media`);
      const opened = observedOpens[observers.length - 1];
      assert.ok(opened, "actual Player created an observed PlaybackSession");
      assert.equal(opened.file, file);
      await wait(async () => opened.resolved, `${phase} production open resolved`);
      // open() publishes ready before resolving. Yield to existing queued
      // invalidation ticks; this fixture never manually redraws or injects state.
      await new Promise<void>((resolve) => setImmediate(resolve));
      const pid = await observer.property("pid");
      assert.ok(typeof pid === "number" && Number.isSafeInteger(pid) && pid > 0);
      assert.equal(pids.includes(pid), false, "queue replacement owns a fresh actual mpv child");
      pids.push(pid);
      assert.equal(
        await observer.property("video-params/w"),
        64,
        "actual mpv decodes generated video",
      );
      assert.equal(await observer.property("current-vo"), "null", "video output must remain null");
      const duration = await observer.property("duration");
      assert.ok(typeof duration === "number" && duration >= 2.8 && duration <= 3.2);
      phases.push({ phase, pid, file: path.basename(file), duration });
      return observer;
    };
    const clickPlay = () => {
      native.injectPointer({ type: "down", button: "left", x: 40, y: 60, timeMs: 1 });
      native.injectPointer({ type: "up", button: "left", x: 40, y: 60, timeMs: 2 });
    };
    const playing = async (observer: MpvObserver, label: string) => {
      await wait(async () => {
        try {
          const position = await observer.property("time-pos");
          return (
            (await observer.property("pause")) === false &&
            typeof position === "number" &&
            position > 0.03
          );
        } catch (error) {
          if (observer.closed) throw error;
          return false;
        }
      }, label);
      assert.equal(await observer.property("current-ao"), "null", "audio output must remain null");
    };
    const eof = async (observer: MpvObserver, label: string) => {
      await wait(
        async () =>
          observer.events.some((event) => event.event === "end-file" && event.reason === "eof"),
        label,
        6000,
      );
      assert.equal(
        observer.events.filter((event) => event.event === "end-file" && event.reason === "eof")
          .length,
        1,
        "one real EOF per queue session",
      );
    };
    try {
      const initial = await attach(first, "initial");
      assert.equal(await initial.property("pause"), true, "initial association stays paused");
      assert.ok(native.lastFrame?.length === 860 * 620 * 4);
      clickPlay();
      await playing(initial, "first plays through public Window input");
      await eof(initial, "first actual EOF");
      const next = await attach(second, "next");
      await playing(next, "EOF starts next automatically");
      await eof(next, "second actual EOF");
      const duplicate = await attach(second, "adjacent-duplicate");
      await playing(duplicate, "adjacent duplicate auto-plays as distinct queue entry");
      await eof(duplicate, "final actual EOF");
      await wait(
        async () => (await duplicate.property("idle-active")) === true,
        "last EOF reaches actual mpv terminal idle",
        6000,
      );
      assert.equal(await duplicate.property("idle-active"), true, "last EOF is terminal idle");
      await new Promise((resolve) => setTimeout(resolve, 120));
      assert.equal(
        (await endpoints()).length,
        1,
        "terminal queue cannot wrap or spawn another backend",
      );
      const terminalPixels = Buffer.from(native.lastFrame ?? []);
      clickPlay();
      const replay = await attach(second, "replay");
      await playing(replay, "terminal Play resumes a new real decoder session");
      assert.ok(
        native.lastFrame && !Buffer.from(native.lastFrame).equals(terminalPixels),
        "replay updates actual Window pixels",
      );
    } finally {
      stopWake();
      window.destroy();
      backend.disconnect();
      try {
        await wait(
          async () => {
            for (const pid of pids) {
              try {
                process.kill(pid, 0);
                return false;
              } catch (error) {
                if (!(error instanceof Error && "code" in error && error.code === "ESRCH"))
                  throw error;
              }
            }
            return (await fs.readdir(path.join(directory, "tmp"))).length === 0;
          },
          "close retires all owned mpv children and IPC directories",
          6000,
        );
      } finally {
        for (const observer of observers) observer.close();
      }
    }
    for (const [file, digest] of original)
      assert.equal(
        createHash("sha256")
          .update(await fs.readFile(file))
          .digest("hex"),
        digest,
      );
    console.log(
      JSON.stringify({
        status: "passed",
        version,
        phases,
        eofCount: observers.reduce(
          (count, observer) =>
            count +
            observer.events.filter((event) => event.event === "end-file" && event.reason === "eof")
              .length,
          0,
        ),
        childrenRetired: pids.length,
        outputs: { ao: "null", vo: "null" },
        scope:
          "real mpv decoding/EOF/public headless Window; no audible/visible-video/native presentation acceptance",
      }),
    );
  });
}
const version = await prerequisites();
if (version !== null) {
  const originalOpen = PlaybackSession.prototype.open;
  // Private fixture process only: observe the public Promise while forwarding
  // the exact original arguments, session and Promise. No state mutation.
  PlaybackSession.prototype.open = function (file: string) {
    const observed = { session: this, file, resolved: false };
    observedOpens.push(observed);
    const pending = originalOpen.call(this, file);
    void pending.then(
      () => {
        observed.resolved = true;
      },
      () => {},
    );
    return pending;
  };
  try {
    await workflow(version);
  } finally {
    PlaybackSession.prototype.open = originalOpen;
  }
}
