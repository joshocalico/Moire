/** Shared Files formatting for metadata, collection cells and transfer progress. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)) - 1);
  return `${(bytes / 1024 ** (index + 1)).toFixed(index < 2 ? 1 : 2)} ${units[index]}`;
}
