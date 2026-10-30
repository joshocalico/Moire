/** Listings for the columns view's ancestor folders; the deepest folder is the tab's own listing. */
import path from "node:path";
import { useEffect, useState } from "react";
import { operationError } from "@moire/file-operations";
import { readDirectory, sortEntries, type Entry, type SortField } from "./filesystem";

export type ColumnListing = { directory: string; entries: readonly Entry[]; error: string | null };

/** Folders from `root` down to `cwd`; just `cwd` when it lies outside `root`. */
export function columnChain(root: string, cwd: string): string[] {
  const relative = path.relative(root, cwd);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return [cwd];
  const chain = [root];
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    chain.push(current);
  }
  return chain;
}

export function useColumnListings(
  directories: readonly string[],
  options: { hidden: boolean; sort: SortField; descending: boolean; revision: number },
): readonly ColumnListing[] {
  const key = directories.join("\n");
  const [listings, setListings] = useState<readonly ColumnListing[]>([]);
  useEffect(() => {
    let alive = true;
    void Promise.all(
      directories.map(async (directory): Promise<ColumnListing> => {
        try {
          const entries = await readDirectory(directory, options.hidden);
          return {
            directory,
            entries: sortEntries(entries, options.sort, options.descending),
            error: null,
          };
        } catch (error) {
          return { directory, entries: [], error: operationError(error) };
        }
      }),
    ).then((next) => alive && setListings(next));
    return () => {
      alive = false;
    };
    // The key stands for the directories themselves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, options.hidden, options.sort, options.descending, options.revision]);
  return listings.filter((listing) => directories.includes(listing.directory));
}
