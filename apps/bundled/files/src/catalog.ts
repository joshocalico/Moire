import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Preview } from "./preview/model";

type CatalogRecord = { tags: string[] };

/** Tag colours (ARGB): blue, green, orange, pink, violet, amber. */
export const TAG_COLOURS: readonly number[] = [
  0xff6aa6f0, 0xff4fbf8a, 0xffe39a6a, 0xffe0709b, 0xff8b7cf6, 0xffd9a441,
];

/** A tag without a chosen colour always gets the same one, from its name (FNV-1a). */
function defaultColour(tag: string): number {
  let hash = 0x811c9dc5;
  for (const char of tag.toLowerCase()) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return TAG_COLOURS[hash % TAG_COLOURS.length]!;
}

const isColour = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
export function parseTags(value: string): string[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((tag) => tag.trim().slice(0, 40))
        .filter(Boolean),
    ),
  ].slice(0, 24);
}
/** One catalog owner per Files process; writes are serialized and atomic. */
export class FileCatalog {
  private records = new Map<string, CatalogRecord>();
  private colours = new Map<string, number>();
  private pending: Promise<void> = Promise.resolve();
  constructor(
    private readonly file = path.join(
      process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
      "moire",
      "files-tags.json",
    ),
  ) {}
  async load(): Promise<void> {
    let text: string;
    try {
      text = await fs.readFile(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const stored = JSON.parse(text);
    if (stored.version !== 1 || !Array.isArray(stored.records))
      throw new Error("The saved tag catalog is invalid. It has been preserved.");
    for (const record of stored.records) {
      if (
        typeof record.path !== "string" ||
        !path.isAbsolute(record.path) ||
        !Array.isArray(record.tags) ||
        !record.tags.every((tag: unknown) => typeof tag === "string")
      )
        continue;
      this.records.set(record.path, { tags: parseTags(record.tags.join(",")) });
    }
    // Optional since the first catalogs: files without colours load as before.
    if (stored.colours && typeof stored.colours === "object" && !Array.isArray(stored.colours))
      for (const [tag, colour] of Object.entries(stored.colours as Record<string, unknown>))
        if (isColour(colour)) this.colours.set(tag, colour);
  }
  /** The tag's chosen colour, else a stable one from `TAG_COLOURS`. */
  colourOf(tag: string): number {
    return this.colours.get(tag) ?? defaultColour(tag);
  }
  async setColour(tag: string, colour: number): Promise<void> {
    if (!isColour(colour)) throw new Error("Choose a colour for the tag.");
    await this.mutate((_records, colours) => colours.set(tag, colour));
  }
  tags(file: string): readonly string[] {
    return this.records.get(path.resolve(file))?.tags ?? [];
  }
  allTags(): string[] {
    return [...new Set([...this.records.values()].flatMap((record) => record.tags))].sort((a, b) =>
      a.localeCompare(b),
    );
  }
  async update(
    files: readonly string[],
    tags: readonly string[],
    mode: "add" | "remove",
  ): Promise<void> {
    await this.mutate((records) => {
      for (const file of files) {
        const key = path.resolve(file);
        const previous = records.get(key)?.tags ?? [];
        const next =
          mode === "add"
            ? [...new Set([...previous, ...tags])].slice(0, 24)
            : previous.filter((tag) => !tags.includes(tag));
        if (next.length) records.set(key, { tags: next });
        else records.delete(key);
      }
    });
  }
  async relocate(source: string, destination: string, copy = false): Promise<void> {
    const prefix = path.resolve(source);
    if (
      ![...this.records.keys()].some(
        (file) => file === prefix || file.startsWith(prefix + path.sep),
      )
    )
      return;
    try {
      await this.mutate((records) => {
        for (const [file, record] of [...records]) {
          if (file !== prefix && !file.startsWith(prefix + path.sep)) continue;
          records.set(path.resolve(destination) + file.slice(prefix.length), {
            tags: [...record.tags],
          });
          if (!copy) records.delete(file);
        }
      });
    } catch {
      throw new Error(
        `The file operation completed, but its tags could not be saved. The original tag catalog was preserved. New location: ${destination}`,
      );
    }
  }
  private mutate(
    change: (records: Map<string, CatalogRecord>, colours: Map<string, number>) => void,
  ): Promise<void> {
    const write = this.pending
      .catch(() => {})
      .then(async () => {
        const next = new Map(
          [...this.records].map(([file, record]) => [file, { tags: [...record.tags] }]),
        );
        const colours = new Map(this.colours);
        change(next, colours);
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const temporary = `${this.file}.${randomUUID()}.tmp`;
        try {
          await fs.writeFile(
            temporary,
            JSON.stringify({
              version: 1,
              records: [...next].map(([file, record]) => ({ path: file, ...record })),
              ...(colours.size ? { colours: Object.fromEntries(colours) } : {}),
            }),
            { flag: "wx", mode: 0o600 },
          );
          await fs.rename(temporary, this.file);
          this.records = next;
          this.colours = colours;
        } finally {
          await fs.rm(temporary, { force: true });
        }
      });
    this.pending = write;
    return write;
  }
}

/** Folders whose names say nothing about what is inside them. */
const GENERIC_FOLDERS = new Set([
  "desktop",
  "documents",
  "downloads",
  "music",
  "pictures",
  "videos",
  "public",
  "templates",
]);
const MAX_SUGGESTIONS = 3;

/** "FUJIFILM X-T4" → "Fujifilm": a maker's first word, shouting toned down. */
function makerOf(camera: string): string | null {
  const word = camera.trim().split(/\s+/)[0];
  if (!word || /\d/.test(word)) return null;
  return word.length > 3 && word === word.toUpperCase()
    ? word[0] + word.slice(1).toLowerCase()
    : word;
}

const yearIn = (text: string | null | undefined) => text?.match(/\b(19|20)\d{2}\b/)?.[0] ?? null;

/**
 * Up to three tags worth suggesting for one item: from its preview (the year a
 * photo was taken and its camera maker; an album's artist, title and year; a
 * PDF's author; a year in a video's title), then its folder's name unless that
 * is a standard place. Tags already on the item are left out, and a known tag
 * keeps its spelling.
 */
export function tagSuggestions(input: {
  preview: Preview | null;
  path: string;
  existing: readonly string[];
  known?: readonly string[];
}): string[] {
  const { preview } = input;
  const candidates: Array<string | null | undefined> = [];
  switch (preview?.kind) {
    case "image": {
      const taken = preview.exposure?.taken;
      candidates.push(
        taken ? String(new Date(taken).getFullYear()) : null,
        preview.exposure?.camera ? makerOf(preview.exposure.camera) : null,
      );
      break;
    }
    case "audio":
      candidates.push(preview.artist, preview.album, yearIn(preview.year) ?? preview.year);
      break;
    case "pdf":
      candidates.push(preview.author);
      break;
    case "video":
      candidates.push(yearIn(preview.title));
      break;
  }
  const folder = path.dirname(path.resolve(input.path));
  const folderName = path.basename(folder);
  if (folder !== path.parse(folder).root && folder !== os.homedir())
    if (!GENERIC_FOLDERS.has(folderName.toLowerCase())) candidates.push(folderName);

  const known = new Map((input.known ?? []).map((tag) => [tag.toLowerCase(), tag]));
  const taken = new Set(input.existing.map((tag) => tag.toLowerCase()));
  const suggestions: string[] = [];
  for (const candidate of candidates) {
    // Tags are comma-separated, so a suggestion holds none.
    const [tag] = parseTags((candidate ?? "").replace(/,/g, " "));
    if (!tag || taken.has(tag.toLowerCase())) continue;
    taken.add(tag.toLowerCase());
    suggestions.push(known.get(tag.toLowerCase()) ?? tag);
    if (suggestions.length === MAX_SUGGESTIONS) break;
  }
  return suggestions;
}
