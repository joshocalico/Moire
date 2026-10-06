import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionBus } from "@moire/dbus";
import {
  STORAGE_BUS,
  STORAGE_INTERFACE,
  STORAGE_PATH,
  StorageControlError,
  observeStorageStatus,
  parseStorageSnapshot,
  parseStorageVolumeId,
  type StorageAdapter,
  type StorageState,
  type StorageVolumeId,
  type StorageClient,
} from "@moire/system-management/storage-status";
import { attachStorageControls } from "./storage-controls";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string) {
  const deadline = performance.now() + 4000;
  while (!check()) {
    if (performance.now() >= deadline) throw new Error(`Timed out: ${label}`);
    await sleep(5);
  }
}
class StorageFixture implements StorageAdapter {
  state: StorageState = {
    status: { kind: "ready", policy: "interactive", volumes: [] },
    operation: { kind: "idle" },
  };
  listeners = new Set<() => void>();
  calls: { action: "mount" | "unmount" | "eject"; id: StorageVolumeId }[] = [];
  refreshes = 0;
  disposals = 0;
  hold = false;
  failure: StorageControlError | null = null;
  release: (() => void) | null = null;
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  publish(state: StorageState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  async refresh() {
    this.refreshes++;
    this.publish(structuredClone(this.state));
  }
  async run(action: "mount" | "unmount" | "eject", id: StorageVolumeId) {
    this.calls.push({ action, id });
    this.publish({ ...this.state, operation: { kind: "pending", action, id } });
    if (this.hold) await new Promise<void>((resolve) => (this.release = resolve));
    if (this.failure) {
      this.publish({
        ...this.state,
        operation: {
          kind: "error",
          action,
          id,
          code: this.failure.code,
          message: this.failure.message,
        },
      });
      throw this.failure;
    }
    this.publish({ ...this.state, operation: { kind: "idle" } });
  }
  mount(id: StorageVolumeId) {
    return this.run("mount", id);
  }
  unmount(id: StorageVolumeId) {
    return this.run("unmount", id);
  }
  eject(id: StorageVolumeId) {
    return this.run("eject", id);
  }
  async dispose() {
    this.disposals++;
    this.release?.();
    this.listeners.clear();
  }
}

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-storage-wire-"));
const daemon = spawn(
  process.env.MOIRE_TEST_DBUS_DAEMON ?? "dbus-daemon",
  [
    process.env.MOIRE_TEST_DBUS_CONFIG
      ? `--config-file=${process.env.MOIRE_TEST_DBUS_CONFIG}`
      : "--session",
    "--nofork",
    "--nopidfile",
    `--address=unix:path=${path.join(directory, "bus")}`,
    "--print-address=1",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const exited = once(daemon, "exit");
let address = "",
  stderr = "",
  daemonError: Error | null = null;
daemon.stdout.on("data", (bytes) => {
  address += bytes.toString();
});
daemon.stderr.on("data", (bytes) => {
  stderr += bytes.toString();
});
daemon.on("error", (error) => {
  daemonError = error;
});
const buses: SessionBus[] = [];
const services: ReturnType<typeof attachStorageControls>[] = [];
const observers: StorageClient[] = [];
const errors: unknown[] = [];
try {
  await until(
    () => address.includes("\n") || daemonError !== null || daemon.exitCode !== null,
    "daemon",
  );
  if (daemonError) throw daemonError;
  assert(address.startsWith("unix:"), stderr);
  async function connect() {
    const bus = await SessionBus.connect(address.trim());
    buses.push(bus);
    return bus;
  }
  const server = await connect(),
    client = await connect();
  assert.equal(await server.requestName(STORAGE_BUS, 4), 1);
  const adapter = new StorageFixture();
  const controls = attachStorageControls(server, {
    adapter,
    onError: (error) => errors.push(error),
  });
  services.push(controls);
  const id = parseStorageVolumeId("/org/freedesktop/UDisks2/block_devices/sdb1");
  async function call(
    member: string,
    signature = "",
    body: unknown[] = [],
    destination = STORAGE_BUS,
  ) {
    return client.call(
      { destination, path: STORAGE_PATH, interface: STORAGE_INTERFACE, member, signature, body },
      { timeoutMs: 3000 },
    );
  }
  async function read() {
    return parseStorageSnapshot((await call("GetStatus")).body?.[0]);
  }
  let changed = 0;
  const removeChanged = await client.subscribeSignal(
    { sender: STORAGE_BUS, path: STORAGE_PATH, interface: STORAGE_INTERFACE, member: "Changed" },
    (message) => {
      parseStorageSnapshot(message.body?.[0]);
      changed++;
    },
  );
  const first = await read();
  assert.equal(first.revision, 1);
  await call("Refresh");
  await sleep(20);
  assert.equal((await read()).revision, 1, "identical refresh has no semantic revision");
  assert.equal(changed, 0);
  await assert.rejects(call("GetStatus", "s", ["unexpected"]), /arguments/);
  await assert.rejects(call("Refresh", "u", [1]), /arguments/);
  await assert.rejects(call("Mount", "sd", [id, 1]), /arguments/);
  await assert.rejects(call("Mount", "su", ["", 1]), /Invalid/);
  await assert.rejects(call("Mount", "su", [id, 0]), /changed/);
  assert.equal(adapter.calls.length, 0, "wire rejection never reaches backend");
  await call("Mount", "su", [id, first.revision]);
  assert.deepEqual(adapter.calls, [{ action: "mount", id }]);
  await until(() => changed === 2, "pending and authoritative settled state");
  const mounted = await read();
  await assert.rejects(call("Unmount", "su", [id, first.revision]), /changed/);
  await call("Unmount", "su", [id, mounted.revision]);
  adapter.hold = true;
  const pending = call("Eject", "su", [id, (await read()).revision]);
  await until(() => adapter.release !== null, "held backend request");
  await assert.rejects(call("Mount", "su", [id, (await read()).revision]), /pending/);
  await assert.rejects(call("Refresh"), /pending/, "an actively dispatched RPC owns the adapter");
  assert.equal(adapter.calls.length, 3, "no retry or parallel dispatch");
  adapter.publish({
    status: { kind: "unavailable", message: "owner disappeared" },
    operation: {
      kind: "unknown",
      id,
      action: "eject",
      code: "unknown",
      message: "Outcome unknown",
    },
  });
  const lost = await read();
  assert.equal(lost.status.kind, "unavailable");
  assert.equal(
    lost.operation.kind,
    "unknown",
    "discovery loss does not erase operation uncertainty",
  );
  adapter.release?.();
  await pending;
  adapter.hold = false;
  adapter.failure = new StorageControlError("permission", "Authorization denied");
  await assert.rejects(
    call("Mount", "su", [id, (await read()).revision]),
    /org.moire.Storage1.Error.permission/,
  );
  assert.equal((await read()).operation.kind, "error");
  const beforeDispose = changed;
  const d1 = controls.dispose(),
    d2 = controls.dispose();
  assert.equal(d1, d2, "idempotent async disposal");
  await d1;
  assert.equal(adapter.disposals, 1);
  assert.equal(adapter.listeners.size, 0);
  adapter.publish({ status: { kind: "loading", message: "late" }, operation: { kind: "idle" } });
  await sleep(20);
  assert.equal(changed, beforeDispose, "retired service never emits late state");
  await assert.rejects(call("GetStatus"), /UnknownMethod/);
  await removeChanged();
  server.close();
  const replacement = await connect();
  assert.equal(await replacement.requestName(STORAGE_BUS, 4), 1);
  const replacementAdapter = new StorageFixture();
  const replacementControls = attachStorageControls(replacement, { adapter: replacementAdapter });
  services.push(replacementControls);
  assert.notEqual(replacement.name, server.name);
  assert.equal((await read()).revision, 1, "replacement has independent revision authority");
  await assert.rejects(
    call("Mount", "su", [id, 1], server.name ?? "invalid"),
    /ServiceUnknown|NameHasNoOwner/,
  );
  assert.equal(
    replacementAdapter.calls.length,
    0,
    "old unique destination cannot mutate replacement",
  );
  replacement.close();
  await until(() => replacementAdapter.disposals === 1, "disconnect disposes adapter");

  const observedBus = await connect();
  let observations = 0;
  const observer = await observeStorageStatus(observedBus, () => observations++, {
    actionTimeoutMs: 1000,
  });
  observers.push(observer);
  await until(() => observer.state.kind === "unavailable", "no service authority");
  const owner = await connect();
  const observedAdapter = new StorageFixture();
  const observedControls = attachStorageControls(owner, { adapter: observedAdapter });
  services.push(observedControls);
  assert.equal(await owner.requestName(STORAGE_BUS, 4), 1);
  await until(
    () => observer.state.kind === "ready" && observer.state.owner === owner.name,
    "production client GetStatus",
  );
  function ready() {
    const state = observer.state;
    assert.equal(state.kind, "ready");
    if (state.kind !== "ready") throw new Error("Expected actual ready client");
    return state;
  }
  const captured = ready();
  await observer.mount({ owner: captured.owner, id, revision: captured.snapshot.revision });
  assert.equal(observedAdapter.calls.length, 1);
  await assert.rejects(
    observer.eject({ owner: captured.owner, id, revision: captured.snapshot.revision }),
    (error: unknown) => error instanceof StorageControlError && error.code === "gone",
  );
  observedAdapter.failure = new StorageControlError("readonly", "Read-only fixture policy");
  await assert.rejects(
    observer.unmount({ owner: ready().owner, id, revision: ready().snapshot.revision }),
    (error: unknown) => error instanceof StorageControlError && error.code === "readonly",
  );
  observedAdapter.failure = null;
  observedAdapter.publish({
    status: {
      kind: "ready",
      policy: "interactive",
      volumes: [
        {
          id,
          label: "Actual fixture drive",
          device: "/dev/fixture-only",
          filesystem: "ext4",
          sizeBytes: 4096,
          canEject: true,
          mount: { kind: "mounted", paths: ["/media/fixture"] },
        },
      ],
    },
    operation: { kind: "idle" },
  });
  await until(
    () => ready().snapshot.revision === observedControls.snapshot().revision,
    "hotplug metadata",
  );
  const hotplugRevision = ready().snapshot.revision;
  await observer.refresh();
  assert.equal(
    ready().snapshot.revision,
    hotplugRevision,
    "identical full volume fields do not churn revision",
  );
  observedAdapter.publish({
    ...observedAdapter.state,
    operation: { kind: "pending", action: "mount", id },
  });
  await until(() => ready().snapshot.operation.kind === "pending", "pending observation");
  await observer.refresh();
  assert.equal(
    ready().snapshot.operation.kind,
    "pending",
    "readback is allowed for an unresolved backend observation",
  );
  observedAdapter.publish({ ...observedAdapter.state, operation: { kind: "idle" } });
  await until(() => ready().snapshot.operation.kind === "idle", "settled readback");
  const intruder = await connect();
  const beforeSpoof = ready().snapshot.revision;
  intruder.emitSignal({
    path: STORAGE_PATH,
    interface: STORAGE_INTERFACE,
    member: "Changed",
    signature: "s",
    body: [JSON.stringify({ ...observedControls.snapshot(), revision: 999 })],
  });
  await sleep(20);
  assert.equal(ready().snapshot.revision, beforeSpoof, "unowned producer cannot spoof Changed");
  owner.emitSignal({
    path: STORAGE_PATH,
    interface: STORAGE_INTERFACE,
    member: "Changed",
    signature: "u",
    body: [1],
  });
  await until(() => observer.state.kind === "error", "malformed signal signature rejected");
  await observer.refresh();
  assert.equal(
    observer.state.kind,
    "ready",
    "read-only refresh recovers from invalid wire observation",
  );
  owner.emitSignal({
    path: STORAGE_PATH,
    interface: STORAGE_INTERFACE,
    member: "Changed",
    signature: "s",
    body: ["{}"],
  });
  await until(() => observer.state.kind === "error", "malformed snapshot rejected");
  await observer.refresh();
  const oldRequest = { owner: ready().owner, id, revision: ready().snapshot.revision };
  observedAdapter.hold = true;
  const timedOut = observer.mount(oldRequest).then(
    () => null,
    (error: unknown) => error,
  );
  await until(() => observedAdapter.release !== null, "timed action reached fixture");
  const timeoutError = await timedOut;
  assert(timeoutError instanceof StorageControlError);
  assert.equal(
    timeoutError.code,
    "unknown",
    "bounded client timeout preserves outcome uncertainty",
  );
  assert.equal(ready().snapshot.operation.kind, "pending");
  const timedCalls = observedAdapter.calls.length;
  await assert.rejects(
    observer.mount({ owner: ready().owner, id, revision: ready().snapshot.revision }),
    (error: unknown) => error instanceof StorageControlError && error.code === "busy",
  );
  assert.equal(
    observedAdapter.calls.length,
    timedCalls,
    "timeout does not retry a pending mutation",
  );
  observedAdapter.release?.();
  await until(
    () => ready().snapshot.operation.kind === "idle",
    "late actual completion settles via Changed",
  );
  observedAdapter.release = null;
  const interruptedRequest = { owner: ready().owner, id, revision: ready().snapshot.revision };
  observedAdapter.hold = true;
  const interrupted = observer.eject(interruptedRequest).then(
    () => null,
    (error: unknown) => error,
  );
  await until(() => observedAdapter.release !== null, "production client action in flight");
  owner.close();
  await until(() => observer.state.kind === "unavailable", "owner loss revokes client readiness");
  const nextOwner = await connect();
  const nextAdapter = new StorageFixture();
  services.push(attachStorageControls(nextOwner, { adapter: nextAdapter }));
  assert.equal(await nextOwner.requestName(STORAGE_BUS, 4), 1);
  await until(
    () => observer.state.kind === "ready" && observer.state.owner === nextOwner.name,
    "replacement authority",
  );
  const interruptedError = await interrupted;
  assert(interruptedError instanceof StorageControlError);
  assert.equal(
    interruptedError.code,
    "unknown",
    "replacement never claims interrupted action success",
  );
  await assert.rejects(
    observer.mount(oldRequest),
    (error: unknown) => error instanceof StorageControlError && error.code === "gone",
  );
  assert.equal(nextAdapter.calls.length, 0, "captured old owner cannot reach replacement");
  nextOwner.close();
  const finalOwner = await connect();
  const finalAdapter = new StorageFixture();
  const finalControls = attachStorageControls(finalOwner, { adapter: finalAdapter });
  services.push(finalControls);
  assert.equal(await finalOwner.requestName(STORAGE_BUS, 4), 1);
  await until(
    () => observer.state.kind === "ready" && observer.state.owner === finalOwner.name,
    "rapid replacement remains current",
  );
  const removeListener = observer.subscribe(() => {});
  const disposeClient1 = observer.dispose(),
    disposeClient2 = observer.dispose();
  assert.equal(disposeClient1, disposeClient2);
  await disposeClient1;
  removeListener();
  const afterClientDispose = observations;
  finalAdapter.publish({
    status: { kind: "unavailable", message: "late" },
    operation: { kind: "idle" },
  });
  await sleep(20);
  assert.equal(observations, afterClientDispose, "disposed client receives no late callbacks");
  await finalControls.dispose();
  const removeMalformed = finalOwner.exportObject(STORAGE_PATH, {
    name: STORAGE_INTERFACE,
    methods: {
      GetStatus: { inSignature: "", outSignature: "u", handler: () => ({ body: [1] }) },
    },
  });
  const recovering = await observeStorageStatus(await connect(), () => {});
  observers.push(recovering);
  await until(() => recovering.state.kind === "error", "malformed GetStatus reply rejected");
  removeMalformed();
  const recoveredAdapter = new StorageFixture();
  services.push(attachStorageControls(finalOwner, { adapter: recoveredAdapter }));
  await recovering.refresh();
  assert.equal(recovering.state.kind, "ready", "client refresh recovers malformed initial reply");
  daemon.kill("SIGTERM");
  await until(
    () => recovering.state.kind === "unavailable",
    "daemon loss revokes client authority",
  );
  await until(() => recoveredAdapter.disposals === 1, "daemon loss disposes service resources");
  assert.equal(errors.length, 0);
  console.log(
    "Storage1 private-bus ingress, semantic revisions, actions, uncertainty, replacement and teardown passed",
  );
} finally {
  for (const observer of observers) await observer.dispose();
  for (const service of services) await service.dispose();
  for (const bus of buses) bus.close();
  if (daemon.exitCode === null) daemon.kill("SIGTERM");
  await Promise.race([exited, sleep(2000)]);
  if (daemon.exitCode === null && daemon.signalCode === null) {
    daemon.kill("SIGKILL");
    await Promise.race([exited, sleep(2000)]);
  }
  assert(daemon.exitCode !== null || daemon.signalCode !== null, "owned daemon retired");
  await fs.rm(directory, { recursive: true, force: true });
}
