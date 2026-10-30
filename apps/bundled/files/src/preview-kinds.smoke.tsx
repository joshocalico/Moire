/**
 * The Space preview for every kind of file Files previews, in the real window: a folder (its
 * entries and size), photos (upright, with EXIF), audio (tags, art, play/pause), video (frame and
 * duration), PDF (pages, first page, opening words), office documents, archives (top entries),
 * fonts (a specimen), Markdown (rendered), source (highlighted) and plain text. Grid tiles and
 * Home's Recent strip show real JPEG thumbnails; the columns pane and search's best match use the
 * same previews. `--output=<dir>` also writes each state as a PNG,
 * dark and light, at UI scale 1 and 1.5.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { entryId, openFiles, withHome, type FilesHarness } from "./harness";

const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice(9);
const here = path.dirname(fileURLToPath(import.meta.url));
const formats = path.resolve(here, "../../../../packages/file-formats/src/fixtures");
const font = path.resolve(here, "../../../../packages/ui/fonts/IBMPlexSans-Regular.ttf");

const README = `# Field trip

Notes for the **spring** field trip, with a \`checklist\` and links to [the map](https://example.org).

## Packing

- Boots and a rain jacket
- Water, 2 litres
  - a spare bottle
- [x] Permits printed

> Leave the gate as you found it.

| Day | Place     |
| --- | --------- |
| Sat | Ridgeline |
| Sun | Lakeshore |

\`\`\`sh
rsync -a photos/ backup/
\`\`\`
`;

const SOURCE = `/** Shortest route between two stops. */
export function route(from: Stop, to: Stop): Stop[] {
  const seen = new Set<string>([from.id]); // visited
  const queue: Stop[][] = [[from]];
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (path.at(-1) === to) return path;
    for (const next of path.at(-1)!.links) if (!seen.has(next.id)) queue.push([...path, next]);
  }
  return [];
}
`;

/** Each previewed item, in listing order, and text its preview must show. */
const KINDS: ReadonlyArray<readonly [kind: string, name: string, shows: string]> = [
  ["folder", "Trip", "Day 1"],
  ["archive", "bundle.zip", "readme.txt"],
  ["font", "Display.ttf", "IBM Plex Sans"],
  ["image", "garden-gate.jpg", "Canon EOS R6"],
  ["pdf", "Guide.pdf", "Pages"],
  ["image-landscape", "harbour.jpg", "Sony ILCE-7M3"],
  ["audio", "Interlude.mp3", "Artist"],
  ["image-exif", "lisbon-tram.jpg", "1/250 s · f/2.8 · ISO 160 · 23 mm"],
  ["video", "Lookout.mp4", "Duration"],
  ["code", "main.ts", "Lines"],
  ["document", "Minutes.odt", "Quarterly notes"],
  ["text", "notes.txt", "Call the plumber"],
  ["markdown", "README.md", "Field trip"],
  ["image-rotated", "tower-portrait.jpg", "400 × 600 pixels"],
];

async function seed(home: string): Promise<string> {
  const folder = path.join(home, "Mixed");
  await fs.mkdir(path.join(folder, "Trip", "Day 1"), { recursive: true });
  await fs.writeFile(path.join(folder, "Trip", "plan.txt"), "Meet at 7");
  await fs.writeFile(path.join(folder, "Trip", "Day 1", "route.gpx"), "<gpx/>".repeat(400));
  const copy = (from: string, name: string) => fs.copyFile(from, path.join(folder, name));
  for (const photo of ["garden-gate.jpg", "harbour.jpg", "lisbon-tram.jpg", "tower-portrait.jpg"])
    await copy(path.join(here, "fixtures", photo), photo);
  await copy(path.join(formats, "bundle.zip"), "bundle.zip");
  await copy(font, "Display.ttf");
  await copy(path.join(formats, "pdf-quartz-text.pdf"), "Guide.pdf");
  await copy(path.join(formats, "media-cbr.mp3"), "Interlude.mp3");
  await copy(path.join(formats, "media.mp4"), "Lookout.mp4");
  await copy(path.join(formats, "notes.odt"), "Minutes.odt");
  await fs.writeFile(path.join(folder, "main.ts"), SOURCE);
  await fs.writeFile(path.join(folder, "notes.txt"), "Shopping: tea, bread\nCall the plumber\n");
  await fs.writeFile(path.join(folder, "README.md"), README);
  return folder;
}

const VARIANTS = [
  { scheme: "dark", scale: 1, width: 1100, height: 760 },
  { scheme: "light", scale: 1, width: 1100, height: 760 },
  { scheme: "dark", scale: 1.5, width: 1500, height: 1080 },
  { scheme: "light", scale: 1.5, width: 1500, height: 1080 },
  // The narrowest window: the stage sits above the details.
  { scheme: "dark", scale: 1, width: 640, height: 650 },
] as const;

const shot = async (files: FilesHarness, name: string) => {
  if (output) await files.capture(path.join(output, `${name}.png`));
};

await withHome(async (home) => {
  const folder = await seed(home);
  for (const variant of output ? VARIANTS : VARIANTS.slice(0, 1)) {
    const tag = `${variant.scheme}-scale${variant.scale}${variant.width < 1000 ? "-narrow" : ""}`;
    const files = await openFiles({ initialPath: folder, ...variant });
    try {
      const first = path.join(folder, KINDS[0]![1]);
      await files.until(() => files.hits().some((hit) => hit.focusId === entryId(first)), "lists");
      files.click(files.center(entryId(first)));
      files.key(57, " ");
      for (const [index, [kind, name, shows]] of KINDS.entries()) {
        if (index > 0) files.key(106, "ArrowRight");
        await files.until(
          () => files.texts().includes(`${index + 1} of ${KINDS.length}`),
          `pages to ${name}`,
        );
        await files.until(
          () => files.texts().some((text) => text.includes(shows)),
          `the ${kind} preview of ${name} shows “${shows}”`,
        );
        if (kind === "folder")
          await files.until(
            () => files.texts().some((text) => text.endsWith("in 2 files")),
            "the folder's size is counted",
          );
        if (kind === "audio") {
          // Play starts mpv; without it the preview says so and stays usable.
          files.click(files.center("preview:play"));
          await files.until(
            () => files.texts().some((text) => /mpv|Starting…|\d:\d\d \/ \d:\d\d/.test(text)),
            "play reports its state",
          );
        }
        // Thumbnails arrive from the workers a few frames later.
        await files.settle(40);
        await shot(files, `preview-${kind}-${tag}`);
      }
      files.key(1, "Escape");
      await files.until(() => !files.texts().includes(`1 of ${KINDS.length}`), "Escape closes");
    } finally {
      files.close();
    }
    if (!output && variant !== VARIANTS[0]) continue;
    // A grid of photos, and Home's Recent strip, with real JPEG thumbnails.
    const grid = await openFiles({ initialPath: folder, view: "grid", ...variant });
    try {
      await grid.until(() => grid.texts().includes("garden-gate.jpg"), "the grid lists");
      await grid.settle(60);
      await shot(grid, `grid-${tag}`);
    } finally {
      grid.close();
    }
    // Columns: the pane after the last column previews the selection (narrow windows have no
    // room for it); search's best match says what the file holds.
    if (variant.width < 1000) continue;
    const columns = await openFiles({ initialPath: folder, view: "columns", ...variant });
    try {
      const pdf = path.join(folder, "Guide.pdf");
      await columns.until(
        () => columns.hits().some((hit) => hit.focusId === entryId(pdf)),
        "columns list",
      );
      columns.click(columns.center(entryId(pdf)));
      await columns.until(
        () => columns.texts().includes("Pages"),
        "the pane shows the PDF's facts",
      );
      await columns.settle(40);
      await shot(columns, `columns-pdf-${tag}`);
      columns.click(columns.center(entryId(path.join(folder, "main.ts"))));
      await columns.until(() => columns.texts().includes("Lines"), "the pane shows source facts");
      await columns.settle(20);
      await shot(columns, `columns-code-${tag}`);
      columns.type("garden");
      await columns.until(
        () => columns.texts().includes("360 × 360 · Canon EOS R6"),
        "the best match summarises the photo",
      );
      await columns.settle(40);
      await shot(columns, `search-best-match-${tag}`);
    } finally {
      columns.close();
    }
  }
  const recent = path.join(home, ".local", "state", "moire", "recent");
  await fs.mkdir(recent, { recursive: true });
  await fs.writeFile(
    path.join(recent, "org.moire.ImageViewer.json"),
    JSON.stringify(
      ["tower-portrait.jpg", "garden-gate.jpg", "lisbon-tram.jpg", "harbour.jpg", "Guide.pdf"].map(
        (name) => path.join(folder, name),
      ),
    ),
  );
  for (const variant of output ? VARIANTS : VARIANTS.slice(0, 1)) {
    const overview = await openFiles({ initialPath: home, ...variant, indexClient: null });
    try {
      await overview.until(() => overview.texts().includes("Recent"), "Home shows Recent");
      await overview.settle(60);
      await shot(
        overview,
        `home-recent-${variant.scheme}-scale${variant.scale}${variant.width < 1000 ? "-narrow" : ""}`,
      );
    } finally {
      overview.close();
    }
  }
  console.log(
    `[files/preview-kinds] ${KINDS.length} kinds previewed by Space with their details, play state, grid and Recent thumbnails${output ? `; PNGs in ${output}` : ""}`,
  );
});
