/**
 * The polkit helper client against a fake `polkit-agent-helper-1` on a unix socket. The scripts
 * replay what polkit 127's helper writes (docs/polkit-agent.md, "The helper protocol"),
 * including its stderr diagnostics, which share the socket under systemd.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { POLKIT_ANSWER_MAX_BYTES, createPolkitHelper } from "./polkit-helper";

const COOKIE = "1-0db981de61254d654931c5760fa1cc42-1-ca235288b48a0d78b2ff43c4f5bdf42f";
const PROMPT = "PAM_PROMPT_ECHO_OFF Password: \n";
const AUTH_FAILED = "polkit-agent-helper-1: pam_authenticate failed: Authentication failure\n";
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One accepted connection: what arrived, and how to read up to a given number of newlines. */
class Conversation {
  received: Buffer = Buffer.alloc(0);
  private waiters: (() => void)[] = [];
  constructor(readonly socket: net.Socket) {
    socket.on("data", (chunk: Buffer) => {
      this.received = Buffer.concat([this.received, chunk]);
      for (const wake of this.waiters.splice(0)) wake();
    });
    socket.on("error", () => {});
  }
  /** Resolve once `count` complete lines have arrived. */
  async lines(count: number): Promise<Buffer[]> {
    for (;;) {
      const lines: Buffer[] = [];
      let start = 0;
      for (let end = this.received.indexOf(0x0a); end >= 0;) {
        lines.push(this.received.subarray(start, end));
        start = end + 1;
        end = this.received.indexOf(0x0a, start);
      }
      if (lines.length >= count) return lines;
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }
}

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-pkh-"));
const socketPath = path.join(directory, "helper.socket");
let script: (conversation: Conversation) => Promise<void> = async () => {};
const conversations: Conversation[] = [];
const server = net.createServer((socket) => {
  const conversation = new Conversation(socket);
  conversations.push(conversation);
  void script(conversation).catch(() => socket.destroy());
});
await new Promise<void>((resolve) => server.listen(socketPath, resolve));

const helper = createPolkitHelper({
  socketPath,
  promptTimeoutMs: 300,
  verdictTimeoutMs: 300,
  closeTimeoutMs: 150,
});
const secret = (text: string) => Buffer.from(text, "utf8");
const ask = (text = "correct horse", account = "alice", cookie = COOKIE) =>
  helper({ account, cookie, secret: secret(text) });
/** The stock exchange: read the header, prompt, read the answer, then send `tail` and close. */
const answerWith =
  (tail: string, pause = 0) =>
  async (conversation: Conversation) => {
    await conversation.lines(2);
    conversation.socket.write(PROMPT);
    await conversation.lines(3);
    if (pause) await delay(pause);
    conversation.socket.end(tail);
  };

let cases = 0;
try {
  // Accepted: the header and the answer arrive as exact bytes, and the write copy is wiped.
  {
    const written: (string | Uint8Array)[] = [];
    const write = net.Socket.prototype.write;
    net.Socket.prototype.write = function (this: net.Socket, ...args: unknown[]) {
      if (this.remoteAddress === undefined && !conversations.some((c) => c.socket === this))
        written.push(args[0] as string | Uint8Array);
      return (write as (...a: unknown[]) => boolean).apply(this, args);
    } as typeof write;
    try {
      script = answerWith("SUCCESS\n");
      const mine = secret("pä55 wörd");
      assert.equal(await helper({ account: "alice", cookie: COOKIE, secret: mine }), "accepted");
      assert.deepEqual(
        conversations.at(-1)!.received,
        Buffer.concat([Buffer.from(`alice\n${COOKIE}\n`), secret("pä55 wörd"), Buffer.from("\n")]),
      );
      // The caller's bytes are the caller's to wipe; the helper client's copy is already zero.
      assert.deepEqual(mine, secret("pä55 wörd"));
      assert.equal(written.length, 2);
      assert.ok(
        written.every((chunk) => Buffer.isBuffer(chunk)),
        "only Buffers are written",
      );
      assert.ok(
        (written[1] as Buffer).every((byte) => byte === 0),
        "the answer copy is wiped",
      );
    } finally {
      net.Socket.prototype.write = write;
    }
    cases++;
  }

  // Wrong password, as the real helper reports it: its stderr line, then FAILURE.
  {
    script = answerWith(`${AUTH_FAILED}FAILURE\n`);
    assert.equal(await ask("wrong"), "rejected");
    // The diagnostic alone (the reader went away before FAILURE) and FAILURE alone (stderr sent
    // elsewhere) are the same refusal.
    script = answerWith(AUTH_FAILED);
    assert.equal(await ask("wrong"), "rejected");
    script = answerWith("FAILURE\n");
    assert.equal(await ask("wrong"), "rejected");
    // PAM chatter is read and never shown.
    script = answerWith(`PAM_ERROR_MSG nope\nPAM_TEXT_INFO 2 tries left\n${AUTH_FAILED}FAILURE\n`);
    assert.equal(await ask("wrong"), "rejected");
    cases++;
  }

  // Failures that are not about the password are "unavailable": no retry is promised.
  {
    script = answerWith(
      "polkit-agent-helper-1: pam_acct_mgmt failed: Authentication token expired\nFAILURE\n",
    );
    assert.equal(await ask(), "unavailable");
    script = answerWith(
      "polkit-agent-helper-1: error response to PolicyKit daemon: No session for cookie\nFAILURE\n",
    );
    assert.equal(await ask(), "unavailable");
    // A verdict before any prompt was answered.
    script = async (conversation) => {
      await conversation.lines(2);
      conversation.socket.end("FAILURE\n");
    };
    assert.equal(await ask(), "unavailable");
    // No verdict at all.
    script = answerWith("");
    assert.equal(await ask(), "unavailable");
    cases++;
  }

  // A visible prompt (a one-time code, a new-password dialogue) is never answered.
  {
    script = async (conversation) => {
      await conversation.lines(2);
      conversation.socket.write("PAM_PROMPT_ECHO_ON Code: \n");
    };
    assert.equal(await ask(), "unavailable");
    await delay(30);
    assert.equal(conversations.at(-1)!.received.toString(), `alice\n${COOKIE}\n`);
    // Nor a second secret after the password.
    script = async (conversation) => {
      await conversation.lines(2);
      conversation.socket.write(PROMPT);
      await conversation.lines(3);
      conversation.socket.write("PAM_PROMPT_ECHO_OFF Second factor: \n");
    };
    assert.equal(await ask(), "unavailable");
    await delay(30);
    assert.equal((await conversations.at(-1)!.lines(3)).length, 3, "one answer only");
    cases++;
  }

  // The strict reader: oversized lines, unknown keywords, near-miss verdicts, trailing bytes.
  {
    for (const hostile of [
      `${"A".repeat(1025)}\n`,
      "A".repeat(4096),
      "PAM_PROMPT_SECRET Password: \n",
      "Error getting authority: no bus\n",
      "SUCCESS \n",
      "SUCCESSFUL\n",
      "success\n",
      "\n",
    ]) {
      script = async (conversation) => {
        await conversation.lines(2);
        conversation.socket.write(hostile);
      };
      assert.equal(await ask(), "unavailable", JSON.stringify(hostile.slice(0, 24)));
    }
    for (const tail of ["SUCCESS\nSUCCESS\n", "SUCCESS\nPAM_TEXT_INFO late\n", "SUCCESS\nx"]) {
      script = answerWith(tail);
      assert.equal(await ask(), "unavailable", JSON.stringify(tail));
    }
    // A line of exactly 1 KiB is still a line.
    script = answerWith(`PAM_TEXT_INFO ${"i".repeat(1024 - 14)}\nSUCCESS\n`);
    assert.equal(await ask(), "accepted");
    cases++;
  }

  // Lines split across reads, and several lines in one read.
  {
    script = async (conversation) => {
      await conversation.lines(2);
      for (const byte of Buffer.from(PROMPT)) {
        conversation.socket.write(Buffer.from([byte]));
        await delay(1);
      }
      await conversation.lines(3);
      conversation.socket.end("PAM_TEXT_INFO ok\nSUCCESS\n");
    };
    assert.equal(await ask(), "accepted");
    cases++;
  }

  // Answers the line protocol cannot carry are refused before anything is connected.
  {
    const before = conversations.length;
    script = answerWith("SUCCESS\n");
    assert.equal(await ask(""), "rejected");
    assert.equal(await ask("two\nlines"), "rejected");
    assert.equal(await ask("nul\0byte"), "rejected");
    assert.equal(await ask("x".repeat(POLKIT_ANSWER_MAX_BYTES + 1)), "rejected");
    for (const account of ["", "Alice", "al ice", "alice\nroot", "a".repeat(40), "-alice"])
      assert.equal(await ask("pw", account), "unavailable", account);
    for (const cookie of ["", "has space", "new\nline", "x".repeat(129), "café"])
      assert.equal(await ask("pw", "alice", cookie), "unavailable", cookie);
    await delay(20);
    assert.equal(conversations.length, before, "nothing connected");
    assert.equal(await ask("x".repeat(POLKIT_ANSWER_MAX_BYTES)), "accepted");
    assert.equal(conversations.at(-1)!.received.length, 6 + COOKIE.length + 1 + 511);
    cases++;
  }

  // Deadlines: no prompt, then no verdict.
  {
    script = async () => {};
    let started = performance.now();
    assert.equal(await ask(), "unavailable");
    assert.ok(performance.now() - started >= 250);
    script = async (conversation) => {
      await conversation.lines(2);
      conversation.socket.write(PROMPT);
    };
    started = performance.now();
    assert.equal(await ask(), "unavailable");
    assert.ok(performance.now() - started >= 250);
    // A helper that never closes after its verdict does not hold the verdict hostage.
    script = async (conversation) => {
      await conversation.lines(2);
      conversation.socket.write(PROMPT);
      await conversation.lines(3);
      conversation.socket.write("SUCCESS\n");
    };
    assert.equal(await ask(), "accepted");
    cases++;
  }

  // Cancelling closes the conversation.
  {
    script = async (conversation) => {
      await conversation.lines(2);
    };
    const controller = new AbortController();
    const verdict = helper({
      account: "alice",
      cookie: COOKIE,
      secret: secret("pw"),
      signal: controller.signal,
    });
    await delay(30);
    const conversation = conversations.at(-1)!;
    const closed = new Promise<void>((resolve) => conversation.socket.once("close", resolve));
    controller.abort();
    assert.equal(await verdict, "unavailable");
    await closed;
    const aborted = new AbortController();
    aborted.abort();
    assert.equal(
      await helper({
        account: "alice",
        cookie: COOKIE,
        secret: secret("pw"),
        signal: aborted.signal,
      }),
      "unavailable",
    );
    cases++;
  }

  // No socket (the units are off): unavailable, at once.
  {
    const missing = createPolkitHelper({ socketPath: path.join(directory, "absent.socket") });
    assert.equal(
      await missing({ account: "alice", cookie: COOKIE, secret: secret("pw") }),
      "unavailable",
    );
    cases++;
  }
} finally {
  for (const conversation of conversations) conversation.socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(directory, { recursive: true, force: true });
}
console.log(`[polkit-helper] ${cases} cases PASS`);
