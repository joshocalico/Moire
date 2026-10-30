/**
 * Where apps put and find the person's files: free names for new outputs, a home folder for an
 * app's saves, Files for showing a result, and the Trash for removing one recoverably.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

/**
 * A path in `directory` that does not exist yet: `stem + extension`, else "stem 2", "stem 3"…
 * Callers still create the output exclusively; this only picks a name nobody is using.
 */
export function freePath(directory: string, stem: string, extension = ""): string {
  for (let n = 1; ; n++) {
    const candidate = path.join(directory, `${stem}${n === 1 ? "" : ` ${n}`}${extension}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
}

/** A folder in the person's home ("Music/Recordings"), created if it is missing. */
export function homeFolder(relative: string): string {
  const folder = path.join(os.homedir(), relative);
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

/** How long the opener may keep running before it counts as having handed the folder over. */
const HANDOFF_MS = 5000;

/**
 * Show a folder, or the folder holding a file, in Files: the desktop opener on its file:// URL,
 * as the shell's own "Show in Files" does (Files handles inode/directory). Resolves once handed
 * over; rejects with a message to show when nothing could open it.
 */
export function showInFiles(target: string, options: { command?: string } = {}): Promise<void> {
  const command = options.command ?? "xdg-open";
  let folder = target;
  try {
    if (!fs.statSync(target).isDirectory()) folder = path.dirname(target);
  } catch {
    return Promise.reject(new Error("That item no longer exists."));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(command, [pathToFileURL(folder).href], { detached: true, stdio: "ignore" });
    const handedOver = setTimeout(() => {
      child.unref();
      resolve();
    }, HANDOFF_MS);
    handedOver.unref?.();
    child.once("error", (error) => {
      clearTimeout(handedOver);
      reject(
        "code" in error && error.code === "ENOENT"
          ? new Error(`${command} is unavailable, so the folder can't be shown.`)
          : error,
      );
    });
    child.once("exit", (code) => {
      clearTimeout(handedOver);
      if (code === 0) resolve();
      else reject(new Error("No app is set up to show folders."));
    });
  });
}

/**
 * Move a file or folder to the person's Trash (the freedesktop.org layout Files uses), so it can
 * be restored. Only items on the same filesystem as the Trash can be moved.
 */
export async function moveToTrash(target: string): Promise<void> {
  const data = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  const trash = path.join(data, "Trash");
  await fsp.mkdir(path.join(trash, "files"), { recursive: true, mode: 0o700 });
  await fsp.mkdir(path.join(trash, "info"), { recursive: true, mode: 0o700 });
  const extension = path.extname(target);
  const stem = path.basename(target, extension);
  // The .trashinfo file is created exclusively first: it reserves the name in the Trash.
  let name = "";
  let info = "";
  for (let n = 1; ; n++) {
    name = `${stem}${n === 1 ? "" : ` ${n}`}${extension}`;
    info = path.join(trash, "info", `${name}.trashinfo`);
    if (fs.existsSync(path.join(trash, "files", name))) continue;
    try {
      await fsp.writeFile(
        info,
        `[Trash Info]\nPath=${encodeURIComponent(path.resolve(target)).replaceAll("%2F", "/")}\nDeletionDate=${new Date().toISOString().slice(0, 19)}\n`,
        { flag: "wx", mode: 0o600 },
      );
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    }
  }
  try {
    await fsp.rename(target, path.join(trash, "files", name));
  } catch (error) {
    await fsp.rm(info, { force: true });
    if (error instanceof Error && "code" in error && error.code === "EXDEV")
      throw new Error("This item is on another drive and can't be moved to the Trash.");
    throw error;
  }
}
