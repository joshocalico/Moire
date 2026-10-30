/**
 * Search as a page: typing on a folder starts it, a prefix makes the best match (type to
 * select), Escape returns with that match selected and clearing returns without changing the
 * selection; Ctrl shortcuts are never taken by typing; tokens complete with Tab and leave with
 * Backspace; scope chips widen the search; arrows and Ctrl+Enter act on results; without an
 * index (or with indexing off) the page says it searches names only.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createLocalIndexClient,
  groupSearchHits,
  type IndexBackend,
  type IndexStatus,
} from "@moire/system-management/index-status";
import { entryId, openFiles, withHome, type FilesHarness } from "./harness";
import { SEARCH_FOCUS_ID } from "./views/search-field";

function index(home: string, state: IndexStatus["state"]): IndexBackend {
  return {
    status: () => ({
      state,
      message: "",
      revision: 1,
      roots: [home],
      files: 0,
      folders: 0,
      withText: 0,
      pendingText: 0,
      crawl: { directories: 0, entries: 0, queued: 0 },
      watching: "off",
      lastCrawlAt: null,
    }),
    subscribe: () => () => {},
    reindex: async () => {},
    recent: async () => [],
    kindCounts: async (scope) => ({ scope, total: 0, kinds: {}, large: 0 }),
    search: async (_query, _scope, perGroup) =>
      groupSearchHits(
        [
          {
            path: path.join(home, "Elsewhere", "bravo-notes.md"),
            name: "bravo-notes.md",
            kind: "document",
            isDir: false,
            size: 10,
            modified: Date.now(),
            tags: [],
            reason: { kind: "text", excerpt: "the bravo plan", highlights: [[4, 9]] },
            score: 5,
          },
        ],
        perGroup,
        "index",
        false,
      ),
  };
}

const menuTitle = (files: FilesHarness) => {
  files.key(139, "ContextMenu");
  return files.menu.title;
};

await withHome(async (home) => {
  const folder = path.join(home, "Projects");
  await fs.mkdir(path.join(folder, "Design"), { recursive: true });
  for (const name of ["alpha.txt", "beta.txt", "bravo.txt"])
    await fs.writeFile(path.join(folder, name), name);
  await fs.writeFile(path.join(folder, "Design", "brief.md"), "brief");
  await fs.writeFile(path.join(home, "outside-bravo.txt"), "outside");

  // No index: names only.
  let files = await openFiles({ initialPath: folder });
  try {
    const alpha = path.join(folder, "alpha.txt");
    await files.until(() => files.hits().some((hit) => hit.focusId === entryId(alpha)), "lists");
    files.click(files.center(entryId(alpha)));

    // Ctrl shortcuts stay shortcuts: Ctrl+A selects everything, no search starts.
    files.key(30, "a", { ctrl: true });
    assert.match(menuTitle(files), /^4 Items$/, "Ctrl+A still selects all");
    assert.ok(!files.texts().includes("Best match"), "and starts no search");

    // Typing on the page starts a search with what was typed; the prefix match is best.
    files.type("br");
    await files.until(() => files.texts().includes("Best match"), "typing starts a search");
    assert.equal(
      (files.window as unknown as { focusedId: string | null }).focusedId,
      SEARCH_FOCUS_ID,
      "the field takes the keyboard",
    );
    await files.until(
      () => files.texts().includes("Searching names only; the index is unavailable"),
      "without an index the page says names only",
    );
    const best = files.hit(`result:${path.join(folder, "bravo.txt")}`);
    const others = files.hits().filter((hit) => hit.focusId?.startsWith("result:"));
    assert.equal(others[0]?.focusId, best.focusId, "bravo.txt is the best match");
    assert.ok(
      !files.texts().includes("outside-bravo.txt"),
      "This folder leaves out the rest of Home",
    );

    // Escape: back to the folder with the best match selected (type to select).
    files.key(1, "Escape");
    await files.until(() => !files.texts().includes("Best match"), "Escape leaves search");
    assert.equal(menuTitle(files), "bravo.txt", "the best match is selected");

    // Clearing the field returns without changing the selection.
    await new Promise((resolve) => setTimeout(resolve, 450)); // not a double click
    files.click(files.center(entryId(alpha)));
    files.type("b");
    await files.until(() => files.texts().includes("Best match"), "a new search");
    files.key(14, "Backspace");
    await files.until(() => !files.texts().includes("Best match"), "clearing leaves search");
    // Escape in the empty field hands the keyboard back to the folder.
    files.key(1, "Escape");
    await files.settle(3);
    assert.equal(menuTitle(files), "alpha.txt", "the selection is as it was");

    // Tokens: kind: completes with Tab into a chip; Backspace removes it.
    files.key(33, "f", { ctrl: true });
    files.type("kind:im");
    await files.until(() => files.texts().includes("image"), "kind: offers its values");
    files.key(15, "Tab");
    await files.until(() => files.texts().includes("kind: image"), "Tab makes a chip");
    files.key(14, "Backspace");
    await files.until(() => !files.texts().includes("kind: image"), "Backspace removes it");

    // Scopes: Home finds what This folder did not; Ctrl+Enter shows a result in its folder.
    files.type("b");
    await files.until(() => files.texts().includes("Best match"), "searching again");
    files.press("Home");
    await files.until(() => files.texts().includes("outside-bravo.txt"), "Home widens the search");
    // The chip took the keyboard; Ctrl+F returns it to the field.
    files.key(33, "f", { ctrl: true });
    files.key(30, "a", { ctrl: true });
    files.type("brief");
    await files.until(
      () =>
        files.hits().find((hit) => hit.focusId?.startsWith("result:"))?.focusId ===
        `result:${path.join(folder, "Design", "brief.md")}`,
      "brief.md under Design is the best match",
    );
    files.key(28, "Enter", { ctrl: true });
    await files.until(() => files.texts().includes("Search Design"), "Ctrl+Enter opens its folder");
    await files.until(() => menuTitle(files) === "brief.md", "with the result selected");

    // No results: an empty state offers Search everywhere when the scope was narrower.
    files.type("zzzz");
    await files.until(() => files.texts().includes("No results"), "no results says so");
    files.press("Search everywhere");
    await files.until(
      () => files.texts().includes("Try different words or fewer filters."),
      "Search everywhere widens to every indexed place",
    );
    files.key(1, "Escape");
  } finally {
    files.close();
  }

  // Indexing switched off: still names only, and the page says why.
  files = await openFiles({
    initialPath: folder,
    indexClient: createLocalIndexClient(index(home, "disabled")),
  });
  try {
    await files.until(() => files.texts().includes("bravo.txt"), "lists");
    files.click(files.center(entryId(path.join(folder, "alpha.txt"))));
    files.type("bravo");
    await files.until(
      () => files.texts().includes("Searching names only; indexing is off"),
      "indexing off says names only",
    );
  } finally {
    files.close();
  }

  // An index that answers: its results, reasons and keyboard order.
  files = await openFiles({
    initialPath: folder,
    indexClient: createLocalIndexClient(index(home, "ready")),
  });
  try {
    await files.until(() => files.texts().includes("bravo.txt"), "lists");
    files.click(files.center(entryId(path.join(folder, "alpha.txt"))));
    files.type("bravo");
    await files.until(() => files.texts().includes("bravo-notes.md"), "the index's results show");
    assert.ok(!files.texts().some((text) => text.startsWith("Searching names only")));
    // A hovered row shows its actions instead; keep the pointer off the results.
    files.pointer("move", files.window.getWidth() - 4, files.window.getHeight() - 4);
    await files.settle(3);
    assert.ok(files.texts().includes("Text: …the bravo plan…"), "each result says why");
    files.key(108, "ArrowDown");
    files.key(1, "Escape");
    await files.until(() => !files.texts().includes("Best match"), "Escape leaves search");
    assert.equal(
      menuTitle(files),
      "alpha.txt",
      "↓ moved past the best match to a result elsewhere: the way back keeps the selection",
    );
  } finally {
    files.close();
  }
  console.log(
    "[files/search-page] typing starts search, prefix best match and Escape select, clearing keeps selection, Ctrl+A, tokens, scopes, Ctrl+Enter, no results and names-only notices passed",
  );
});
