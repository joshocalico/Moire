/**
 * Home as an overview: Pinned, Recent and Browse by kind above Home's own contents, each left
 * out when it would be empty; pinning by drop and unpinning from ⋯; Browse by kind opens a
 * search with that kind as a token; See all opens the Recent page.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  createLocalIndexClient,
  groupSearchHits,
  type IndexBackend,
} from "@moire/system-management/index-status";
import { notifyDrop } from "@moire/ui/testing";
import { openFiles, withHome } from "./harness";
import { loadRecentWithoutIndex } from "./search/recent";

const SECTIONS = ["Pinned", "Recent", "Browse by kind", "In Home"];

function countingIndex(home: string): IndexBackend {
  return {
    status: () => ({
      state: "ready",
      message: "",
      revision: 1,
      roots: [home],
      files: 3,
      folders: 1,
      withText: 0,
      pendingText: 0,
      crawl: { directories: 1, entries: 4, queued: 0 },
      watching: "recursive",
      lastCrawlAt: Date.now(),
    }),
    subscribe: () => () => {},
    reindex: async () => {},
    recent: (limit) => loadRecentWithoutIndex(limit),
    kindCounts: async (scope) => ({ scope, total: 5, kinds: { image: 2, document: 3 }, large: 0 }),
    search: async (_query, _scope, perGroup) => groupSearchHits([], perGroup, "index", false),
  };
}

// Nothing to show: no pins, no recent files, no index.
await withHome(async (home) => {
  const config = path.join(home, ".config", "moire");
  await fs.mkdir(config, { recursive: true });
  await fs.writeFile(
    path.join(config, "files-places.json"),
    JSON.stringify({
      version: 1,
      favorites: [],
      unpinned: ["documents", "pictures", "downloads", "music"],
    }),
  );
  await fs.writeFile(path.join(home, "notes.txt"), "notes");
  const files = await openFiles({ initialPath: home });
  try {
    await files.until(() => files.texts().includes("notes.txt"), "Home lists its contents");
    for (const section of SECTIONS)
      assert.ok(!files.texts().includes(section), `an empty overview leaves out ${section}`);
    assert.ok(files.texts().includes("Home"), "Home keeps its title");
  } finally {
    files.close();
  }
});

// Everything to show.
await withHome(async (home) => {
  const config = path.join(home, ".config", "moire");
  await fs.mkdir(config, { recursive: true });
  const projects = path.join(home, "Projects");
  const archive = path.join(home, "Archive");
  await fs.mkdir(projects, { recursive: true });
  await fs.mkdir(archive, { recursive: true });
  await fs.writeFile(path.join(projects, "plan.txt"), "plan");
  await fs.writeFile(
    path.join(config, "files-places.json"),
    JSON.stringify({ version: 1, favorites: [{ label: "Projects", path: projects }] }),
  );
  const recent = path.join(home, ".local", "state", "moire", "recent");
  await fs.mkdir(recent, { recursive: true });
  await fs.writeFile(
    path.join(recent, "org.moire.Editor.json"),
    JSON.stringify([path.join(projects, "plan.txt")]),
  );
  const files = await openFiles({
    initialPath: home,
    indexClient: createLocalIndexClient(countingIndex(home)),
    preferences: { railExpanded: true },
  });
  try {
    await files.until(() => files.texts().includes("Browse by kind"), "the overview loads");
    for (const section of SECTIONS)
      assert.ok(files.texts().includes(section), `the overview shows ${section}`);
    assert.ok(files.texts().includes("plan.txt"), "Recent shows the app's recent file");
    assert.ok(
      files.texts().some((text) => /free of/.test(text)),
      "the title shows free space",
    );

    // Drop a folder on Pinned to pin it; unpin it again from its ⋯.
    const pinnedTitle = files.hits().find((hit) => hit.focusId === "pinned:documents")!;
    notifyDrop(
      `${pathToFileURL(archive).href}\r\n`,
      ["text/uri-list"],
      pinnedTitle.x + pinnedTitle.width + 4,
      pinnedTitle.y - 20,
    );
    await files.until(
      () => files.hits().some((hit) => hit.focusId === `pinned:favorite:${archive}`),
      "a folder dropped on Pinned is pinned",
    );
    const archiveCard = files.hit(`pinned:favorite:${archive}`);
    files.rightClick({ x: archiveCard.x + 20, y: archiveCard.y + 20 });
    assert.equal(files.menu.title, "Archive");
    await files.invoke("unpin");
    await files.until(
      () => !files.hits().some((hit) => hit.focusId === `pinned:favorite:${archive}`),
      "Unpin takes the card away",
    );
    files.rightClick(files.center("pinned:pictures"));
    await files.invoke("unpin");
    await files.until(
      () => !files.hits().some((hit) => hit.focusId === "pinned:pictures"),
      "a built-in place can be unpinned too",
    );
    assert.ok(
      files.hits().some((hit) => hit.focusId === "rail:pictures"),
      "and stays on the rail",
    );

    // Browse by kind searches Home for that kind.
    files.press("Images");
    await files.until(() => files.texts().includes("kind: image"), "the kind becomes a token");
    assert.ok(files.texts().includes("Home"), "the search covers Home");
    files.key(1, "Escape");
    await files.until(() => files.texts().includes("Browse by kind"), "Escape returns to Home");

    // See all opens the Recent page, grouped by day.
    files.press("See all");
    await files.until(() => files.texts().includes("Today"), "Recent groups by day");
    assert.ok(files.texts().includes("plan.txt"));

    // A pinned card opens its folder.
    files.click(files.center("rail:home"));
    await files.until(() => files.texts().includes("Pinned"), "back on Home");
    files.click(files.center(`pinned:favorite:${projects}`));
    await files.until(() => files.texts().includes("Search Projects"), "the card opens Projects");
    console.log(
      "[files/overview] empty sections hidden; pinned drop/unpin, recent, kind search, See all and card navigation passed",
    );
  } finally {
    files.close();
  }
});
