/**
 * The index against a throwaway HOME: crawl and exclusions, text from .txt/.odt/.pdf/JPEG EXIF,
 * every filter, scope, folder and tag matches, recent files, reindex, the schema rebuild and
 * turning indexing off.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  EMPTY_QUERY,
  EVERYWHERE,
  createLocalIndexClient,
  type IndexQuery,
  type IndexSearchResult,
} from "@moire/system-management/index-status";
import type { ActivitySource } from "./activity";
import { homeFixture, jpegWithExif, odt, write } from "./fixture";
import { SCHEMA_VERSION, checkSqliteSupport, openIndexDatabase } from "./schema";
import { IndexService, type IndexSettings } from "./service";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const quiet: ActivitySource = { battery: async () => null, loadPerCpu: () => 0 };
const query = (patch: Partial<IndexQuery>): IndexQuery => ({ ...EMPTY_QUERY, ...patch });
const paths = (result: IndexSearchResult) =>
  result.groups.flatMap((group) => group.hits.map((hit) => hit.path)).sort();

assert.match(checkSqliteSupport(), /^3\.\d+/);

const fixture = homeFixture("service");
const { home, env } = fixture;
const file = (relative: string) => path.join(home, relative);
try {
  write(
    file("Documents/Quarterly Report.txt"),
    "Revenue grew in the northern region.",
    new Date(NOW - 2 * DAY),
  );
  write(
    file("Documents/notes.md"),
    "# Ideas\nA lighthouse keeper's budget.",
    new Date(NOW - 40 * DAY),
  );
  write(
    file("Documents/Minutes.odt"),
    odt(["Board meeting", "Discussed the &quot;harbour&quot; expansion"]),
  );
  // A real Quartz-made PDF (compressed content streams, embedded subset fonts).
  write(
    file("Documents/Field notes.pdf"),
    fs.readFileSync(
      new URL(
        "../../../../packages/file-formats/src/fixtures/pdf-quartz-two-pages.pdf",
        import.meta.url,
      ),
    ),
  );
  write(file("Pictures/beach.jpg"), jpegWithExif("Canon", "EOS R6", "2024:06:01 14:30:00"));
  write(file("Pictures/huge.png"), Buffer.alloc(12 * 1024 * 1024), new Date(NOW - 400 * DAY));
  write(file("Projects/Atlas/plan.txt"), "Milestones for the atlas launch");
  write(file("Projects/Atlas/src/index.ts"), "export const answer = 42;");
  write(file("Projects/Atlas/node_modules/dep/readme.md"), "dependency readme");
  write(file("Projects/Atlas/.git/HEAD"), "ref: refs/heads/main");
  write(file("Projects/Atlas/dist/bundle.js"), "bundled");
  write(file(".secret/keys.txt"), "hidden folder");
  write(file(".bashrc"), "export PATH");
  write(file(".cache/thumb.png"), "cache");
  write(file(".local/share/Trash/files/old.txt"), "trashed");
  write(file("Videos/raw/take1.mp4"), "video");
  write(file("Downloads/installer.iso"), "image");
  write(
    path.join(fixture.root, "config/moire/index.json"),
    JSON.stringify({ exclude: ["~/Videos/raw", "*.iso"] }),
  );
  write(
    path.join(fixture.root, "config/moire/files-tags.json"),
    JSON.stringify({
      version: 1,
      records: [{ path: file("Pictures/beach.jpg"), tags: ["Travel", "summer"] }],
    }),
  );
  write(
    path.join(fixture.root, "state/moire/recent/org.moire.Editor.json"),
    JSON.stringify([file("Documents/notes.md")]),
  );

  let settings: IndexSettings = { enabled: true, excludes: [] };
  const service = new IndexService({
    env,
    readSettings: () => settings,
    activity: quiet,
    watch: false,
    now: () => NOW,
  });
  const client = createLocalIndexClient(service);
  await service.start();
  await service.idle();

  // ---- Crawl and exclusions.
  let status = service.status();
  assert.equal(status.state, "ready", status.message);
  assert.deepEqual(status.roots, [home]);
  assert.equal(status.pendingText, 0, "every textual file was extracted");
  const all = await client.search(query({ includeHidden: true }), EVERYWHERE, 200);
  const indexed = paths(all).map((item) => path.relative(home, item));
  for (const expected of [
    "Documents/Quarterly Report.txt",
    "Documents/Minutes.odt",
    "Pictures/beach.jpg",
    "Projects/Atlas/src/index.ts",
    "Projects/Atlas",
    ".bashrc",
  ])
    assert(indexed.includes(expected), `${expected} is indexed`);
  for (const excluded of [
    "Projects/Atlas/node_modules",
    "Projects/Atlas/node_modules/dep/readme.md",
    "Projects/Atlas/.git/HEAD",
    "Projects/Atlas/dist/bundle.js",
    ".secret/keys.txt",
    ".cache/thumb.png",
    ".local/share/Trash/files/old.txt",
    "Videos/raw",
    "Videos/raw/take1.mp4",
    "Downloads/installer.iso",
  ])
    assert(!indexed.includes(excluded), `${excluded} is excluded`);
  const visible = paths(await client.search(EMPTY_QUERY, EVERYWHERE, 200));
  assert(!visible.includes(file(".bashrc")), "hidden files only appear when asked for");

  // ---- Names: substring, prefix and short words.
  let result = await client.search(query({ words: ["report"] }), EVERYWHERE, 8);
  assert.equal(result.best?.path, file("Documents/Quarterly Report.txt"));
  assert.deepEqual(result.best?.reason, { kind: "name" });
  result = await client.search(query({ words: ["qu", "rep"] }), EVERYWHERE, 8);
  assert.equal(result.best?.path, file("Documents/Quarterly Report.txt"), "short words scan names");

  // ---- Text: plain text, OpenDocument and EXIF camera fields, with excerpts.
  result = await client.search(query({ words: ["northern"] }), EVERYWHERE, 8);
  assert.equal(result.best?.path, file("Documents/Quarterly Report.txt"));
  assert.equal(result.best?.reason.kind, "text");
  if (result.best?.reason.kind === "text") {
    const [start, end] = result.best.reason.highlights[0]!;
    assert.equal(result.best.reason.excerpt.slice(start, end), "northern");
  }
  result = await client.search(query({ words: ["harbo"] }), EVERYWHERE, 8);
  assert.equal(
    result.best?.path,
    file("Documents/Minutes.odt"),
    "odt content.xml text is searchable",
  );
  if (result.best?.reason.kind === "text")
    assert.match(result.best.reason.excerpt, /"harbour" expansion/);
  result = await client.search(query({ words: ["longer", "document"] }), EVERYWHERE, 8);
  assert.equal(result.best?.path, file("Documents/Field notes.pdf"), "PDF text is searchable");
  assert.equal(result.best?.reason.kind, "text");
  result = await client.search(query({ words: ["canon"] }), EVERYWHERE, 8);
  assert.equal(result.best?.path, file("Pictures/beach.jpg"), "EXIF camera is searchable");
  const taken = new DatabaseSync(env.database, { readOnly: true });
  assert.equal(
    taken.prepare("SELECT taken FROM files WHERE name = 'beach.jpg'").get()?.taken,
    new Date(2024, 5, 1, 14, 30, 0).getTime(),
  );
  taken.close();

  // ---- Folder and tag reasons.
  result = await client.search(query({ words: ["atlas"] }), EVERYWHERE, 8);
  assert.equal(result.best?.path, file("Projects/Atlas"), "the folder itself is the best match");
  const inside = result.groups
    .flatMap((group) => group.hits)
    .find((hit) => hit.name === "index.ts");
  assert.deepEqual(inside?.reason, { kind: "folder", folder: file("Projects/Atlas") });
  result = await client.search(query({ words: ["trav"] }), EVERYWHERE, 8);
  assert.equal(result.best?.path, file("Pictures/beach.jpg"));
  assert.deepEqual(result.best?.reason, { kind: "tag", tag: "Travel" });
  assert.deepEqual(result.best?.tags, ["Travel", "summer"]);

  // ---- Filters: kind, when, size, tag and in:, and the scope prefix.
  assert.deepEqual(paths(await client.search(query({ kinds: ["image"] }), EVERYWHERE, 50)), [
    file("Pictures/beach.jpg"),
    file("Pictures/huge.png"),
  ]);
  const week = paths(
    await client.search(query({ kinds: ["document"], when: "week" }), EVERYWHERE, 50),
  );
  assert(
    week.includes(file("Documents/Quarterly Report.txt")) &&
      !week.includes(file("Documents/notes.md")),
  );
  assert.deepEqual(
    paths(
      await client.search(query({ sizes: [{ op: ">", bytes: 10 * 1024 * 1024 }] }), EVERYWHERE, 50),
    ),
    [file("Pictures/huge.png")],
  );
  assert(
    !paths(
      await client.search(query({ sizes: [{ op: "<", bytes: 1024 }] }), EVERYWHERE, 50),
    ).includes(file("Pictures/huge.png")),
  );
  assert.deepEqual(paths(await client.search(query({ tags: ["travel"] }), EVERYWHERE, 50)), [
    file("Pictures/beach.jpg"),
  ]);
  const scoped = paths(await client.search(EMPTY_QUERY, file("Projects"), 50));
  assert(scoped.length > 0 && scoped.every((item) => item.startsWith(file("Projects") + "/")));
  const within = paths(await client.search(query({ within: [file("Documents")] }), EVERYWHERE, 50));
  assert(within.length === 4 && within.every((item) => item.startsWith(file("Documents") + "/")));
  result = await client.search(query({ words: ["report"] }), file("Pictures"), 8);
  assert.equal(result.total, 0, "scope excludes other folders");

  // ---- Kind counts.
  const counts = await client.kindCounts(home);
  assert.equal(counts.kinds.image, 2);
  assert.equal(counts.kinds.document, 5, "four in Documents, one in Projects");
  assert.equal(counts.large, 0, "12 MB is not a large file");

  // ---- Recent: opened through an app, plus modified in the last 14 days.
  const recent = await client.recent(10);
  assert.equal(recent.find((item) => item.path === file("Documents/notes.md"))?.source, "opened");
  assert.equal(
    recent.find((item) => item.path === file("Documents/Quarterly Report.txt"))?.source,
    "modified",
  );
  assert(
    !recent.some((item) => item.path === file("Pictures/huge.png")),
    "old files are not recent",
  );

  // ---- Reconcile: a reindex picks up changes made while nothing watched.
  fs.rmSync(file("Documents/Minutes.odt"));
  fs.renameSync(file("Projects/Atlas"), file("Projects/Globe"));
  write(file("Documents/later.txt"), "added while unwatched");
  await client.reindex(EVERYWHERE);
  await service.idle();
  const after = paths(await client.search(query({ includeHidden: true }), EVERYWHERE, 200));
  assert(!after.includes(file("Documents/Minutes.odt")));
  assert(!after.some((item) => item.includes("/Atlas")), "a renamed folder's old subtree is gone");
  assert(after.includes(file("Projects/Globe/src/index.ts")));
  assert.equal(
    (await client.search(query({ words: ["unwatched"] }), EVERYWHERE, 8)).best?.path,
    file("Documents/later.txt"),
  );
  await assert.rejects(client.reindex("/elsewhere"), RangeError);

  // ---- Excludes from settings apply on the next pass and drop what they cover.
  settings = { enabled: true, excludes: ["~/Projects"] };
  await service.applySettings();
  await service.idle();
  assert(
    !paths(await client.search(EMPTY_QUERY, EVERYWHERE, 200)).some((item) =>
      item.includes("/Projects"),
    ),
  );

  // ---- A drive Settings opts in becomes a root; turning it off drops what it held.
  const drive = path.join(fixture.root, "media/USB");
  write(path.join(drive, "holiday.txt"), "photos from the drive");
  settings = { enabled: true, excludes: ["~/Projects"], includes: [drive] };
  await service.applySettings();
  await service.idle();
  assert.deepEqual(service.status().roots, [home, drive]);
  assert.equal(
    (await client.search(query({ words: ["holiday"] }), EVERYWHERE, 8)).best?.path,
    path.join(drive, "holiday.txt"),
  );
  settings = { enabled: true, excludes: ["~/Projects"] };
  await service.applySettings();
  await service.idle();
  assert.equal((await client.search(query({ words: ["holiday"] }), EVERYWHERE, 8)).total, 0);

  // ---- Turning indexing off deletes the database and refuses searches.
  settings = { enabled: false, excludes: [] };
  await service.applySettings();
  status = service.status();
  assert.equal(status.state, "disabled");
  assert.equal(fs.existsSync(env.database), false, "the index file is deleted");
  assert.equal(fs.existsSync(`${env.database}-wal`), false);
  await assert.rejects(client.search(EMPTY_QUERY, EVERYWHERE, 8), /Indexing is off/);
  assert.equal(
    (await client.recent(10))[0]?.path,
    file("Documents/notes.md"),
    "recent still answers",
  );
  settings = { enabled: true, excludes: [] };
  await service.applySettings();
  await service.idle();
  assert.equal(
    (await client.search(query({ words: ["report"] }), EVERYWHERE, 8)).total,
    1,
    "re-enabled crawls again",
  );
  await service.stop();

  // ---- A schema version change rebuilds the index instead of migrating it.
  const bumped = openIndexDatabase(env.database, SCHEMA_VERSION + 1);
  assert.equal(bumped.rebuilt, true);
  assert.equal(bumped.db.prepare("SELECT COUNT(*) AS n FROM files").get()?.n, 0);
  assert.equal(bumped.db.prepare("PRAGMA user_version").get()?.user_version, SCHEMA_VERSION + 1);
  bumped.db.close();
  const current = openIndexDatabase(env.database);
  assert.equal(current.rebuilt, true, "going back is a version change too");
  current.db.close();
  fs.writeFileSync(env.database, "not a database");
  const corrupt = openIndexDatabase(env.database);
  assert.equal(corrupt.rebuilt, true, "a corrupt cache is rebuilt");
  corrupt.db.close();

  // ---- Pausing: low battery holds the crawl until power returns.
  let battery = { percent: 10, discharging: true };
  const paused = new IndexService({
    env,
    readSettings: () => ({ enabled: true, excludes: [] }),
    activity: { battery: async () => battery, loadPerCpu: () => 0 },
    watch: false,
  });
  const states: string[] = [];
  paused.subscribe(() => states.push(paused.status().state));
  await paused.start();
  const deadline = Date.now() + 2000;
  while (paused.status().state !== "paused" && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(paused.status().state, "paused");
  assert.match(paused.status().message, /battery/);
  battery = { percent: 10, discharging: false };
  await paused.stop();
  console.log("[index-service/service.smoke] ok");
} finally {
  fixture.remove();
}
