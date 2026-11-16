import path from "node:path";
import type { DesktopEntry } from "./desktop";

/** Vendor words an id carries that are not part of the app's name. */
const VENDOR_WORDS = new Set(["moire"]);

/**
 * The name to show for an app id as apps record it (a desktop id, a reverse-DNS window class like
 * `org.moire.ImageViewer`, or an executable name): the installed app's Name when one matches,
 * else the id made readable.
 */
export function applicationDisplayName(
  appId: string,
  applications: readonly DesktopEntry[],
): string {
  const id = appId.trim().replace(/\.desktop$/, "");
  const lower = id.toLowerCase();
  const match =
    applications.find((app) => app.id.replace(/\.desktop$/, "") === id) ??
    applications.find((app) => app.startupWMClass?.toLowerCase() === lower) ??
    applications.find((app) => executableName(app.exec) === id);
  return match?.name ?? humaniseApplicationId(id);
}

function executableName(exec: string): string {
  const first = exec.trim().match(/^"([^"]+)"|^(\S+)/);
  return path.basename(first?.[1] ?? first?.[2] ?? "");
}

/** "org.moire.ImageViewer" → "Image Viewer", "moire-font-viewer" → "Font Viewer". */
function humaniseApplicationId(id: string): string {
  // Reverse-DNS ids name the app in their last segment.
  const tail = /^[a-z0-9-]+(\.[A-Za-z0-9_-]+){2,}$/.test(id) ? id.split(".").at(-1)! : id;
  const words = tail
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s._-]+/)
    .filter(Boolean);
  const named =
    words.length > 1 && VENDOR_WORDS.has(words[0]!.toLowerCase()) ? words.slice(1) : words;
  const title = named.map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
  return title || id;
}

/**
 * Whether a window whose app id is `windowAppId` belongs to `app`: the id equals the desktop id
 * (without `.desktop`) or the entry's `StartupWMClass`, case-insensitively. Exact on purpose: a
 * single-window launch activates the match, so a near miss must not steal another app's window.
 */
export function applicationOwnsWindow(app: DesktopEntry, windowAppId: string): boolean {
  const id = windowAppId
    .trim()
    .replace(/\.desktop$/i, "")
    .toLowerCase();
  if (!id) return false;
  return (
    app.id.replace(/\.desktop$/i, "").toLowerCase() === id ||
    app.startupWMClass?.toLowerCase() === id
  );
}
