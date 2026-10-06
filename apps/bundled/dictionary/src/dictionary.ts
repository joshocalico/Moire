import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
export type Definition = { partOfSpeech: string; definition: string; example: string };
export type DictionaryEntry = { word: string; phonetic: string; definitions: Definition[] };
export type LookupResult = { entry: DictionaryEntry; source: "cache" | "online"; cached: boolean };
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export function parseDefinitions(value: unknown): DictionaryEntry {
  if (
    !Array.isArray(value) ||
    !record(value[0]) ||
    typeof value[0].word !== "string" ||
    !Array.isArray(value[0].meanings)
  )
    throw new Error("The dictionary returned an unreadable entry.");
  const entry = value[0];
  const word = entry.word;
  const meanings = entry.meanings;
  if (typeof word !== "string" || !Array.isArray(meanings))
    throw new Error("The dictionary returned an unreadable entry.");
  const definitions: Definition[] = [];
  for (const meaning of meanings) {
    if (!record(meaning) || !Array.isArray(meaning.definitions)) continue;
    for (const definition of meaning.definitions) {
      if (record(definition) && typeof definition.definition === "string")
        definitions.push({
          partOfSpeech: typeof meaning.partOfSpeech === "string" ? meaning.partOfSpeech : "",
          definition: definition.definition,
          example: typeof definition.example === "string" ? definition.example : "",
        });
    }
  }
  if (!definitions.length) throw new Error("No definitions are available for this word.");
  return {
    word,
    phonetic: typeof entry.phonetic === "string" ? entry.phonetic : "",
    definitions: definitions.slice(0, 40),
  };
}
export class DictionaryService {
  constructor(
    readonly directory = path.join(
      process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
      "moire",
      "dictionary",
    ),
    readonly fetcher: typeof fetch = fetch,
  ) {}
  async lookup(input: string, signal?: AbortSignal): Promise<LookupResult> {
    const word = input.trim().toLocaleLowerCase();
    if (!/^[a-z][a-z '-]{0,79}$/.test(word)) throw new Error("Enter an English word or phrase.");
    const file = path.join(
      this.directory,
      `${createHash("sha256").update(word).digest("hex")}.json`,
    );
    try {
      const content = await fs.readFile(file, "utf8");
      if (content.length < 512 * 1024)
        return { entry: parseDefinitions(JSON.parse(content)), source: "cache", cached: true };
    } catch {
      /* A missing or corrupt cache can be replaced by a successful lookup. */
    }
    let response: Response;
    try {
      response = await this.fetcher(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
        {
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
            : AbortSignal.timeout(8000),
        },
      );
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new Error(
        "Dictionary is unavailable. Connect to the internet; saved words remain available offline.",
      );
    }
    if (response.status === 404)
      throw new Error(`No definition found for “${word}”. Check the spelling.`);
    if (!response.ok) throw new Error("The dictionary service is unavailable. Try again later.");
    const content = await response.text();
    if (content.length > 512 * 1024) throw new Error("The dictionary entry is too large.");
    const entry = parseDefinitions(JSON.parse(content));
    let cached = false;
    const temporary = path.join(this.directory, `.entry-${randomUUID()}.tmp`);
    try {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      await fs.writeFile(temporary, content, { mode: 0o600, flag: "wx" });
      await fs.rename(temporary, file);
      cached = true;
    } catch {
      /* The online definition remains useful when local storage is unavailable. */
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => {});
    }
    return { entry, source: "online", cached };
  }
}
