/**
 * Search results as sections: one per page in sidebar order, each holding the live rows that
 * matched (the real controls from the page) or a link to a matching list. Only settings their
 * page actually builds are offered, so a setting without a backend is never found.
 */
import React from "react";
import { Button, getUiScaleFactor, type SettingRowSpec, type SettingsSectionSpec } from "@moire/ui";
import { pageInfo, type Route, type SettingEntry, type SidebarPageId } from "./catalog";
import type { PageContent } from "./model";
import { countsByPage, groupHits, searchSettings, type SearchGroup } from "./search-settings";

/** The row a setting is on its page, or null when the page doesn't build it now. */
export function findRow(content: PageContent, id: string): SettingRowSpec | null {
  for (const row of content.searchRows ?? []) if (row.id === id) return row;
  for (const section of content.sections)
    for (const row of section.rows) if (row.id === id) return row;
  return null;
}

/** Whether a page shows a list or card with this id. */
export function hasSection(content: PageContent, id: string): boolean {
  if (content.empty) return false;
  return (
    (content.anchors ?? []).includes(id) ||
    content.sections.some((section) => section.id === id && section.rows.length > 0)
  );
}

export function available(content: PageContent, entry: SettingEntry): boolean {
  if (content.empty) return false;
  return entry.kind === "setting" ? !!findRow(content, entry.id) : hasSection(content, entry.id);
}

export type SearchResults = {
  groups: SearchGroup[];
  counts: Partial<Record<SidebarPageId, number>>;
  sections: SettingsSectionSpec[];
  /** Each result row's id and where Enter takes it, in display order. */
  targets: { rowId: string; route: Route }[];
};

const anchorOf = (entry: SettingEntry) => entry.id.slice(entry.page.length + 1);

export function searchResults(
  query: string,
  content: (page: SidebarPageId) => PageContent,
  go: (route: Route) => void,
  linkColor: number,
): SearchResults {
  const built = new Map<SidebarPageId, PageContent>();
  const contentOf = (page: SidebarPageId) => {
    let found = built.get(page);
    if (!found) {
      found = content(page);
      built.set(page, found);
    }
    return found;
  };
  const hits = searchSettings(query).filter((hit) =>
    available(contentOf(hit.entry.page), hit.entry),
  );
  const groups = groupHits(hits);
  const ui = getUiScaleFactor();
  const targets: SearchResults["targets"] = [];
  const sections = groups.map((group): SettingsSectionSpec => {
    const page = pageInfo(group.page);
    const rows = group.hits.map(({ entry }): SettingRowSpec => {
      const route: Route = { kind: "page", id: entry.page, anchor: anchorOf(entry) };
      targets.push({ rowId: entry.id, route });
      if (entry.kind === "section")
        return {
          id: entry.id,
          label: entry.label,
          description: entry.description,
          chevron: true,
          focusId: `result:${entry.id}`,
          onPress: () => go(route),
        };
      const row = findRow(contentOf(entry.page), entry.id)!;
      return {
        ...row,
        description: row.description ?? entry.description,
        height: Math.max(row.height ?? 0, 54),
      };
    });
    return {
      id: `results:${group.page}`,
      title: page.title,
      titleIcon: page.icon,
      titleTint: page.tint,
      trailingWidth: 110,
      trailing: (
        <Button
          width={104 * ui}
          height={22 * ui}
          size="small"
          variant="ghost"
          label="Open page ›"
          color={linkColor}
          focusId={`results:open:${group.page}`}
          onPress={() => go({ kind: "page", id: group.page })}
        />
      ),
      rows,
    };
  });
  return { groups, counts: countsByPage(groups), sections, targets };
}
