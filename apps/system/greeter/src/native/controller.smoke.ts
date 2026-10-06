import assert from "node:assert/strict";
import type {
  AuthReply,
  CancelReply,
  NativeGreetdClient,
  StartReply,
  // oxlint-disable-next-line import/no-relative-parent-imports -- Source-only native contract has no package export.
} from "../../../display-manager/src/native-greetd-client";
import { createNativeGreeterController } from "./controller";

const privateText = "PRIVATE-RESPONSE-MUST-NOT-APPEAR";
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Deferred not initialized");
  };
  let reject: (error: Error) => void = () => {
    throw new Error("Deferred not initialized");
  };
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function prompt(style: "secret" | "visible" | "info" | "error" = "secret"): AuthReply {
  return { kind: "prompt", style, message: privateText };
}
class Client implements NativeGreetdClient {
  events: string[] = [];
  auth: () => Promise<AuthReply> = async () => prompt();
  response: () => Promise<AuthReply> = async () => ({ kind: "authorized" });
  cancellation: () => Promise<CancelReply> = async () => ({ kind: "cancelled" });
  launch: () => Promise<StartReply> = async () => ({ kind: "committed" });
  authenticate(_username: string) {
    this.events.push("authenticate");
    return this.auth();
  }
  respond(_response: string | null) {
    this.events.push("respond");
    return this.response();
  }
  cancel() {
    this.events.push("cancel");
    return this.cancellation();
  }
  start() {
    this.events.push("start");
    return this.launch();
  }
  close() {
    this.events.push("close");
  }
}
function setup() {
  const client = new Client();
  const controller = createNativeGreeterController({ client });
  const observations: string[] = [];
  controller.subscribe(() => observations.push(JSON.stringify(controller.snapshot())));
  function ready() {
    const state = controller.snapshot();
    assert(state.kind === "ready");
    return state;
  }
  function currentPrompt() {
    const state = controller.snapshot();
    assert(state.kind === "prompt");
    return state;
  }
  return {
    client,
    controller,
    observations,
    ready,
    currentPrompt,
    begin: () => controller.begin("nativeuser", ready().revision),
    answer() {
      const state = currentPrompt();
      return controller.answer(state.attemptId, state.promptId, privateText);
    },
  };
}
async function tick() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
let cases = 0;
async function test(name: string, run: () => Promise<void>) {
  await run();
  cases++;
  console.log("ok " + name);
}

await test("prompt and attempt objects reject stale actions, copies and duplicate responses", async () => {
  const f = setup();
  f.client.response = async () => prompt();
  await f.begin();
  const original = f.currentPrompt();
  assert(Object.isFrozen(original));
  assert(Object.isFrozen(original.attemptId));
  assert(Object.isFrozen(original.promptId));
  await assert.rejects(
    f.controller.answer({ ...original.attemptId }, original.promptId, privateText),
  );
  await assert.rejects(
    f.controller.answer(original.attemptId, { ...original.promptId }, privateText),
  );
  await f.answer();
  const next = f.currentPrompt();
  assert.equal(next.attemptId, original.attemptId);
  assert.notEqual(next.promptId, original.promptId);
  await assert.rejects(f.controller.answer(original.attemptId, original.promptId, privateText));
  const reply = deferred<AuthReply>();
  f.client.response = () => reply.promise;
  const answering = f.answer();
  await assert.rejects(f.controller.answer(next.attemptId, next.promptId, privateText));
  reply.resolve(prompt());
  await answering;
  assert.equal(f.client.events.filter((event) => event === "respond").length, 2);
  const current = f.currentPrompt();
  await f.controller.cancel(current.attemptId);
  const revision = f.ready().revision;
  await assert.rejects(f.controller.begin("nativeuser", revision - 1));
  await f.begin();
  await assert.rejects(f.controller.cancel(original.attemptId));
  await assert.rejects(f.controller.answer(original.attemptId, original.promptId, privateText));
  await f.controller.dispose();
});

await test("pending answers serialize cancel and an authorized late reply never starts", async () => {
  const f = setup();
  const answer = deferred<AuthReply>();
  const cancel = deferred<CancelReply>();
  f.client.response = () => answer.promise;
  f.client.cancellation = () => cancel.promise;
  await f.begin();
  const state = f.currentPrompt();
  const answering = f.answer();
  await tick();
  const one = f.controller.cancel(state.attemptId);
  const two = f.controller.cancel(state.attemptId);
  await tick();
  assert.equal(f.controller.snapshot().kind, "cancelling");
  assert.deepEqual(f.client.events, ["authenticate", "respond"]);
  answer.resolve({ kind: "authorized" });
  await answering;
  await tick();
  assert.deepEqual(f.client.events, ["authenticate", "respond", "cancel"]);
  assert.equal(f.controller.snapshot().kind, "cancelling");
  cancel.resolve({ kind: "cancelled" });
  await Promise.all([one, two]);
  assert.equal(f.ready().revision, 1);
  await f.controller.dispose();
});

await test("start acknowledgement alone commits launch, disposals wait and cancel is forbidden", async () => {
  const f = setup();
  const start = deferred<StartReply>();
  f.client.launch = () => start.promise;
  await f.begin();
  const state = f.currentPrompt();
  const answering = f.answer();
  await tick();
  assert.equal(f.controller.snapshot().kind, "launching");
  await assert.rejects(f.controller.cancel(state.attemptId));
  await assert.rejects(f.controller.begin("nativeuser", 0));
  const disposing = f.controller.dispose();
  await tick();
  assert.deepEqual(f.client.events, ["authenticate", "respond", "start"]);
  start.resolve({ kind: "committed" });
  await Promise.all([answering, disposing]);
  assert.deepEqual(await f.controller.finished, { kind: "launch-committed" });
  assert.equal(f.controller.snapshot().kind, "launch-committed");
  assert.deepEqual(f.client.events, ["authenticate", "respond", "start", "close"]);
  assert(f.observations.every((value) => !value.includes('"kind":"running"')));
  assert.equal("logout" in f.controller, false);
});

await test("unknown launch and broker errors are terminal, with no false reset", async () => {
  for (const reason of [
    "start-unavailable",
    "start-failed",
    "start-error",
    "auth-error",
    "cancel-unavailable",
  ]) {
    const f = setup();
    if (reason === "auth-error")
      f.client.auth = async () => {
        throw new Error(privateText);
      };
    if (reason === "start-unavailable") f.client.launch = async () => ({ kind: "unavailable" });
    if (reason === "start-failed") f.client.launch = async () => ({ kind: "failed" });
    if (reason === "start-error")
      f.client.launch = async () => {
        throw new Error(privateText);
      };
    if (reason === "cancel-unavailable")
      f.client.cancellation = async () => ({ kind: "unavailable" });
    await f.begin();
    if (reason === "cancel-unavailable") await f.controller.cancel(f.currentPrompt().attemptId);
    else if (reason !== "auth-error") await f.answer();
    assert.equal(f.controller.snapshot().kind, "unavailable");
    assert.deepEqual(await f.controller.finished, { kind: "unavailable" });
    await assert.rejects(f.controller.begin("nativeuser", 0));
    assert(f.observations.every((value) => !value.includes(privateText)));
    assert.equal(f.client.events.filter((event) => event === "close").length, 1);
    if (reason.startsWith("start-")) assert.equal(f.client.events.includes("cancel"), false);
    await f.controller.dispose();
  }
});

await test("authentication denial resets only after the cancel acknowledgement", async () => {
  for (const reason of ["username-denial", "answer-denial"]) {
    const f = setup();
    const cancel = deferred<CancelReply>();
    f.client.cancellation = () => cancel.promise;
    if (reason === "username-denial") f.client.auth = async () => ({ kind: "denied" });
    if (reason === "answer-denial") f.client.response = async () => ({ kind: "denied" });
    const initialRevision = f.ready().revision;
    const beginning = f.begin();
    await tick();
    const operation = reason === "username-denial" ? beginning : f.answer();
    await tick();
    assert.equal(f.controller.snapshot().kind, "cancelling");
    await assert.rejects(f.controller.begin("nativeuser", initialRevision));
    cancel.resolve({ kind: "cancelled" });
    await Promise.all([beginning, operation]);
    assert.equal(f.ready().revision, initialRevision + 1);
    assert.equal(f.client.events.filter((event) => event === "cancel").length, 1);
    assert.equal(f.client.events.includes("close"), false);
    await f.controller.dispose();
  }
});

await test("observers cannot duplicate operations or cancel a launching transition", async () => {
  const f = setup();
  const nested: Promise<void>[] = [];
  let cancellations = 0;
  let attemptedBegin = false;
  f.controller.subscribe(() => {
    const state = f.controller.snapshot();
    if (state.kind === "authenticating" && !attemptedBegin) {
      attemptedBegin = true;
      nested.push(assert.rejects(f.controller.begin("nativeuser", 0)));
    }
    if (state.kind === "cancelling" && cancellations++ === 0)
      nested.push(f.controller.cancel(state.attemptId));
    if (state.kind === "launching")
      nested.push(assert.rejects(f.controller.cancel(state.attemptId)));
  });
  f.controller.subscribe(() => {
    throw new Error(privateText);
  });
  await f.begin();
  await f.controller.cancel(f.currentPrompt().attemptId);
  await Promise.all(nested);
  assert.deepEqual(f.client.events, ["authenticate", "cancel"]);
  await f.begin();
  await f.answer();
  await Promise.all(nested);
  assert.deepEqual(f.client.events, [
    "authenticate",
    "cancel",
    "authenticate",
    "respond",
    "start",
    "close",
  ]);
  assert.deepEqual(await f.controller.finished, { kind: "launch-committed" });
  await f.controller.dispose();
});

await test("cancel cannot turn a pending authentication EOF into a fresh attempt", async () => {
  const f = setup();
  const response = deferred<AuthReply>();
  f.client.response = () => response.promise;
  await f.begin();
  const state = f.currentPrompt();
  const answering = f.answer();
  const cancelling = f.controller.cancel(state.attemptId);
  response.reject(new Error(privateText));
  await Promise.all([answering, cancelling]);
  assert.equal(f.controller.snapshot().kind, "unavailable");
  assert.equal(f.client.events.includes("cancel"), false);
  assert.deepEqual(await f.controller.finished, { kind: "unavailable" });
  await f.controller.dispose();
});

await test("all prompt styles, public validation errors and state exclude broker secrets", async () => {
  for (const style of ["visible", "secret", "info", "error"] satisfies Array<
    "visible" | "secret" | "info" | "error"
  >) {
    const f = setup();
    f.client.auth = async () => prompt(style);
    await assert.rejects(f.controller.begin(privateText + "\0", 0), (error: unknown) => {
      assert(error instanceof Error);
      return !error.message.includes(privateText);
    });
    await f.begin();
    const state = f.currentPrompt();
    if (style === "info" || style === "error")
      await assert.rejects(f.controller.answer(state.attemptId, state.promptId, privateText));
    else await assert.rejects(f.controller.answer(state.attemptId, state.promptId, null));
    await f.controller.answer(
      state.attemptId,
      state.promptId,
      style === "info" || style === "error" ? null : "",
    );
    assert(f.observations.every((value) => !value.includes(privateText)));
    await f.controller.dispose();
  }
});

await test("dispose during pending auth releases local ownership without asserting cancellation", async () => {
  const f = setup();
  const auth = deferred<AuthReply>();
  f.client.auth = () => auth.promise;
  const beginning = f.begin();
  await tick();
  await Promise.all([f.controller.dispose(), f.controller.dispose()]);
  assert.deepEqual(await f.controller.finished, { kind: "unavailable" });
  assert.deepEqual(f.client.events, ["authenticate", "close"]);
  auth.resolve({ kind: "authorized" });
  await beginning;
  assert.equal(f.controller.snapshot().kind, "unavailable");
  assert.deepEqual(f.client.events, ["authenticate", "close"]);
});

await test("reentrant cancellation before an authentication reply preserves request order", async () => {
  const f = setup();
  f.client.auth = async () => ({ kind: "authorized" });
  let cancelled: Promise<void> | null = null;
  f.controller.subscribe(() => {
    const state = f.controller.snapshot();
    if (state.kind === "authenticating") cancelled = f.controller.cancel(state.attemptId);
  });
  await f.begin();
  assert(cancelled);
  await cancelled;
  assert.deepEqual(f.client.events, ["authenticate", "cancel"]);
  assert.equal(f.ready().revision, 1);
  await f.controller.dispose();
});

await test("reentrant disposal at launch publication keeps ownership until a failure reply", async () => {
  for (const outcome of ["unavailable", "failed"] satisfies Array<StartReply["kind"]>) {
    const f = setup();
    const start = deferred<StartReply>();
    f.client.launch = () => start.promise;
    let disposing: Promise<void> | null = null;
    f.controller.subscribe(() => {
      if (f.controller.snapshot().kind === "launching") disposing = f.controller.dispose();
    });
    await f.begin();
    const answering = f.answer();
    await tick();
    assert(disposing);
    assert.deepEqual(f.client.events, ["authenticate", "respond", "start"]);
    start.resolve({ kind: outcome });
    await Promise.all([answering, disposing]);
    assert.deepEqual(await f.controller.finished, { kind: "unavailable" });
    assert.deepEqual(f.client.events, ["authenticate", "respond", "start", "close"]);
    await assert.rejects(f.controller.begin("nativeuser", 0));
  }
});

console.log(
  JSON.stringify({ suite: "native greeter frontend controller", cases, actualExitCode: 0 }),
);
