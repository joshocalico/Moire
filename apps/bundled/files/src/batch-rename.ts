/**
 * Renaming several items with one pattern: `{name}` is the old name without its extension,
 * `{ext}` the extension, `{n}` the item's number in the selection (padded to the count's width).
 * The extension is kept unless the pattern places `{ext}` itself.
 */
import path from "node:path";

export const BATCH_PATTERN_HINT = "{name} old name · {n} number · {ext} extension";

export function batchName(name: string, pattern: string, index: number, count: number): string {
  const extension = path.extname(name);
  const base = extension && extension !== name ? name.slice(0, -extension.length) : name;
  const number = String(index + 1).padStart(String(count).length, "0");
  const placesExtension = pattern.includes("{ext}");
  const result = pattern
    .replaceAll("{name}", base)
    .replaceAll("{n}", number)
    .replaceAll("{ext}", extension.slice(1))
    .trim();
  return placesExtension ? result : `${result}${extension}`;
}

/** Every new name, or why the pattern cannot be used. */
export function batchNames(
  names: readonly string[],
  pattern: string,
): { names: string[]; error: string | null } {
  const result = names.map((name, index) => batchName(name, pattern, index, names.length));
  if (!pattern.trim()) return { names: result, error: "Enter a pattern" };
  if (result.some((name) => !name || name === "." || name === ".." || name.includes("/")))
    return { names: result, error: "Names cannot be empty or contain “/”" };
  if (new Set(result).size !== result.length)
    return { names: result, error: "Add {n} so every item gets a different name" };
  return { names: result, error: null };
}
