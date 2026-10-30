/** Apps & Defaults: which app opens each kind of file, and every installed app. */
import React from "react";
import { Button, applicationIcon, getUiScaleFactor, type SettingRowSpec } from "@moire/ui";
import { buildDesktopExec, type DesktopEntry } from "@moire/app-discovery";
import { DEFAULT_KINDS, type DefaultKind } from "#settings/apps-state";
import type { PageContext } from "#settings/context";
import type { PageContent } from "#settings/model";
import { section, selectRow } from "#settings-view/rows";

const PAGE = "apps";
const KIND_LABELS: Record<DefaultKind, string> = {
  web: "Web browser",
  mail: "Mail",
  text: "Text",
  images: "Images",
  music: "Music",
  video: "Video",
  pdf: "PDF documents",
  archives: "Archives",
};

function open(context: PageContext, app: DesktopEntry) {
  context.attempt(PAGE, () =>
    context
      .launch("/bin/sh", ["-c", buildDesktopExec(app, [])])
      .then(() => null)
      .catch(
        (error: unknown) =>
          `Couldn't open ${app.name}: ${error instanceof Error ? error.message : String(error)}`,
      ),
  );
}

function appRow(context: PageContext, app: DesktopEntry): SettingRowSpec {
  const ui = getUiScaleFactor();
  return {
    id: `app:${app.id}`,
    label: app.name,
    description: app.comment ?? app.genericName,
    icon: applicationIcon(app.id),
    tint: 0xff2fbfb3,
    height: 52,
    control: { kind: "compact", width: 1, render: () => null },
    revealControl: {
      kind: "compact",
      width: 76,
      render: (_width, reveal) => (
        <Button
          width={76 * ui}
          height={30 * ui}
          label="Open"
          focusId={`apps:open:${app.id}`}
          onHoverChange={reveal.onHoverChange}
          onFocusChange={reveal.onFocusChange}
          onPress={() => open(context, app)}
        />
      ),
    },
  };
}

export function appsPage(context: PageContext): PageContent {
  const catalog = context.apps.catalog;
  if (catalog.kind !== "ready")
    return {
      summary: "Default apps and installed apps",
      sections: [],
      empty:
        catalog.kind === "error"
          ? { icon: "apps", title: "Apps couldn't be read", message: catalog.message }
          : { icon: "apps", title: "Looking for apps…", message: "Reading the installed apps" },
    };
  const viewport = { width: context.width, height: context.height };
  const defaults = DEFAULT_KINDS.flatMap((kind) => {
    const choices = catalog.choices[kind.id];
    if (!choices.length) return [];
    return [
      selectRow(
        `apps.${kind.id}`,
        viewport,
        choices[0]!.id,
        choices.map((app) => ({ id: app.id, label: app.name })),
        (id) => {
          const result = context.apps.setDefault(kind.id, id);
          context.report(PAGE, result.ok ? null : result.message);
        },
        { label: KIND_LABELS[kind.id] },
      ),
    ];
  });
  return {
    summary: `${catalog.apps.length} apps installed`,
    sections: [
      section("apps.defaults", "Default apps", defaults),
      section("apps.installed", "Installed apps", [
        {
          id: "apps.running",
          label: "Running apps…",
          description: "See and stop what's running in Process Manager",
          chevron: true,
          onPress: () =>
            context.attempt(PAGE, () => context.launch("moire-process-manager").then(() => null)),
        },
        ...catalog.apps.map((app) => appRow(context, app)),
      ]),
    ],
  };
}
