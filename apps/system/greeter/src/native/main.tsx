/** Trusted entry callers supply the already configured stock greetd transport. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import React, { useLayoutEffect, type ReactNode } from "react";
import {
  Application,
  Window,
  discoverPersonalization,
  type PersonalizationOverrides,
  type WindowSize,
} from "@moire/ui";
import type {
  NativeGreetdClient,
  // oxlint-disable-next-line import/no-relative-parent-imports -- Native adapter is source-only until its package is wired.
} from "../../../display-manager/src/native-greetd-client";
import { createNativeGreeterController } from "./controller";
import type { NativeGreeterController, NativeGreeterOutcome } from "./types";
import { NativeGreeterView } from "./view";
import { nativeGreeterPersonalization } from "./silk";
import type { LocalUserProvider } from "./local-users";

export type RunNativeGreeterOptions = Readonly<{
  client: NativeGreetdClient;
  platform?: "wayland" | "headless";
  width?: number;
  height?: number;
  colorScheme?: "dark" | "light";
  uiScale?: number;
  sessionLabel?: string;
  reducedMotion?: boolean;
  now?: Date;
  /** Staged account-picker entry. Production activation requires its metadata service. */
  users?: LocalUserProvider;
  /**
   * "compositor": the compositor draws the backdrop scene beneath a transparent greeter
   * window (see ./scene). Otherwise the greeter paints its own static backdrop.
   */
  backdrop?: "compositor" | "own";
  /** Called after the actual public Window is mounted. It grants no session authority. */
  onMounted?: (window: Window, controller: NativeGreeterController) => void;
}>;
export type NativeGreeterRunResult = Readonly<{
  exitCode: 0 | 1;
  outcome: NativeGreeterOutcome;
  presentation: "closed";
  transport: "closed";
  authority: "frontend-only";
}>;
function bounded(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < min || value > max)
    throw new Error("Invalid greeter presentation size.");
  return value;
}
function Presentation(
  props: WindowSize & {
    window: Window;
    controller: NativeGreeterController;
    options: RunNativeGreeterOptions;
    reducedMotion: boolean;
    onReducedMotionChange: (value: boolean) => void;
  },
): ReactNode {
  useLayoutEffect(() => {
    props.options.onMounted?.(props.window, props.controller);
  }, []);
  return (
    <NativeGreeterView
      width={props.width}
      height={props.height}
      state={props.controller.snapshot()}
      actions={props.controller}
      sessionLabel={props.options.sessionLabel}
      now={props.options.now}
      admission={props.window.getRetainedMotionAdmission()}
      reducedMotion={props.reducedMotion}
      onReducedMotionChange={props.onReducedMotionChange}
      users={props.options.users}
      compositorBackdrop={props.options.backdrop === "compositor"}
    />
  );
}

export async function runNativeGreeter(
  options: RunNativeGreeterOptions,
): Promise<NativeGreeterRunResult> {
  let app: Application | undefined;
  let window: Window | undefined;
  let controller: NativeGreeterController | undefined;
  let unsubscribe = () => {};
  let shuttingDown = false;
  let cleanup: Promise<void> | undefined;
  const dismiss = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    // Unmount private input drafts before disposing the local transport.
    window?.destroy();
    app?.quit();
    cleanup = controller?.dispose();
  };
  try {
    const width = bounded(options.width, 1280, 320, 8192);
    const height = bounded(options.height, 800, 320, 8192);
    const fontScale = bounded(options.uiScale, 1, 0.75, 2);
    let reducedMotion =
      options.reducedMotion ??
      discoverPersonalization("linux", { source: "application" }).reducedMotion;
    const personalization: PersonalizationOverrides = nativeGreeterPersonalization({
      colorScheme: options.colorScheme,
      fontScale,
    });
    if (
      options.sessionLabel !== undefined &&
      (options.sessionLabel.length > 160 ||
        Array.from(options.sessionLabel).some(
          (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
        ))
    )
      throw new Error("Invalid greeter presentation label.");
    const createdApp = new Application({
      platform: options.platform ?? "wayland",
      personalization: {
        ...personalization,
        reducedMotion,
      },
    });
    app = createdApp;
    const createdWindow = new Window({
      title: "Sign in to Moire",
      appId: "org.moire.NativeGreeter",
      width,
      height,
      fullscreen: true,
      decorated: false,
      resizable: true,
      retainedMotionPolicy: "bounded-wave",
    });
    window = createdWindow;
    const createdController = createNativeGreeterController({ client: options.client });
    controller = createdController;
    unsubscribe = createdController.subscribe(() => {
      const state = createdController.snapshot();
      if (state.kind === "launch-committed" || state.kind === "unavailable") dismiss();
      else if (!shuttingDown) createdWindow.requestRedraw();
    });
    createdWindow.onClose(dismiss);
    createdWindow.setContent((size) => (
      <Presentation
        {...size}
        window={createdWindow}
        controller={createdController}
        options={options}
        reducedMotion={reducedMotion}
        onReducedMotionChange={(value) => {
          if (shuttingDown) return;
          reducedMotion = value;
          // Application overrides only. Never discover or persist a user's settings pre-auth.
          createdApp.setPersonalization({ ...personalization, reducedMotion });
          createdWindow.requestRedraw();
        }}
      />
    ));
    createdApp.addWindow(createdWindow);
    const finished = createdController.finished.then((outcome) => {
      dismiss();
      return outcome;
    });
    await createdApp.run();
    dismiss();
    const outcome = await finished;
    await cleanup;
    return {
      exitCode: outcome.kind === "launch-committed" ? 0 : 1,
      outcome,
      presentation: "closed",
      transport: "closed",
      authority: "frontend-only",
    };
  } finally {
    unsubscribe();
    try {
      dismiss();
      await cleanup;
    } finally {
      try {
        options.client.close();
      } catch {
        /* Transport teardown cannot disclose broker error text. */
      }
    }
  }
}

// This source entry cannot construct or override launch commands from CLI arguments or environment.
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  console.error("Native greeter requires an explicitly configured trusted entry client.");
  process.exitCode = 1;
}
