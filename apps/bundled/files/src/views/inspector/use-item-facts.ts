/**
 * The current facts about the inspected items, read off the render path: each item's lstat
 * (dates, mode, owner), the owner's and group's names, and the app each was last opened in.
 * Re-read when the items change or `refresh` moves (after an operation settles).
 */
import fs from "node:fs/promises";
import { useEffect, useState } from "react";
import { readOpenedFiles } from "@moire/file-operations";
import type { Entry } from "#files/filesystem";
import { accountName, currentUserName, readAccounts } from "#files/permissions";
import type { ItemStat, LastOpened } from "./model";

export type ItemFacts = {
  stats: ItemStat[];
  /** Owner and group names by the first item's ids. */
  owner: string;
  group: string;
  currentUid: number;
  /** By path. */
  lastOpened: ReadonlyMap<string, LastOpened>;
};

export function useItemFacts(
  entries: readonly Entry[],
  refresh: number,
  applicationName: (appId: string) => string,
): ItemFacts | null {
  const key = entries.map((entry) => `${entry.path}:${entry.modified}`).join("\n");
  const [facts, setFacts] = useState<{ key: string; value: ItemFacts } | null>(null);
  useEffect(() => {
    let alive = true;
    void readFacts(entries, applicationName).then(
      (value) => alive && setFacts({ key, value }),
      () => alive && setFacts(null),
    );
    return () => {
      alive = false;
    };
    // The items are identified by their key; the name lookup is stable for a window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, refresh]);
  return facts?.key === key ? facts.value : null;
}

async function readFacts(
  entries: readonly Entry[],
  applicationName: (appId: string) => string,
): Promise<ItemFacts> {
  const stats = (
    await Promise.all(
      entries.map(async (entry): Promise<ItemStat | null> => {
        try {
          const stat = await fs.lstat(entry.path);
          return {
            path: entry.path,
            mode: stat.mode & 0o7777,
            uid: stat.uid,
            gid: stat.gid,
            created: stat.birthtimeMs > 0 ? stat.birthtimeMs : null,
            modified: stat.mtimeMs,
            accessed: stat.atimeMs,
            isDir: stat.isDirectory(),
            linkTarget: stat.isSymbolicLink() ? await fs.readlink(entry.path) : null,
          };
        } catch {
          return null;
        }
      }),
    )
  ).filter((stat): stat is ItemStat => stat !== null);
  const [accounts, opened] = await Promise.all([readAccounts(), readOpenedFiles()]);
  const wanted = new Set(entries.map((entry) => entry.path));
  const lastOpened = new Map<string, LastOpened>();
  for (const item of opened)
    if (wanted.has(item.path) && !lastOpened.has(item.path))
      lastOpened.set(item.path, { app: applicationName(item.app), at: item.openedAt });
  const currentUid = process.getuid?.() ?? -1;
  const first = stats[0];
  const users = new Map(accounts.users);
  if (currentUid >= 0 && !users.has(currentUid)) users.set(currentUid, currentUserName());
  return {
    stats,
    owner: first ? accountName(users, first.uid) : "",
    group: first ? accountName(accounts.groups, first.gid) : "",
    currentUid,
    lastOpened,
  };
}
