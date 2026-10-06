import fs from "node:fs/promises";

/** A move may finish with skips or stop after publishing only part of its payload. */
export async function remainingCutPaths(paths: readonly string[]): Promise<string[]> {
  const remaining: string[] = [];
  for (const file of paths) {
    try {
      await fs.lstat(file);
      remaining.push(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return remaining;
}
