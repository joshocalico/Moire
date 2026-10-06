import { fileURLToPath, pathToFileURL } from "node:url";

/** URI-list is an external boundary: accept only absolute local file URLs. */
export function pathsFromUriList(payload: unknown): string[] {
  if (typeof payload !== "string") return [];
  const paths = new Set<string>();
  for (const line of payload.split(/\r?\n/u)) {
    const value = line.trim();
    if (!value.startsWith("file:/")) continue;
    try {
      const url = new URL(value);
      if (url.protocol !== "file:" || url.search || url.hash) continue;
      const local = fileURLToPath(url); // Rejects remote hosts and encoded path separators.
      if (local.includes("\0")) continue;
      paths.add(local);
    } catch {
      // An unsupported URI must not turn into an unintended local operation.
    }
  }
  return [...paths];
}

/** Escape literal #, ?, %, Unicode and line breaks instead of treating them as URL syntax. */
export function pathsToUriList(paths: readonly string[]): string {
  return paths.map((file) => pathToFileURL(file).href).join("\r\n") + "\r\n";
}
