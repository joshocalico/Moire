/**
 * The polkit agent on a private dbus-daemon, with a fake authority (org.freedesktop.PolicyKit1),
 * a fake logind, a fake `polkit-agent-helper-1` on a unix socket and a fake secure prompt.
 * Messages are shaped as polkitd 127 sends them (docs/polkit-agent.md, "Pinned against polkit
 * 127").
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DbusRemoteError, SessionBus, variant, type DbusMessage } from "@moire/dbus";
import type {
  SecurePromptHandle,
  SecurePromptRequest,
  SecurePromptResult,
  SecurePrompts,
} from "@moire/core";
import { LOGIND_BUS } from "./logind-power";
import {
  POLKIT_AGENT_INTERFACE,
  POLKIT_AGENT_PATH,
  POLKIT_AUTHORITY,
  POLKIT_CANCELLED,
  POLKIT_FAILED,
  createFileAccounts,
  polkitHeadline,
  startPolkitAgent,
  type PolkitAgent,
  type PolkitAgentOptions,
  type PolkitAgentStatus,
} from "./polkit-agent";
import { createPolkitHelper } from "./polkit-helper";
import { createRequesterResolver } from "./polkit-requester";

const AUTHORITY_PATH = "/org/freedesktop/PolicyKit1/Authority";
const AUTHORITY_INTERFACE = "org.freedesktop.PolicyKit1.Authority";
const SESSION_PATH = "/org/freedesktop/login1/session/_37";
const BEGIN = "sssa{ss}sa(sa{sv})";
const PASSWORD = "correct horse";
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string) {
  const deadline = performance.now() + 4000;
  while (!check()) {
    if (performance.now() > deadline) throw new Error("Timeout: " + label);
    await delay(5);
  }
}
let cookieSerial = 0;
/** A cookie as polkitd 127 mints them. */
const newCookie = () =>
  `1-0db981de61254d654931c5760fa1cc42-${++cookieSerial}-ca235288b48a0d78b2ff43c4f5bdf42f`;
const user = (uid: number) => ["unix-user", { uid: variant("u", uid) }];
const group = (gid: number) => ["unix-group", { gid: variant("u", gid) }];
const errorName = (error: unknown) =>
  error instanceof DbusRemoteError ? error.errorName : `not a D-Bus error: ${String(error)}`;

/** A secure prompt the test drives: it records requests and plays the user. */
class FakePrompts implements SecurePrompts {
  readonly entries: {
    request: SecurePromptRequest;
    cancelled: boolean;
    settle(result: SecurePromptResult): void;
  }[] = [];
  request(request: SecurePromptRequest): SecurePromptHandle {
    let settle!: (result: SecurePromptResult) => void;
    const result = new Promise<SecurePromptResult>((resolve) => (settle = resolve));
    const entry = { request, cancelled: false, settle };
    this.entries.push(entry);
    return {
      result,
      cancel: () => {
        entry.cancelled = true;
        settle({ outcome: "cancelled" });
      },
    };
  }
  get last() {
    return this.entries.at(-1)!;
  }
  /** Type a password for an identity, as the prompt would: bytes it owns and wipes. */
  async type(text: string, account?: string, entry = this.last) {
    const identity =
      entry.request.identities.find((candidate) => candidate.account === account) ??
      entry.request.identities[entry.request.selected]!;
    const secret = Buffer.from(text, "utf8");
    try {
      return await entry.request.check!(identity, secret);
    } finally {
      secret.fill(0);
    }
  }
}

/** What a fake helper connection saw, and the reply script. */
type HelperExchange = { account: string; cookie: string; answer: Buffer | null };
class FakeHelper {
  readonly exchanges: HelperExchange[] = [];
  /** What follows the header instead of the stock password exchange. */
  hostile: string | null = null;
  private readonly server: net.Server;
  constructor(readonly socketPath: string) {
    this.server = net.createServer((socket) => {
      let received = Buffer.alloc(0);
      let prompted = false;
      const exchange: HelperExchange = { account: "", cookie: "", answer: null };
      socket.on("error", () => {});
      socket.on("data", (chunk: Buffer) => {
        received = Buffer.concat([received, chunk]);
        const lines = received.toString("latin1").split("\n");
        if (lines.length >= 3 && !prompted) {
          prompted = true;
          exchange.account = lines[0]!;
          exchange.cookie = lines[1]!;
          this.exchanges.push(exchange);
          if (this.hostile !== null) socket.write(this.hostile);
          else socket.write("PAM_PROMPT_ECHO_OFF Password: \n");
        }
        if (lines.length >= 4 && exchange.answer === null) {
          const start = lines[0]!.length + lines[1]!.length + 2;
          exchange.answer = Buffer.from(received.subarray(start, received.indexOf(0x0a, start)));
          socket.end(
            exchange.answer.equals(Buffer.from(PASSWORD))
              ? "SUCCESS\n"
              : "polkit-agent-helper-1: pam_authenticate failed: Authentication failure\nFAILURE\n",
          );
        }
      });
    });
  }
  listen() {
    return new Promise<void>((resolve) => this.server.listen(this.socketPath, resolve));
  }
  close() {
    return new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

/** org.freedesktop.PolicyKit1 on one connection. */
class AuthorityFixture {
  readonly registrations: unknown[][] = [];
  readonly unregistrations: unknown[][] = [];
  refuse: string | null = null;
  constructor(readonly bus: SessionBus) {
    bus.exportObject(AUTHORITY_PATH, {
      name: AUTHORITY_INTERFACE,
      methods: {
        RegisterAuthenticationAgent: {
          inSignature: "(sa{sv})ss",
          outSignature: "",
          handler: ({ message, body }) => {
            assert.equal(message.signature, "(sa{sv})ss");
            this.registrations.push([message.sender, ...body]);
            if (this.refuse) throw new DbusRemoteError(POLKIT_FAILED, this.refuse);
            return {};
          },
        },
        UnregisterAuthenticationAgent: {
          inSignature: "(sa{sv})s",
          outSignature: "",
          handler: ({ body }) => {
            this.unregistrations.push(body);
            return {};
          },
        },
      },
    });
  }
  get agent(): string {
    return this.registrations.at(-1)![0] as string;
  }
  begin(
    cookie: string,
    options: {
      action?: string;
      message?: string;
      details?: Record<string, string>;
      identities?: unknown[];
      from?: SessionBus;
      to?: string;
    } = {},
  ): Promise<DbusMessage> {
    return (options.from ?? this.bus).call(
      {
        destination: options.to ?? this.agent,
        path: POLKIT_AGENT_PATH,
        interface: POLKIT_AGENT_INTERFACE,
        member: "BeginAuthentication",
        signature: BEGIN,
        body: [
          options.action ?? "org.moire.test.admin",
          options.message ?? "Authentication is required to add a user",
          "",
          options.details ?? { "polkit.caller-pid": "349", "polkit.subject-pid": "338" },
          cookie,
          options.identities ?? [user(1000), user(1001)],
        ],
      },
      { timeoutMs: 4000 },
    );
  }
  cancel(cookie: string, from: SessionBus = this.bus, to = this.agent): Promise<DbusMessage> {
    return from.call(
      {
        destination: to,
        path: POLKIT_AGENT_PATH,
        interface: POLKIT_AGENT_INTERFACE,
        member: "CancelAuthentication",
        signature: "s",
        body: [cookie],
      },
      { timeoutMs: 2000 },
    );
  }
}

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-pka-"));
const passwd = path.join(directory, "passwd");
const groupFile = path.join(directory, "group");
await fs.writeFile(
  passwd,
  [
    "root:x:0:0:System administrator:/root:/bin/sh",
    "polkituser:x:28:28:polkit:/var/empty:/run/current-system/sw/bin/nologin",
    "alice:x:1000:100:Alice Admin,,,:/home/alice:/run/current-system/sw/bin/bash",
    "bob:x:1001:100:Bob \u202eBuilder:/home/bob:/bin/sh",
    "carol:x:1002:100::/home/carol:/bin/sh",
    "svc:x:1003:100:Service:/var/empty:/run/current-system/sw/bin/nologin",
    "Odd Name:x:1004:100:Odd:/home/odd:/bin/sh",
    "nobody:x:65534:65534:Nobody:/var/empty:/bin/sh",
    ...Array.from({ length: 9 }, (_, n) => `extra${n}:x:${1100 + n}:100:Extra ${n}:/tmp:/bin/sh`),
    "",
  ].join("\n"),
);
await fs.writeFile(groupFile, "root:x:0:\nwheel:x:1:alice,bob,root,ghost\nusers:x:100:\n");
const accounts = createFileAccounts(passwd, groupFile);

const daemon = spawn(
  process.env.MOIRE_TEST_DBUS_DAEMON ?? "dbus-daemon",
  [
    process.env.MOIRE_TEST_DBUS_CONFIG
      ? "--config-file=" + process.env.MOIRE_TEST_DBUS_CONFIG
      : "--session",
    "--nofork",
    "--nopidfile",
    `--address=unix:path=${path.join(directory, "bus")}`,
    "--print-address=1",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
let address = "";
let daemonError: Error | null = null;
daemon.stdout.on("data", (chunk) => {
  address += chunk.toString();
});
daemon.once("error", (error) => {
  daemonError = error;
});
const buses: SessionBus[] = [];
const bus = async () => {
  const b = await SessionBus.connect(address.trim());
  buses.push(b);
  return b;
};
const fakeHelper = new FakeHelper(path.join(directory, "helper.socket"));
const agents: PolkitAgent[] = [];
let cases = 0;
try {
  await until(() => address.includes("\n") || daemonError !== null, "private daemon");
  if (daemonError) throw daemonError;
  await fakeHelper.listen();
  const helper = createPolkitHelper({
    socketPath: fakeHelper.socketPath,
    promptTimeoutMs: 500,
    verdictTimeoutMs: 500,
    closeTimeoutMs: 100,
  });

  const lines: string[] = [];
  const statuses: PolkitAgentStatus[] = [];
  const prompts = new FakePrompts();
  // Why each Cancelled answer was given, for its subject (prompt-outcomes.ts).
  const dismissals: [number, string, string][] = [];
  let clock = 1_000_000;
  const agentBuses: SessionBus[] = [];
  const start = async (overrides: Partial<PolkitAgentOptions> = {}) => {
    const agent = await startPolkitAgent({
      prompts,
      sessionUser: "alice",
      accounts,
      helper,
      connect: async () => {
        const b = await bus();
        agentBuses.push(b);
        return b;
      },
      pid: 4242,
      locale: "en_GB.UTF-8",
      timeoutMs: 1000,
      reconnectMs: 20,
      now: () => clock,
      log: (line) => lines.push(line),
      onStatus: (status) => statuses.push(status),
      onDismissed: (pid, actionId, dismissal) => dismissals.push([pid, actionId, dismissal]),
      resolveRequester: (pid) =>
        pid === 338
          ? {
              requester: { name: "Settings", pid, via: "Terminal", x11: false },
              executable: "/run/current-system/sw/bin/moire-settings",
              key: "launch:moire-settings",
            }
          : null,
      ...overrides,
    });
    agents.push(agent);
    return agent;
  };

  // Outside a logind session there is nothing to register for, and no retry.
  {
    const authority = new AuthorityFixture(await bus());
    assert.equal(await authority.bus.requestName(POLKIT_AUTHORITY, 4), 1);
    const agent = await start();
    assert.equal(agent.status, "unavailable");
    assert.deepEqual(lines, ["polkit-agent: code=no-session action=-"]);
    await delay(60);
    assert.equal(authority.registrations.length, 0);
    await agent.dispose();
    authority.bus.close();
    lines.length = 0;
    statuses.length = 0;
    cases++;
  }

  const logindBus = await bus();
  logindBus.exportObject("/org/freedesktop/login1", {
    name: "org.freedesktop.login1.Manager",
    methods: {
      GetSessionByPID: {
        inSignature: "u",
        outSignature: "o",
        handler: ({ body }) => {
          assert.equal(body[0], 4242);
          return { body: [SESSION_PATH] };
        },
      },
    },
  });
  logindBus.exportObject(SESSION_PATH, {
    name: "org.freedesktop.DBus.Properties",
    methods: {
      Get: {
        inSignature: "ss",
        outSignature: "v",
        handler: ({ body }) => {
          assert.deepEqual(body, ["org.freedesktop.login1.Session", "Id"]);
          return { body: [variant("s", "37")] };
        },
      },
    },
  });
  assert.equal(await logindBus.requestName(LOGIND_BUS, 4), 1);

  // An agent already registered for the session: reported, no fallback, no retry loop.
  let authority = new AuthorityFixture(await bus());
  assert.equal(await authority.bus.requestName(POLKIT_AUTHORITY, 4), 1);
  authority.refuse = "An authentication agent already exists for the given subject";
  const agent = await start();
  {
    assert.equal(agent.status, "agent-taken");
    assert.deepEqual(lines, ["polkit-agent: code=agent-taken action=-"]);
    assert.deepEqual(statuses, ["agent-taken"]);
    await delay(80);
    assert.equal(authority.registrations.length, 1, "one attempt per authority");
    cases++;
  }

  // A new polkitd (the name changes owner): register again, with the pinned subject form.
  {
    authority.bus.close();
    authority = new AuthorityFixture(await bus());
    assert.equal(await authority.bus.requestName(POLKIT_AUTHORITY, 4), 1);
    await until(() => agent.status === "registered", "registration with the new authority");
    assert.equal(authority.registrations.length, 1);
    assert.deepEqual(authority.registrations[0]!.slice(1), [
      ["unix-session", { "session-id": { signature: "s", value: "37" } }],
      "en_GB.UTF-8",
      POLKIT_AGENT_PATH,
    ]);
    assert.equal(lines.at(-1), "polkit-agent: code=registered action=-");
    cases++;
  }

  // Registration comes before the first client: startPolkitAgent only resolves once the attempt
  // has ended, and main.ts awaits it ahead of every spawnApp call.
  {
    const main = fsSync.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "main.ts"),
      "utf8",
    );
    const registered = main.indexOf("await startSessionPolkitAgent(");
    const firstClient = main.indexOf("spawnApp({ exec:");
    assert.ok(registered > 0 && firstClient > registered, "agent before the first client");
    assert.ok(!main.slice(0, registered).includes("startXwayland("), "agent before Xwayland");
    cases++;
  }

  // Only the owner of org.freedesktop.PolicyKit1 may call the agent.
  {
    const stranger = await bus();
    const before = prompts.entries.length;
    await assert.rejects(authority.begin(newCookie(), { from: stranger }), (error) => {
      assert.equal(errorName(error), "org.freedesktop.DBus.Error.AccessDenied");
      return true;
    });
    await assert.rejects(authority.cancel("anything", stranger), (error) => {
      assert.equal(errorName(error), "org.freedesktop.DBus.Error.AccessDenied");
      return true;
    });
    assert.equal(prompts.entries.length, before, "no prompt for a stranger");
    assert.equal(lines.at(-1), "polkit-agent: code=refused-sender action=-");
    cases++;
  }

  // A request becomes a prompt; wrong then right; the answer travels as bytes on the socket.
  {
    const cookie = newCookie();
    const hostileMessage =
      "Authentication is\nrequired\u0007 to \u202eadd\u2028 a user\u009b " + "x".repeat(400);
    const reply = authority.begin(cookie, {
      message: hostileMessage,
      identities: [user(0), user(28), user(1001), user(1000), user(1003), user(1004), user(4242)],
    });
    await until(() => prompts.entries.length === 1, "prompt");
    const { request } = prompts.last;
    assert.equal(request.kind, "password");
    assert.equal(request.headline.length, 200);
    assert.ok(request.headline.startsWith("Authentication is required to add a user xxx"));
    assert.ok(!/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(request.headline));
    // Local login accounts only (no root, system, nologin or oddly named ones), mine first.
    assert.deepEqual(request.identities, [
      { account: "alice", displayName: "Alice Admin" },
      { account: "bob", displayName: "Bob Builder" },
    ]);
    assert.equal(request.selected, 0);
    assert.equal(request.needsAdministrator, false);
    assert.deepEqual(request.requester, {
      name: "Settings",
      pid: 338,
      via: "Terminal",
      x11: false,
    });
    assert.deepEqual(request.details, [
      { label: "Action", value: "org.moire.test.admin" },
      { label: "Process ID", value: "338" },
    ]);
    assert.equal(
      request.coolDownKey,
      "/run/current-system/sw/bin/moire-settings\norg.moire.test.admin",
    );
    assert.equal(request.requesterKey, "launch:moire-settings", "the flood pause is per program");

    assert.equal(await prompts.type("wrong"), "rejected");
    assert.equal(await prompts.type(PASSWORD), "accepted");
    // Each try is a new helper conversation with the same cookie.
    assert.deepEqual(
      fakeHelper.exchanges.map(({ account, cookie: sent, answer }) => [account, sent, answer]),
      [
        ["alice", cookie, Buffer.from("wrong")],
        ["alice", cookie, Buffer.from(PASSWORD)],
      ],
    );
    // An identity polkit did not offer is never sent to the helper.
    assert.equal(
      await request.check!({ account: "root", displayName: "root" }, Buffer.from(PASSWORD)),
      "unavailable",
    );
    assert.equal(fakeHelper.exchanges.length, 2);
    prompts.last.settle({ outcome: "completed", identity: request.identities[0] });
    // The helper told polkitd; the agent's reply is empty.
    assert.equal((await reply).signature ?? "", "");
    assert.deepEqual(lines.slice(-3), [
      "polkit-agent: code=begin action=org.moire.test.admin",
      "polkit-agent: code=rejected action=org.moire.test.admin",
      "polkit-agent: code=completed action=org.moire.test.admin",
    ]);
    cases++;
  }

  // A visible prompt, an oversized line and an unknown line all end as "can't be checked".
  {
    const reply = authority.begin(newCookie());
    await until(() => prompts.entries.length === 2, "prompt");
    for (const hostile of [
      "PAM_PROMPT_ECHO_ON One-time code: \n",
      `${"A".repeat(2000)}\n`,
      "HELLO there\n",
    ]) {
      fakeHelper.hostile = hostile;
      const before: number = fakeHelper.exchanges.length;
      assert.equal(await prompts.type(PASSWORD), "unavailable");
      assert.equal(fakeHelper.exchanges.length, before + 1);
      assert.equal(fakeHelper.exchanges.at(-1)!.answer, null, "nothing was answered");
      assert.equal(
        lines.at(-1),
        "polkit-agent: code=helper-unavailable action=org.moire.test.admin",
      );
    }
    fakeHelper.hostile = null;
    // The user gives up: polkitd is told the prompt was dismissed.
    prompts.last.settle({ outcome: "cancelled" });
    await assert.rejects(reply, (error) => {
      assert.equal(errorName(error), POLKIT_CANCELLED);
      return true;
    });
    assert.equal(lines.at(-1), "polkit-agent: code=cancelled action=org.moire.test.admin");
    cases++;
  }

  // CancelAuthentication from polkitd closes the prompt and the helper conversation.
  {
    const cookie = newCookie();
    const reply = authority.begin(cookie);
    await until(() => prompts.entries.length === 3, "prompt");
    const entry = prompts.last;
    // A check is in flight when the cancel arrives.
    fakeHelper.hostile = "";
    const pending = prompts.type(PASSWORD);
    await until(() => fakeHelper.exchanges.at(-1)?.cookie === cookie, "helper conversation");
    await authority.cancel("no-such-cookie");
    assert.equal(entry.cancelled, false);
    await authority.cancel(cookie);
    assert.equal(entry.cancelled, true);
    assert.equal(await pending, "unavailable");
    fakeHelper.hostile = null;
    await assert.rejects(reply, (error) => {
      assert.equal(errorName(error), POLKIT_CANCELLED);
      return true;
    });
    assert.equal(
      lines.at(-1),
      "polkit-agent: code=authority-cancelled action=org.moire.test.admin",
    );
    assert.deepEqual(dismissals.at(-1), [338, "org.moire.test.admin", "withdrawn"]);
    // Once closed, the checker is dead.
    const before = fakeHelper.exchanges.length;
    assert.equal(await prompts.type(PASSWORD, undefined, entry), "unavailable");
    assert.equal(fakeHelper.exchanges.length, before);
    cases++;
  }

  // Five wrong in a row pause that identity for a minute, across requests; others are unaffected.
  {
    let reply = authority.begin(newCookie());
    await until(() => prompts.entries.length === 4, "prompt");
    for (let n = 0; n < 3; n++) assert.equal(await prompts.type("wrong", "bob"), "rejected");
    prompts.last.settle({ outcome: "cancelled" });
    await assert.rejects(reply);
    reply = authority.begin(newCookie());
    await until(() => prompts.entries.length === 5, "prompt");
    for (let n = 0; n < 2; n++) assert.equal(await prompts.type("wrong", "bob"), "rejected");
    const before = fakeHelper.exchanges.length;
    assert.equal(await prompts.type(PASSWORD, "bob"), "throttled");
    assert.equal(fakeHelper.exchanges.length, before, "no helper while throttled");
    assert.equal(lines.at(-1), "polkit-agent: code=throttled action=org.moire.test.admin");
    assert.equal(await prompts.type("wrong", "alice"), "rejected");
    clock += 59_000;
    assert.equal(await prompts.type(PASSWORD, "bob"), "throttled");
    clock += 1_000;
    assert.equal(await prompts.type(PASSWORD, "bob"), "accepted");
    assert.equal(fakeHelper.exchanges.at(-1)!.account, "bob");
    prompts.last.settle({ outcome: "completed", identity: prompts.last.request.identities[1] });
    await reply;
    cases++;
  }

  // Every other way a prompt ends, as polkitd sees it.
  {
    for (const [outcome, name, code] of [
      ["timed-out", POLKIT_CANCELLED, "timed-out"],
      ["locked", POLKIT_CANCELLED, "locked"],
      ["refused", POLKIT_CANCELLED, "refused"],
      ["failed", POLKIT_FAILED, "failed"],
      // "Completed" with no accepted password is never an authentication.
      ["completed", POLKIT_FAILED, "failed"],
    ] as const) {
      const count = prompts.entries.length;
      const recorded = dismissals.length;
      const reply = authority.begin(newCookie());
      await until(() => prompts.entries.length === count + 1, "prompt");
      prompts.last.settle({ outcome });
      await assert.rejects(reply, (error) => {
        assert.equal(errorName(error), name, outcome);
        // The reason is kept before polkitd hears the answer, so a requester that asks as soon
        // as polkit replies finds it.
        if (name === POLKIT_CANCELLED)
          assert.deepEqual(dismissals.at(-1), [338, "org.moire.test.admin", outcome]);
        return true;
      });
      assert.equal(lines.at(-1), `polkit-agent: code=${code} action=org.moire.test.admin`);
      // Only Cancelled answers (polkit's `polkit.dismissed`) carry a reason.
      assert.equal(dismissals.length, recorded + (name === POLKIT_CANCELLED ? 1 : 0), outcome);
    }
    // A person's cancel, for another subject: kept for the subject, never the caller.
    const count = prompts.entries.length;
    const reply = authority.begin(newCookie(), {
      details: { "polkit.caller-pid": "349", "polkit.subject-pid": "512" },
    });
    await until(() => prompts.entries.length === count + 1, "prompt");
    prompts.last.settle({ outcome: "cancelled" });
    await assert.rejects(reply);
    assert.deepEqual(dismissals.at(-1), [512, "org.moire.test.admin", "cancelled"]);
    cases++;
  }

  // Identities: a standard user's prompt, groups, the cap of eight, and nobody to ask.
  {
    let count = prompts.entries.length;
    let reply = authority.begin(newCookie(), { identities: [user(1001)], details: {} });
    await until(() => prompts.entries.length === count + 1, "prompt");
    assert.deepEqual(prompts.last.request.identities, [
      { account: "bob", displayName: "Bob Builder" },
    ]);
    assert.equal(prompts.last.request.needsAdministrator, true);
    assert.equal(prompts.last.request.requester, null);
    assert.deepEqual(prompts.last.request.details, [
      { label: "Action", value: "org.moire.test.admin" },
    ]);
    assert.equal(prompts.last.request.coolDownKey, "-\norg.moire.test.admin");
    assert.equal(prompts.last.request.requesterKey, undefined);
    prompts.last.settle({ outcome: "cancelled" });
    await assert.rejects(reply);

    // The caller's pid stands in when the subject has none, and an unresolved pid names nobody.
    // The reason is kept for the subject only: with none, for nobody (not the mechanism).
    count = prompts.entries.length;
    const recorded = dismissals.length;
    reply = authority.begin(newCookie(), { details: { "polkit.caller-pid": "349" } });
    await until(() => prompts.entries.length === count + 1, "prompt");
    assert.equal(prompts.last.request.requester, null);
    assert.deepEqual(prompts.last.request.details.at(-1), { label: "Process ID", value: "349" });
    prompts.last.settle({ outcome: "cancelled" });
    await assert.rejects(reply);
    assert.equal(dismissals.length, recorded, "no subject, no record");

    // polkitd 127 expands groups itself; an authority that does not is handled the same way.
    count = prompts.entries.length;
    reply = authority.begin(newCookie(), { identities: [group(1), user(1000)] });
    await until(() => prompts.entries.length === count + 1, "prompt");
    assert.deepEqual(
      prompts.last.request.identities.map((identity) => identity.account),
      ["alice", "bob"],
    );
    prompts.last.settle({ outcome: "cancelled" });
    await assert.rejects(reply);

    count = prompts.entries.length;
    reply = authority.begin(newCookie(), {
      identities: [...Array.from({ length: 9 }, (_, n) => user(1100 + n)), user(1000)],
    });
    await until(() => prompts.entries.length === count + 1, "prompt");
    assert.deepEqual(
      prompts.last.request.identities.map((identity) => identity.account),
      ["alice", ...Array.from({ length: 7 }, (_, n) => `extra${n}`)],
    );
    prompts.last.settle({ outcome: "cancelled" });
    await assert.rejects(reply);

    // polkitd falls back to root when no administrator exists; root is not offered a prompt.
    count = prompts.entries.length;
    for (const identities of [[user(0)], [], [["unix-netgroup", { name: variant("s", "x") }]]]) {
      await assert.rejects(authority.begin(newCookie(), { identities }), (error) => {
        assert.equal(errorName(error), POLKIT_FAILED);
        return true;
      });
      assert.equal(lines.at(-1), "polkit-agent: code=no-identity action=org.moire.test.admin");
    }
    assert.equal(prompts.entries.length, count);
    cases++;
  }

  // Malformed requests are refused without a prompt, and nothing of them reaches the log.
  {
    const count = prompts.entries.length;
    for (const [options, cookie] of [
      [{ action: "org.moire.test admin\nINJECTED" }, newCookie()],
      [{ action: "" }, newCookie()],
      [{}, "has space"],
      [{}, "new\nline"],
      [{}, "x".repeat(200)],
    ] as const) {
      await assert.rejects(authority.begin(cookie, options), (error) => {
        assert.equal(errorName(error), POLKIT_FAILED);
        return true;
      });
      assert.equal(lines.at(-1), "polkit-agent: code=invalid-request action=-");
    }
    // The wrong argument types.
    await assert.rejects(
      authority.bus.call({
        destination: authority.agent,
        path: POLKIT_AGENT_PATH,
        interface: POLKIT_AGENT_INTERFACE,
        member: "BeginAuthentication",
        signature: "ss",
        body: ["org.moire.test.admin", newCookie()],
      }),
    );
    // A cookie already being answered.
    const cookie = newCookie();
    const reply = authority.begin(cookie);
    await until(() => prompts.entries.length === count + 1, "prompt");
    await assert.rejects(authority.begin(cookie));
    assert.equal(prompts.entries.length, count + 1);
    prompts.last.settle({ outcome: "cancelled" });
    await assert.rejects(reply);
    cases++;
  }

  // The log holds fixed codes and action ids only: no cookie, answer, message or detail.
  {
    assert.ok(lines.length > 30);
    for (const line of lines)
      assert.match(line, /^polkit-agent: code=[a-z-]+ action=(?:-|org\.moire\.test\.admin)$/);
    cases++;
  }

  // polkitd going away closes open prompts; the system bus dropping means reconnect and register.
  {
    const count = prompts.entries.length;
    const reply = authority.begin(newCookie());
    await until(() => prompts.entries.length === count + 1, "prompt");
    reply.catch(() => {});
    authority.bus.close();
    await until(() => prompts.last.cancelled, "prompt closed with its authority");
    await until(() => agent.status === "unavailable", "no authority");

    authority = new AuthorityFixture(await bus());
    assert.equal(await authority.bus.requestName(POLKIT_AUTHORITY, 4), 1);
    await until(() => agent.status === "registered", "registered again");
    const first = authority.agent;
    agentBuses.at(-1)!.close();
    await until(() => authority.registrations.length === 2, "registered on a new connection");
    assert.notEqual(authority.agent, first);
    await until(() => agent.status === "registered", "registered after reconnect");
    assert.ok(lines.includes("polkit-agent: code=bus-lost action=-"));
    // The new connection serves requests.
    const again = authority.begin(newCookie());
    await until(() => prompts.entries.length === count + 2, "prompt after reconnect");
    assert.equal(await prompts.type(PASSWORD), "accepted");
    prompts.last.settle({ outcome: "completed", identity: prompts.last.request.identities[0] });
    await again;
    cases++;
  }

  // Leaving: open prompts close and the agent unregisters.
  {
    const count = prompts.entries.length;
    const reply = authority.begin(newCookie());
    reply.catch(() => {});
    await until(() => prompts.entries.length === count + 1, "prompt");
    await agent.dispose();
    assert.equal(prompts.last.cancelled, true);
    assert.deepEqual(authority.unregistrations, [
      [["unix-session", { "session-id": { signature: "s", value: "37" } }], POLKIT_AGENT_PATH],
    ]);
    cases++;
  }

  // Headline sanitising on its own.
  {
    assert.equal(polkitHeadline("  Plain   text  "), "Plain text");
    assert.equal(polkitHeadline("\u001b[31mred\u001b[0m"), "[31mred [0m");
    assert.equal(polkitHeadline(""), "Authentication is required");
    assert.equal(polkitHeadline(undefined), "Authentication is required");
    assert.equal([...polkitHeadline("\u{1f512}".repeat(300))].length, 200);
    cases++;
  }

  // Naming the requester from kernel pids: its own window, an ancestor's, a launch, or X11.
  {
    const parents = new Map([
      [100, 1], // terminal (Wayland client, launched)
      [101, 100], // shell
      [102, 101], // systemctl
      [200, 1], // management service (launched, no window)
      [201, 200], // its child
      [300, 1], // an X app
      [400, 1], // a daemonised tool
    ]);
    const executables = new Map([
      [100, "/run/current-system/sw/bin/moire-terminal"],
      [101, "/run/current-system/sw/bin/bash"],
      [102, "/run/current-system/sw/bin/systemctl"],
      [200, "/nix/store/x-node/bin/node"],
      [201, "/run/current-system/sw/bin/helper\u0007tool"],
      [300, "/run/current-system/sw/bin/xterm"],
      [400, "/usr/local/bin/tool"],
    ]);
    let xwayland = true;
    const resolve = createRequesterResolver({
      clients: () => [{ pid: 100, xwayland: false }, ...(xwayland ? [{ pid: 50, xwayland }] : [])],
      launchOf: (pid) =>
        pid === 100 || pid === 101 || pid === 102
          ? { pid: 100, name: "Terminal", command: "moire-terminal" }
          : pid === 200 || pid === 201
            ? { pid: 200, name: "Moire Management", command: "moire-management" }
            : null,
      inspector: {
        parent: (pid) => parents.get(pid) ?? null,
        executable: (pid) => executables.get(pid) ?? null,
      },
      xClient: (pid) => pid === 300 || pid === 102,
    });
    assert.deepEqual(resolve(100), {
      requester: { name: "Terminal", pid: 100, x11: false },
      executable: "/run/current-system/sw/bin/moire-terminal",
      key: "launch:moire-terminal",
    });
    // "systemctl, from Terminal": never flagged X11 under a Wayland app, whatever it links.
    assert.deepEqual(resolve(102)?.requester, {
      name: "systemctl",
      pid: 102,
      via: "Terminal",
      x11: false,
    });
    assert.deepEqual(resolve(200)?.requester, { name: "Moire Management", pid: 200, x11: false });
    assert.deepEqual(resolve(201)?.requester, {
      name: "helpertool",
      pid: 201,
      via: "Moire Management",
      x11: false,
    });
    assert.deepEqual(resolve(300)?.requester, { name: "xterm", pid: 300, x11: true });
    assert.deepEqual(resolve(400)?.requester, { name: "tool", pid: 400, x11: false });
    // The flood pause names the program: a launched service by its launch (its executable is
    // node, like every Moire app's), anything else by its executable.
    assert.equal(resolve(200)?.key, "launch:moire-management");
    assert.equal(resolve(201)?.key, "launch:moire-management");
    assert.equal(resolve(102)?.key, "launch:moire-terminal");
    assert.equal(resolve(400)?.key, "exe:/usr/local/bin/tool");
    xwayland = false;
    assert.equal(resolve(300)?.requester.x11, false, "no Xwayland, no X11 flag");
    assert.equal(resolve(999), null, "a process that is gone");
    assert.equal(resolve(1), null);
    assert.equal(resolve(-5), null);
    cases++;
  }
} finally {
  for (const agent of agents) await agent.dispose().catch(() => {});
  for (const b of buses) b.close();
  await fakeHelper.close();
  daemon.kill("SIGTERM");
  await fs.rm(directory, { recursive: true, force: true });
}
console.log(`[polkit-agent] ${cases} cases PASS`);
