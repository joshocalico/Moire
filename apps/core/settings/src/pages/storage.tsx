/**
 * Storage & Drives: how full this computer is, the drives the storage service sees with Mount,
 * Unmount and Eject, and which removable drives search reads.
 */
import React from "react";
import {
  Box,
  Button,
  Horizontal,
  ProgressBar,
  TextBlock,
  Toggle,
  getUiScaleFactor,
  type SettingRowSpec,
} from "@moire/ui";
import { formatBytes } from "@moire/app-tools";
import type { StorageAction, StorageVolume } from "@moire/system-management/storage-status";
import type { PageContext } from "#settings/context";
import type { PageContent } from "#settings/model";
import { section } from "#settings-view/rows";

const PAGE = "storage";
const BUTTON = 92;

function volumeDetail(volume: StorageVolume): string {
  const size = volume.sizeBytes != null ? formatBytes(volume.sizeBytes) : null;
  const mount =
    volume.mount.kind === "mounted"
      ? `Mounted at ${volume.mount.paths[0]}`
      : volume.mount.kind === "unmounted"
        ? "Not mounted"
        : volume.mount.message;
  return [size, volume.filesystem || null, mount].filter(Boolean).join(" · ");
}

function driveRow(context: PageContext, volume: StorageVolume): SettingRowSpec {
  const ui = getUiScaleFactor();
  const pending = context.storage.pending;
  const busy = !!pending;
  const actions: { action: StorageAction; label: string }[] = [];
  if (context.storage.interactive) {
    if (volume.mount.kind === "unmounted") actions.push({ action: "mount", label: "Mount" });
    if (volume.mount.kind === "mounted") actions.push({ action: "unmount", label: "Unmount" });
    if (volume.canEject) actions.push({ action: "eject", label: "Eject" });
  }
  const width = actions.length * BUTTON + Math.max(0, actions.length - 1) * 8;
  return {
    id: `drive:${volume.id}`,
    label: volume.label || volume.device,
    description:
      pending?.id === volume.id
        ? `${pending.action[0]!.toUpperCase()}${pending.action.slice(1)}ing…`
        : volumeDetail(volume),
    icon: "disk-usage",
    tint: 0xffe8915a,
    control: actions.length
      ? {
          kind: "compact",
          width,
          render: () => (
            <Horizontal width={width * ui} height={32 * ui} gap={8 * ui} align="center">
              {actions.map(({ action, label }) => (
                <Button
                  key={action}
                  width={BUTTON * ui}
                  height={30 * ui}
                  label={label}
                  disabled={busy}
                  focusId={`storage:${action}:${volume.id}`}
                  onPress={() => context.attempt(PAGE, () => context.storage.act(action, volume))}
                />
              ))}
            </Horizontal>
          ),
        }
      : undefined,
  };
}

export function storagePage(context: PageContext): PageContent {
  const ui = getUiScaleFactor();
  const space = context.storage.space;
  const volumes = context.storage.volumes;
  const drives = context.search.drives;
  const used = space && space.totalBytes ? 1 - space.freeBytes / space.totalBytes : 0;
  const homeRows: SettingRowSpec[] = space
    ? [
        {
          id: "storage.capacity",
          label: "Home",
          control: {
            kind: "block",
            height: 44,
            render: (width) => (
              <Box width={width} height={44 * ui}>
                <TextBlock
                  width={width - 150 * ui}
                  height={18 * ui}
                  text={`${formatBytes(space.freeBytes)} free of ${formatBytes(space.totalBytes)}`}
                  fontSize={13}
                  fontWeight="medium"
                  verticalAlign="center"
                  maxLines={1}
                  overflow="ellipsis"
                />
                <Button
                  x={width - 140 * ui}
                  y={-6 * ui}
                  width={140 * ui}
                  height={30 * ui}
                  label="Open Disk Usage"
                  focusId="storage:disk-usage"
                  onPress={() =>
                    context.attempt(PAGE, () => context.launch("moire-disk-usage").then(() => null))
                  }
                />
                <ProgressBar y={32 * ui} width={width} height={8 * ui} value={used} />
              </Box>
            ),
          },
        },
      ]
    : [];
  return {
    summary: space ? `${formatBytes(space.freeBytes)} free` : "Space and drives",
    sections: [
      section("storage.home", "This computer", homeRows),
      section(
        "storage.drives",
        "Drives",
        context.storage.state?.kind === "ready"
          ? volumes.length
            ? volumes.map((volume) => driveRow(context, volume))
            : [
                {
                  id: "drive:none",
                  label: "No drives connected",
                  description: "USB sticks and disks show here when you plug them in",
                },
              ]
          : [
              {
                id: "drive:unavailable",
                label: "The drive service isn't running",
                description: "Drives can't be mounted from here until it starts",
              },
            ],
      ),
      section(
        "storage.search",
        "Search on drives",
        drives.kind === "ready"
          ? drives.drives.map((drive) => ({
              id: `index:${drive.path}`,
              label: `Index ${drive.label}`,
              description: drive.detail,
              control: {
                kind: "compact" as const,
                width: 52,
                render: () => (
                  <Toggle
                    on={drive.included}
                    focusId={`search:drive:${drive.path}`}
                    onChange={(on) => context.search.setDrive(drive.path, on)}
                  />
                ),
              },
            }))
          : [],
        { footnote: "A drive is indexed only while it's connected" },
      ),
    ],
  };
}
