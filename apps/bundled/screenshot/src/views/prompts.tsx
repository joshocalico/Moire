/** Whatever Screenshot is asking right now: a file chooser or one of its dialogs. */
import path from "node:path";
import React, { type ReactNode } from "react";
import type { WindowSize } from "@moire/ui";
import { FileChooser } from "@moire/app-tools";
import { SCREENSHOT_APP_ID } from "#screenshot/model";
import type { ScreenshotSession } from "#screenshot/session";
import { PromptDialog } from "./dialogs";

export function ScreenshotPrompts(props: WindowSize & { session: ScreenshotSession }): ReactNode {
  const { session, width, height } = props;
  const { prompt } = session;
  const size = { width, height };
  if (!prompt) return null;
  if (prompt.kind === "choose-open")
    return (
      <FileChooser
        {...size}
        mode="open"
        appId={SCREENSHOT_APP_ID}
        title="Open image"
        accept={["png"]}
        onChoose={(file) => {
          session.setPrompt(null);
          session.request({ kind: "open", file });
        }}
        onCancel={() => session.setPrompt(null)}
      />
    );
  if (prompt.kind === "choose-save")
    return (
      <FileChooser
        {...size}
        mode="save"
        appId={SCREENSHOT_APP_ID}
        title="Save screenshot as"
        accept={["png"]}
        directory={path.dirname(session.target)}
        name={path.basename(session.target)}
        onChoose={(file) => session.saveAs(file, prompt.after)}
        onCancel={() => session.setPrompt(null)}
      />
    );
  return (
    <PromptDialog
      {...size}
      prompt={prompt}
      status={session.status}
      busy={session.busy}
      saving={session.operation?.kind === "save"}
      hasImage={!!session.image}
      captureOptions={session.captureOptions}
      crop={session.crop}
      onCaptureOptions={session.setCaptureOptions}
      onCrop={session.setCrop}
      onSave={() => prompt.kind === "unsaved" && session.saveCurrent(prompt.intent)}
      onDiscard={() => {
        if (prompt.kind !== "unsaved") return;
        session.cancelOperation();
        session.perform(prompt.intent);
      }}
      onReplace={() => prompt.kind === "overwrite" && void session.save(prompt.save, true)}
      onApplyCrop={session.applyCrop}
      onTake={() => {
        session.setPrompt(null);
        session.request({ kind: "capture", options: session.captureOptions });
      }}
      onDismiss={session.dismiss}
    />
  );
}
