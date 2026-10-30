import React, { type ReactNode } from "react";
import { Button, getUiScaleFactor } from "@moire/ui";
import { ToolButton } from "@moire/app-tools";
import { newScreenshot, openImage } from "#screenshot/commands";
import type { ScreenshotSession } from "#screenshot/session";

const NEW_BUTTON = 150;

/**
 * Header bar actions: Open, and New Screenshot (Cancel while capturing) once there is an image.
 * Called as a function so the header bar receives the buttons themselves, which it measures.
 */
export function headerActions(
  session: ScreenshotSession,
  compact: boolean,
  row: number,
): ReactNode {
  const ui = getUiScaleFactor();
  const capture = session.capturing ? session.cancelOperation : () => newScreenshot(session);
  return (
    <>
      <ToolButton
        icon="folder"
        tooltip="Open image… (Ctrl+O)"
        focusId="screenshot-open"
        disabled={session.busy}
        onPress={() => openImage(session)}
      />
      {!session.image && !session.capturing ? null : compact ? (
        <ToolButton
          icon={session.capturing ? "close" : "screenshot"}
          tooltip={session.capturing ? "Cancel" : "New screenshot… (Ctrl+N)"}
          focusId="screenshot-capture"
          disabled={session.operation?.kind === "save"}
          onPress={capture}
        />
      ) : (
        <Button
          height={row}
          width={NEW_BUTTON * ui}
          label={session.capturing ? "Cancel" : "New Screenshot…"}
          focusId="screenshot-capture"
          disabled={session.operation?.kind === "save"}
          onPress={capture}
        />
      )}
    </>
  );
}
