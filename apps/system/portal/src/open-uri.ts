/**
 * Opening files and links for apps.
 *
 * xdg-desktop-portal implements the public OpenURI portal itself: it resolves the handler from
 * mimeapps.list (the file Moire's default-apps settings write), asks this backend's AppChooser
 * when there is a choice to make, and launches the result. There is no backend OpenURI interface.
 *
 * Moire's own apps use the same policy without the frontend through org.moire.FileActivation1:
 * OpenURI for `file:`, `http(s):` and other registered schemes, OpenFile and OpenDirectory for a
 * descriptor. Whatever arrives is only ever handed to an application as an argument. A program,
 * script, installer or .desktop launcher is never opened, because "opening" one means running it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FileActivationService } from "@moire/app-discovery";

/** Types whose handler would run the file: never opened. */
const EXECUTABLE_TYPES = new Set([
  "application/x-desktop",
  "application/x-executable",
  "application/x-pie-executable",
  "application/x-sharedlib",
  "application/x-elf",
  "application/x-msdownload",
  "application/x-ms-dos-executable",
  "application/x-msi",
  "application/x-ms-shortcut",
  "application/vnd.appimage",
  "application/x-iso9660-appimage",
  "application/vnd.flatpak.ref",
  "application/vnd.debian.binary-package",
  "application/x-rpm",
  "application/java-archive",
  "application/x-java-archive",
]);
const EXECUTABLE_EXTENSIONS = new Set([
  ".desktop",
  ".appimage",
  ".run",
  ".bin",
  ".exe",
  ".msi",
  ".com",
  ".scr",
  ".lnk",
  ".jar",
  ".deb",
  ".rpm",
  ".flatpakref",
]);
/**
 * Scripts are text a person may well want in an editor, but a default handler could be an
 * interpreter. They are opened only with an application the person picks in the chooser.
 */
const SCRIPT_TYPES = new Set([
  "application/x-shellscript",
  "application/x-csh",
  "application/x-perl",
  "application/x-python",
  "application/x-ruby",
  "text/x-shellscript",
  "text/x-python",
  "text/x-perl",
]);
const SCRIPT_EXTENSIONS = new Set([
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".csh",
  ".py",
  ".pl",
  ".rb",
  ".bat",
  ".cmd",
  ".ps1",
]);
/** Schemes that would run code or reach local files by another name. */
const REFUSED_SCHEMES = new Set(["javascript", "data", "vbscript", "blob", "about"]);
const MAX_URI_BYTES = 8192;

export type OpenTarget =
  | {
      kind: "file";
      path: string;
      mimeType: string;
      /** Never use the default handler. */ ask: boolean;
    }
  | { kind: "directory"; path: string }
  | { kind: "uri"; uri: string; mimeType: string }
  | { kind: "refused"; reason: string };

function fileTarget(activation: FileActivationService, filePath: string): OpenTarget {
  let stat: fs.Stats;
  let resolved: string;
  try {
    // Judge the file the link points at, not the name it hides behind.
    resolved = fs.realpathSync(filePath);
    stat = fs.statSync(resolved);
  } catch {
    return { kind: "refused", reason: "No such file" };
  }
  if (stat.isDirectory()) return { kind: "directory", path: resolved };
  if (!stat.isFile()) return { kind: "refused", reason: "Not a regular file" };
  const mimeType = activation.mimeDatabase.mimeTypeForPath(resolved);
  const extension = path.extname(resolved).toLowerCase();
  const executableBit = (stat.mode & 0o111) !== 0;
  const script = SCRIPT_TYPES.has(mimeType) || SCRIPT_EXTENSIONS.has(extension);
  if (
    EXECUTABLE_TYPES.has(mimeType) ||
    EXECUTABLE_EXTENSIONS.has(extension) ||
    // An unrecognised file marked executable is a program, whatever it is called.
    (!script && mimeType === "application/octet-stream" && executableBit)
  )
    return { kind: "refused", reason: "Programs are not opened" };
  return { kind: "file", path: resolved, mimeType, ask: script || executableBit };
}

/** Decide what a URI would open, without opening anything. */
export function openTargetForUri(activation: FileActivationService, uri: unknown): OpenTarget {
  if (typeof uri !== "string" || uri.length === 0 || Buffer.byteLength(uri) > MAX_URI_BYTES)
    return { kind: "refused", reason: "Invalid URI" };
  if (/[\0-\x1f\x7f\s]/.test(uri)) return { kind: "refused", reason: "Invalid URI" };
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return { kind: "refused", reason: "Invalid URI" };
  }
  const scheme = parsed.protocol.slice(0, -1).toLowerCase();
  if (scheme === "file") {
    if (parsed.host && parsed.host !== "localhost")
      return { kind: "refused", reason: "Remote file URIs are not opened" };
    try {
      return fileTarget(activation, fileURLToPath(parsed));
    } catch {
      return { kind: "refused", reason: "Invalid file URI" };
    }
  }
  if (REFUSED_SCHEMES.has(scheme)) return { kind: "refused", reason: "Unsupported URI scheme" };
  const mimeType = FileActivationService.schemeMimeType(uri);
  if (!mimeType) return { kind: "refused", reason: "Unsupported URI scheme" };
  // The normalised form, so what the handler receives is what was checked.
  return { kind: "uri", uri: parsed.href, mimeType };
}

/**
 * Decide what a descriptor would open. The path comes from the kernel's record of the open file
 * (not from the caller), and must still name that same file.
 */
export function openTargetForFd(activation: FileActivationService, fd: number): OpenTarget {
  let filePath: string;
  let held: fs.Stats;
  try {
    filePath = fs.readlinkSync(`/proc/self/fd/${fd}`);
    held = fs.fstatSync(fd);
  } catch {
    return { kind: "refused", reason: "Invalid file descriptor" };
  }
  if (!path.isAbsolute(filePath)) return { kind: "refused", reason: "Not a file on disk" };
  const target = fileTarget(activation, filePath);
  if (target.kind !== "file" && target.kind !== "directory") return target;
  try {
    const named = fs.statSync(target.path);
    if (named.dev !== held.dev || named.ino !== held.ino)
      return { kind: "refused", reason: "The file was moved or replaced" };
  } catch {
    return { kind: "refused", reason: "No such file" };
  }
  return target;
}
