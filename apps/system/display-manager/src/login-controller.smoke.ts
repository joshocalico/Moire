import assert from "node:assert/strict";
import { createLoginController } from "./login-controller";
import {
  loginId,
  type BrokerReply,
  type LoginBroker,
  type GreeterIdentity,
  type UserSessionIdentity,
  type SessionLifecycleAuthority,
  type SessionSelection,
} from "./types";
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string) {
  const end = performance.now() + 2000;
  while (!check()) {
    if (performance.now() > end) throw new Error("Timeout " + label);
    await delay(2);
  }
}
function deferred<T>() {
  let complete: (value: T) => void = () => {
    throw new Error("Deferred not initialized");
  };
  const promise = new Promise<T>((resolve) => {
    complete = resolve;
  });
  return { promise, complete };
}
class Life implements SessionLifecycleAuthority {
  qualification = "fixture" as const;
  serial = 0;
  greeters = 0;
  started = 0;
  stopped = 0;
  canceled = 0;
  events: string[] = [];
  holdGreeter = false;
  holdRetire = false;
  holdObserve = false;
  holdStop = false;
  cancelUnresolved = false;
  retireUnresolved = false;
  stopUnresolved = false;
  greeterWait = deferred<GreeterIdentity>();
  retireWait = deferred<void>();
  observeWait = deferred<void>();
  stopWait = deferred<void>();
  async createGreeter() {
    this.greeters++;
    if (this.holdGreeter) return this.greeterWait.promise;
    this.events.push("greeter");
    return {
      id: loginId("greeter_" + ++this.serial),
      generation: this.serial,
      qualification: "fixture" as const,
    };
  }
  async retireGreeter(identity: GreeterIdentity) {
    this.events.push("retire-greeter");
    if (this.holdRetire) await this.retireWait.promise;
    return this.retireUnresolved
      ? { kind: "unresolved" as const, message: "unresolved" }
      : { kind: "released" as const, identity };
  }
  async observeStarted() {
    this.events.push("observe-started");
    this.started++;
    if (this.holdObserve) await this.observeWait.promise;
    return {
      id: loginId("session_" + ++this.serial),
      generation: this.serial,
      qualification: "fixture" as const,
    };
  }
  async cancelLaunch(attemptId: ReturnType<typeof loginId>) {
    this.events.push("cancel-launch");
    this.canceled++;
    return this.cancelUnresolved
      ? { kind: "unresolved" as const, message: "unresolved" }
      : { kind: "released" as const, identity: attemptId };
  }
  async retireSession(identity: UserSessionIdentity) {
    this.events.push("retire-session");
    this.stopped++;
    if (this.holdStop) await this.stopWait.promise;
    return this.stopUnresolved
      ? { kind: "unresolved" as const, message: "unresolved" }
      : { kind: "released" as const, identity };
  }
  async dispose() {}
}
class Broker implements LoginBroker {
  qualification = "fixture" as const;
  began = 0;
  answered = 0;
  scheduled = 0;
  canceled = 0;
  closed = 0;
  accountDenied = false;
  rejectStart = false;
  repeat = false;
  info = false;
  deny = false;
  holdAnswer = false;
  holdStart = false;
  holdCancel = false;
  cancelUnknown = false;
  answerWait = deferred<BrokerReply>();
  startWait = deferred<BrokerReply>();
  cancelWait = deferred<BrokerReply>();
  async begin() {
    this.began++;
    if (this.accountDenied) return { kind: "denied" as const, message: "SYNTHETIC-RESPONSE" };
    return {
      kind: "prompt" as const,
      style: this.info ? ("info" as const) : ("secret" as const),
      message: "SYNTHETIC-RESPONSE",
    };
  }
  async answer() {
    this.answered++;
    if (this.holdAnswer) return this.answerWait.promise;
    return this.repeat
      ? { kind: "prompt" as const, style: "secret" as const, message: "SYNTHETIC-RESPONSE" }
      : this.deny
        ? { kind: "denied" as const, message: "SYNTHETIC-RESPONSE" }
        : { kind: "success" as const };
  }
  async start() {
    this.scheduled++;
    if (this.holdStart) return this.startWait.promise;
    return this.rejectStart
      ? { kind: "error" as const, message: "SYNTHETIC-RESPONSE" }
      : { kind: "success" as const };
  }
  async cancel() {
    this.canceled++;
    if (this.holdCancel) return this.cancelWait.promise;
    if (this.cancelUnknown) throw new Error("SYNTHETIC-RESPONSE");
    return { kind: "success" as const };
  }
  close() {
    this.closed++;
  }
}
function setup(timeoutMs = 200) {
  const life = new Life(),
    brokers: Broker[] = [],
    observations: string[] = [];
  let selection: SessionSelection = {
    id: loginId("moire"),
    generation: "catalog_1",
    label: "Moire",
    protocol: "wayland",
    desktop: "Moire",
    descriptorPath: "/fixture/moire.desktop",
    argv: ["/fixture/session"],
  };
  let consoleIntent = false;
  const configure: { broker: ((broker: Broker) => void) | null } = { broker: null };
  const controller = createLoginController({
    qualification: "fixture",
    timeoutMs,
    lifecycle: life,
    loadSelection: async () => selection,
    brokerLaunch: () => ({
      command: ["/fixture/trusted-launcher", "moire"],
      environment: ["SYNTHETIC_ENV=PRIVATE"],
    }),
    createBroker: async () => {
      const b = new Broker();
      configure.broker?.(b);
      brokers.push(b);
      return b;
    },
    consoleRequested: () => consoleIntent,
  });
  controller.subscribe(() => observations.push(JSON.stringify(controller.state)));
  function beginRequest() {
    const s = controller.state;
    assert(s.kind === "ready");
    return {
      greeter: s.greeter,
      account: "fixtureuser",
      sessionId: selection.id,
      catalogGeneration: selection.generation,
    };
  }
  function answerRequest() {
    const s = controller.state;
    assert(s.kind === "prompt");
    return {
      attemptId: s.attemptId,
      promptId: s.prompt.id,
      response:
        s.prompt.style === "info" || s.prompt.style === "error" ? null : "SYNTHETIC-RESPONSE",
    };
  }
  return {
    state: () => controller.state,
    life,
    brokers,
    controller,
    observations,
    configure,
    beginRequest,
    answerRequest,
    console(value: boolean) {
      consoleIntent = value;
    },
    catalog(value: string) {
      selection = { ...selection, generation: value };
    },
  };
}
let cases = 0;
async function test(name: string, run: () => Promise<void>) {
  await run();
  cases++;
  console.log("ok " + name);
}
await test("scheduled login waits exact greeter release and fixture running proof; logout waits cleanup", async () => {
  const f = setup();
  f.life.holdRetire = true;
  f.life.holdObserve = true;
  await f.controller.initialize();
  const original = f.beginRequest().greeter;
  assert(Object.isFrozen(f.state()));
  assert(Object.isFrozen(original));
  await f.controller.beginLogin(f.beginRequest());
  const launch = f.controller.answerPrompt(f.answerRequest());
  await until(() => f.state().kind === "retiring-greeter", "greeter retirement");
  assert.equal(f.brokers[0]!.scheduled, 1);
  assert.equal(f.life.started, 0);
  f.life.retireWait.complete();
  await until(() => f.state().kind === "starting-session", "running observation");
  assert.equal(f.life.started, 1);
  f.life.observeWait.complete();
  await launch;
  const running = f.state();
  assert(running.kind === "running");
  await assert.rejects(
    f.controller.logout({ ...running.session, generation: running.session.generation + 1 }),
  );
  f.life.holdStop = true;
  const one = f.controller.logout(running.session),
    two = f.controller.logout(running.session);
  await until(() => f.life.stopped === 1, "owned session cleanup");
  assert.equal(f.life.greeters, 1);
  assert.equal(f.state().kind, "stopping");
  f.life.stopWait.complete();
  await Promise.all([one, two]);
  assert.equal(f.state().kind, "ready");
  assert.notEqual(f.beginRequest().greeter.id, original.id);
  await f.controller.beginLogin(f.beginRequest());
  assert.equal(f.brokers.length, 2);
  const next = f.state();
  assert(next.kind === "prompt");
  await f.controller.cancelLogin(next.attemptId);
  await f.controller.dispose();
  for (const s of f.observations) {
    assert(!s.includes("SYNTHETIC-RESPONSE"));
    assert(!s.includes("SYNTHETIC_ENV"));
  }
});
await test("repeated prompts use new single-use identity and old/double answers fail", async () => {
  const f = setup();
  f.configure.broker = (b) => {
    b.repeat = true;
  };
  await f.controller.initialize();
  await f.controller.beginLogin(f.beginRequest());
  const old = f.answerRequest();
  await f.controller.answerPrompt(old);
  assert.notEqual(f.answerRequest().promptId, old.promptId);
  await assert.rejects(f.controller.answerPrompt(old));
  const req = f.answerRequest();
  f.brokers[0]!.holdAnswer = true;
  const answering = f.controller.answerPrompt(req);
  await assert.rejects(f.controller.answerPrompt(req));
  const s = f.state();
  assert(s.kind === "authenticating");
  await f.controller.cancelLogin(s.attemptId);
  f.brokers[0]!.answerWait.complete({ kind: "success" });
  await answering;
  assert.equal(f.life.started, 0);
  await f.controller.dispose();
});
await test("held cancellation owns attempt and duplicate cancellation joins", async () => {
  const f = setup();
  f.configure.broker = (b) => {
    b.holdCancel = true;
  };
  await f.controller.initialize();
  await f.controller.beginLogin(f.beginRequest());
  const req = f.answerRequest();
  const one = f.controller.cancelLogin(req.attemptId),
    two = f.controller.cancelLogin(req.attemptId);
  await delay(10);
  assert.equal(f.brokers[0]!.canceled, 1);
  await assert.rejects(f.controller.answerPrompt(req));
  assert.notEqual(f.state().kind, "ready");
  f.brokers[0]!.cancelWait.complete({ kind: "success" });
  await Promise.all([one, two]);
  assert.equal(f.state().kind, "ready");
  await f.controller.dispose();
});
await test("stale greeter/catalog identities and changed catalog never schedule", async () => {
  const f = setup();
  await f.controller.initialize();
  const req = f.beginRequest();
  await assert.rejects(
    f.controller.beginLogin({
      ...req,
      greeter: { ...req.greeter, generation: req.greeter.generation + 1 },
    }),
  );
  await assert.rejects(f.controller.beginLogin({ ...req, catalogGeneration: "stale" }));
  assert.equal(f.brokers.length, 0);
  await f.controller.beginLogin(req);
  f.catalog("catalog_2");
  await f.controller.answerPrompt(f.answerRequest());
  assert.equal(f.brokers[0]!.scheduled, 0);
  assert.equal(f.state().kind, "ready");
  await f.controller.dispose();
});
await test("console intent blocks admission and cancels scheduled launch before retirement", async () => {
  const f = setup();
  f.console(true);
  await f.controller.initialize();
  assert.equal(f.life.greeters, 0);
  assert.equal(f.state().kind, "inactive");
  f.console(false);
  await f.controller.initialize();
  f.configure.broker = (b) => {
    b.holdStart = true;
  };
  await f.controller.beginLogin(f.beginRequest());
  const answering = f.controller.answerPrompt(f.answerRequest());
  await until(() => f.brokers[0]!.scheduled === 1, "held scheduling");
  f.console(true);
  f.brokers[0]!.startWait.complete({ kind: "success" });
  await answering;
  assert.equal(f.life.started, 0);
  assert.equal(f.state().kind, "inactive");
  await f.controller.dispose();
});
await test("broker/lifecycle cleanup uncertainty blocks further login", async () => {
  for (const reason of ["broker", "launch", "greeter"]) {
    const f = setup();
    await f.controller.initialize();
    await f.controller.beginLogin(f.beginRequest());
    const s = f.state();
    assert(s.kind === "prompt");
    if (reason === "broker") f.brokers[0]!.cancelUnknown = true;
    else if (reason === "launch") f.life.cancelUnresolved = true;
    else f.life.retireUnresolved = true;
    if (reason === "greeter") await f.controller.answerPrompt(f.answerRequest());
    else await f.controller.cancelLogin(s.attemptId);
    assert.equal(f.state().kind, "blocked");
    await assert.rejects(f.controller.initialize());
    await assert.rejects(f.controller.dispose());
  }
});
await test("logout unresolved descendants never admit fresh greeter", async () => {
  const f = setup();
  await f.controller.initialize();
  await f.controller.beginLogin(f.beginRequest());
  await f.controller.answerPrompt(f.answerRequest());
  const s = f.state();
  assert(s.kind === "running");
  f.life.stopUnresolved = true;
  await f.controller.logout(s.session);
  assert.equal(f.state().kind, "blocked");
  assert.equal(f.life.greeters, 1);
  await assert.rejects(f.controller.dispose());
});
await test("deadline and late broker scheduling success cannot revive canceled attempt", async () => {
  const f = setup(40);
  f.configure.broker = (b) => {
    b.holdStart = true;
  };
  await f.controller.initialize();
  await f.controller.beginLogin(f.beginRequest());
  await f.controller.answerPrompt(f.answerRequest());
  assert.equal(f.state().kind, "ready");
  f.brokers[0]!.startWait.complete({ kind: "success" });
  await delay(10);
  assert.equal(f.life.started, 0);
  assert.equal(f.state().kind, "ready");
  await f.controller.dispose();
});
await test("informational prompt rejects response and listener exception cannot corrupt ownership", async () => {
  const f = setup();
  f.configure.broker = (b) => {
    b.info = true;
  };
  f.controller.subscribe(() => {
    throw new Error("observer failed");
  });
  await f.controller.initialize();
  await f.controller.beginLogin(f.beginRequest());
  const req = f.answerRequest();
  await assert.rejects(f.controller.answerPrompt({ ...req, response: "SYNTHETIC-RESPONSE" }));
  await f.controller.cancelLogin(req.attemptId);
  await f.controller.dispose();
});
await test("dispose during pending scheduling retires ownership and never creates replacement greeter", async () => {
  const f = setup();
  f.configure.broker = (b) => {
    b.holdStart = true;
  };
  await f.controller.initialize();
  await f.controller.beginLogin(f.beginRequest());
  const pending = f.controller.answerPrompt(f.answerRequest());
  await until(() => f.brokers[0]!.scheduled === 1, "scheduled");
  await f.controller.dispose();
  f.brokers[0]!.startWait.complete({ kind: "success" });
  await pending;
  assert.equal(f.life.started, 0);
  assert.equal(f.life.greeters, 1);
  await assert.rejects(f.controller.initialize());
});
await test("late greeter creation after timeout is retired and never admitted", async () => {
  const f = setup(30);
  f.life.holdGreeter = true;
  await f.controller.initialize();
  assert.equal(f.state().kind, "blocked");
  f.life.greeterWait.complete({
    id: loginId("late_greeter"),
    generation: 1,
    qualification: "fixture",
  });
  await delay(10);
  assert(f.life.events.includes("retire-greeter"));
  assert.equal(f.state().kind, "blocked");
  await assert.rejects(f.controller.dispose());
});
await test("account and authentication denial never schedule or observe a session", async () => {
  for (const accountDenied of [true, false]) {
    const f = setup();
    f.configure.broker = (b) => {
      b.accountDenied = accountDenied;
      b.deny = !accountDenied;
    };
    await f.controller.initialize();
    await f.controller.beginLogin(f.beginRequest());
    if (!accountDenied) await f.controller.answerPrompt(f.answerRequest());
    assert.equal(f.brokers[0]!.scheduled, 0);
    assert.equal(f.life.started, 0);
    assert.equal(f.state().kind, "ready");
    assert.equal(f.brokers[0]!.canceled, 1);
    for (const observed of f.observations) assert(!observed.includes("SYNTHETIC-RESPONSE"));
    await f.controller.dispose();
  }
});
await test("broker start rejection is cleaned and active account cannot change", async () => {
  const f = setup();
  f.configure.broker = (b) => {
    b.rejectStart = true;
  };
  await f.controller.initialize();
  const req = f.beginRequest();
  await f.controller.beginLogin(req);
  await assert.rejects(f.controller.beginLogin({ ...req, account: "differentuser" }));
  assert.equal(f.brokers.length, 1);
  await f.controller.answerPrompt(f.answerRequest());
  assert.equal(f.state().kind, "ready");
  assert.equal(f.life.started, 0);
  assert.equal(f.life.canceled, 1);
  await f.controller.dispose();
});
await test("fresh console intent after greeter and logout release blocks each graphical admission", async () => {
  const f = setup();
  f.life.holdRetire = true;
  await f.controller.initialize();
  await f.controller.beginLogin(f.beginRequest());
  const answered = f.controller.answerPrompt(f.answerRequest());
  await until(() => f.state().kind === "retiring-greeter", "held greeter release");
  f.console(true);
  f.life.retireWait.complete();
  await answered;
  assert.equal(f.life.started, 0);
  assert.equal(f.state().kind, "inactive");
  await f.controller.dispose();
  const out = setup();
  await out.controller.initialize();
  await out.controller.beginLogin(out.beginRequest());
  await out.controller.answerPrompt(out.answerRequest());
  const running = out.state();
  assert(running.kind === "running");
  out.life.holdStop = true;
  const logout = out.controller.logout(running.session);
  await until(() => out.state().kind === "stopping", "held logout release");
  out.console(true);
  out.life.stopWait.complete();
  await logout;
  assert.equal(out.state().kind, "inactive");
  assert.equal(out.life.greeters, 1);
  await out.controller.dispose();
});
await test("reentrant observers join already-owned cleanup without extra cancellation", async () => {
  const f = setup();
  await f.controller.initialize();
  await f.controller.beginLogin(f.beginRequest());
  const req = f.answerRequest();
  let nested: Promise<void> | null = null;
  f.controller.subscribe(() => {
    if (f.state().kind === "authenticating" && !nested)
      nested = f.controller.cancelLogin(req.attemptId);
  });
  await f.controller.cancelLogin(req.attemptId);
  if (nested) await nested;
  assert.equal(f.brokers[0]!.canceled, 1);
  assert.equal(f.life.canceled, 1);
  await f.controller.dispose();
});
console.log(
  JSON.stringify({
    suite: "fixture login/logout controller",
    cases,
    actualExitCode: 0,
    realAuthentication: false,
    nativeSeat: false,
    secureLock: false,
  }),
);
