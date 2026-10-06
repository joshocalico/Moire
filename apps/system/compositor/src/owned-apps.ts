import { type ChildProcess } from "node:child_process";
import { spawnDesktopApp, type SpawnOptions } from "@moire/core";

/** Each app has a process group; the compositor's PAM/seat owner stays separate. */
export class OwnedDesktopApps {
  private readonly children = new Set<ChildProcess>();
  private closing?: Promise<void>;

  spawn(options: SpawnOptions): ChildProcess {
    if (this.closing) throw new Error("Desktop is logging out");
    const child = spawnDesktopApp(options);
    this.children.add(child);
    child.once("exit", () => this.children.delete(child));
    child.once("error", () => this.children.delete(child));
    return child;
  }

  stop(): Promise<void> {
    return (this.closing ??= Promise.all(
      [...this.children].map(
        (child) =>
          new Promise<void>((resolve, reject) => {
            if (!child.pid || child.exitCode !== null || child.signalCode !== null)
              return resolve();
            const timer = setTimeout(
              () => reject(new Error(`App ${child.pid} did not retire`)),
              5000,
            );
            child.once("exit", () => {
              clearTimeout(timer);
              resolve();
            });
            try {
              process.kill(-child.pid, "SIGTERM");
            } catch (error) {
              clearTimeout(timer);
              if ((error as NodeJS.ErrnoException).code === "ESRCH") resolve();
              else reject(error);
            }
          }),
      ),
    ).then(() => undefined));
  }
}
