import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { errorText, localPath, runTool } from "@moire/app-tools";
export type RecordingState =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "recording"; startedAt: number }
  | { kind: "ready"; file: string; seconds: number }
  | { kind: "error"; message: string };
export class Recorder {
  private child: ChildProcess | null = null;
  private directory: string | null = null;
  private file: string | null = null;
  private startedAt = 0;
  private stopped = false;
  private closed = false;
  private state: RecordingState = { kind: "idle" };
  constructor(
    private readonly change: (value: RecordingState) => void,
    private readonly binary = "pw-record",
  ) {}
  private publish(value: RecordingState) {
    this.state = value;
    if (!this.closed) this.change(value);
  }
  async start(): Promise<void> {
    if (this.closed) throw new Error("The recorder has been closed.");
    if (this.child || this.state.kind === "starting")
      throw new Error("A recording is already running.");
    this.publish({ kind: "starting" });
    try {
      await this.cleanup();
      this.stopped = false;
      this.directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-recording-"));
      this.file = path.join(this.directory, "recording.wav");
      this.startedAt = Date.now();
      let stderr = "";
      const child = spawn(this.binary, ["--rate", "48000", "--channels", "2", this.file], {
        stdio: ["ignore", "ignore", "pipe"],
      });
      this.child = child;
      child.stderr?.on("data", (chunk) => {
        stderr = (stderr + String(chunk)).slice(-2000);
      });
      child.on("error", (error) => {
        this.child = null;
        this.publish({
          kind: "error",
          message: `PipeWire recording backend unavailable. ${errorText(error)}`,
        });
      });
      child.on("exit", (code) => {
        this.child = null;
        if (!this.stopped && !this.closed)
          this.publish({
            kind: "error",
            message:
              stderr ||
              `No audio was captured. PipeWire recorder exited with status ${code}. Check the input device and PipeWire session.`,
          });
      });
      await new Promise<void>((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      }).catch((error) => {
        throw new Error(`PipeWire recording backend unavailable. ${errorText(error)}`);
      });
      if (this.closed) {
        await this.close();
        return;
      }
      this.publish({ kind: "recording", startedAt: this.startedAt });
    } catch (error) {
      this.publish({ kind: "error", message: errorText(error) });
      await this.cleanup();
      throw error;
    }
  }
  async stop(): Promise<void> {
    const child = this.child;
    if (!child || !this.file) throw new Error("There is no active recording.");
    this.stopped = true;
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          child.kill("SIGKILL");
          reject(new Error("The recorder did not finish. This recording cannot be saved."));
        }, 5000);
        child.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
        child.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        if (!child.kill("SIGINT")) {
          clearTimeout(timeout);
          reject(new Error("The recorder has already stopped."));
        }
      });
      const stat = await fs.stat(this.file);
      if (stat.size <= 44) {
        this.publish({
          kind: "error",
          message: "No audio was captured. Check the input device and try again.",
        });
        return;
      }
      // Probe the actual WAV after the recorder finalizes its header.
      const seconds = Number(
        (
          await runTool("ffprobe", [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            this.file,
          ])
        ).trim(),
      );
      if (!Number.isFinite(seconds) || seconds <= 0) {
        this.publish({ kind: "error", message: "No readable audio was captured." });
        return;
      }
      this.publish({ kind: "ready", file: this.file, seconds });
    } catch (error) {
      this.publish({ kind: "error", message: errorText(error) });
      throw error;
    }
  }
  async save(value: string): Promise<string> {
    if (this.state.kind !== "ready")
      throw new Error("Stop a recording with captured audio before saving.");
    const destination = localPath(value);
    if (path.extname(destination).toLowerCase() !== ".wav")
      throw new Error("Save recordings with a .wav extension.");
    const directory = await fs.mkdtemp(
      path.join(path.dirname(destination), ".moire-save-recording-"),
    );
    try {
      const staged = path.join(directory, "recording.wav");
      await fs.copyFile(this.state.file, staged);
      await fs.link(staged, destination);
      return destination;
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
  async discard(): Promise<void> {
    if (this.child || this.state.kind === "starting")
      throw new Error("Stop recording before discarding a take.");
    await this.cleanup();
    this.publish({ kind: "idle" });
  }
  private async cleanup(): Promise<void> {
    if (this.directory) await fs.rm(this.directory, { recursive: true, force: true });
    this.directory = null;
    this.file = null;
  }
  async close(): Promise<void> {
    this.closed = true;
    this.stopped = true;
    const child = this.child;
    this.child = null;
    if (child && child.exitCode === null && child.signalCode === null)
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
        if (!child.kill("SIGINT")) {
          clearTimeout(timeout);
          resolve();
        }
      });
    await this.cleanup();
  }
}
