/** What opens over the window: the palette file chooser and the confirmation dialogs. */
import React, { type ReactNode } from "react";
import { ConfirmationDialog } from "@moire/ui";
import { FileChooser } from "@moire/app-tools";
import { PALETTE_EXTENSIONS } from "#colors/backend";
import { APP_ID, type ColorsController } from "#colors/controller";

export function ColorsOverlays(props: {
  width: number;
  height: number;
  app: ColorsController;
}): ReactNode {
  const { app } = props;
  const overlay = app.editor.overlay.kind;
  const close = () => app.dispatch({ type: "overlay", overlay: { kind: "none" } });
  return (
    <>
      {overlay === "import" || overlay === "export" ? (
        <FileChooser
          width={props.width}
          height={props.height}
          mode={overlay === "import" ? "open" : "save"}
          title={
            overlay === "import" ? "Import a palette" : `Export ${app.palette?.name ?? "palette"}`
          }
          appId={APP_ID}
          accept={PALETTE_EXTENSIONS}
          name={overlay === "export" ? `${app.palette?.name ?? "Palette"}.gpl` : undefined}
          onChoose={(file) =>
            void (overlay === "import" ? app.importFile(file) : app.exportFile(file))
          }
          onCancel={close}
        />
      ) : null}
      <ConfirmationDialog
        open={overlay === "delete-palette"}
        viewportWidth={props.width}
        viewportHeight={props.height}
        title="Delete palette?"
        message={`Delete ${app.palette?.name ?? "this palette"} and all its saved colors?`}
        confirmLabel="Delete"
        danger
        onDismiss={close}
        onConfirm={app.deletePalette}
      />
      <ConfirmationDialog
        open={overlay === "reload"}
        viewportWidth={props.width}
        viewportHeight={props.height}
        title="Reload saved data?"
        message="Current input is kept. Review it before retrying the save."
        confirmLabel="Reload saved"
        cancelLabel="Keep draft"
        onDismiss={close}
        onConfirm={app.reload}
      />
      <ConfirmationDialog
        open={!!app.notice}
        viewportWidth={props.width}
        viewportHeight={props.height}
        title={app.notice?.title ?? "Saved data changed"}
        message={app.notice?.message ?? ""}
        confirmLabel={app.notice?.kind === "cleanup" ? "Retry" : "Reload saved"}
        cancelLabel={app.notice?.kind === "cleanup" ? "Close" : "Keep draft"}
        onDismiss={app.dismissNotice}
        onConfirm={() => (app.notice?.kind === "cleanup" ? app.retryCleanup() : app.reload())}
      />
    </>
  );
}
