import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { FileActivation } from "@moire/app-discovery";

type FileLaunchTarget = { filePath: string; applicationName: string };
export type FileLaunchFailure = FileLaunchTarget &
  (
    | { kind: "spawn"; error: Error }
    | { kind: "exit"; code: number }
    | { kind: "signal"; signal: NodeJS.Signals }
  );

export function launchFailureNotice(failure: FileLaunchFailure): string {
  const fileName = path.basename(failure.filePath);
  switch (failure.kind) {
    case "spawn":
      return `Could not start ${failure.applicationName} for ${fileName}. Try Open With.`;
    case "exit":
      return `${failure.applicationName} exited with an error while handling ${fileName}. Try Open With.`;
    case "signal":
      return `${failure.applicationName} was terminated while handling ${fileName}. Try Open With.`;
  }
}

/** Observe failures without treating process creation as application readiness. */
export class FileLauncher {
  private onFailure: ((failure: FileLaunchFailure) => void) | null = null;

  observeFailures(handler: (failure: FileLaunchFailure) => void): () => void {
    this.onFailure = handler;
    return () => {
      if (this.onFailure === handler) this.onFailure = null;
    };
  }

  launchDesktop(activation: FileActivation): ChildProcess | null {
    return this.launch(
      { filePath: activation.filePath, applicationName: activation.application.name },
      "/bin/sh",
      ["-c", activation.command],
    );
  }

  launchFallback(filePath: string): ChildProcess | null {
    return this.launch({ filePath, applicationName: "the default application" }, "xdg-open", [
      filePath,
    ]);
  }

  private launch(
    target: FileLaunchTarget,
    executable: string,
    args: string[],
  ): ChildProcess | null {
    let reported = false;
    const report = (failure: FileLaunchFailure) => {
      if (reported) return;
      reported = true;
      this.onFailure?.(failure);
    };
    let child: ChildProcess;
    try {
      // Inherit the established session environment; a login shell can replace its PATH.
      // Preserve command quoting, detachment, I/O and application-owned lifetime.
      child = spawn(executable, args, { detached: true, stdio: "ignore" });
    } catch (error) {
      report({
        ...target,
        kind: "spawn",
        error: error instanceof Error ? error : new Error(String(error)),
      });
      return null;
    }
    child.once("error", (error) => report({ ...target, kind: "spawn", error }));
    child.once("close", (code, signal) => {
      if (signal !== null) report({ ...target, kind: "signal", signal });
      else if (code !== null && code !== 0) report({ ...target, kind: "exit", code });
    });
    // Unsubscribing suppresses UI feedback only. The application owns its lifetime.
    child.unref();
    return child;
  }
}
