/** A folder with one item of every kind the inspector draws, for the inspector smokes. */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const formats = path.join(repo, "packages/file-formats/src/fixtures");
const fonts = path.join(repo, "packages/ui/fonts");

const README = `# Field trip

Notes for the **spring** field trip, with a \`checklist\` and links to [the map](https://example.org).

## Packing

- Boots and a rain jacket
- Water, 2 litres
- [x] Permits printed

> Leave the gate as you found it.
`;

const SOURCE = `/** Shortest route between two stops. */
export function route(from: Stop, to: Stop): Stop[] {
  const seen = new Set<string>([from.id]); // visited
  const queue: Stop[][] = [[from]];
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (path.at(-1) === to) return path;
    for (const next of path.at(-1)!.links)
      if (!seen.has(next.id)) queue.push([...path, next]);
  }
  return [];
}

export type Stop = { id: string; name: string; links: Stop[] };
`;

/** `<home>/Mixed`, holding a photo, a track, a clip, a PDF, code, Markdown, a font family,
 * an archive, an office document and a "Trip" folder of pictures. */
export async function seedMixed(home: string): Promise<string> {
  const folder = path.join(home, "Mixed");
  const trip = path.join(folder, "Trip");
  await fs.mkdir(path.join(trip, "Day 1"), { recursive: true });
  for (const photo of ["garden-gate.jpg", "harbour.jpg", "lisbon-tram.jpg", "tower-portrait.jpg"]) {
    await fs.copyFile(path.join(here, "fixtures", photo), path.join(folder, photo));
    await fs.copyFile(path.join(here, "fixtures", photo), path.join(trip, photo));
  }
  await fs.copyFile(
    path.join(formats, "pdf-quartz-two-pages.pdf"),
    path.join(trip, "Itinerary.pdf"),
  );
  await fs.copyFile(path.join(formats, "media.mp4"), path.join(trip, "Ferry.mp4"));
  await fs.writeFile(path.join(trip, "plan.txt"), "Meet at 7\n");
  await fs.writeFile(path.join(trip, "Day 1", "route.gpx"), "<gpx/>".repeat(400));
  await fs.copyFile(path.join(formats, "bundle.zip"), path.join(folder, "bundle.zip"));
  await fs.copyFile(path.join(fonts, "IBMPlexSans-Regular.ttf"), path.join(folder, "Display.ttf"));
  await fs.copyFile(
    path.join(fonts, "IBMPlexSans-Medium.ttf"),
    path.join(folder, "Display-Medium.ttf"),
  );
  await fs.copyFile(
    path.join(fonts, "IBMPlexSans-Bold.ttf"),
    path.join(folder, "Display-Bold.ttf"),
  );
  await fs.copyFile(path.join(formats, "pdf-quartz-two-pages.pdf"), path.join(folder, "Guide.pdf"));
  await fs.copyFile(path.join(formats, "media-cbr.mp3"), path.join(folder, "Interlude.mp3"));
  await fs.copyFile(path.join(formats, "media.mp4"), path.join(folder, "Lookout.mp4"));
  await fs.copyFile(path.join(formats, "notes.odt"), path.join(folder, "Minutes.odt"));
  await fs.writeFile(path.join(folder, "main.ts"), SOURCE);
  await fs.writeFile(path.join(folder, "README.md"), README);
  return folder;
}
