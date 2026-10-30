/** A ContextMenu dropped from a trigger, for overflow ("More", ⋯) controls. */
import React, { type ReactNode } from "react";
import { Group, type SceneNode } from "@moire/react-host";
import { ContextMenu, contextMenuSurfaceSize, type ContextMenuAction } from "./context-menu";
import { OverlayPortal, useOverlayHost } from "./overlay";

export type AnchoredMenuProps = {
  open: boolean;
  /** The trigger's scene node, to place the menu against. */
  anchor: SceneNode | null;
  anchorWidth: number;
  anchorHeight: number;
  actions: ContextMenuAction[];
  align?: "start" | "end";
  /** "above" suits triggers near the bottom edge, such as a floating bar. */
  side?: "below" | "above";
  width?: number;
  onDismiss: () => void;
};

const GAP = 4;

/**
 * Inside an OverlayHost the menu paints in its top layer, placed against the host's bounds, and a
 * press anywhere outside dismisses it. Without a host (a bare smoke or preview) it paints inline
 * below the trigger.
 */
export function AnchoredMenu(props: AnchoredMenuProps): ReactNode {
  const host = useOverlayHost();
  if (!props.open) return null;
  const width = props.width ?? 220;
  const located = host && props.anchor ? host.locate(props.anchor) : null;
  const x = located ? located.x : 0;
  const y = located ? located.y : 0;
  const menuX = props.align === "end" ? x + props.anchorWidth - width : x;
  const menuY = y + props.anchorHeight + GAP;
  const size = contextMenuSurfaceSize(props.actions, undefined, width);
  if (located) {
    // The surface size includes a 13px allowance for shadow and entrance motion.
    const aboveY = y - GAP - (size.height - 13);
    return (
      <OverlayPortal>
        <ContextMenu
          viewportWidth={located.width}
          viewportHeight={located.height}
          x={menuX}
          y={props.side === "above" ? aboveY : menuY}
          width={width}
          actions={props.actions}
          onDismiss={props.onDismiss}
        />
      </OverlayPortal>
    );
  }
  const left = Math.min(0, menuX);
  return (
    <Group
      x={left}
      width={size.width + Math.max(props.anchorWidth, width)}
      height={menuY + size.height}
    >
      <ContextMenu
        viewportWidth={size.width + Math.max(props.anchorWidth, width)}
        viewportHeight={menuY + size.height}
        x={menuX - left}
        y={menuY}
        width={width}
        actions={props.actions}
        onDismiss={props.onDismiss}
      />
    </Group>
  );
}
