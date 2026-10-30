import React from "react";
import {
  createShellRoot,
  renderShell,
  SoftwareRenderer,
  RetainedSceneRenderer,
  type RetainedSceneFrame,
} from "@moire/react-host";
import { getMotionActivity, type SilkBackdropSource } from "@moire/ui";
import { boundedBootViewport } from "./assets";
import type { BootScene } from "./scene";
import { foldScene } from "./scene-fold";

export type BootRootOptions = {
  scene?: BootScene;
  /** Scene time in seconds (defaults to a frozen clock). */
  time?: () => number;
  gpu?: boolean;
};

/** Own React root; no Application, Wayland window, D-Bus or shell is started. */
export function createBootRoot(
  width: number,
  height: number,
  source: SilkBackdropSource | null,
  options: BootRootOptions = {},
) {
  boundedBootViewport(width, height);
  const root = createShellRoot();
  const software = new SoftwareRenderer();
  const retained = new RetainedSceneRenderer();
  const time = options.time ?? (() => 0);
  const gpu = options.gpu ?? false;
  let scene = options.scene ?? foldScene;
  let reconciled = false;
  const mount = () => {
    const View = scene.View;
    renderShell(
      root,
      <View width={width} height={height} time={time} gpu={gpu} artwork={source} />,
    );
    reconciled = true;
  };
  mount();
  let closed = false;
  const live = () => {
    if (closed) throw new Error("Boot React root is closed");
  };
  return {
    root,
    source,
    get scene(): BootScene {
      return scene;
    },
    /** Swap the mounted scene in place (hot reload); the clock keeps running. */
    setScene(next: BootScene) {
      live();
      scene = next;
      mount();
    },
    softwareFrame() {
      live();
      return software.render(root.container, { width, height });
    },
    /** Full layer graph after a React commit, otherwise a cheap live-number refresh. */
    retainedFrame(): RetainedSceneFrame {
      live();
      const viewport = { width, height };
      if (reconciled) {
        reconciled = false;
        return retained.render(root.container, viewport);
      }
      return (
        retained.renderPresentation(root.container, viewport) ??
        retained.render(root.container, viewport)
      );
    },
    motionActivity: getMotionActivity,
    close() {
      if (closed) return;
      closed = true;
      renderShell(root, null);
    },
  };
}

export type BootRoot = ReturnType<typeof createBootRoot>;
