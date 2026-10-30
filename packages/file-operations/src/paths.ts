import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

export async function pathExists(file: string): Promise<boolean> {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export class DestinationExistsError extends Error {
  override name = "DestinationExistsError";
  constructor(readonly destination: string) {
    super(
      `“${path.basename(destination)}” already exists. Rename the item or choose another folder.`,
    );
  }
}

export async function requireAbsent(file: string): Promise<void> {
  if (await pathExists(file)) throw new DestinationExistsError(file);
}

/**
 * Rename without ever replacing an existing destination. A preflight check
 * alone races with other writers, and plain rename(2) replaces files.
 */
export async function moveWithoutReplacing(source: string, destination: string): Promise<void> {
  await requireAbsent(destination);
  if (process.platform === "linux") {
    // GNU coreutils supplies an atomic no-replace rename (renameat2 RENAME_NOREPLACE).
    try {
      await promisify(execFile)("mv", [
        "--no-copy",
        "--update=none-fail",
        "--no-target-directory",
        "--",
        source,
        destination,
      ]);
    } catch (error) {
      const stderr = String((error as { stderr?: string }).stderr ?? "");
      if (/cross-device|different file ?system|EXDEV/i.test(stderr)) {
        throw Object.assign(new Error(`Could not move “${path.basename(source)}” across drives.`), {
          code: "EXDEV",
        });
      }
      throw new Error(
        `Could not move “${path.basename(source)}”. ${(stderr || "The destination changed or is on another filesystem. Refresh and try again.").trim()}`,
      );
    }
    return;
  }
  // Hard links publish files without replacing a concurrent destination.
  const stat = await fs.lstat(source);
  if (!stat.isDirectory()) {
    await fs.link(source, destination);
    await fs.unlink(source);
  } else await fs.rename(source, destination);
}

/** Reject names the filesystem cannot hold or that would escape the folder. */
export function validateName(name: string): string {
  const value = name.trim();
  if (!value || value === "." || value === ".." || value.includes("/") || value.includes("\0"))
    throw new Error("Enter a name without slashes.");
  return value;
}

/** Turn filesystem failures into sentences a person can act on. */
export function operationError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === "EACCES" || code === "EPERM")
    return "Permission denied. Choose a folder you can write to.";
  if (code === "ENOENT") return "The file or folder no longer exists. Refresh and try again.";
  if (code === "ENOSPC") return "There is not enough space to finish this operation.";
  if (code === "ENOTEMPTY") return "The folder is not empty.";
  if (code === "EXDEV") return "Moving between drives is not supported yet. Copy the item instead.";
  return error instanceof Error ? error.message : String(error);
}
