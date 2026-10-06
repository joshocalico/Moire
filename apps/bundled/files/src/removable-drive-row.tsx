import React, { type ReactNode } from "react";
import { CollectionItem, Horizontal, Icon, IconButton, ListItem } from "@moire/ui";
import type { StorageClientState, StorageVolume } from "@moire/system-management/storage-status";
import { driveCaption, driveOperationBlocked } from "./removable-drives";

/** Fits the existing NavigationSidebar's allocated row; actions are a separate accessible hit. */
export function RemovableDriveRow(props: {
  width: number;
  height: number;
  volume: StorageVolume;
  state: StorageClientState;
  selected: boolean;
  busy: boolean;
  onActivate(): void;
  onActions(): void;
}): ReactNode {
  const actionWidth = 28;
  const operation = props.state.kind === "ready" ? props.state.snapshot.operation : null;
  const pending = operation?.kind === "pending";
  const readonly =
    props.state.kind === "ready" &&
    props.state.snapshot.status.kind === "ready" &&
    props.state.snapshot.status.policy === "readonly";
  const unsupported = props.volume.mount.kind === "unsupported";
  const caption =
    pending && operation.id === props.volume.id
      ? operation.action === "mount"
        ? "Mounting…"
        : operation.action === "unmount"
          ? "Unmounting…"
          : "Ejecting…"
      : `${driveCaption(props.volume)}${readonly && props.volume.mount.kind === "unmounted" ? " · Read-only" : ""}`;
  const disabled =
    props.busy ||
    driveOperationBlocked(props.state, props.volume.id) ||
    unsupported ||
    (readonly && props.volume.mount.kind !== "mounted");
  return (
    <Horizontal width={props.width} height={props.height} gap={0} align="center">
      <CollectionItem
        width={Math.max(0, props.width - actionWidth)}
        height={props.height - 2}
        focusId={`sidebar:drive:${props.volume.id}`}
        disabled={disabled}
        onPress={props.onActivate}
        onContextMenu={props.onActions}
      >
        <ListItem
          size="small"
          width={Math.max(0, props.width - actionWidth)}
          height={props.height - 2}
          title={props.volume.label}
          subtitle={caption}
          selected={props.selected}
          disabled={disabled}
          interactive={false}
          leading={<Icon name="folder" size={18} symbolic />}
        />
      </CollectionItem>
      <IconButton
        width={24}
        height={24}
        variant="ghost"
        focusId={`drive:actions:${props.volume.id}`}
        tooltip={`Drive actions: ${props.volume.label}`}
        icon={<Icon name="more" size={16} symbolic />}
        onPress={props.onActions}
        disabled={props.busy}
      />
    </Horizontal>
  );
}
