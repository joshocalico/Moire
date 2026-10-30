/** Shared Files formatting for metadata, collection cells and transfer progress. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)) - 1);
  return `${(bytes / 1024 ** (index + 1)).toFixed(index < 2 ? 1 : 2)} ${units[index]}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Calendar days between two moments in local time (0 = same day). */
function daysBetween(then: number, now: number): number {
  const start = (time: number) => {
    const date = new Date(time);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  return Math.round((start(now) - start(then)) / DAY_MS);
}

const clock = (time: number) =>
  new Date(time).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** A row's date: "Today, 10:02", "Yesterday", "2 Oct", or "2 Oct 2024" in another year. */
export function formatDay(time: number, now = Date.now()): string {
  const days = daysBetween(time, now);
  if (days === 0) return `Today, ${clock(time)}`;
  if (days === 1) return "Yesterday";
  const date = new Date(time);
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: "numeric" }),
  });
}

/** A recent file's time: "just now", "10 min ago", "3 h ago", "Yesterday", "Mon", "2 Oct". */
export function formatRecent(time: number, now = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - time) / 60_000);
  const days = daysBetween(time, now);
  if (days === 0) {
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes} min ago`;
    return `${Math.floor(minutes / 60)} h ago`;
  }
  if (days === 1) return "Yesterday";
  if (days < 7) return new Date(time).toLocaleDateString(undefined, { weekday: "short" });
  return formatDay(time, now);
}

/** "1 item", "3 items". */
export const countLabel = (value: number, noun = "item") =>
  `${value.toLocaleString()} ${noun}${value === 1 ? "" : "s"}`;

/** A folder for people: inside Home it starts with "~" ("~/Pictures"). */
export function tidyPath(file: string, home: string): string {
  return file === home || file.startsWith(`${home}/`) ? `~${file.slice(home.length)}` : file;
}

/** A disk's size or free space, rounded as people say it: "160 GB", "3.6 TB". */
export function formatSpace(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** A folder's last change in its subtitle: "Modified today", "Modified yesterday", "Modified 2 Oct". */
export function formatModified(time: number, now = Date.now()): string {
  const days = daysBetween(time, now);
  if (days === 0) return "Modified today";
  if (days === 1) return "Modified yesterday";
  return `Modified ${formatDay(time, now)}`;
}

/** "3 Oct, 01:02" (with the year when asked): a timestamp to the minute. */
export function formatTimestamp(timestamp: number, includeYear = false): string {
  return new Date(timestamp).toLocaleString(undefined, {
    ...(includeYear ? { year: "numeric" as const } : {}),
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
