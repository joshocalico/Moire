/** The window's left edge: places, the user's bookmarks, Trash and removable drives. */
import React, { type ReactNode } from "react";
import {
  Icon,
  IconButton,
  NavigationRail,
  TextBlock,
  getUiScaleFactor,
  mixColor,
  usePalette,
  type HitPointerEvent,
  type NavigationRailItem,
  type NavigationRailSection,
} from "@moire/ui";
import type { StorageClientState, StorageVolume } from "@moire/system-management/storage-status";
import type { FilePlace } from "#files/places";
import { canDriveAction, driveCaption, driveOperationBlocked } from "#files/removable-drives";

export const RECENT_ITEM_ID = "recent";
export const TRASH_ITEM_ID = "trash";
const RAIL_ID_PREFIX = "rail";
export const driveItemId = (volume: StorageVolume) => `drive:${volume.id}`;
const BADGE = 36;
const HEADER = 60;

/** The rail's places in order, for Ctrl+Alt+1–9: Home, Recent, the other places, Trash, bookmarks. */
export function railItemIds(places: readonly FilePlace[]): string[] {
  const [home, ...folders] = places.filter((place) => place.builtIn);
  return [
    ...(home ? [home.id] : []),
    RECENT_ITEM_ID,
    ...folders.map((place) => place.id),
    TRASH_ITEM_ID,
    ...places.filter((place) => !place.builtIn).map((place) => place.id),
  ];
}

/** A drive's status after its name, while something is happening to it. */
function driveLabel(volume: StorageVolume, state: StorageClientState): string {
  const operation = state.kind === "ready" ? state.snapshot.operation : null;
  if (operation?.kind === "pending" && operation.id === volume.id)
    return `${volume.label} · ${operation.action === "mount" ? "Mounting…" : operation.action === "unmount" ? "Unmounting…" : "Ejecting…"}`;
  const readonly =
    state.kind === "ready" &&
    state.snapshot.status.kind === "ready" &&
    state.snapshot.status.policy === "readonly";
  const caption = driveCaption(volume);
  return `${volume.label} · ${caption}${readonly && volume.mount.kind === "unmounted" ? " · Read-only" : ""}`;
}

export function FilesRail(props: {
  height: number;
  expanded: boolean;
  onToggleExpanded(): void;
  places: readonly FilePlace[];
  trashDirectory: string;
  volumes: readonly StorageVolume[];
  driveState: StorageClientState;
  driveBusy: boolean;
  selectedId: string | null;
  onSelect(item: NavigationRailItem): void;
  onContextMenu(item: NavigationRailItem, event: HitPointerEvent): void;
  onEject(volume: StorageVolume): void;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const placeItem = (place: FilePlace): NavigationRailItem => ({
    id: place.id,
    label: place.label,
    icon: place.icon,
    dropData: place.path,
  });
  const builtIn = props.places.filter((place) => place.builtIn);
  const [home, ...folders] = builtIn;
  const bookmarks = props.places.filter((place) => !place.builtIn);
  const sections: NavigationRailSection[] = [
    {
      id: "places",
      label: "Places",
      items: [
        ...(home ? [placeItem(home)] : []),
        { id: RECENT_ITEM_ID, label: "Recent", icon: "history" },
        ...folders.map(placeItem),
        { id: TRASH_ITEM_ID, label: "Trash", icon: "trash", dropData: props.trashDirectory },
      ],
    },
    ...(bookmarks.length
      ? [{ id: "bookmarks", label: "Bookmarks", items: bookmarks.map(placeItem) }]
      : []),
    ...(props.volumes.length
      ? [
          {
            id: "drives",
            label: "Drives",
            placement: "end" as const,
            items: props.volumes.map((volume): NavigationRailItem => {
              const ejectable =
                !props.driveBusy && canDriveAction(props.driveState, volume.id, "eject");
              return {
                id: driveItemId(volume),
                label: driveLabel(volume, props.driveState),
                icon: "disk-usage",
                disabled:
                  props.driveBusy ||
                  driveOperationBlocked(props.driveState, volume.id) ||
                  volume.mount.kind === "unsupported",
                dropData: volume.mount.kind === "mounted" ? volume.mount.paths[0] : undefined,
                action: ejectable
                  ? {
                      icon: "eject",
                      label: `Eject ${volume.label}`,
                      onPress: () => props.onEject(volume),
                    }
                  : undefined,
              };
            }),
          },
        ]
      : []),
  ];
  const badge = Math.round(BADGE * ui);
  return (
    <NavigationRail
      height={props.height}
      expanded={props.expanded}
      idPrefix={RAIL_ID_PREFIX}
      sections={sections}
      selectedId={props.selectedId}
      headerHeight={Math.round(HEADER * ui)}
      header={
        <>
          <IconButton
            x={Math.round(14 * ui)}
            y={Math.round(12 * ui)}
            width={badge}
            height={badge}
            focusId="rail:toggle"
            fill={mixColor(pal.panel, pal.accent, 0.25)}
            tooltip={props.expanded ? "Hide labels · Ctrl+B" : "Show labels · Ctrl+B"}
            tooltipPlacement="right"
            icon={
              <Icon
                name="folder-filled"
                size={Math.round(20 * ui)}
                color={pal.accentLine}
                symbolic
              />
            }
            onPress={props.onToggleExpanded}
          />
          {props.expanded ? (
            <TextBlock
              x={Math.round(60 * ui)}
              y={Math.round(12 * ui)}
              width={Math.round(120 * ui)}
              height={badge}
              text="Files"
              fontSize={15}
              fontWeight="medium"
              verticalAlign="center"
              maxLines={1}
            />
          ) : null}
        </>
      }
      onSelect={props.onSelect}
      onContextMenu={props.onContextMenu}
    />
  );
}
