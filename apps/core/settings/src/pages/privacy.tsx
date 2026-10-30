/**
 * Search & Privacy: the file index (its status, the switch, rebuilding and clearing, excluded
 * folders and what is always skipped) and the recent files apps remember.
 */
import React, { useState } from "react";
import { Button, Icon, IconButton, Toggle, getUiScaleFactor, type SettingRowSpec } from "@moire/ui";
import {
  clearRecentFiles,
  countRecentFiles,
  errorText,
  formatTimeAgo,
  tidyPath,
} from "@moire/app-tools";
import { settingEntry } from "#settings/catalog";
import type { PageContext } from "#settings/context";
import type { PageContent } from "#settings/model";
import { buttonRow, infoRow, section } from "#settings-view/rows";
import { searchSummary } from "#settings-view/search";
import { builtInExcludes, formatCount } from "#settings/search-model";
import { IndexStatusHeadline, indexStatusHeight } from "#settings-view/search-status";

const PAGE = "privacy";

/** How many recent files apps remember, and forgetting them all. */
export function useRecentFiles() {
  const [count, setCount] = useState(countRecentFiles);
  return {
    count,
    clear(): string | null {
      try {
        clearRecentFiles();
        setCount(countRecentFiles());
        return null;
      } catch (error) {
        return `Couldn't clear recent files: ${errorText(error)}`;
      }
    },
  };
}
export type RecentFiles = ReturnType<typeof useRecentFiles>;

export function privacyPage(context: PageContext): PageContent {
  const ui = getUiScaleFactor();
  const state = context.search;
  const { summary, prefs } = state;
  const counts = summary.counts;
  const statusRows: SettingRowSpec[] = [
    {
      id: "index-headline",
      label: summary.title,
      control: {
        kind: "block",
        height: indexStatusHeight(summary) / ui,
        render: (width) => <IndexStatusHeadline summary={summary} width={width} />,
      },
    },
    ...(counts
      ? [
          infoRow(
            "files",
            "Files indexed",
            `${formatCount(counts.files)} files · ${formatCount(counts.folders)} folders`,
          ),
          infoRow(
            "text",
            "Text extracted",
            counts.pendingText
              ? `${formatCount(counts.withText)} files · ${formatCount(counts.pendingText)} waiting`
              : `${formatCount(counts.withText)} files`,
          ),
          infoRow(
            "updated",
            "Last updated",
            summary.lastUpdated != null ? formatTimeAgo(summary.lastUpdated) : "Not yet",
          ),
        ]
      : []),
  ];
  const handEdited = state.handEdited;
  const excludeRows: SettingRowSpec[] = [
    ...prefs.excludes.map((entry) => ({
      id: `exclude:${entry}`,
      label: tidyPath(entry),
      icon: "folder" as const,
      tint: 0xff8a94a6,
      control: {
        kind: "compact" as const,
        width: 32,
        render: () => (
          <IconButton
            width={32 * ui}
            height={32 * ui}
            variant="ghost"
            tooltip={`Index ${tidyPath(entry)} again`}
            focusId={`search:remove:${entry}`}
            icon={(style) => <Icon name="close" symbolic {...style} />}
            onPress={() => state.removeExclude(entry)}
          />
        ),
      },
    })),
    ...(handEdited?.exclude ?? []).map((entry) => ({
      id: `file:${entry}`,
      label: tidyPath(entry),
      description: "Set in index.json",
    })),
    {
      id: "add-exclude",
      label:
        prefs.excludes.length || handEdited?.exclude.length
          ? "Exclude another folder"
          : "No folders excluded",
      description: "Their files never appear in search",
      control: {
        kind: "compact",
        width: 120,
        render: () => (
          <Button
            width={120 * ui}
            height={30 * ui}
            label="Add folder…"
            focusId="search:add-exclude"
            onPress={() => state.setDialog("choose-folder")}
          />
        ),
      },
    },
  ];
  const recent = context.recent;
  const failed = /couldn't|could not|can't|isn't|didn't|already|failed/i.test(state.status);
  return {
    summary: searchSummary(state),
    banners: state.status
      ? [
          {
            id: "search-status",
            title: state.status,
            tone: failed ? "warning" : "accent",
            icon: failed ? "help" : "check-circle",
          },
        ]
      : undefined,
    sections: [
      section("privacy.index", "File search", statusRows),
      section(
        "privacy.indexing-section",
        "Indexing",
        [
          {
            id: "privacy.indexing",
            label: settingEntry("privacy.indexing").label,
            description: prefs.enabled
              ? "Find files by name and contents in Files"
              : "Turning this on reads your home folder in the background",
            control: {
              kind: "compact",
              width: 52,
              render: () => (
                <Toggle on={prefs.enabled} focusId="search:enabled" onChange={state.setEnabled} />
              ),
            },
          },
          buttonRow(
            "privacy.rebuild",
            state.busy === "rebuild" ? "Rebuilding…" : "Rebuild",
            state.rebuild,
            {
              disabled: !state.running || state.busy != null,
              width: 112,
            },
          ),
          buttonRow(
            "privacy.clear",
            state.busy === "clear" ? "Clearing…" : "Clear…",
            () => state.setDialog("clear"),
            {
              disabled: !state.running || state.busy != null,
              width: 112,
            },
          ),
        ],
        { footnote: "The index stays in your cache folder on this computer" },
      ),
      section("privacy.excludes", "Excluded folders", excludeRows, {
        footnote: handEdited?.exclude.length
          ? `Entries from ${tidyPath(handEdited.file)} are edited in that file`
          : undefined,
      }),
      section(
        "privacy.always",
        "Always skipped",
        builtInExcludes(state.env, tidyPath).map((entry) => ({
          id: `builtin:${entry.id}`,
          label: entry.label,
          description: entry.detail,
          value: "Always",
        })),
      ),
      section("privacy.recent-section", "Recent files", [
        buttonRow(
          "privacy.recent",
          "Clear list",
          () => context.attempt(PAGE, () => recent.clear()),
          {
            label: "Recent files",
            description: recent.count
              ? `Apps remember ${recent.count} recently opened ${recent.count === 1 ? "file" : "files"}`
              : "Apps remember nothing right now",
            disabled: !recent.count,
            width: 96,
          },
        ),
      ]),
    ],
  };
}
