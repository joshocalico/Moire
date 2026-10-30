/**
 * Settings search as pure functions: fold text, match a query against each entry's label,
 * words and page, rank the matches, and group them by page in sidebar order.
 */
import { PAGES, SETTINGS, pageInfo, type SettingEntry, type SidebarPageId } from "./catalog";

/** Lower case, accents and punctuation removed, words separated by single spaces. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

/** How well one query word matches one piece of text, 0 for not at all. */
function wordScore(text: string, word: string, prefix: number, start: number, inside: number) {
  if (!text) return 0;
  if (text.startsWith(word)) return prefix;
  if (` ${text}`.includes(` ${word}`)) return start;
  // "wifi" finds "Wi‑Fi": compare with the separators gone.
  if (text.replaceAll(" ", "").includes(word)) return inside;
  return 0;
}

export type SettingHit = { entry: SettingEntry; score: number };

/**
 * Rank one entry: the label first (prefix, then word start), then the other words people use,
 * then the page's title. Every query word must match one of those.
 */
export function scoreEntry(entry: SettingEntry, query: string): number {
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length) return 0;
  const label = fold(entry.label);
  const keywords = entry.keywords.map(fold);
  const page = fold(pageInfo(entry.page).title);
  let total = 0;
  for (const word of words) {
    const best = Math.max(
      wordScore(label, word, 100, 80, 50),
      ...keywords.map((keyword) => wordScore(keyword, word, 60, 55, 30)),
      wordScore(page, word, 30, 25, 15),
    );
    if (!best) return 0;
    total += best;
  }
  // A whole-label match beats a label that merely starts with the words.
  return total + (label === words.join(" ") ? 20 : 0);
}

/** Entries matching the query, best first; ties keep catalog order. */
export function searchSettings(
  query: string,
  entries: readonly SettingEntry[] = SETTINGS,
): SettingHit[] {
  return entries
    .map((entry, index) => ({ entry, score: scoreEntry(entry, query), index }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ entry, score }) => ({ entry, score }));
}

export type SearchGroup = { page: SidebarPageId; hits: SettingHit[] };

/** Hits grouped by page, pages in sidebar order, hits best first within each page. */
export function groupHits(hits: readonly SettingHit[]): SearchGroup[] {
  return PAGES.flatMap((page) => {
    const pageHits = hits.filter((hit) => hit.entry.page === page.id);
    return pageHits.length ? [{ page: page.id, hits: pageHits }] : [];
  });
}

/** Matches per page, for the sidebar's counts. */
export function countsByPage(
  groups: readonly SearchGroup[],
): Partial<Record<SidebarPageId, number>> {
  return Object.fromEntries(groups.map((group) => [group.page, group.hits.length]));
}

/** "7 settings on 4 pages". */
export function resultSummary(groups: readonly SearchGroup[]): string {
  const settings = groups.reduce((sum, group) => sum + group.hits.length, 0);
  if (!settings) return "No settings match";
  const pages = groups.length;
  return `${settings} ${settings === 1 ? "setting" : "settings"} on ${pages} ${pages === 1 ? "page" : "pages"}`;
}

/**
 * The character a key types, when typing it on a page should start a search: one printable,
 * non-space character with no Ctrl, Alt or Meta held. Null for anything else.
 */
export function typedSearchText(event: {
  key?: string;
  text?: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): string | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  const text = event.text ?? (event.key?.length === 1 ? event.key : undefined);
  if (!text || [...text].length !== 1 || !text.trim() || /\p{Cc}/u.test(text)) return null;
  return text;
}
