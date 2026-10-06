/** Real public Window/widgets and native controller; synthetic metadata/PAM transport. */
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import React from "react";
import { collectHits, SoftwareRenderer, type SceneNode } from "@moire/react-host";
import {
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
} from "@moire/ui";
// oxlint-disable-next-line import/no-relative-parent-imports -- Reuse the actual Window harness.
import { greeterHarness } from "../testing";
import { createNativeGreeterController } from "./controller";
import { NativeGreeterView } from "./view";
import type { LocalLoginUser, LocalUserProvider } from "./local-users";
import type {
  AuthReply,
  CancelReply,
  NativeGreetdClient,
  // oxlint-disable-next-line import/no-relative-parent-imports -- Native source transport contract.
} from "../../../display-manager/src/native-greetd-client";

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Uninitialized deferred");
  };
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
const alice: LocalLoginUser = Object.freeze({
  uid: 1000n,
  username: "alice",
  displayName: "Alice",
});
const bob: LocalLoginUser = Object.freeze({ uid: 1001n, username: "bob", displayName: "Bob" });
let observed: SceneNode | undefined;
const render = SoftwareRenderer.prototype.render;
SoftwareRenderer.prototype.render = function (root, viewport) {
  observed = root;
  return render.call(this, root, viewport);
};
function scene(): SceneNode {
  assert.ok(observed);
  return observed;
}
const nodes = (node: SceneNode): SceneNode[] => [node, ...node.children.flatMap(nodes)];
const texts = () =>
  nodes(scene()).flatMap((node) => (typeof node.text === "string" ? [node.text] : []));
const hits = () => collectHits(scene());
const theme = createPersonalizedWidgetTheme(
  discoverPersonalization("linux", {
    source: "application",
    themeFamily: "moire",
    reducedMotion: true,
  }),
);
async function setup() {
  let available: readonly LocalLoginUser[] = [alice, bob];
  let lookup: LocalUserProvider["list"] = async () => available;
  let cancel: () => Promise<CancelReply> = async () => ({ kind: "cancelled" });
  let response: () => Promise<AuthReply> = async () => ({
    kind: "prompt",
    style: "secret",
    message: "",
  });
  const auths: string[] = [],
    responses: (string | null)[] = [];
  let cancellations = 0;
  const client: NativeGreetdClient = {
    authenticate: async (username) => {
      auths.push(username);
      return { kind: "prompt", style: "secret", message: "" };
    },
    respond: async (value) => {
      responses.push(value);
      return response();
    },
    cancel: async () => {
      cancellations++;
      return cancel();
    },
    start: async () => ({ kind: "committed" }),
    close: () => {},
  };
  const controller = createNativeGreeterController({ client });
  const users: LocalUserProvider = { list: (signal) => lookup(signal) };
  const app = await greeterHarness((size) => (
    <WidgetThemeProvider theme={theme}>
      <NativeGreeterView
        {...size}
        state={controller.snapshot()}
        actions={controller}
        users={users}
        now={new Date("2026-10-05T06:00:00Z")}
      />
    </WidgetThemeProvider>
  ));
  const unsubscribe = controller.subscribe(() => app.window.requestRedraw());
  await app.settle();
  const click = (id: string) => {
    const hit = hits().find((item) => item.focusId === id && item.focusable);
    assert.ok(hit, `Missing control ${id}`);
    app.click(hit.x + hit.width / 2, hit.y + hit.height / 2);
    return hit.onPress;
  };
  const type = (value: string) => {
    for (const key of value) {
      const modifiers = { ctrl: false, alt: false, meta: false, shift: false };
      app.native.injectKey({ type: "down", code: 30, key, text: key, modifiers, timeMs: 0 });
      app.native.injectKey({ type: "up", code: 30, key, modifiers, timeMs: 1 });
      app.window.tick();
    }
  };
  return {
    ...app,
    controller,
    click,
    type,
    auths,
    responses,
    get cancellations() {
      return cancellations;
    },
    available(value: readonly LocalLoginUser[]) {
      available = value;
    },
    lookup(value: LocalUserProvider["list"]) {
      lookup = value;
    },
    cancel(value: () => Promise<CancelReply>) {
      cancel = value;
    },
    response(value: () => Promise<AuthReply>) {
      response = value;
    },
    async close() {
      unsubscribe();
      app.destroy();
      await controller.dispose();
    },
  };
}
const event = { x: 0, y: 0, localX: 0, localY: 0, button: "left" } satisfies Parameters<
  NonNullable<ReturnType<typeof hits>[number]["onPress"]>
>[0];
let cases = 0;
try {
  const app = await setup();
  try {
    assert.ok(texts().includes("Choose your account to sign in."));
    const staleUser = app.click("native:user:alice");
    await app.settle();
    assert.deepEqual(app.auths, ["alice"]);
    assert.ok(texts().includes("Alice") && texts().includes("Password"));
    app.type("private");
    assert.ok(texts().includes("•••••••") && !texts().includes("private"));
    const staleAnswer = hits().find((hit) => hit.focusId === "native:answer")?.onPress;
    assert.ok(staleAnswer && staleUser);
    const cancelled = deferred<CancelReply>();
    app.cancel(() => cancelled.promise);
    app.click("native:cancel");
    await app.settle();
    assert.equal(app.controller.snapshot().kind, "cancelling");
    assert.ok(!texts().includes("•••••••"));
    assert.ok(!hits().some((hit) => hit.focusId?.startsWith("native:user:")));
    staleAnswer(event);
    staleUser(event);
    assert.equal(app.responses.length, 0);
    assert.equal(app.auths.length, 1);
    cancelled.resolve({ kind: "cancelled" });
    await app.settle();
    staleUser(event);
    await app.settle();
    assert.equal(app.auths.length, 1, "Old catalog callback cannot start another attempt");
    app.click("native:user:bob");
    await app.settle();
    staleAnswer(event);
    assert.deepEqual(app.auths, ["alice", "bob"]);
    assert.equal(app.responses.length, 0);
    app.type("b");
    app.key(28, "Enter");
    await app.settle();
    assert.deepEqual(app.responses, ["b"]);
    assert.ok(texts().includes("Authentication response") && !texts().includes("Password"));
    app.response(async () => ({ kind: "prompt", style: "info", message: "" }));
    app.type("c");
    app.key(28, "Enter");
    await app.settle();
    app.response(async () => ({ kind: "authorized" }));
    app.click("native:answer");
    await app.settle();
    assert.deepEqual(app.responses, ["b", "c", null]);
    assert.equal(app.controller.snapshot().kind, "launch-committed");
    cases++;
  } finally {
    await app.close();
  }

  const locked = await setup();
  try {
    locked.available([bob]);
    locked.click("native:user:alice");
    await locked.settle();
    assert.equal(locked.auths.length, 0);
    assert.ok(texts().includes("That account is no longer available."));
    assert.ok(!hits().some((hit) => hit.focusId === "native:user:alice"));
    cases++;
  } finally {
    await locked.close();
  }

  const unavailable = await setup();
  try {
    unavailable.lookup(async () => {
      throw new Error("PRIVATE PROVIDER DETAIL");
    });
    unavailable.click("native:user:alice");
    await unavailable.settle();
    assert.equal(unavailable.auths.length, 0);
    assert.ok(texts().includes("Local users are unavailable. Try again."));
    assert.ok(!texts().some((text) => text.includes("PRIVATE")));
    unavailable.lookup(async () => [bob]);
    unavailable.click("native:users-retry");
    await unavailable.settle();
    assert.ok(hits().some((hit) => hit.focusId === "native:user:bob"));
    cases++;
  } finally {
    await unavailable.close();
  }

  const stale = await setup();
  const later = deferred<readonly LocalLoginUser[]>();
  try {
    stale.lookup(() => later.promise);
    stale.click("native:user:alice");
    await stale.settle();
    await stale.controller.dispose();
    stale.window.requestRedraw();
    await stale.settle();
    later.resolve([alice]);
    await stale.settle();
    assert.equal(stale.auths.length, 0, "Late discovery cannot authenticate after retirement");
    cases++;
  } finally {
    later.resolve([]);
    await stale.close();
  }

  const visual = await setup();
  try {
    const directory =
      process.env.MOIRE_USER_PICKER_CAPTURE_DIR ?? path.join(os.tmpdir(), "moire-user-picker");
    await visual.capture(path.join(directory, "picker.png"), { width: 1280, height: 800 });
    visual.click("native:user:alice");
    await visual.settle();
    await visual.capture(path.join(directory, "password.png"), { width: 1280, height: 800 });
    const attempt = visual.controller.snapshot();
    const desktopLabels = texts().filter((text) => text === "Moire Wayland").length;
    visual.click("native:desktop");
    await visual.settle();
    assert.equal(texts().filter((text) => text === "Moire Wayland").length, desktopLabels + 1);
    assert.ok(!texts().includes("Other desktop"), "Mock alternatives must not enter production");
    assert.equal(
      visual.controller.snapshot(),
      attempt,
      "Session presentation cannot restart authentication",
    );
    await visual.capture(path.join(directory, "password-desktop-flyout.png"), {
      width: 1280,
      height: 800,
    });
    cases++;
    console.log(
      JSON.stringify({
        test: "native-user-picker",
        cases,
        actualWindow: true,
        actualCpuPixels: true,
        authority: "synthetic metadata/PAM; no native session proof",
        captures: directory,
      }),
    );
  } finally {
    await visual.close();
  }
} finally {
  SoftwareRenderer.prototype.render = render;
}
