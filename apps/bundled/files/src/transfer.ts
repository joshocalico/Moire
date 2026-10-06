import fs from "node:fs/promises";
import path from "node:path";

export type PlannedFile = {
  source: string;
  relative: string;
  kind: "directory" | "file" | "symlink";
  size: number;
  mode: number;
  modified: number;
  link?: string;
};
export class TransferCancelledError extends Error {
  override name = "TransferCancelledError";
}
export function checkCancelled(signal: AbortSignal): void {
  if (signal.aborted)
    throw new TransferCancelledError(
      "Transfer cancelled. Completed items are kept; the unfinished copy is removed. Unfinished source items are unchanged.",
    );
}
export async function planCopy(source: string, signal: AbortSignal): Promise<PlannedFile[]> {
  const files: PlannedFile[] = [];
  const visit = async (file: string, relative: string) => {
    checkCancelled(signal);
    const stat = await fs.lstat(file);
    const kind = stat.isDirectory()
      ? "directory"
      : stat.isSymbolicLink()
        ? "symlink"
        : stat.isFile()
          ? "file"
          : null;
    if (!kind) throw new Error(`“${path.basename(file)}” is a special file and cannot be copied.`);
    files.push({
      source: file,
      relative,
      kind,
      size: kind === "file" ? stat.size : 0,
      mode: stat.mode & 0o777,
      modified: stat.mtimeMs,
      link: kind === "symlink" ? await fs.readlink(file) : undefined,
    });
    if (kind === "directory")
      for (const name of await fs.readdir(file))
        await visit(path.join(file, name), path.join(relative, name));
  };
  await visit(source, "");
  return files;
}
/** Stage in a private destination directory; only complete copies are published. */
export async function copyPlanned(
  files: readonly PlannedFile[],
  destination: string,
  signal: AbortSignal,
  report: (bytes: number, files: number, current: string) => void,
): Promise<void> {
  let completed = 0,
    bytes = 0;
  const chunk = Buffer.alloc(512 * 1024);
  for (const file of files) {
    checkCancelled(signal);
    const target = path.join(destination, file.relative);
    if (file.kind === "directory") await fs.mkdir(target, { mode: file.mode | 0o700 });
    else if (file.kind === "symlink") await fs.symlink(file.link!, target);
    else {
      const source = await fs.open(file.source, "r");
      let output: fs.FileHandle | null = null;
      try {
        const stat = await source.stat();
        if (!stat.isFile() || stat.size !== file.size || stat.mtimeMs !== file.modified)
          throw new Error(
            `“${path.basename(file.source)}” changed during preparation. Refresh and try again.`,
          );
        output = await fs.open(target, "wx", file.mode);
        for (;;) {
          checkCancelled(signal);
          const { bytesRead } = await source.read(chunk, 0, chunk.length, null);
          if (!bytesRead) break;
          let written = 0;
          while (written < bytesRead) {
            checkCancelled(signal);
            written += (await output.write(chunk, written, bytesRead - written, null)).bytesWritten;
          }
          bytes += bytesRead;
          report(bytes, completed, file.source);
        }
        const after = await source.stat();
        if (after.size !== file.size || after.mtimeMs !== file.modified)
          throw new Error(
            `“${path.basename(file.source)}” changed while copying. The unfinished copy was removed.`,
          );
        await output.sync();
      } finally {
        await output?.close();
        await source.close();
      }
    }
    completed++;
    report(bytes, completed, file.source);
  }
  // Apply directory metadata after their children have been written.
  for (const file of [...files].reverse()) {
    if (file.kind === "symlink") continue;
    const target = path.join(destination, file.relative);
    await fs.chmod(target, file.mode);
    await fs.utimes(target, new Date(file.modified), new Date(file.modified));
  }
}
