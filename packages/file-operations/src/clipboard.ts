/**
 * The session's file clipboard, shared by Files windows and the desktop so
 * Cut on one and Paste on the other behave as one clipboard. It lives in the
 * runtime directory: it belongs to this login session and nothing else.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type FileClipboardKind = "copy" | "cut";

export type FileClipboard = {
  readonly kind: FileClipboardKind;
  readonly paths: readonly string[];
  /** When it was written, so a reader can tell a newer clipboard from an older one. */
  readonly at: number;
};

export function fileClipboardPath(): string {
  const runtime =
    process.env.XDG_RUNTIME_DIR || process.env.XDG_CACHE_HOME || path.join(os.homedir(), ".cache");
  return path.join(runtime, "moire", "file-clipboard.json");
}

/** The current clipboard, or null when it is empty or unreadable. Small and synchronous by design. */
export function readFileClipboard(): FileClipboard | null {
  try {
    const value = JSON.parse(
      fs.readFileSync(fileClipboardPath(), "utf8"),
    ) as Partial<FileClipboard>;
    if (
      (value.kind !== "copy" && value.kind !== "cut") ||
      !Array.isArray(value.paths) ||
      !value.paths.every((item) => typeof item === "string" && path.isAbsolute(item)) ||
      value.paths.length === 0
    )
      return null;
    return {
      kind: value.kind,
      paths: value.paths,
      at: typeof value.at === "number" ? value.at : 0,
    };
  } catch {
    return null;
  }
}

/** Replace the clipboard; `null` clears it. Written atomically. */
export function writeFileClipboard(
  value: { kind: FileClipboardKind; paths: readonly string[] } | null,
): FileClipboard | null {
  const file = fileClipboardPath();
  if (!value || value.paths.length === 0) {
    fs.rmSync(file, { force: true });
    return null;
  }
  const stored: FileClipboard = {
    kind: value.kind,
    paths: value.paths.map((item) => path.resolve(item)),
    at: Date.now(),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(stored), { mode: 0o600 });
  fs.renameSync(temporary, file);
  return stored;
}
