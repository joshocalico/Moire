import fs from "node:fs/promises";
import path from "node:path";
import { operationError } from "./filesystem";

export type TransferItemMetadata =
  | {
      state: "available";
      name: string;
      kind: "file" | "folder" | "link" | "other";
      bytes?: number;
      modified: number;
    }
  | { state: "unavailable"; name: string; error: string };

/** A read-only observation. Publication still performs its own no-replace checks. */
export async function readTransferItemMetadata(file: string): Promise<TransferItemMetadata> {
  const name = path.basename(file);
  try {
    const stat = await fs.lstat(file);
    const kind = stat.isDirectory()
      ? "folder"
      : stat.isSymbolicLink()
        ? "link"
        : stat.isFile()
          ? "file"
          : "other";
    return {
      state: "available",
      name,
      kind,
      bytes: kind === "file" ? stat.size : undefined,
      modified: stat.mtimeMs,
    };
  } catch (error) {
    return { state: "unavailable", name, error: operationError(error) };
  }
}

export async function readTransferConflictMetadata(source: string, destination: string) {
  const [incoming, existing] = await Promise.all([
    readTransferItemMetadata(source),
    readTransferItemMetadata(destination),
  ]);
  return { incoming, existing };
}

export async function transferDestinationFolder(directory: string): Promise<string> {
  const resolved = await fs.realpath(directory);
  if (!(await fs.stat(resolved)).isDirectory())
    throw new Error("The transfer destination is no longer a folder.");
  return resolved;
}
