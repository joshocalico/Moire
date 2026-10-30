/** Context menus as native popup surfaces, above every window, when the platform has them. */
import React from "react";
import { ContextMenu, contextMenuSurfaceSize, type PopupHandle, type Window } from "@moire/ui";
import type { ContextMenuRequest } from "./workspace";

const MENU_WIDTH = 244;
const MENU_MAX_HEIGHT = 480;

export function popupMenus(win: Window) {
  let activePopup: PopupHandle | null = null;
  const retire = () => {
    activePopup?.destroy();
    activePopup = null;
  };
  /** False when the platform has no popups; the caller then draws the menu in the window. */
  const show = (request: ContextMenuRequest): boolean => {
    retire();
    const popupSize = contextMenuSurfaceSize(
      request.actions,
      request.title,
      MENU_WIDTH,
      Math.min(MENU_MAX_HEIGHT, win.getHeight()),
    );
    let next: PopupHandle | null = null;
    next = win.showPopup({
      x: request.x,
      y: request.y,
      width: popupSize.width,
      height: popupSize.height,
      content: (surface) => (
        <ContextMenu
          viewportWidth={surface.width}
          viewportHeight={surface.height}
          x={0}
          y={0}
          title={request.title}
          actions={request.actions}
          surface
          onDismiss={() => {
            next?.destroy();
            if (activePopup === next) activePopup = null;
          }}
        />
      ),
      onClose: () => {
        if (activePopup === next) activePopup = null;
      },
    });
    if (!next) return false;
    activePopup = next;
    return true;
  };
  return { show, retire };
}
