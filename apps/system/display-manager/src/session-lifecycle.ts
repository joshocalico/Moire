/** Device-free fixture authority. IPC ownership never proves a native seat/logind/cgroup. */
import { type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  loginId,
  type GreeterIdentity,
  type UserSessionIdentity,
  type LoginId,
  type ReleaseResult,
  type SessionLifecycleAuthority,
  type SessionSelection,
} from "./types";
import { spawnFixtureProcess, type FixtureProcessOptions } from "./testing/fixture-process";
export type FixtureLaunchRequest = Readonly<{ attemptId: LoginId; selection: SessionSelection }>;
export type FixtureLaunchContext = Readonly<{
  nonce: string;
  generation: number;
  signal: AbortSignal;
  onSpawn: (child: ChildProcess) => void;
}>;
export type FixtureLifecycleOptions = Readonly<{
  qualification: "fixture";
  launchSession: (
    request: FixtureLaunchRequest,
    context: FixtureLaunchContext,
  ) => ChildProcess | Promise<ChildProcess>;
  launchGreeter?: (context: FixtureLaunchContext) => ChildProcess | Promise<ChildProcess>;
  greeterOptions?: FixtureProcessOptions;
  startupTimeoutMs?: number;
  cleanupTimeoutMs?: number;
}>;
type Identity = GreeterIdentity | UserSessionIdentity;
type Member = Readonly<{ pid: number; token: string }>;
type Owned = {
  role: "greeter" | "session";
  identity: Identity;
  nonce: string;
  scope: AbortController;
  child: ChildProcess | null;
  launched: boolean;
  launchFailed: boolean;
  launchInvoked: boolean;
  callbackSettled: boolean;
  protocolFailed: boolean;
  closed: boolean;
  members: readonly Member[] | null;
  ready: boolean;
  releaseAck: boolean;
  retired: boolean;
  released: boolean;
  cleanup: Promise<boolean> | null;
};
type Launch = { record: Owned | null; canceled: boolean; selectionGeneration: string | null };
export type FixtureLifecycle = SessionLifecycleAuthority & {
  diagnostics(): readonly Readonly<{
    role: "greeter" | "session";
    identity: Identity;
    pid: number | null;
    parentClosed: boolean;
    descendantCount: number;
    released: boolean;
  }>[];
};
function members(value: unknown): readonly Member[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return null;
  const parsed: Member[] = [];
  for (const member of value) {
    if (
      !member ||
      typeof member !== "object" ||
      !("pid" in member) ||
      typeof member.pid !== "number" ||
      !Number.isSafeInteger(member.pid) ||
      member.pid <= 1 ||
      !("token" in member) ||
      typeof member.token !== "string" ||
      !/^[a-f0-9-]{36}$/.test(member.token) ||
      parsed.some((entry) => entry.pid === member.pid || entry.token === member.token)
    )
      return null;
    parsed.push({ pid: member.pid, token: member.token });
  }
  return parsed;
}
function gone(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (cause) {
    return !!cause && typeof cause === "object" && "code" in cause && cause.code === "ESRCH";
  }
}
async function until(check: () => boolean, timeout: number): Promise<boolean> {
  const deadline = performance.now() + timeout;
  while (!check()) {
    if (performance.now() >= deadline) return false;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(10, Math.max(1, deadline - performance.now()))),
    );
  }
  return true;
}
function sameIdentity(a: Identity, b: Identity): boolean {
  return b.qualification === "fixture" && a.id === b.id && a.generation === b.generation;
}
export function createFixtureLifecycle(options: FixtureLifecycleOptions): FixtureLifecycle {
  const startup = options.startupTimeoutMs ?? 4000,
    cleanup = options.cleanupTimeoutMs ?? 2000;
  if (
    options.qualification !== "fixture" ||
    typeof options.launchSession !== "function" ||
    !Number.isInteger(startup) ||
    startup < 10 ||
    startup > 10000 ||
    !Number.isInteger(cleanup) ||
    cleanup < 10 ||
    cleanup > 10000
  )
    throw new Error("Invalid fixture lifecycle options");
  let generation = 0,
    disposed = false;
  const records = new Map<LoginId, Owned>(),
    launches = new Map<LoginId, Launch>();
  function allocate(role: Owned["role"]): Owned {
    if (records.size >= 128) throw new Error("Fixture lifecycle identity budget exhausted");
    const record: Owned = {
      role,
      identity: { qualification: "fixture", id: loginId(randomUUID()), generation: ++generation },
      nonce: randomUUID(),
      scope: new AbortController(),
      child: null,
      launched: false,
      launchFailed: false,
      launchInvoked: false,
      callbackSettled: false,
      protocolFailed: false,
      closed: false,
      members: null,
      ready: false,
      releaseAck: false,
      retired: false,
      released: false,
      cleanup: null,
    };
    records.set(record.identity.id, record);
    return record;
  }
  function context(record: Owned): FixtureLaunchContext {
    return {
      nonce: record.nonce,
      generation: record.identity.generation,
      signal: record.scope.signal,
      onSpawn: (child) => bind(record, child),
    };
  }
  function send(record: Owned, type: string): void {
    const child = record.child;
    if (child?.connected) {
      try {
        child.send({ type, nonce: record.nonce, generation: record.identity.generation }, () => {});
      } catch {
        /* IPC failure cannot establish release. ChildProcess close remains observed. */
      }
    }
  }
  function bind(record: Owned, child: ChildProcess): void {
    if (record.child === child) return;
    if (record.child) {
      record.protocolFailed = true;
      record.released = false;
      throw new Error("Fixture launcher produced multiple parent handles");
    }
    record.child = child;
    record.launched = true;
    child.once("error", () => {
      record.launchFailed = true;
    });
    child.once("close", () => {
      record.closed = true;
    });
    child.on("message", (value) => {
      if (
        !value ||
        typeof value !== "object" ||
        !("nonce" in value) ||
        value.nonce !== record.nonce ||
        !("generation" in value) ||
        value.generation !== record.identity.generation ||
        !("role" in value) ||
        value.role !== record.role ||
        !("type" in value)
      )
        return;
      if (value.type === "fixture-owned" && !record.members && "members" in value) {
        const observed = members(value.members);
        if (observed && observed.every((member) => member.pid !== child.pid))
          record.members = observed;
      } else if (value.type === "fixture-ready" && record.members && !record.retired)
        record.ready = true;
      else if (value.type === "fixture-released" && record.members && "members" in value) {
        const observed = members(value.members);
        if (
          observed &&
          observed.length === record.members.length &&
          observed.every(
            (member, index) =>
              member.pid === record.members?.[index]?.pid &&
              member.token === record.members?.[index]?.token,
          ) &&
          Array.isArray(value.members) &&
          value.members.every(
            (member: unknown) =>
              !!member &&
              typeof member === "object" &&
              "closed" in member &&
              member.closed === true,
          )
        )
          record.releaseAck = true;
      }
    });
    const initialize = () => {
      if (child.connected) {
        try {
          child.send(
            {
              type: "fixture-init",
              nonce: record.nonce,
              generation: record.identity.generation,
              role: record.role,
            },
            () => {},
          );
        } catch {
          record.launchFailed = true;
        }
      } else record.launchFailed = true;
      if (record.retired) send(record, "fixture-retire");
    };
    if (child.pid) initialize();
    else child.once("spawn", initialize);
  }
  function start(record: Owned, launch: () => ChildProcess | Promise<ChildProcess>): void {
    void Promise.resolve()
      .then(() => {
        if (record.retired) throw new Error("Fixture launch canceled before scheduling");
        record.launchInvoked = true;
        return launch();
      })
      .then((child) => {
        bind(record, child);
        record.callbackSettled = true;
        if (record.retired) void retire(record);
      })
      .catch(() => {
        record.launchFailed = true;
        record.callbackSettled = true;
        record.launched = true;
      });
  }
  async function retire(record: Owned): Promise<boolean> {
    if (record.released) return true;
    if (record.cleanup) return record.cleanup;
    record.retired = true;
    // Do not abort a spawned supervisor: Node spawn abort may orphan descendants.
    // Pending launch handles remain owned/blocked until the injected callback settles.
    const pending = (async () => {
      if (!(await until(() => record.launched, cleanup))) return false;
      if (!record.child) {
        record.released = record.launchFailed && !record.launchInvoked;
        if (record.released) record.scope.abort();
        return record.released;
      }
      send(record, "fixture-retire");
      const complete = await until(
        () =>
          !record.protocolFailed &&
          record.callbackSettled &&
          record.closed &&
          record.releaseAck &&
          record.members !== null &&
          record.members.every((member) => gone(member.pid)),
        cleanup,
      );
      record.released = complete;
      if (complete) record.scope.abort();
      return complete;
    })();
    record.cleanup = pending;
    try {
      return await pending;
    } finally {
      if (record.cleanup === pending) record.cleanup = null;
    }
  }
  async function retireIdentity<T extends Identity>(
    identity: T,
    role: Owned["role"],
  ): Promise<ReleaseResult<T>> {
    const record = records.get(identity.id);
    if (!record || record.role !== role || !sameIdentity(record.identity, identity))
      return { kind: "unresolved", message: "Fixture identity or generation is stale" };
    return (await retire(record))
      ? { kind: "released", identity }
      : { kind: "unresolved", message: "Fixture descendant retirement is unproven" };
  }
  return {
    qualification: "fixture",
    diagnostics: () =>
      Array.from(records.values(), (record) => ({
        role: record.role,
        identity: record.identity,
        pid: record.child?.pid ?? null,
        parentClosed: record.closed,
        descendantCount: record.members?.length ?? 0,
        released: record.released,
      })),
    async createGreeter() {
      if (disposed || Array.from(records.values()).some((record) => !record.released))
        throw new Error("Fixture admission is blocked by an owned lifetime");
      const record = allocate("greeter");
      start(record, () =>
        options.launchGreeter
          ? options.launchGreeter(context(record))
          : spawnFixtureProcess(options.greeterOptions),
      );
      if (
        !(await until(
          () =>
            (record.ready && record.callbackSettled) ||
            record.closed ||
            record.launchFailed ||
            record.retired,
          startup,
        )) ||
        !record.ready ||
        !record.callbackSettled ||
        record.launchFailed ||
        record.protocolFailed ||
        record.retired ||
        record.closed
      ) {
        await retire(record);
        throw new Error("Fixture greeter startup is unproven");
      }
      return record.identity;
    },
    retireGreeter: (identity) => retireIdentity(identity, "greeter"),
    async observeStarted(request) {
      if (disposed) throw new Error("Fixture lifecycle is disposed");
      let launch = launches.get(request.attemptId);
      if (launch?.canceled) throw new Error("Fixture launch was canceled");
      if (
        launch?.record ||
        (launch?.selectionGeneration !== null && launch?.selectionGeneration !== undefined)
      )
        throw new Error("Fixture launch attempt was already observed");
      if (Array.from(records.values()).some((record) => !record.released))
        throw new Error("Greeter or previous fixture session has not retired");
      const record = allocate("session");
      launch = { record, canceled: false, selectionGeneration: request.selection.generation };
      launches.set(request.attemptId, launch);
      start(record, () => options.launchSession(request, context(record)));
      if (
        !(await until(
          () =>
            (record.ready && record.callbackSettled) ||
            record.closed ||
            record.launchFailed ||
            record.retired,
          startup,
        )) ||
        !record.ready ||
        !record.callbackSettled ||
        record.launchFailed ||
        record.protocolFailed ||
        record.closed ||
        record.retired
      ) {
        launch.canceled = true;
        await retire(record);
        throw new Error("Fixture session startup is unproven");
      }
      return record.identity;
    },
    async cancelLaunch(attemptId) {
      let launch = launches.get(attemptId);
      if (!launch) {
        if (launches.size >= 128)
          return { kind: "unresolved", message: "Fixture launch identity budget exhausted" };
        launch = { record: null, canceled: true, selectionGeneration: null };
        launches.set(attemptId, launch);
      }
      launch.canceled = true;
      return !launch.record || (await retire(launch.record))
        ? { kind: "released", identity: attemptId }
        : { kind: "unresolved", message: "Fixture pending launch retirement is unproven" };
    },
    retireSession: (identity) => retireIdentity(identity, "session"),
    async dispose() {
      disposed = true;
      for (const launch of launches.values()) launch.canceled = true;
      const outcomes = await Promise.all(Array.from(records.values(), retire));
      if (outcomes.some((released) => !released))
        throw new Error("Fixture cleanup remains unresolved");
    },
  };
}
