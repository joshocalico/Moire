import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React, { useState, type ReactNode } from "react";
import { createShellRoot, renderShell, collectHits, type SceneNode } from "@moire/react-host";
import {
  THEME_FAMILIES,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  setUiScaleFactor,
} from "@moire/ui";
import { GreeterApp } from "./view";
import { SessionContinuation, type ContinuationState } from "./controller";
import { greeterHarness } from "./testing";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-greeter-smoke-"));
const keys = ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "TMPDIR"];
const previous = keys.map((key) => [key, process.env[key]] as const);
const captureDirectory = process.env.MOIRE_GREETER_CAPTURE_DIR ?? "/tmp/moire-greeter-v2-captures";
const now = new Date("2026-10-03T12:34:00Z");
const nodes = (node: SceneNode): SceneNode[] => [node, ...node.children.flatMap(nodes)];
let frames = 0;
try {
  process.env.HOME = directory;
  process.env.XDG_CONFIG_HOME = path.join(directory, "config");
  process.env.XDG_DATA_HOME = path.join(directory, "data");
  fs.mkdirSync(path.join(directory, "tmp"));
  process.env.TMPDIR = path.join(directory, "tmp");
  const changes: ContinuationState[] = [];
  let requests = 0;
  let release = () => {};
  const continuing = new SessionContinuation(
    () => {
      requests++;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    },
    (state) => changes.push(state),
  );
  const pending = continuing.start();
  await continuing.start();
  assert.equal(requests, 1);
  release();
  await pending;
  await continuing.start();
  assert.equal(requests, 1, "successful continuation must not repeat");
  assert.deepEqual(
    changes.map((state) => state.kind),
    ["starting", "complete"],
  );
  let attempts = 0;
  const retry = new SessionContinuation(
    async () => {
      if (++attempts === 1) throw new Error("Session fixture could not launch its apps.");
    },
    (state) => changes.push(state),
  );
  await retry.start();
  assert.deepEqual(changes.at(-1), {
    kind: "error",
    message: "Session fixture could not launch its apps.",
  });
  await retry.start();
  assert.equal(attempts, 2);
  assert.equal(changes.at(-1)?.kind, "complete");

  setUiScaleFactor(1);
  let invokes = 0,
    complete = () => {},
    reducedMotion = true;
  const app = await greeterHarness((size) => (
    <GreeterApp
      {...size}
      username="moire"
      now={now}
      reducedMotion={reducedMotion}
      onReducedMotionChange={(value) => {
        reducedMotion = value;
      }}
      onContinue={() => {
        invokes++;
        return new Promise<void>((resolve) => {
          complete = resolve;
        });
      }}
    />
  ));
  try {
    assert.equal(app.window.isFullscreen(), true, "greeter must request native fullscreen");
    app.key(28, "Enter");
    app.key(28, "Enter");
    app.key(57, " ");
    app.click(200, 420);
    app.key(28, "Enter", false, true);
    assert.equal(invokes, 1, "rapid keyboard and repeat activation duplicated continuation");
    complete();
    await app.settle();
    app.key(28, "Enter");
    assert.equal(invokes, 1);
  } finally {
    app.destroy();
  }

  let closeStarts = 0;
  const closing = await greeterHarness((size) => (
    <GreeterApp
      {...size}
      username="moire"
      now={now}
      reducedMotion
      onContinue={async () => {
        closeStarts++;
      }}
    />
  ));
  try {
    closing.window.requestClose();
    closing.key(28, "Enter");
    assert.equal(closing.window.isClosed(), true);
    assert.equal(closeStarts, 0, "ordinary close must not invoke the explicit Start callback");
  } finally {
    closing.destroy();
  }

  let failed = 0;
  const errorApp = await greeterHarness((size) => (
    <GreeterApp
      {...size}
      username="moire"
      now={now}
      reducedMotion
      onContinue={async () => {
        failed++;
        if (failed === 1) throw new Error("Try the session again.");
      }}
    />
  ));
  try {
    errorApp.key(28, "Enter");
    await errorApp.settle();
    errorApp.key(28, "Enter");
    await errorApp.settle();
    assert.equal(failed, 2, "an actual continuation error did not allow keyboard retry");
  } finally {
    errorApp.destroy();
  }

  let activate = () => {},
    hiddenStarts = 0;
  function Lifecycle(props: { width: number; height: number }) {
    const [active, setActive] = useState(false);
    activate = () => setActive(true);
    return (
      <GreeterApp
        {...props}
        active={active}
        username="moire"
        now={now}
        reducedMotion
        onContinue={async () => {
          hiddenStarts++;
        }}
      />
    );
  }
  const lifecycle = await greeterHarness((size) => <Lifecycle {...size} />);
  try {
    lifecycle.key(28, "Enter");
    lifecycle.click(200, 420);
    assert.equal(hiddenStarts, 0, "hidden greeter must not accept input");
    assert.equal(lifecycle.window.hasActiveAnimations(), false);
    activate();
    await lifecycle.settle();
    lifecycle.key(28, "Enter");
    assert.equal(hiddenStarts, 1, "visible greeter did not restore start focus");
  } finally {
    lifecycle.destroy();
  }

  let motionChanges = 0;
  function Accessible(props: { width: number; height: number }) {
    const [reduce, setReduce] = useState(true);
    return (
      <GreeterApp
        {...props}
        username="moire"
        now={now}
        reducedMotion={reduce}
        onReducedMotionChange={(value) => {
          motionChanges++;
          setReduce(value);
        }}
        onContinue={async () => {}}
      />
    );
  }
  const accessible = await greeterHarness((size) => <Accessible {...size} />);
  try {
    accessible.key(15, "Tab");
    accessible.key(28, "Enter");
    await accessible.settle();
    accessible.key(57, " ");
    assert.equal(motionChanges, 1, "accessibility popover checkbox was not keyboard usable");
    accessible.key(1, "Escape");
    await accessible.settle();
    accessible.key(28, "Enter");
    await accessible.settle();
    accessible.key(57, " ");
    assert.equal(motionChanges, 2, "closing popover did not restore its opener focus");
  } finally {
    accessible.destroy();
  }

  for (const family of THEME_FAMILIES)
    for (const colorScheme of ["dark", "light"] as const)
      for (const scale of [1, 1.5]) {
        setUiScaleFactor(scale);
        const theme = createPersonalizedWidgetTheme(
          discoverPersonalization("linux", {
            themeFamily: family,
            colorScheme,
            reducedMotion: true,
          }),
        );
        let content: ReactNode = null;
        const fixture = await greeterHarness(
          (size) => {
            content = (
              <WidgetThemeProvider theme={theme}>
                <GreeterApp
                  {...size}
                  username="moire"
                  now={now}
                  reducedMotion
                  onReducedMotionChange={() => {}}
                  onContinue={async () => {}}
                />
              </WidgetThemeProvider>
            );
            return content;
          },
          1280,
          800,
        );
        const root = createShellRoot();
        try {
          for (const size of [
            { width: 1280, height: 800 },
            { width: 640, height: 640 },
          ]) {
            fixture.native.setSize(size.width, size.height);
            fixture.window.tick();
            await fixture.settle();
            renderShell(root, content);
            const hits = collectHits(root.container).filter(
              (hit) => hit.focusable && hit.focusScopeActive !== false,
            );
            for (const id of ["greeter:start", "greeter:accessibility"]) {
              const hit = hits.find((item) => item.focusId === id);
              assert.ok(hit, `${family}/${colorScheme}/${scale} missing ${id}`);
              assert.ok(
                hit.x >= 0 &&
                  hit.y >= 0 &&
                  hit.x + hit.width <= size.width &&
                  hit.y + hit.height <= size.height,
                `${id} outside ${size.width}×${size.height}`,
              );
            }
            assert.ok(nodes(root.container).some((node) => node.text === "Start session"));
            assert.ok(nodes(root.container).some((node) => node.text === "moire"));
            assert.ok(!nodes(root.container).some((node) => node.text === "Password"));
            assert.equal(fixture.native.lastFrame?.length, size.width * size.height * 4);
            const before = fixture.native.lastFrame?.slice();
            await fixture.settle();
            assert.deepEqual(
              fixture.native.lastFrame,
              before,
              "static welcome must not animate between input events",
            );
            frames++;
            if (
              (family === "moire" && colorScheme === "dark" && scale === 1) ||
              (family === "cupertino" && colorScheme === "light" && scale === 1.5)
            )
              await fixture.capture(
                path.join(
                  captureDirectory,
                  `greeter-${family}-${colorScheme}-${size.width}x${size.height}-scale${scale}.png`,
                ),
                size,
              );
          }
        } finally {
          fixture.destroy();
          renderShell(root, null);
        }
      }
  console.log(
    `Greeter authorized continuation duplicate/retry guards, actual Window keyboard/accessibility focus, ${frames} static themed/scaled wide/compact frames passed; captures ${captureDirectory}`,
  );
} finally {
  setUiScaleFactor(1);
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(directory, { recursive: true, force: true });
}
