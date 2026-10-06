import React from "react";
import {
  Group,
  createShellRoot,
  renderShell,
  SoftwareRenderer,
  RetainedSceneRenderer,
} from "@moire/react-host";
import { Backdrop, BrandMark, getMotionActivity, type SilkBackdropSource } from "@moire/ui";
import { boundedBootViewport } from "./assets";

export function BootView({
  width,
  height,
  source,
}: {
  width: number;
  height: number;
  source: SilkBackdropSource;
}) {
  boundedBootViewport(width, height);
  return (
    <Group width={width} height={height}>
      <Backdrop width={width} height={height} source={source} motion={{ kind: "static" }} />
      <BrandMark
        x={width * 0.12}
        y={height * 0.29}
        width={width * 0.203125}
        height={height * 0.1075}
        symbol={false}
        color={0xffffe5d3}
      />
    </Group>
  );
}

/** Own React root; no Application, Wayland window, D-Bus or shell is started. */
export function createBootRoot(width: number, height: number, source: SilkBackdropSource) {
  boundedBootViewport(width, height);
  const root = createShellRoot();
  const software = new SoftwareRenderer();
  const retained = new RetainedSceneRenderer();
  renderShell(root, <BootView width={width} height={height} source={source} />);
  let closed = false;
  return {
    root,
    source,
    softwareFrame() {
      if (closed) throw new Error("Boot React root is closed");
      return software.render(root.container, { width, height });
    },
    retainedFrame() {
      if (closed) throw new Error("Boot React root is closed");
      return retained.render(root.container, { width, height });
    },
    motionActivity: getMotionActivity,
    close() {
      if (closed) return;
      closed = true;
      renderShell(root, null);
    },
  };
}
