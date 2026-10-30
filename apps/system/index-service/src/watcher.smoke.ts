/** The live watch keeps the index current: create, rename and delete, files and folders. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { EMPTY_QUERY, EVERYWHERE, type IndexQuery } from "@moire/system-management/index-status";
import { exclusionRules } from "./config";
import { homeFixture, write } from "./fixture";
import { IndexService } from "./service";
import { watchRoots } from "./watcher";

const fixture = homeFixture("watch");
const { home, env } = fixture;
const file = (relative: string) => path.join(home, relative);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const indexed = async (service: IndexService, query: IndexQuery = EMPTY_QUERY) =>
  (await service.search(query, EVERYWHERE, 100)).groups.flatMap((group) =>
    group.hits.map((hit) => hit.path),
  );

/** Watch delivery is asynchronous everywhere; poll until the index agrees or time runs out. */
async function eventually(check: () => Promise<boolean>, label: string): Promise<void> {
  const deadline = performance.now() + 8000;
  while (!(await check())) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${label}`);
    await sleep(25);
  }
}

try {
  write(file("Documents/first.txt"), "first");

  // Events inside excluded folders never reach the index.
  const batches: string[][] = [];
  const raw = watchRoots([home], {
    rules: exclusionRules(env, []),
    onChanges: (paths) => batches.push([...paths]),
    onFailure: (error) => assert.fail(error),
    debounceMs: 50,
  });
  if (raw.mode === "recursive") {
    write(file("node_modules/pkg/index.js"), "x");
    write(file(".git/HEAD"), "x");
    write(file("Documents/visible.txt"), "x");
    await eventually(
      async () => batches.flat().includes(file("Documents/visible.txt")),
      "a visible change",
    );
    await sleep(150);
    assert(
      !batches.flat().some((item) => item.includes("node_modules/pkg") || item.includes(".git/")),
      "excluded folders are filtered",
    );
  }
  raw.close();

  const service = new IndexService({
    env,
    readSettings: () => ({ enabled: true, excludes: [] }),
    activity: { battery: async () => null, loadPerCpu: () => 0 },
    watchTiming: { debounceMs: 50, maxWaitMs: 200 },
  });
  await service.start();
  await service.idle();
  const watching = service.status().watching;
  console.log(`[index-service/watcher.smoke] watch mode: ${watching}`);
  if (watching !== "recursive") {
    // No recursive watch on this platform: the reconcile pass covers it (service.smoke.ts).
    await service.stop();
    console.log("[index-service/watcher.smoke] ok (reconcile only)");
  } else {
    assert((await indexed(service)).includes(file("Documents/first.txt")));

    write(file("Documents/created.txt"), "a needle in the file");
    await eventually(
      async () => (await indexed(service)).includes(file("Documents/created.txt")),
      "create",
    );
    await eventually(
      async () =>
        (await service.search({ ...EMPTY_QUERY, words: ["needle"] }, EVERYWHERE, 8)).total === 1,
      "text of a created file",
    );

    fs.renameSync(file("Documents/created.txt"), file("Documents/renamed.txt"));
    await eventually(async () => {
      const now = await indexed(service);
      return (
        now.includes(file("Documents/renamed.txt")) && !now.includes(file("Documents/created.txt"))
      );
    }, "rename");

    fs.rmSync(file("Documents/renamed.txt"));
    await eventually(
      async () => !(await indexed(service)).includes(file("Documents/renamed.txt")),
      "delete",
    );

    // A folder created with contents, then renamed and deleted as a whole.
    write(file("Work/Deep/inner/note.md"), "nested");
    await eventually(
      async () => (await indexed(service)).includes(file("Work/Deep/inner/note.md")),
      "new tree",
    );
    fs.renameSync(file("Work/Deep"), file("Work/Moved"));
    await eventually(async () => {
      const now = await indexed(service);
      return (
        now.includes(file("Work/Moved/inner/note.md")) &&
        !now.some((item) => item.includes("/Deep"))
      );
    }, "folder rename");
    fs.rmSync(file("Work"), { recursive: true });
    await eventually(
      async () => !(await indexed(service)).some((item) => item.includes("/Work")),
      "folder delete",
    );

    // Writes in excluded folders leave the index alone.
    write(file("Documents/node_modules/x/y.js"), "x");
    await sleep(300);
    assert(!(await indexed(service)).some((item) => item.includes("node_modules")));
    await service.stop();
    console.log("[index-service/watcher.smoke] ok");
  }
} finally {
  fixture.remove();
}
