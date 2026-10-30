/**
 * Desktop & Launcher: desktop icons, and the apps pinned to the top of the launcher (the shell
 * reads `launcherPins` each time the launcher opens, and right-click there pins too).
 */
import React from "react";
import {
  Horizontal,
  Icon,
  IconButton,
  applicationIcon,
  getUiScaleFactor,
  type IconName,
  type SettingRowSpec,
} from "@moire/ui";
import type { DesktopEntry } from "@moire/app-discovery";
import {
  MAX_LAUNCHER_PINS,
  loadLauncherPins,
  moveLauncherPin,
  pinLauncherApp,
  unpinLauncherApp,
} from "@moire/prefs";
import type { PageContext } from "#settings/context";
import type { PageContent } from "#settings/model";
import { linkRow, section, selectRow, toggleRow } from "#settings-view/rows";

const PAGE = "desktop";
const PIN_BUTTON = 30;
const PIN_GAP = 4;

/** The stored pins, read again so a pin made in the launcher meanwhile isn't overwritten. */
function latestPins(context: PageContext): readonly string[] {
  try {
    return loadLauncherPins();
  } catch {
    return context.prefs.values.launcherPins;
  }
}

function changePins(
  context: PageContext,
  change: (pins: readonly string[]) => string[],
  label: string,
) {
  context.prefs.set({ launcherPins: change(latestPins(context)) }, { label, page: PAGE });
}

function pinButton(
  focusId: string,
  icon: IconName,
  tooltip: string,
  disabled: boolean,
  onPress: () => void,
) {
  const ui = getUiScaleFactor();
  return (
    <IconButton
      width={PIN_BUTTON * ui}
      height={PIN_BUTTON * ui}
      variant="ghost"
      focusId={focusId}
      tooltip={tooltip}
      disabled={disabled}
      icon={(style) => <Icon name={icon} size={style.size} color={style.color} />}
      onPress={onPress}
    />
  );
}

function pinRow(
  context: PageContext,
  id: string,
  app: DesktopEntry | undefined,
  index: number,
  count: number,
): SettingRowSpec {
  const ui = getUiScaleFactor();
  const name = app?.name ?? id.replace(/\.desktop$/, "");
  return {
    id: `desktop.pin:${id}`,
    label: name,
    description: app
      ? (app.comment ?? app.genericName ?? "Pinned")
      : "Not installed; it keeps its place if it comes back",
    descriptionTone: app ? "muted" : "danger",
    icon: applicationIcon(id),
    tint: 0xff2fbfb3,
    control: {
      kind: "compact",
      width: PIN_BUTTON * 3 + PIN_GAP * 2,
      render: () => (
        <Horizontal gap={PIN_GAP * ui} align="center">
          {pinButton(`desktop:pin-up:${id}`, "chevron-up", "Move up", index === 0, () =>
            changePins(
              context,
              (pins) => moveLauncherPin(pins, id, -1),
              `${name} moved up in the launcher`,
            ),
          )}
          {pinButton(
            `desktop:pin-down:${id}`,
            "chevron-down",
            "Move down",
            index === count - 1,
            () =>
              changePins(
                context,
                (pins) => moveLauncherPin(pins, id, 1),
                `${name} moved down in the launcher`,
              ),
          )}
          {pinButton(`desktop:unpin:${id}`, "close", "Unpin", false, () =>
            changePins(
              context,
              (pins) => unpinLauncherApp(pins, id),
              `${name} unpinned from the launcher`,
            ),
          )}
        </Horizontal>
      ),
    },
  };
}

export function desktopPage(context: PageContext): PageContent {
  const { values } = context.prefs;
  const pins = values.launcherPins;
  const catalog = context.apps.catalog;
  const installed = catalog.kind === "ready" ? catalog.apps : [];
  const byId = new Map(installed.map((app) => [app.id, app]));
  const unpinned = installed.filter((app) => !pins.includes(app.id));
  const full = pins.length >= MAX_LAUNCHER_PINS;
  const pinned = pins.length === 1 ? "1 pinned app" : `${pins.length} pinned apps`;
  return {
    summary: `${values.showDesktopIcons ? "Desktop icons shown" : "Desktop icons hidden"} · ${pinned}`,
    sections: [
      section("desktop.desktop", "Desktop", [
        toggleRow("desktop.icons", values.showDesktopIcons, (on) =>
          context.prefs.set(
            { showDesktopIcons: on },
            { label: on ? "Desktop icons shown" : "Desktop icons hidden", page: PAGE },
          ),
        ),
        linkRow("desktop.look", () =>
          context.go({ kind: "page", id: "appearance", anchor: "wallpaper" }),
        ),
      ]),
      section(
        "desktop.pins",
        "Launcher",
        [
          ...pins.map((id, index) => pinRow(context, id, byId.get(id), index, pins.length)),
          selectRow(
            "desktop.pin-app",
            { width: context.width, height: context.height },
            null,
            unpinned.map((app) => ({ id: app.id, label: app.name })),
            (id) =>
              changePins(
                context,
                (current) => pinLauncherApp(current, id),
                `${byId.get(id)?.name ?? id} pinned to the launcher`,
              ),
            {
              placeholder: catalog.kind === "loading" ? "Looking for apps…" : "Choose an app…",
              disabled: full || !unpinned.length,
              description: full
                ? `The launcher holds ${MAX_LAUNCHER_PINS} pins; unpin one first`
                : catalog.kind === "error"
                  ? catalog.message
                  : undefined,
            },
          ),
        ],
        {
          footnote: "Pinned apps come first in the launcher. Right-click an app there to pin it.",
        },
      ),
    ],
  };
}
