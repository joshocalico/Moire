import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ENVIRONMENT = ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME"] as const;

/**
 * Point HOME and the XDG folders at a scratch directory, so smokes never write the person's
 * screenshots folder or recent files. `restore` puts the environment back and removes it.
 */
export function scratchHome(): { home: string; restore: () => void } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "moire-screenshot-home-"));
  const previous = ENVIRONMENT.map((name) => [name, process.env[name]] as const);
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = path.join(home, ".config");
  process.env.XDG_DATA_HOME = path.join(home, ".local", "share");
  process.env.XDG_STATE_HOME = path.join(home, ".local", "state");
  return {
    home,
    restore: () => {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      fs.rmSync(home, { recursive: true, force: true });
    },
  };
}
