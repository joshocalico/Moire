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

  const argv = parseDesktopCommand(opts.exec);
  const [cmd, ...args] = argv;

  const child = spawn(cmd!, args, {
    env,
    cwd: opts.cwd,
    stdio: "ignore",
    detached: true,
  });
  // File activation and desktop launch callers may not subscribe to errors.
  // A missing command must never terminate the compositor.
  child.on("error", (error) => console.warn(`[spawn] ${cmd}: ${error.message}`));
  return child;
}

/** Decode quoted command arguments without executing a shell or expanding input. */
export function parseDesktopCommand(command: string): string[] {
  const arguments_: string[] = [];
  let argument = "";
  let started = false;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < command.length; index++) {
    const character = command[index]!;
    if (character === "\\" && quote !== "'") {
      const next = command[++index];
      if (next === undefined) throw new Error("Command ends with an escape");
      if (quote === '"' && !['"', "\\", "$", "`", "\n"].includes(next)) argument += "\\";
      if (next !== "\n") argument += next;
      started = true;
    } else if (quote) {
      if (character === quote) quote = null;
      else argument += character;
    } else if (character === "'" || character === '"') {
      quote = character;
      started = true;
    } else if (/\s/.test(character)) {
      if (started) arguments_.push(argument);
      argument = "";
      started = false;
    } else {
      argument += character;
      started = true;
    }
  }
  if (quote) throw new Error("Command contains an unterminated quote");
  if (started) arguments_.push(argument);
  if (!arguments_[0]) throw new Error("Command has no executable");
  return arguments_;
}
