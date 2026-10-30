/**
 * Facts about this computer for Overview and About: its name, the system and Moire build, the
 * hardware, the person using it, and how full Home is. Read from `/etc`, `/proc`, `/nix` and
 * Node's `os`; anything unreadable is left out rather than guessed.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type SystemInfo = {
  hostname: string;
  /** "NixOS 25.05 (Warbler)", or the platform when there is no os-release. */
  system: string;
  /** "NixOS 25.05", for the one-line summary. */
  systemShort: string;
  /** The Moire build this session runs, when the image says. */
  build: string | null;
  /** The NixOS system generation booted, e.g. 42. */
  generation: number | null;
  kernel: string;
  memoryBytes: number;
  processor: string | null;
  cores: number;
  user: { login: string; name: string; administrator: boolean; picture: string | null };
};

export type DiskSpace = { totalBytes: number; freeBytes: number };

/** `KEY=value` lines, quotes removed. */
export function parseOsRelease(text: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    fields[match[1]!] = match[2]!.replace(/^(["'])(.*)\1$/, "$2");
  }
  return fields;
}

/** The person's full name from their passwd entry's comment field, else the login. */
export function passwdName(passwd: string, login: string): string {
  for (const line of passwd.split("\n")) {
    const fields = line.split(":");
    if (fields[0] !== login) continue;
    const gecos = (fields[4] ?? "").split(",")[0]!.trim();
    return gecos || login;
  }
  return login;
}

/** Members of `wheel`, `sudo` or `admin` can administer the computer. */
export function isAdministrator(group: string, login: string): boolean {
  return group.split("\n").some((line) => {
    const [name, , , members = ""] = line.split(":");
    return (
      (name === "wheel" || name === "sudo" || name === "admin") &&
      members.split(",").includes(login)
    );
  });
}

/** `system-42-link` → 42. */
export function generationFromLink(link: string): number | null {
  const match = /system-(\d+)-link$/.exec(link);
  return match ? Number(match[1]) : null;
}

function read(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function processorName(): string | null {
  const model = os.cpus()[0]?.model?.trim();
  return model && model !== "unknown" ? model.replace(/\s+/g, " ") : null;
}

export function readSystemInfo(env: NodeJS.ProcessEnv = process.env): SystemInfo {
  const release = parseOsRelease(read("/etc/os-release") ?? "");
  const login = os.userInfo().username;
  const name = passwdName(read("/etc/passwd") ?? "", login);
  let generation: number | null = null;
  try {
    generation = generationFromLink(fs.readlinkSync("/nix/var/nix/profiles/system"));
  } catch {
    // Not NixOS, or the profile isn't readable.
  }
  const picture = path.join("/var/lib/AccountsService/icons", login);
  const platform = `${os.type()} ${os.release()}`;
  return {
    hostname: os.hostname(),
    system: release.PRETTY_NAME || platform,
    systemShort:
      [release.NAME, release.VERSION_ID].filter(Boolean).join(" ") ||
      release.PRETTY_NAME ||
      platform,
    build: env.MOIRE_BUILD?.trim() || null,
    generation,
    kernel: os.release(),
    memoryBytes: os.totalmem(),
    processor: processorName(),
    cores: os.cpus().length,
    user: {
      login,
      name,
      administrator: isAdministrator(read("/etc/group") ?? "", login),
      picture: fs.existsSync(picture) ? picture : null,
    },
  };
}

export async function readDiskSpace(directory: string): Promise<DiskSpace | null> {
  try {
    const stats = await fs.promises.statfs(directory);
    return { totalBytes: stats.blocks * stats.bsize, freeBytes: stats.bavail * stats.bsize };
  } catch {
    return null;
  }
}

/** The facts as text, for "Copy system info". */
export function systemReport(info: SystemInfo, formatBytes: (bytes: number) => string): string {
  return [
    `Computer: ${info.hostname}`,
    `System: ${info.system}`,
    info.build ? `Moire: ${info.build}` : null,
    info.generation != null ? `Generation: ${info.generation}` : null,
    `Kernel: ${info.kernel}`,
    `Memory: ${formatBytes(info.memoryBytes)}`,
    info.processor ? `Processor: ${info.processor} × ${info.cores}` : null,
  ]
    .filter((line): line is string => line != null)
    .join("\n");
}
