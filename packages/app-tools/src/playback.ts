import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { readableFile, errorText } from "./index";
export type PlaybackState =
  | { kind: "idle" }
  | { kind: "opening" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      file: string;
      paused: boolean;
      position: number;
      duration: number;
      volume: number;
    };
type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type Loading = {
  loaded: boolean;
  restarted: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
export class PlaybackSession {
  private child: ChildProcess | null = null;
  private socket: net.Socket | null = null;
  private directory: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending = new Map<number, Pending>();
  private loading: Loading | null = null;
  private nextId = 1;
  private closed = false;
  private state: PlaybackState = { kind: "idle" };
  constructor(
    private readonly onChange: (value: PlaybackState) => void,
    private readonly options: {
      video?: boolean;
      binary?: string;
      extraArgs?: string[];
      /** Only a real end-of-file event advances an application-owned queue. */
      onEnded?: () => void;
    } = {},
  ) {}
  private current(): PlaybackState {
    return this.state;
  }
  private publish(value: PlaybackState) {
    this.state = value;
    if (!this.closed) this.onChange(value);
  }
  async open(value: string): Promise<void> {
    if (this.closed) throw new Error("The playback session has been closed.");
    if (this.child || this.state.kind === "opening")
      throw new Error("A media file is already open in this playback session.");
    this.publish({ kind: "opening" });
    try {
      const file = await readableFile(value);
      this.directory = await fs.mkdtemp(path.join(os.tmpdir(), "mp-"));
      if (this.closed) {
        await this.close();
        return;
      }
      const endpoint = path.join(this.directory, "s");
      const args = [
        "--idle=yes",
        "--pause=yes",
        "--no-terminal",
        `--input-ipc-server=${endpoint}`,
        ...(this.options.video
          ? [
              "--force-window=yes",
              ...(process.platform === "linux" ? ["--gpu-context=wayland"] : []),
            ]
          : ["--no-video"]),
        ...(this.options.extraArgs ?? []),
      ];
      let failure: Error | null = null,
        stderr = "";
      const child = spawn(this.options.binary ?? "mpv", args, {
        stdio: ["ignore", "ignore", "pipe"],
      });
      this.child = child;
      child.stderr?.on("data", (chunk) => {
        stderr = (stderr + String(chunk)).slice(-2000);
      });
      child.on("error", (error) => {
        failure = new Error(`mpv playback backend unavailable. ${errorText(error)}`);
        this.rejectPending(failure);
        this.publish({
          kind: "error",
          message: `mpv playback backend unavailable. ${errorText(error)}`,
        });
      });
      child.on("exit", (code) => {
        if (this.closed || this.child !== child) return;
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        if (code === 0 && this.state.kind !== "opening") {
          this.rejectPending(new Error("Playback stopped."));
          this.publish({ kind: "idle" });
        } else {
          failure = new Error(stderr || `mpv exited before playback was ready (status ${code}).`);
          this.rejectPending(failure);
          this.publish({ kind: "error", message: failure.message });
        }
      });
      for (let attempt = 0; attempt < 100 && !this.closed; attempt++) {
        if (failure) throw failure;
        try {
          await fs.stat(endpoint);
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      if (this.closed) return;
      if (failure) throw failure;
      const socket = net.createConnection(endpoint);
      this.socket = socket;
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("mpv IPC connection timed out.")), 2500);
        const finish = () => {
          clearTimeout(timeout);
          resolve();
        };
        const fail = (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        };
        socket.once("connect", finish);
        socket.once("error", fail);
        socket.once("close", () => fail(new Error("Playback connection closed.")));
      });
      let text = "";
      this.socket.on("data", (chunk) => {
        text += String(chunk);
        if (text.length > 1024 * 1024) {
          this.socket?.destroy();
          return;
        }
        for (let newline = text.indexOf("\n"); newline >= 0; newline = text.indexOf("\n")) {
          const line = text.slice(0, newline);
          text = text.slice(newline + 1);
          try {
            const response: unknown = JSON.parse(line);
            if (!response || typeof response !== "object") continue;
            if ("event" in response && typeof response.event === "string") {
              this.receiveEvent(response.event, response);
              continue;
            }
            if (!("request_id" in response) || typeof response.request_id !== "number") continue;
            const pending = this.pending.get(response.request_id);
            if (!pending) continue;
            clearTimeout(pending.timer);
            this.pending.delete(response.request_id);
            if ("error" in response && response.error !== "success")
              pending.reject(new Error(String(response.error)));
            else pending.resolve("data" in response ? response.data : undefined);
          } catch {}
        }
      });
      const disconnected = (error: Error) => {
        if (this.socket !== socket) return;
        this.rejectPending(error);
        if (!this.closed) {
          if (this.timer) clearInterval(this.timer);
          this.timer = null;
          this.publish({ kind: "error", message: error.message });
        }
      };
      this.socket.on("error", disconnected);
      this.socket.on("close", () => disconnected(new Error("Playback connection closed.")));
      // A loadfile reply only acknowledges the playlist change. Wait for the
      // media headers and initial decoder/output restart before exposing controls.
      const loaded = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.loading = null;
          reject(new Error("mpv did not finish loading the media file."));
        }, 10_000);
        this.loading = { loaded: false, restarted: false, resolve, reject, timer };
      });
      await Promise.all([loaded, this.command(["loadfile", file, "replace"])]);
      if (this.closed || this.current().kind !== "opening") return;
      this.publish({ kind: "ready", file, paused: true, position: 0, duration: 0, volume: 100 });
      await this.poll();
      if (!this.closed && this.current().kind === "ready") {
        this.timer = setInterval(() => {
          void this.poll();
        }, 500);
      }
    } catch (error) {
      this.publish({ kind: "error", message: errorText(error) });
      await this.release();
    }
  }
  private receiveEvent(name: string, event: object): void {
    if (name === "file-loaded" && this.loading) this.loading.loaded = true;
    if (name === "playback-restart" && this.loading) this.loading.restarted = true;
    if (this.loading?.loaded && this.loading.restarted) {
      const loading = this.loading;
      this.loading = null;
      clearTimeout(loading.timer);
      loading.resolve();
    }
    if (name === "end-file" && !("reason" in event && event.reason === "redirect")) {
      const detail =
        "file_error" in event && typeof event.file_error === "string"
          ? event.file_error
          : "error" in event && typeof event.error === "string"
            ? event.error
            : "Media playback ended before it was ready.";
      if (this.loading) this.rejectPending(new Error(detail));
      else if (!this.closed && this.state.kind === "ready") {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.publish(
          "reason" in event && event.reason === "error"
            ? { kind: "error", message: detail }
            : { kind: "idle" },
        );
        if ("reason" in event && event.reason === "eof") this.options.onEnded?.();
      }
    }
  }
  private rejectPending(error: Error): void {
    if (this.loading) {
      clearTimeout(this.loading.timer);
      this.loading.reject(error);
      this.loading = null;
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
  async command(command: readonly (string | number | boolean)[]): Promise<unknown> {
    if (!this.socket || this.closed)
      throw new Error("Open a media file before controlling playback.");
    const request_id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request_id);
        reject(new Error("The playback backend did not respond."));
      }, 2500);
      this.pending.set(request_id, { resolve, reject, timer });
      this.socket?.write(JSON.stringify({ command, request_id }) + "\n", (error) => {
        if (error) {
          clearTimeout(timer);
          this.pending.delete(request_id);
          reject(error);
        }
      });
    });
  }
  private async poll(): Promise<void> {
    if (this.state.kind !== "ready") return;
    const values = await Promise.allSettled(
      ["pause", "time-pos", "duration", "volume"].map((name) =>
        this.command(["get_property", name]),
      ),
    );
    if (this.closed || this.state.kind !== "ready") return;
    const [pause, position, duration, volume] = values;
    this.publish({
      ...this.state,
      paused:
        pause?.status === "fulfilled" && typeof pause.value === "boolean"
          ? pause.value
          : this.state.paused,
      position:
        position?.status === "fulfilled" &&
        typeof position.value === "number" &&
        Number.isFinite(position.value)
          ? Math.max(0, position.value)
          : this.state.position,
      duration:
        duration?.status === "fulfilled" &&
        typeof duration.value === "number" &&
        Number.isFinite(duration.value)
          ? Math.max(0, duration.value)
          : this.state.duration,
      volume:
        volume?.status === "fulfilled" &&
        typeof volume.value === "number" &&
        Number.isFinite(volume.value)
          ? volume.value
          : this.state.volume,
    });
  }
  async control(command: readonly (string | number | boolean)[]): Promise<void> {
    await this.command(command);
    await this.poll();
  }
  /** Jump to `seconds` from the start; the published position follows. */
  async seek(seconds: number): Promise<void> {
    await this.control(["seek", Math.max(0, seconds), "absolute"]);
  }
  private async release(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.rejectPending(new Error("Playback stopped."));
    this.socket?.destroy();
    this.socket = null;
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
        }, 1000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
        child.once("error", () => {
          clearTimeout(timeout);
          resolve();
        });
        if (!child.kill("SIGTERM")) {
          clearTimeout(timeout);
          resolve();
        }
      });
    }
    if (this.directory) await fs.rm(this.directory, { recursive: true, force: true });
    this.directory = null;
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.release();
  }
}
