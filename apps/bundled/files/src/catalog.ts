import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Entry } from "./filesystem";

type CatalogRecord = { tags: string[] };
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
  }
  tags(file: string): readonly string[] {
    return this.records.get(path.resolve(file))?.tags ?? [];
  }
  allTags(): string[] {
    return [...new Set([...this.records.values()].flatMap((record) => record.tags))].sort((a, b) =>
      a.localeCompare(b),
    );
  }
  count(tag: string): number {
    return [...this.records.values()].filter((record) => record.tags.includes(tag)).length;
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
  async entries(tag: string): Promise<Entry[]> {
    const entries: Entry[] = [];
    for (const [file, record] of this.records) {
      if (!record.tags.includes(tag)) continue;
      try {
        const stat = await fs.stat(file);
        entries.push({
          name: path.basename(file),
          path: file,
          isDir: stat.isDirectory(),
          size: stat.size,
          modified: stat.mtimeMs,
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return entries;
  }
  private mutate(change: (records: Map<string, CatalogRecord>) => void): Promise<void> {
    const write = this.pending
      .catch(() => {})
      .then(async () => {
        const next = new Map(
          [...this.records].map(([file, record]) => [file, { tags: [...record.tags] }]),
        );
        change(next);
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const temporary = `${this.file}.${randomUUID()}.tmp`;
        try {
          await fs.writeFile(
            temporary,
            JSON.stringify({
              version: 1,
              records: [...next].map(([file, record]) => ({ path: file, ...record })),
            }),
            { flag: "wx", mode: 0o600 },
          );
          await fs.rename(temporary, this.file);
          this.records = next;
        } finally {
          await fs.rm(temporary, { force: true });
        }
      });
    this.pending = write;
    return write;
  }
}
