import { spawn, type ChildProcess } from "node:child_process";

export type SpawnOptions = {
  exec: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
};

/**
 * Spawn a desktop app with Wayland session env.
 * When Xwayland is up, keep DISPLAY so X11 clients (xeyes, …) work.
 */
export function spawnDesktopApp(opts: SpawnOptions): ChildProcess {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...opts.env,
    XDG_SESSION_TYPE: "wayland",
    XDG_CURRENT_DESKTOP: process.env.XDG_CURRENT_DESKTOP ?? "Moire",
  };

  // Prefer Wayland for toolkits that honor it; leave DISPLAY when Xwayland
  // exported it (MOIRE_XWAYLAND=1 or DISPLAY already set by the session).
  if (!env.MOIRE_XWAYLAND && !env.DISPLAY) {
    delete env.DISPLAY;
  }

  const parts = opts.exec.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [opts.exec];
  const argv = parts.map((p) => p.replace(/^"(.*)"$/, "$1"));
  const [cmd, ...args] = argv;

  return spawn(cmd!, args, {
    env,
    cwd: opts.cwd,
    stdio: "ignore",
    detached: true,
  });
}
