/**
 * Recently used files for Home and the Recent page: from the index when it runs, otherwise
 * from the apps' own recent lists.
 */
import { useEffect, useState } from "react";
import type { RecentFile } from "@moire/file-operations";
import {
  indexSearchable,
  type IndexClient,
  type KindCounts,
} from "@moire/system-management/index-status";
import { loadRecentWithoutIndex } from "./search/recent";

const RECENT_LIMIT = 60;

export function useRecent(
  client: IndexClient | null,
  home: string,
  enabled: boolean,
  revision: number,
) {
  const [recent, setRecent] = useState<readonly RecentFile[]>([]);
  const [kinds, setKinds] = useState<KindCounts | null>(null);
  const [indexRevision, setIndexRevision] = useState(0);
  useEffect(() => client?.subscribe(() => setIndexRevision((value) => value + 1)), [client]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const indexed = client && indexSearchable(client.state);
    void (indexed ? client.recent(RECENT_LIMIT) : loadRecentWithoutIndex(RECENT_LIMIT)).then(
      (files) => alive && setRecent(files),
      // Recent files are a convenience; without them the section stays hidden.
      () => alive && setRecent([]),
    );
    if (indexed)
      void client.kindCounts(home).then(
        (counts) => alive && setKinds(counts),
        () => alive && setKinds(null),
      );
    else setKinds(null);
    return () => {
      alive = false;
    };
  }, [client, home, enabled, revision, indexRevision]);
  return { recent, kinds };
}
