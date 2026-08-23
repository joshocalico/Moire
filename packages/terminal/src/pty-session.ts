import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  closeSync,
  openSync,
  readFileSync,
  readlinkSync,
} from "node:fs";
import koffi from "koffi";

export type PtySessionOptions = {
  columns: number;
  rows: number;
  cwd?: string;
  shell?: string;
  command?: string;
  env?: NodeJS.ProcessEnv;
  onData: (data: string) => void;
  onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  onError?: (error: Error) => void;
};

type Ioctl = (fd: number, request: number, argument: Buffer) => number;

const TIOCSWINSZ = 0x5414;
let ioctl: Ioctl | undefined;

function getIoctl(): Ioctl {
  if (!ioctl) {
    const libc = koffi.load("libc.so.6");
    ioctl = libc.func(
      "int ioctl(int fd, unsigned long request, void *argument)",
    ) as Ioctl;
  }
  return ioctl;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function childrenOf(pid: number): number[] {
  try {
    const value = readFileSync(
      `/proc/${pid}/task/${pid}/children`,
      "utf8",
    ).trim();
    if (!value) return [];
    return value
      .split(/\s+/)
      .map(Number)
      .filter((child) => Number.isInteger(child) && child > 0);
  } catch {
    return [];
  }
}

function findTerminalDevice(rootPid: number): string | undefined {
  const queue = [rootPid];
  const seen = new Set<number>();
  while (queue.length > 0) {
    const pid = queue.shift();
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    try {
      const target = readlinkSync(`/proc/${pid}/fd/0`);
      if (target.startsWith("/dev/pts/")) return target;
    } catch {
      // Process may have exited between enumeration and inspection.
    }
    queue.push(...childrenOf(pid));
  }
  return undefined;
}

/**
 * A real shell PTY transported through util-linux `script`. Rendering and VT
 * interpretation live elsewhere; this class only owns bytes, lifecycle, and
 * Linux window-size ioctls.
 */
export class PtySession {
  private child: ChildProcessWithoutNullStreams | undefined;
  private tty: string | undefined;
  private ttyProbe: ReturnType<typeof setInterval> | undefined;
  private columns: number;
  private rows: number;

  constructor(private readonly options: PtySessionOptions) {
    this.columns = Math.max(2, Math.floor(options.columns));
    this.rows = Math.max(1, Math.floor(options.rows));
  }

  start(): void {
    if (this.child) return;
    if (process.platform !== "linux") {
      throw new Error("Moire PTY sessions currently require Linux");
    }
    const shell = this.options.shell ?? process.env.SHELL ?? "/bin/bash";
    const command =
      this.options.command ??
      `stty rows ${this.rows} cols ${this.columns}; exec ${shellQuote(shell)} -l`;
    const child = spawn(
      "script",
      ["-qfec", command, "/dev/null"],
      {
        cwd: this.options.cwd,
        env: {
          ...process.env,
          ...this.options.env,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
          COLUMNS: String(this.columns),
          LINES: String(this.rows),
        },
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.child = child;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data: string) => this.options.onData(data));
    child.stderr.on("data", (data: string) => this.options.onData(data));
    child.on("error", (error) => this.options.onError?.(error));
    child.on("exit", (code, signal) => {
      this.stopTtyProbe();
      this.child = undefined;
      this.options.onExit?.(code, signal);
    });
    this.probeTty();
    this.ttyProbe = setInterval(() => this.probeTty(), 60);
    this.ttyProbe.unref?.();
  }

  write(data: string): void {
    if (this.child?.stdin.writable) this.child.stdin.write(data);
  }

  resize(columns: number, rows: number): void {
    this.columns = Math.max(2, Math.floor(columns));
    this.rows = Math.max(1, Math.floor(rows));
    if (!this.tty) {
      this.probeTty();
      return;
    }
    this.applyWindowSize();
  }

  close(): void {
    const child = this.child;
    this.child = undefined;
    this.stopTtyProbe();
    if (!child?.pid) return;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      try {
        child.kill("SIGTERM");
      } catch {
        // Already exited.
      }
    }
  }

  private probeTty(): void {
    const pid = this.child?.pid;
    if (!pid) return;
    const found = findTerminalDevice(pid);
    if (!found) return;
    this.tty = found;
    this.stopTtyProbe();
    this.applyWindowSize();
  }

  private applyWindowSize(): void {
    if (!this.tty) return;
    let fd: number | undefined;
    try {
      fd = openSync(this.tty, "r+");
      const size = Buffer.alloc(8);
      size.writeUInt16LE(this.rows, 0);
      size.writeUInt16LE(this.columns, 2);
      getIoctl()(fd, TIOCSWINSZ, size);
      const pid = this.child?.pid;
      if (pid) process.kill(-pid, "SIGWINCH");
    } catch (error) {
      this.options.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  private stopTtyProbe(): void {
    if (!this.ttyProbe) return;
    clearInterval(this.ttyProbe);
    this.ttyProbe = undefined;
  }
}
