/** Real private Unix transport + actual public headless Window + harmless child exit. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { SoftwareRenderer, type SceneNode } from "@moire/react-host";
import { HeadlessPlatform, HeadlessWindow } from "@moire/ui/testing";
import type { Window } from "@moire/ui";
import {
  connectNativeGreetd,
  fixedSessionCommand,
  type NativeGreetdClient,
  // oxlint-disable-next-line import/no-relative-parent-imports -- Source-only native adapter, no fixture authority.
} from "../../../display-manager/src/native-greetd-client";
import { runNativeGreeter } from "./main";
import type { NativeGreeterController } from "./types";
import { harmlessSession, nativeProtocolPeer } from "./testing";

const entryFile = fileURLToPath(import.meta.url);
const modes = [
  "username-invalid",
  "secret-invalid",
  "success",
  "denied",
  "start-failed",
  "start-unknown",
  "close-ready",
  "close-launch",
] as const;
type Mode = (typeof modes)[number];
function isMode(value: string | undefined): value is Mode {
  return modes.some((mode) => mode === value);
}
const nodes = (node: SceneNode): SceneNode[] => [node, ...node.children.flatMap(nodes)];

async function child(socketPath: string, mode: Mode) {
  let native: HeadlessWindow | undefined;
  let window: Window | undefined;
  let controller: NativeGreeterController | undefined;
  let observed: SceneNode | undefined;
  const create = HeadlessPlatform.prototype.createWindow;
  HeadlessPlatform.prototype.createWindow = function (opts) {
    const result = create.call(this, opts);
    native = this.getWindows().at(-1);
    return result;
  };
  const render = SoftwareRenderer.prototype.render;
  SoftwareRenderer.prototype.render = function (root, viewport) {
    observed = root;
    return render.call(this, root, viewport);
  };
  const text = () =>
    observed
      ? nodes(observed).flatMap((node) => (typeof node.text === "string" ? [node.text] : []))
      : [];
  const key = (code: number, name: string) => {
    assert.ok(native && window);
    const modifiers = { ctrl: false, alt: false, meta: false, shift: false };
    native.injectKey({
      type: "down",
      code,
      key: name,
      ...(name.length === 1 ? { text: name } : {}),
      modifiers,
      timeMs: 0,
    });
    native.injectKey({ type: "up", code, key: name, modifiers, timeMs: 1 });
    window.tick();
  };
  const type = (value: string) => {
    for (const character of value) key(30, character);
  };
  const insertText = (value: string) => {
    assert.ok(native && window);
    const modifiers = { ctrl: false, alt: false, meta: false, shift: false };
    native.injectKey({ type: "down", code: 30, key: "a", text: value, modifiers, timeMs: 0 });
    native.injectKey({ type: "up", code: 30, key: "a", modifiers, timeMs: 1 });
    window.tick();
  };
  const sent = new Set<string>();
  let masked = false,
    cleared = false,
    actualFrames = 0;
  const client = await connectNativeGreetd({
    socketPath,
    session: fixedSessionCommand(harmlessSession),
    timeoutMs: 3000,
  });
  const timer = setInterval(() => {
    if (!controller || !window || !native || window.isClosed()) return;
    actualFrames = native.presentedFrames;
    const state = controller.snapshot();
    const id =
      state.kind === "ready"
        ? `ready:${state.revision}`
        : state.kind === "prompt"
          ? state.promptId.value
          : state.kind;
    if (sent.has(id)) {
      if (
        mode === "username-invalid" &&
        state.kind === "ready" &&
        state.revision === 0 &&
        !sent.has("invalid-retry")
      ) {
        assert.ok(text().includes("Enter a valid username to try again."));
        assert.ok(!text().includes("x".repeat(65)));
        sent.add("invalid-retry");
        type("synthetic-user");
        key(28, "Enter");
        cleared = true;
      } else if (
        mode === "secret-invalid" &&
        state.kind === "prompt" &&
        !sent.has("invalid-cancel")
      ) {
        assert.ok(
          text().includes("Sign-in request unavailable. Cancel or wait for a fresh prompt."),
        );
        assert.ok(!text().some((value) => value.includes("•") || value.includes("x".repeat(4097))));
        sent.add("invalid-cancel");
        key(1, "Escape");
        cleared = true;
      }
      return;
    }
    if (state.kind === "ready") {
      sent.add(id);
      if (mode === "close-ready") {
        window.requestClose();
        return;
      }
      if (state.revision > 0) {
        assert.ok(mode === "denied" || mode === "secret-invalid");
        window.requestClose();
        return;
      }
      if (mode === "username-invalid") {
        insertText("x".repeat(65));
        key(28, "Enter");
        return;
      }
      type("synthetic-user");
      key(28, "Enter");
      assert.ok(!text().includes("synthetic-user"));
      cleared = true;
    } else if (state.kind === "prompt") {
      sent.add(id);
      key(15, "Tab");
      if (mode === "secret-invalid") {
        insertText("x".repeat(4097));
        key(28, "Enter");
        return;
      }
      if (state.style === "secret" || state.style === "visible") {
        const value = state.style === "secret" ? "synthetic-secret" : "synthetic-visible";
        type(value);
        if (state.style === "secret") {
          assert.ok(text().includes("•".repeat(value.length)) && !text().includes(value));
          masked = true;
        } else assert.ok(text().includes(value));
      }
      key(28, "Enter");
      assert.ok(
        !text().some(
          (value) =>
            value.includes("synthetic-secret") ||
            value.includes("synthetic-visible") ||
            value.includes("•"),
        ),
      );
      cleared = true;
    } else if (state.kind === "launching" && mode === "close-launch") {
      sent.add(id);
      window.requestClose();
    }
  }, 20);
  try {
    const result = await runNativeGreeter({
      client,
      platform: "headless",
      width: 640,
      height: 640,
      now: new Date("2026-10-04T12:34:00Z"),
      onMounted: (nextWindow, nextController) => {
        window = nextWindow;
        controller = nextController;
      },
    });
    assert.ok(window?.isClosed());
    if (mode !== "close-ready") {
      assert.ok(actualFrames > 0);
      assert.ok(cleared);
    }
    if (mode === "success" || mode === "close-launch" || mode === "username-invalid") {
      assert.equal(result.exitCode, 0);
      assert.equal(result.outcome.kind, "launch-committed");
      assert.ok(masked);
    } else {
      assert.equal(result.exitCode, 1);
      assert.equal(result.outcome.kind, "unavailable");
    }
    console.log(
      JSON.stringify({
        test: "native-entry-child",
        mode,
        ...result,
        actualFrames,
        masked,
        cleared,
      }),
    );
    process.exitCode = result.exitCode;
  } finally {
    clearInterval(timer);
    HeadlessPlatform.prototype.createWindow = create;
    SoftwareRenderer.prototype.render = render;
    client.close();
  }
}
async function subprocess(file: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  const started = Date.now();
  return await new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
    elapsedMs: number;
    exitedAt: number;
  }>((resolve, reject) => {
    const processChild = spawn(process.execPath, [...process.execArgv, file, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "";
    const timeout = setTimeout(() => {
      processChild.kill("SIGKILL");
      reject(new Error("Native frontend failed to exit after acknowledgement"));
    }, 15000);
    processChild.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    processChild.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    processChild.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    processChild.on("exit", (code) => {
      clearTimeout(timeout);
      const exitedAt = Date.now();
      resolve({ code, stdout, stderr, elapsedMs: exitedAt - started, exitedAt });
    });
  });
}
async function parent() {
  let cases = 0;
  for (const invalid of [{ width: 10 }, { sessionLabel: "x".repeat(161) }]) {
    let closes = 0,
      operations = 0;
    const forbidden = () => {
      operations++;
      throw new Error("Invalid presentation must not authenticate or start");
    };
    const client: NativeGreetdClient = {
      authenticate: forbidden,
      respond: forbidden,
      cancel: forbidden,
      start: forbidden,
      close: () => {
        closes++;
      },
    };
    await assert.rejects(
      runNativeGreeter({ client, platform: "headless", ...invalid }),
      /Invalid greeter presentation/,
    );
    assert.equal(closes, 1);
    assert.equal(operations, 0);
    cases++;
  }
  const exits: {
    mode: Mode;
    actualExitCode: number | null;
    elapsedMs: number;
    requests: string[];
  }[] = [];
  for (const mode of modes) {
    let response = 0;
    let launchAckAt = 0;
    let launchRequestedAt = 0;
    let delayed: ReturnType<typeof setTimeout> | undefined;
    const peer = await nativeProtocolPeer((request, send) => {
      if (request.type === "create_session") {
        assert.deepEqual(request, { type: "create_session", username: "synthetic-user" });
        if (mode === "denied")
          send({
            type: "error",
            error_type: "auth_error",
            description: "synthetic-secret must never escape",
          });
        else
          send({
            type: "auth_message",
            auth_message_type: "secret",
            auth_message: "synthetic-secret must never escape",
          });
      } else if (request.type === "post_auth_message_response") {
        const expected = ["synthetic-secret", "synthetic-visible", null, null][response];
        assert.deepEqual(request, { type: "post_auth_message_response", response: expected });
        response++;
        if (response === 1)
          send({
            type: "auth_message",
            auth_message_type: "visible",
            auth_message: "synthetic-visible must never escape",
          });
        else if (response === 2)
          send({
            type: "auth_message",
            auth_message_type: "info",
            auth_message: "Synthetic information",
          });
        else if (response === 3)
          send({
            type: "auth_message",
            auth_message_type: "error",
            auth_message: "Synthetic message",
          });
        else send({ type: "success" });
      } else if (request.type === "cancel_session") {
        assert.ok(mode === "denied" || mode === "secret-invalid");
        assert.deepEqual(request, { type: "cancel_session" });
        send({ type: "success" });
      } else if (request.type === "start_session") {
        assert.deepEqual(request, { type: "start_session", cmd: [harmlessSession], env: [] });
        launchRequestedAt = Date.now();
        if (mode === "start-unknown") {
          peer.disconnect();
          return;
        }
        const ack = () => {
          launchAckAt = Date.now();
          send(
            mode === "start-failed"
              ? {
                  type: "error",
                  error_type: "error",
                  description: "synthetic-secret must never escape",
                }
              : { type: "success" },
          );
        };
        if (mode === "close-launch") delayed = setTimeout(ack, 300);
        else ack();
      } else assert.fail("Unexpected request from native frontend");
    });
    try {
      const result = await subprocess(entryFile, ["--child", peer.socketPath, mode]);
      peer.assertHealthy();
      assert.equal(
        result.code,
        mode === "success" || mode === "close-launch" || mode === "username-invalid" ? 0 : 1,
      );
      assert.ok(
        result.stdout.includes('"presentation":"closed"') &&
          result.stdout.includes('"transport":"closed"'),
      );
      assert.ok(
        !result.stdout.includes("synthetic-secret") && !result.stderr.includes("synthetic-secret"),
      );
      const launches = peer.requests.filter((request) => request.type === "start_session");
      assert.equal(
        launches.length,
        mode === "denied" || mode === "close-ready" || mode === "secret-invalid" ? 0 : 1,
      );
      assert.equal(
        peer.requests.filter((request) => request.type === "cancel_session").length,
        mode === "denied" || mode === "secret-invalid" ? 1 : 0,
      );
      if (launchAckAt)
        assert.ok(
          result.exitedAt >= launchAckAt,
          "Actual child exited after launch acknowledgement",
        );
      if (mode === "close-launch")
        assert.ok(
          launchAckAt - launchRequestedAt >= 250,
          "Closing presentation waits delayed launch acknowledgement before exit",
        );
      assert.ok(peer.closed() >= 1, "Local transport closed on actual child exit");
      exits.push({
        mode,
        actualExitCode: result.code,
        elapsedMs: result.elapsedMs,
        requests: peer.requests.map((request) => String(request.type)),
      });
      cases++;
    } finally {
      if (delayed) clearTimeout(delayed);
      await peer.destroy();
    }
  }
  const mainFile = fileURLToPath(new URL("./main.tsx", import.meta.url));
  const missing = await subprocess(mainFile, ["/arbitrary/command"], {
    ...process.env,
    GREETD_SOCK: "/invalid/socket",
    MOIRE_SESSION_COMMAND: "/arbitrary/command",
  });
  assert.equal(missing.code, 1);
  assert.ok(missing.stderr.includes("explicitly configured trusted entry client"));
  assert.ok(!missing.stderr.includes("/arbitrary/command"));
  cases++;
  console.log(
    JSON.stringify({
      test: "native-greeter-entry",
      cases,
      actualSubprocessExits: exits,
      exactLaunch: { cmd: [harmlessSession], env: [] },
      missingConfigExitCode: missing.code,
      authority: "frontend-only",
      noPamClaim: true,
    }),
  );
}

if (process.argv[2] === "--child") {
  const socketPath = process.argv[3],
    mode = process.argv[4];
  if (!socketPath || !isMode(mode)) throw new Error("Invalid synthetic child configuration");
  await child(socketPath, mode);
} else await parent();
