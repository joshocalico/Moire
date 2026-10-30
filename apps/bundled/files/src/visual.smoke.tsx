/**
 * Renders the real Files window in each of its pages, in dark and light, to PNGs for review
 * against the design (`--output=<dir>`, a temporary folder otherwise), and checks that each
 * page paints what it should.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createLocalIndexClient,
  groupSearchHits,
  type IndexBackend,
  type IndexStatus,
} from "@moire/system-management/index-status";
import { fileKind } from "@moire/file-operations";
import { entryId, openFiles, withHome } from "./harness";
import { loadRecentWithoutIndex } from "./search/recent";
import { SEARCH_FOCUS_ID } from "./views/search-field";

const output =
  process.argv.find((arg) => arg.startsWith("--output="))?.slice(9) ??
  (await fs.mkdtemp(path.join(os.tmpdir(), "moire-files-captures-")));
const artwork = fileURLToPath(
  new URL("../../../../themes/default/botanical-wisteria.png", import.meta.url),
);
const DAY = 24 * 60 * 60 * 1000;

async function seed(home: string) {
  const projects = path.join(home, "Projects");
  for (const name of ["Design", "Notes", "Photos"])
    await fs.mkdir(path.join(projects, name), { recursive: true });
  const files: Array<[string, number]> = [
    ["Q3 budget.ods", 18_000],
    ["Launch plan.pdf", 1_200_000],
    ["readme.md", 4_000],
    ["Night drive.mp3", 4_200_000],
    ["site-backup.tar.gz", 8_600_000],
    ["todo.txt", 1_000],
  ];
  for (const [index, [name, size]] of files.entries()) {
    const file = path.join(projects, name);
    await fs.writeFile(file, `${name}\n`.repeat(Math.ceil(size / (name.length + 1))));
    const when = new Date(Date.now() - index * 0.8 * DAY);
    await fs.utimes(file, when, when);
  }
  await fs.copyFile(artwork, path.join(projects, "Holiday in Lisbon.png"));
  await fs.copyFile(artwork, path.join(projects, "Design", "Moodboard.png"));
  await fs.writeFile(path.join(projects, "Design", "Specs.pdf"), "Specs");
  await fs.writeFile(path.join(projects, "Design", "Palette.gpl"), "GIMP Palette");
  await fs.writeFile(path.join(home, "notes.txt"), "Shopping: tea, bread\nCall the plumber\n");
  await fs.writeFile(
    path.join(home, ".config", "moire", "files-places.json"),
    JSON.stringify({ version: 1, favorites: [{ label: "Projects", path: projects }] }),
  );
  const recent = path.join(home, ".local", "state", "moire", "recent");
  await fs.mkdir(recent, { recursive: true });
  await fs.writeFile(
    path.join(recent, "org.moire.Editor.json"),
    JSON.stringify(
      [
        "Holiday in Lisbon.png",
        "Q3 budget.ods",
        "Launch plan.pdf",
        "Night drive.mp3",
        "readme.md",
      ].map((name) => path.join(projects, name)),
    ),
  );
  return projects;
}

/** An index over the fixture: counts for Browse by kind, and name search. */
function fixtureIndex(home: string): IndexBackend {
  const status: IndexStatus = {
    state: "ready",
    message: "",
    revision: 1,
    roots: [home],
    files: 12,
    folders: 4,
    withText: 4,
    pendingText: 0,
    crawl: { directories: 4, entries: 16, queued: 0 },
    watching: "recursive",
    lastCrawlAt: Date.now(),
  };
  return {
    status: () => status,
    subscribe: () => () => {},
    reindex: async () => {},
    // The service merges the apps' lists with recently modified files; the lists suffice here.
    recent: (limit) => loadRecentWithoutIndex(limit),
    kindCounts: async (scope) => ({
      scope,
      total: 1640,
      kinds: { image: 1204, document: 312, audio: 88, video: 14, archive: 12 },
      large: 9,
    }),
    search: async (query, _scope, perGroup) => {
      const words = query.words.map((word) => word.toLowerCase());
      const found: string[] = [];
      const walk = async (directory: string) => {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          if (entry.name.startsWith(".")) continue;
          const file = path.join(directory, entry.name);
          if (words.every((word) => entry.name.toLowerCase().includes(word))) found.push(file);
          if (entry.isDirectory()) await walk(file);
        }
      };
      await walk(home);
      const hits = await Promise.all(
        found.map(async (file, index) => {
          const stat = await fs.stat(file);
          return {
            path: file,
            name: path.basename(file),
            kind: fileKind(file, stat.isDirectory()),
            isDir: stat.isDirectory(),
            size: stat.size,
            modified: stat.mtimeMs,
            tags: [],
            reason:
              index % 2
                ? ({ kind: "folder", folder: path.dirname(file) } as const)
                : ({ kind: "name" } as const),
            score: 100 - index,
          };
        }),
      );
      return groupSearchHits(hits, perGroup, "index", false);
    },
  };
}

for (const scheme of ["dark", "light"] as const)
  await withHome(async (home) => {
    await fs.mkdir(path.join(home, ".config", "moire"), { recursive: true });
    const projects = await seed(home);
    const client = createLocalIndexClient(fixtureIndex(home));
    const shot = (name: string) => path.join(output, `files-${name}-${scheme}.png`);
    let files = await openFiles({
      initialPath: home,
      width: 1020,
      height: 760,
      scheme,
      indexClient: client,
      windowControls: true,
    });
    try {
      await files.until(() => files.texts().includes("Browse by kind"), "Home shows its sections");
      for (const label of ["Pinned", "Recent", "In Home", "Images", "Projects", "notes.txt"])
        assert.ok(files.texts().includes(label), `Home shows ${label}`);
      await files.capture(shot("home"));

      // A folder with two items selected: the selection bar.
      files.click(files.center(`pinned:favorite:${projects}`));
      await files.until(() => files.texts().includes("todo.txt"), "Projects opens");
      files.click(files.center(entryId(path.join(projects, "Holiday in Lisbon.png"))));
      files.click(files.center(entryId(path.join(projects, "Launch plan.pdf"))), { ctrl: true });
      await files.until(() => files.texts().includes("Move to…"), "the selection bar shows");
      await files.capture(shot("folder-selected"));

      // Properties as a docked pane.
      files.click(files.center(entryId(path.join(projects, "readme.md"))));
      files.key(28, "Enter", { alt: true });
      await files.until(() => files.texts().includes("Properties"), "Properties opens");
      await files.until(() => files.texts().includes("Information"), "the inspector loads");
      await files.capture(shot("properties"));
      files.key(1, "Escape");
      await files.settle(5);

      // Space previews the focused file.
      files.click(files.center(entryId(path.join(projects, "Holiday in Lisbon.png"))));
      files.key(57, " ");
      await files.until(
        () => files.texts().includes("1 of 1") || files.texts().some((t) => / of \d+$/.test(t)),
        "preview opens",
      );
      await files.capture(shot("preview"));
      files.key(1, "Escape");
      await files.settle(5);

      // Search: typing on the page starts it.
      files.type("re");
      await files.until(() => files.texts().includes("Best match"), "results show");
      await files.capture(shot("search"));
      files.key(1, "Escape");
      await files.settle(5);

      files.key(50, "2", { ctrl: true });
      await files.settle(5);
      await files.capture(shot("grid"));
      files.key(51, "3", { ctrl: true });
      files.click(files.center(entryId(path.join(projects, "Design"))));
      files.key(106, "ArrowRight");
      await files.until(() => files.texts().includes("Moodboard.png"), "columns open Design");
      files.click(files.center(entryId(path.join(projects, "Design", "Moodboard.png"))));
      await files.until(() => files.texts().includes("Open"), "the preview column shows");
      await files.capture(shot("columns"));
      files.key(49, "1", { ctrl: true });

      // Trash with what was deleted.
      files.key(105, "ArrowLeft", { alt: true });
      await files.until(() => files.texts().includes("todo.txt"), "back in Projects");
      files.click(files.center(entryId(path.join(projects, "todo.txt"))));
      files.click(files.center(entryId(path.join(projects, "readme.md"))), { ctrl: true });
      files.key(111, "Delete");
      await files.until(() => files.texts().includes("2 items moved to Trash"), "trashed");
      files.click(files.center("rail:trash"));
      await files.until(() => files.texts().includes("Empty Trash"), "Trash opens");
      await files.capture(shot("trash"));
    } finally {
      files.close();
    }

    for (const [name, width, height, scale] of [
      ["folder-640x650", 640, 650, 1],
      ["folder-scale1.5", 1530, 1140, 1.5],
    ] as const) {
      files = await openFiles({
        initialPath: projects,
        width,
        height,
        scale,
        scheme,
        indexClient: client,
      });
      try {
        await files.until(() => files.texts().includes("Q3 budget.ods"), `${name} lists`);
        files.click(files.center(entryId(path.join(projects, "Holiday in Lisbon.png"))));
        files.click(files.center(entryId(path.join(projects, "Q3 budget.ods"))), { ctrl: true });
        await files.capture(shot(name));
      } finally {
        files.close();
      }
    }
    assert.ok(SEARCH_FOCUS_ID);
  });
console.log(
  JSON.stringify({
    kind: "files-visual-captures",
    output,
    files: (await fs.readdir(output)).sort(),
  }),
);
