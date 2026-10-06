/** Device-free public Window observer contract: tracing never owns editing or saving. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import React from "react";
import {
  createInputFixtureRecorder,
  INPUT_FIXTURE_VALUE,
  type InputFixtureManifest,
  type InputFixtureRecord,
  type InputFixtureTrace,
} from "@moire/sys/input-fixture";
import { collectHits, createShellRoot, renderShell } from "@moire/react-host";
import {
  Window,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  installUiFonts,
  setUiScaleFactor,
  type ImageData,
  type PlatformWindowOpts,
} from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { ScreenshotApp } from "./main";
import { documentImage, emptyDocument } from "./document";
import { screenshotLayout } from "./layout";

const manifest: InputFixtureManifest = {
  version: 2,
  runId: "00000000-0000-0000-0000-000000000001",
  bootId: "00000000-0000-0000-0000-000000000002",
  armedAtMonoNs: "0",
  scenario: "keys",
  compositor: {
    pid: 1,
    uid: 1,
    startTicks: "1",
    cwd: "/fixture/home",
    entryPoint: "/fixture/apps/system/compositor/src/main.ts",
  },
  app: {
    pid: 2,
    uid: 1,
    startTicks: "2",
    cwd: "/fixture/apps/bundled/screenshot",
    entryPoint: "/fixture/apps/bundled/screenshot/src/main.tsx",
  },
  appId: "org.moire.Screenshot",
  devices: [],
};
class RetainedCpuPlatform extends HeadlessPlatform {
  override createWindow(opts: PlatformWindowOpts) {
    return Object.assign(super.createWindow(opts), { presentScene: () => false });
  }
}
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
await installUiFonts();
let cases = 0;
for (const retained of [false, true])
  for (const scale of [1, 1.5]) {
    for (const policy of ["record", "denied", "throw"]) {
      setUiScaleFactor(scale);
      const records: InputFixtureRecord[] = [];
      const recorder = createInputFixtureRecorder({
        manifest,
        role: "app",
        now: () => 1n,
        validate: () => (policy === "denied" ? "identity" : null),
        emit: (record) => records.push(record),
      });
      const diagnosticTrace: InputFixtureTrace =
        policy !== "throw"
          ? recorder
          : {
              ...recorder,
              write: () => {
                throw new Error("Fixture observer failure");
              },
            };
      const theme = createPersonalizedWidgetTheme(
        discoverPersonalization("linux", {
          themeFamily: "moire",
          colorScheme: "dark",
          reducedMotion: true,
          accent: "#b794f4",
        }),
      );
      const wrap = (content: React.ReactNode) => (
        <WidgetThemeProvider theme={theme}>{content}</WidgetThemeProvider>
      );
      const image: ImageData = { width: 80, height: 50, rgba: new Uint8Array(80 * 50 * 4) };
      for (let i = 0; i < image.rgba.length; i += 4) image.rgba.set([i % 251, 85, 194, 255], i);
      const latest = { current: emptyDocument() };
      const saves: { image: ImageData; target: string }[] = [];
      const size = { width: 1280, height: 800 };
      const platform = retained ? new RetainedCpuPlatform() : new HeadlessPlatform();
      const window = new Window({ ...size, title: "Input observer contract" });
      const scene = createShellRoot();
      try {
        window.setContent((allocation) =>
          wrap(
            <ScreenshotApp
              {...allocation}
              window={window}
              initialImage={image}
              initialOutput=""
              diagnosticTrace={diagnosticTrace}
              onDocumentChange={(value) => {
                latest.current = value;
              }}
              save={async (value, target) => {
                saves.push({ image: value, target });
              }}
            />,
          ),
        );
        window.mount(platform);
        await Promise.resolve();
        window.tick();
        const native = platform.getWindows()[0];
        assert.ok(native);
        const pointer = (type: "down" | "up", x: number, y: number) =>
          native.injectPointer({ type, x, y, button: "left", timeMs: 1 });
        const layout = screenshotLayout(size, scale);
        pointer("down", layout.footer.x + 10, layout.footer.y + layout.row / 2);
        pointer("up", layout.footer.x + 10, layout.footer.y + layout.row / 2);
        for (const text of INPUT_FIXTURE_VALUE)
          for (const type of ["down", "up"] as const)
            native.injectKey({
              type,
              code: 30,
              key: text,
              text,
              timeMs: 1,
              modifiers: { ctrl: false, shift: false, alt: false, meta: false },
            });
        for (const type of ["down", "up"] as const)
          native.injectKey({
            type,
            code: 28,
            key: "Enter",
            timeMs: 1,
            modifiers: { ctrl: false, shift: false, alt: false, meta: false },
          });
        for (let i = 0; i < 15; i++) await Promise.resolve();
        window.tick();
        assert.equal(saves.length, 1);
        assert.equal(saves[0]?.target, INPUT_FIXTURE_VALUE);
        assert.equal(sha(saves[0]!.image.rgba), sha(image.rgba));
        // Independently rendered production scene supplies hit coordinates, never handler calls.
        renderShell(scene, wrap(<ScreenshotApp {...size} initialImage={image} />));
        const canvas = collectHits(scene.container).find(
          (hit) => hit.focusId === "screenshot-canvas",
        );
        assert.ok(canvas);
        const x = canvas.x + canvas.width * 0.2,
          y = canvas.y + canvas.height * 0.2;
        pointer("down", x, y);
        pointer("up", canvas.x + canvas.width * 0.7, canvas.y + canvas.height * 0.7);
        window.tick();
        const cropped = documentImage(latest.current);
        assert.ok(cropped);
        assert.ok(
          cropped.width > 1 && cropped.width < image.width,
          JSON.stringify({
            policy,
            scale,
            retained,
            canvas,
            cropped: { width: cropped.width, height: cropped.height },
            records,
          }),
        );
        assert.ok(cropped.height > 1 && cropped.height < image.height);
        const before = latest.current.revision;
        // Same coordinate stationary drag is rejected regardless of observer state.
        pointer("down", size.width / 2, layout.preview.y + layout.preview.height / 2);
        pointer("up", size.width / 2, layout.preview.y + layout.preview.height / 2);
        window.tick();
        assert.equal(latest.current.revision, before);
        if (policy === "record") {
          assert.ok(
            records.some(
              (record) => record.stage === "value" && record.action === "submit" && record.expected,
            ),
          );
          const phases = records.flatMap((record) =>
            record.stage === "event" && record.event.layer === "app-gesture"
              ? [record.event.phase]
              : [],
          );
          assert.deepEqual(phases, ["down", "up", "commit", "down", "up", "reject"]);
          assert.ok(
            records.some(
              (record) =>
                record.stage === "event" &&
                record.event.layer === "app-focus" &&
                record.event.control === "save-path",
            ),
          );
          assert.ok(
            !JSON.stringify(records).includes(INPUT_FIXTURE_VALUE),
            "values are hashed, never included in trace",
          );
        } else
          assert.equal(
            records.filter((record) => record.stage === "event" || record.stage === "value").length,
            0,
          );
        if (policy === "record") {
          pointer("down", layout.footer.x + 10, layout.footer.y + layout.row / 2);
          pointer("up", layout.footer.x + 10, layout.footer.y + layout.row / 2);
          for (const type of ["down", "up"] as const)
            native.injectKey({
              type,
              code: 30,
              key: "a",
              timeMs: 2,
              modifiers: { ctrl: true, shift: false, alt: false, meta: false },
            });
          for (const type of ["down", "up"] as const)
            native.injectKey({
              type,
              code: 53,
              key: "?",
              text: "?",
              timeMs: 2,
              modifiers: { ctrl: false, shift: false, alt: false, meta: false },
            });
          assert.ok(
            records.some(
              (record) => record.stage === "end" && record.reason === "unexpected-value",
            ),
          );
          assert.ok(
            !records.some(
              (record) => record.stage === "value" && record.sha256 === sha(Buffer.from("?")),
            ),
            "unrelated value must not reach even the hashing sink",
          );
          for (const type of ["down", "up"] as const)
            native.injectKey({
              type,
              code: 28,
              key: "Enter",
              timeMs: 2,
              modifiers: { ctrl: false, shift: false, alt: false, meta: false },
            });
          for (let i = 0; i < 15; i++) await Promise.resolve();
          window.tick();
          assert.equal(
            saves.at(-1)?.target,
            "?",
            "diagnostic denial never blocks the real submit callback",
          );
          assert.equal(saves.length, 2);
        }
        cases++;
      } finally {
        window.destroy();
        renderShell(scene, null);
        await platform.disconnect();
      }
    }
  }
console.log(
  `input-trace: ${cases} public Window direct/retained/scale fixtures; actual path burst/submit/save pixels, missing-move crop + stationary rejection, recording/denied/throwing diagnostic observer preserved`,
);
