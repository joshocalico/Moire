import fs from "node:fs/promises";
import path from "node:path";
import { formatBytes } from "./format";
import { operationError, type Entry } from "./filesystem";

export type Inspection = {
  details: Array<[string, string]>;
  /** Actual single-item/current-folder timestamp, independent of locale display strings. */
  modifiedAt?: number;
  /** Actual earliest/latest timestamps for a selection, from the same lstat results. */
  modifiedRange?: readonly [number, number];
  text?: string;
  png?: string;
  error?: string;
};
/** Metadata and bounded previews come from the current files, not cached list rows. */
export async function inspectFiles(entries: readonly Entry[], cwd: string): Promise<Inspection> {
  const files = entries.length ? entries.map((entry) => entry.path) : [cwd];
  const stats = await Promise.all(
    files.map(async (file) => ({ file, stat: await fs.lstat(file) })),
  );
  const folders = stats.filter(({ stat }) => stat.isDirectory()).length;
  const bytes = stats.reduce((total, { stat }) => total + (stat.isFile() ? stat.size : 0), 0);
  const details: Array<[string, string]> = [
    [
      "Selection",
      `${stats.length} ${stats.length === 1 ? "item" : "items"} · ${folders} ${folders === 1 ? "folder" : "folders"}`,
    ],
    ["File bytes", bytes.toLocaleString()],
  ];
  const parents = [...new Set(files.map((file) => path.dirname(file)))];
  details.push([
    "Location",
    parents.length === 1 ? parents[0]! : `${parents.length} different folders`,
  ]);
  if (stats.length > 1) {
    const dates = stats.map(({ stat }) => stat.mtimeMs);
    const modifiedRange = [Math.min(...dates), Math.max(...dates)] as const;
    details.push([
      "Modified range",
      `${new Date(modifiedRange[0]).toLocaleString()} — ${new Date(modifiedRange[1]).toLocaleString()}`,
    ]);
    const modes = [...new Set(stats.map(({ stat }) => (stat.mode & 0o777).toString(8)))];
    details.push([
      "Permissions",
      modes.length === 1 ? modes[0]! : `${modes.length} different modes`,
    ]);
    details.push(["Items", files.map((file) => path.basename(file)).join(", ")]);
    return { details, modifiedRange };
  }
  const { file, stat } = stats[0]!;
  const modifiedAt = stat.mtimeMs;
  const mode = stat.mode & 0o777;
  const permissionText = [0o400, 0o200, 0o100, 0o40, 0o20, 0o10, 0o4, 0o2, 0o1]
    .map((bit, index) => (mode & bit ? "rwx"[index % 3] : "-"))
    .join("");
  details.push(
    ["Modified", stat.mtime.toLocaleString()],
    ["Accessed", stat.atime.toLocaleString()],
    ["Metadata changed", stat.ctime.toLocaleString()],
    ["Permissions", `${permissionText} (${mode.toString(8)})`],
    ["Owner / group", `${stat.uid} / ${stat.gid}`],
  );
  if (stat.birthtimeMs > 0)
    details.push([
      "Created",
      stat.birthtime.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
    ]);
  if (stat.isSymbolicLink()) details.push(["Link target", await fs.readlink(file)]);
  if (stat.isDirectory()) {
    const children = await fs.readdir(file, { withFileTypes: true });
    const folders = children.filter((entry) => entry.isDirectory()).length;
    details.push([
      "Contents",
      `${children.length} ${children.length === 1 ? "item" : "items"} · ${folders} ${folders === 1 ? "folder" : "folders"}`,
    ]);
    try {
      const volume = await fs.statfs(file);
      details.push(["Available bytes", formatBytes(volume.bavail * volume.bsize)]);
    } catch (error) {
      details.push(["Storage", operationError(error)]);
    }
    return { details, modifiedAt };
  }
  if (!stat.isFile()) return { details, modifiedAt };
  const handle = await fs.open(file, "r");
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const data = buffer.subarray(0, bytesRead);
    if (
      data.length >= 24 &&
      data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      details.unshift(["Dimensions", `${data.readUInt32BE(16)} × ${data.readUInt32BE(20)} pixels`]);
      return { details, modifiedAt, png: stat.size <= 8 * 1024 * 1024 ? file : undefined };
    }
    const textFile = /\.(txt|md|json|csv|log|nix|ts|tsx|js|css|html|xml|yaml|yml|sh)$/i.test(file);
    return {
      details,
      modifiedAt,
      text:
        textFile && !data.includes(0)
          ? `${data.toString("utf8").slice(0, 1800)}${stat.size > bytesRead ? "\n… Preview truncated" : ""}`
          : undefined,
    };
  } finally {
    await handle.close();
  }
}
