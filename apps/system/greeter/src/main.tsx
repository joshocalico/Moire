/** Root's session runner owns what starts after this already authorized welcome. */
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { Application, Window } from "@moire/ui";
import { GreeterApp } from "./view";
export { GreeterApp, type GreeterAppProps } from "./view";

export type RunGreeterOptions = {
  /** The session owner can await its own real continuation work before dismissal. */
  onContinue: () => Promise<void>;
};
export async function runGreeter(options: RunGreeterOptions): Promise<boolean> {
  const app = new Application();
  const window = new Window({
    title: "Welcome to Moire",
    appId: "org.moire.Greeter",
    fullscreen: true,
    decorated: false,
    resizable: true,
  });
  let complete = false;
  let motionSaving = false;
  let motionStatus = "";
  window.onClose(() => {
    app.quit();
  });
  window.setContent((next) => (
    <GreeterApp
      {...next}
      username={os.userInfo().username}
      backdropAdmission={window.getRetainedMotionAdmission()}
      reducedMotion={app.getPersonalization()?.reducedMotion ?? true}
      reducedMotionBusy={motionSaving}
      reducedMotionStatus={motionStatus}
      onReducedMotionChange={(reducedMotion) => {
        if (motionSaving) return;
        motionSaving = true;
        motionStatus = "Saving motion preference…";
        window.requestRedraw();
        void app
          .setSessionReducedMotion(reducedMotion)
          .then(() => {
            motionStatus = "Motion preference saved for Moire apps.";
          })
          .catch((error: unknown) => {
            motionStatus = `Could not save motion preference: ${error instanceof Error ? error.message : String(error)}`;
          })
          .finally(() => {
            motionSaving = false;
            if (!window.isClosed()) window.requestRedraw();
          });
      }}
      onContinue={async () => {
        await options.onContinue();
        if (window.isClosed()) return;
        complete = true;
        window.destroy();
        app.quit();
      }}
    />
  ));
  app.addWindow(window);
  await app.run();
  return complete;
}
// The CLI's successful result tells its existing session parent to proceed.
// It performs no account lookup beyond the current uid and no authentication.
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  void runGreeter({ onContinue: async () => {} })
    .then((complete) => {
      if (!complete) process.exitCode = 1;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
