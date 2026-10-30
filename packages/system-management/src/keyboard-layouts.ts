/**
 * The keyboard layouts XKB can compile, read from xkeyboard-config's rules files as data
 * (`rules/evdev.xml`, else `rules/evdev.lst` / `base.lst`). Hosts without xkeyboard-config
 * (macOS development) get a short built-in list of common layouts.
 */
import fs from "node:fs";
import path from "node:path";

export type KeyboardLayoutVariant = {
  /** XKB variant name, such as `nodeadkeys`. */
  name: string;
  description: string;
  /** Short indicator label (`de`), when xkeyboard-config gives one. */
  shortDescription: string;
  /** ISO 639-2 codes. */
  languages: string[];
};

export type KeyboardLayoutInfo = {
  /** XKB layout name, such as `de`. */
  name: string;
  description: string;
  shortDescription: string;
  languages: string[];
  variants: KeyboardLayoutVariant[];
};

export type KeyboardLayoutCatalog = {
  source: "evdev.xml" | "lst" | "fallback";
  /** The file read, or null for the built-in list. */
  path: string | null;
  /** Sorted by description. */
  layouts: KeyboardLayoutInfo[];
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Older files mark translatable fields `<_description>`. */
function tag(block: string, name: string): string {
  const match = new RegExp(`<_?${name}>([\\s\\S]*?)</_?${name}>`).exec(block);
  return match ? decodeXml(match[1]!.trim()) : "";
}

function languages(block: string): string[] {
  return [...block.matchAll(/<iso639Id>([^<]*)<\/iso639Id>/g)].map((m) => m[1]!.trim());
}

function byDescription<T extends { description: string; name: string }>(a: T, b: T): number {
  return a.description.localeCompare(b.description) || a.name.localeCompare(b.name);
}

export function parseEvdevXml(text: string): KeyboardLayoutInfo[] {
  const source = text.replace(/<!--[\s\S]*?-->/g, "");
  const list = /<layoutList>([\s\S]*?)<\/layoutList>/.exec(source)?.[1] ?? "";
  const layouts: KeyboardLayoutInfo[] = [];
  for (const [, block] of list.matchAll(/<layout>([\s\S]*?)<\/layout>/g)) {
    const split = block!.indexOf("<variantList>");
    const head = split >= 0 ? block!.slice(0, split) : block!;
    const name = tag(head, "name");
    if (!name) continue;
    const variants: KeyboardLayoutVariant[] = [];
    if (split >= 0)
      for (const [, item] of block!.slice(split).matchAll(/<variant>([\s\S]*?)<\/variant>/g)) {
        const variant = tag(item!, "name");
        if (!variant) continue;
        variants.push({
          name: variant,
          description: tag(item!, "description") || `${name} (${variant})`,
          shortDescription: tag(item!, "shortDescription"),
          languages: languages(item!),
        });
      }
    layouts.push({
      name,
      description: tag(head, "description") || name,
      shortDescription: tag(head, "shortDescription"),
      languages: languages(head),
      variants: variants.sort(byDescription),
    });
  }
  return layouts.sort(byDescription);
}

/** `! layout` lines are `name description`; `! variant` lines are `name layout: description`. */
export function parseRulesLst(text: string): KeyboardLayoutInfo[] {
  const layouts = new Map<string, KeyboardLayoutInfo>();
  const variants: { layout: string; variant: KeyboardLayoutVariant }[] = [];
  let section = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("!")) {
      section = line.slice(1).trim();
      continue;
    }
    const match = /^(\S+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const [, name, rest] = match;
    if (section === "layout")
      layouts.set(name!, {
        name: name!,
        description: rest!.trim(),
        shortDescription: "",
        languages: [],
        variants: [],
      });
    else if (section === "variant") {
      const v = /^(\S+):\s*(.*)$/.exec(rest!.trim());
      if (v)
        variants.push({
          layout: v[1]!,
          variant: { name: name!, description: v[2]!, shortDescription: "", languages: [] },
        });
    }
  }
  for (const { layout, variant } of variants) layouts.get(layout)?.variants.push(variant);
  return [...layouts.values()]
    .map((layout) => ({ ...layout, variants: layout.variants.sort(byDescription) }))
    .sort(byDescription);
}

/** Candidate xkeyboard-config roots, most specific first. */
export function xkbConfigRootCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  return [
    env.MOIRE_XKB_CONFIG_ROOT,
    env.XKB_CONFIG_ROOT,
    "/run/current-system/sw/share/X11/xkb",
    "/etc/X11/xkb",
    "/usr/share/X11/xkb",
    "/usr/local/share/X11/xkb",
    "/opt/X11/share/X11/xkb",
    "/opt/homebrew/share/X11/xkb",
  ].filter((root): root is string => typeof root === "string" && root.length > 0);
}

export type CatalogFileIo = {
  exists(file: string): boolean;
  read(file: string): string;
};

const nodeCatalogIo: CatalogFileIo = {
  exists: (file) => fs.existsSync(file),
  read: (file) => fs.readFileSync(file, "utf8"),
};

export function loadKeyboardLayoutCatalog(
  roots: readonly string[] = xkbConfigRootCandidates(),
  io: CatalogFileIo = nodeCatalogIo,
): KeyboardLayoutCatalog {
  for (const root of roots) {
    for (const [file, source, parse] of [
      ["rules/evdev.xml", "evdev.xml", parseEvdevXml],
      ["rules/base.xml", "evdev.xml", parseEvdevXml],
      ["rules/evdev.lst", "lst", parseRulesLst],
      ["rules/base.lst", "lst", parseRulesLst],
    ] as const) {
      const full = path.join(root, file);
      try {
        if (!io.exists(full)) continue;
        const layouts = parse(io.read(full));
        if (layouts.length > 0) return { source, path: full, layouts };
      } catch {
        // An unreadable or malformed file falls through to the next candidate.
      }
    }
  }
  return { source: "fallback", path: null, layouts: FALLBACK_LAYOUTS };
}

function layout(
  name: string,
  description: string,
  shortDescription: string,
  language: string,
  variants: [string, string][] = [],
): KeyboardLayoutInfo {
  return {
    name,
    description,
    shortDescription,
    languages: [language],
    variants: variants
      .map(([variant, text]) => ({
        name: variant,
        description: text,
        shortDescription,
        languages: [language],
      }))
      .sort(byDescription),
  };
}

/** Common xkeyboard-config layouts, names and descriptions as upstream spells them. */
export const FALLBACK_LAYOUTS: KeyboardLayoutInfo[] = [
  layout("ara", "Arabic", "ar", "ara"),
  layout("cn", "Chinese", "zh", "chi"),
  layout("cz", "Czech", "cs", "cze"),
  layout("dk", "Danish", "da", "dan"),
  layout("nl", "Dutch", "nl", "dut"),
  layout("us", "English (US)", "en", "eng", [
    ["colemak", "English (Colemak)"],
    ["dvorak", "English (Dvorak)"],
    ["altgr-intl", "English (intl., with AltGr dead keys)"],
    ["intl", "English (US, intl., with dead keys)"],
  ]),
  layout("gb", "English (UK)", "en", "eng", [
    ["dvorak", "English (UK, Dvorak)"],
    ["extd", "English (UK, extended, with Win keys)"],
  ]),
  layout("fi", "Finnish", "fi", "fin"),
  layout("fr", "French", "fr", "fra", [
    ["oss", "French (alt.)"],
    ["bepo", "French (BEPO)"],
  ]),
  layout("de", "German", "de", "ger", [
    ["neo", "German (Neo 2)"],
    ["nodeadkeys", "German (no dead keys)"],
  ]),
  layout("ch", "German (Switzerland)", "de", "ger", [["fr", "French (Switzerland)"]]),
  layout("gr", "Greek", "gr", "gre"),
  layout("il", "Hebrew", "he", "heb"),
  layout("hu", "Hungarian", "hu", "hun"),
  layout("it", "Italian", "it", "ita"),
  layout("jp", "Japanese", "ja", "jpn"),
  layout("kr", "Korean", "ko", "kor"),
  layout("no", "Norwegian", "no", "nor"),
  layout("pl", "Polish", "pl", "pol"),
  layout("pt", "Portuguese", "pt", "por"),
  layout("br", "Portuguese (Brazil)", "pt", "por"),
  layout("ru", "Russian", "ru", "rus"),
  layout("es", "Spanish", "es", "spa"),
  layout("se", "Swedish", "sv", "swe"),
  layout("tr", "Turkish", "tr", "tur"),
  layout("ua", "Ukrainian", "uk", "ukr"),
].sort(byDescription);
