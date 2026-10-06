/** Harmless IPC fixture only. This supervisor owns its real descendant ChildProcess. */
import { fork, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
export type FixtureProcessOptions = Readonly<{
  holdReady?: boolean;
  holdRetirement?: boolean;
  exitParentAfterReady?: boolean;
}>;
export function fixtureProcessArgv(
  options: FixtureProcessOptions = {},
): readonly [string, ...string[]] {
  return [
    process.execPath,
    ...process.execArgv,
    fileURLToPath(import.meta.url),
    "fixture-parent",
    JSON.stringify(options),
  ];
}
export function spawnFixtureProcess(options: FixtureProcessOptions = {}): ChildProcess {
  return fork(fileURLToPath(import.meta.url), ["fixture-parent", JSON.stringify(options)], {
    execArgv: process.execArgv,
    env: {},
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
}
export type FixtureInitialization = Readonly<{
  type: "fixture-init";
  nonce: string;
  generation: number;
  role: "greeter" | "session";
}>;
export function initialization(value: unknown): FixtureInitialization | null {
  if (
    !value ||
    typeof value !== "object" ||
    !("type" in value) ||
    value.type !== "fixture-init" ||
    !("nonce" in value) ||
    typeof value.nonce !== "string" ||
    !/^[a-f0-9-]{36}$/.test(value.nonce) ||
    !("generation" in value) ||
    !Number.isSafeInteger(value.generation) ||
    typeof value.generation !== "number" ||
    value.generation < 1 ||
    !("role" in value) ||
    (value.role !== "greeter" && value.role !== "session")
  )
    return null;
  return {
    type: "fixture-init",
    nonce: value.nonce,
    generation: value.generation,
    role: value.role,
  };
}
function messageType(value: unknown): string | null {
  return value && typeof value === "object" && "type" in value && typeof value.type === "string"
    ? value.type
    : null;
}
function authenticated(value: unknown, nonce: string): boolean {
  return !!value && typeof value === "object" && "nonce" in value && value.nonce === nonce;
}
function send(value: object): void {
  if (process.connected) process.send?.(value, () => {});
}
function finish(): void {
  if (process.connected) process.disconnect();
}
if (process.argv[2] === "fixture-member") {
  let nonce = "";
  const safety = setTimeout(() => {
    finish();
    process.exit(0);
  }, 15000);
  process.on("message", (value) => {
    if (
      messageType(value) === "member-init" &&
      value &&
      typeof value === "object" &&
      "nonce" in value &&
      typeof value.nonce === "string"
    ) {
      nonce = value.nonce;
      send({ type: "member-ready", nonce, pid: process.pid });
    } else if (messageType(value) === "member-retire" && authenticated(value, nonce)) {
      clearTimeout(safety);
      finish();
    }
  });
  // A deliberately exited parent leaves a briefly live descendant for the negative oracle.
  process.on("disconnect", () => {
    setTimeout(() => process.exit(0), 500);
  });
} else if (process.argv[2] === "fixture-parent") {
  const raw: unknown = JSON.parse(process.argv[3] ?? "{}");
  if (!raw || typeof raw !== "object") throw new Error("Invalid fixture options");
  const options: FixtureProcessOptions = {
    holdReady: "holdReady" in raw && raw.holdReady === true,
    holdRetirement: "holdRetirement" in raw && raw.holdRetirement === true,
    exitParentAfterReady: "exitParentAfterReady" in raw && raw.exitParentAfterReady === true,
  };
  let init: FixtureInitialization | null = null,
    member: ChildProcess | null = null;
  let memberNonce = "",
    memberPid = 0,
    memberClosed = false,
    owned = false;
  let readyHeld = options.holdReady ?? false,
    retirementHeld = options.holdRetirement ?? false;
  let retiring = false,
    retiringRequested = false;
  const safety = setTimeout(() => {
    if (!owned) {
      // Failed/no initialization must also have a finite lifetime. No release ack
      // is fabricated: await any real child handle, then close this fixture only.
      void (async () => {
        if (member && !memberClosed)
          await new Promise<void>((resolve) => member?.once("close", () => resolve()));
        finish();
      })();
      return;
    }
    retirementHeld = false;
    void retire();
  }, 15000);
  function envelope(type: string) {
    if (!init) throw new Error("Fixture not initialized");
    return { type, nonce: init.nonce, generation: init.generation, role: init.role };
  }
  function ready() {
    if (!init || !owned || readyHeld || retiringRequested) return;
    send(envelope("fixture-ready"));
    if (options.exitParentAfterReady) {
      clearTimeout(safety);
      finish();
      process.exit(0);
    }
  }
  async function retire() {
    retiringRequested = true;
    if (!init || !owned || retirementHeld || retiring) return;
    retiring = true;
    if (member && !memberClosed) {
      const closed = new Promise<void>((resolve) => member?.once("close", () => resolve()));
      if (member.connected) member.send({ type: "member-retire", nonce: memberNonce }, () => {});
      await closed;
    }
    if (!memberClosed) return;
    clearTimeout(safety);
    send({
      ...envelope("fixture-released"),
      members: [{ pid: memberPid, token: memberNonce, closed: true }],
    });
    finish();
  }
  process.on("message", (value) => {
    const next = initialization(value);
    if (next && !init) {
      init = next;
      memberNonce = randomUUID();
      member = fork(fileURLToPath(import.meta.url), ["fixture-member"], {
        execArgv: process.execArgv,
        env: {},
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      member.once("close", () => {
        memberClosed = true;
      });
      member.once("error", () => {
        /* No false release; deadline owns the negative outcome. */
      });
      member.on("message", (report) => {
        if (
          messageType(report) !== "member-ready" ||
          !authenticated(report, memberNonce) ||
          !member?.pid
        )
          return;
        memberPid = member.pid;
        owned = true;
        send({ ...envelope("fixture-owned"), members: [{ pid: memberPid, token: memberNonce }] });
        ready();
        if (retiringRequested) void retire();
      });
      member.once("spawn", () =>
        member?.send({ type: "member-init", nonce: memberNonce }, () => {}),
      );
    } else if (
      init &&
      authenticated(value, init.nonce) &&
      value &&
      typeof value === "object" &&
      "generation" in value &&
      value.generation === init.generation
    ) {
      if (messageType(value) === "fixture-stale-ready") {
        send({ ...envelope("fixture-ready"), generation: init.generation + 1 });
        send({ ...envelope("fixture-ready"), nonce: "00000000-0000-0000-0000-000000000000" });
      }
      if (messageType(value) === "fixture-retire") void retire();
      if (messageType(value) === "fixture-release-ready") {
        readyHeld = false;
        ready();
      }
      if (messageType(value) === "fixture-release-retirement") {
        retirementHeld = false;
        void retire();
      }
      if (messageType(value) === "fixture-exit-parent") {
        clearTimeout(safety);
        finish();
        process.exit(0);
      }
    }
  });
  process.on("disconnect", () => {
    retirementHeld = false;
    void retire();
  });
}
