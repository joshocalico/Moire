/**
 * Sharing & permissions: what the owner, the group and everyone else may do, each as a
 * segmented control, and whether the file runs as a program. Changes are chmods through the
 * operation queue, so Undo puts the old mode back.
 */
import React, { type ReactNode } from "react";
import {
  Avatar,
  Box,
  Icon,
  SegmentedControl,
  Separator,
  Surface,
  TextBlock,
  Toggle,
  mixColor,
  usePalette,
} from "@moire/ui";
import type { InspectorActions } from "#files/inspector-actions";
import {
  accessOf,
  isExecutable,
  withAccess,
  withExecutable,
  type Access,
  type PermissionClass,
} from "#files/permissions";
import { CARD_HEAD, CARD_PAD, Card, cardHeight, px } from "./cards";
import type { ItemStat } from "./model";

const ROW = 40;
const AVATAR = 24;
const CONTROL = 180;
const TOGGLE_ROW = 40;

type Line = { who: PermissionClass; name: string; role: string };

export function SharingCard(props: {
  y?: number;
  width: number;
  stat: ItemStat;
  owner: string;
  group: string;
  currentUid: number;
  actions: InspectorActions;
}): ReactNode {
  const pal = usePalette();
  const { stat, actions } = props;
  const inner = props.width - px(CARD_PAD * 2);
  const control = Math.min(px(CONTROL), inner - px(110));
  const mine = stat.uid === props.currentUid;
  // Only the owner (or root) may chmod.
  const editable = (mine || props.currentUid === 0) && !actions.inTrash && !actions.busy;
  const lines: Line[] = [
    {
      who: "owner",
      name: mine ? "You" : props.owner,
      role: mine ? `${props.owner} · owner` : "Owner",
    },
    { who: "group", name: props.group, role: "Group" },
    { who: "others", name: "Everyone", role: "Others" },
  ];
  const change = (mode: number) => {
    if (mode !== stat.mode) actions.setPermissions([{ path: stat.path, mode }]);
  };
  const toggleY = px(CARD_HEAD + 2) + lines.length * px(ROW);
  return (
    <Card
      y={props.y}
      width={props.width}
      height={sharingCardHeight(stat.isDir)}
      title="Sharing & permissions"
    >
      {lines.map((line, index) => (
        <Box
          key={line.who}
          x={px(CARD_PAD)}
          y={px(CARD_HEAD + 2) + index * px(ROW)}
          width={inner}
          height={px(34)}
        >
          {line.who === "owner" ? (
            <Avatar y={px(5)} name={props.owner || line.name} size={AVATAR} />
          ) : (
            <Surface
              y={px(5)}
              width={px(AVATAR)}
              height={px(AVATAR)}
              radius={px(AVATAR / 2)}
              fill={mixColor(pal.surface, pal.muted, 0.2)}
            >
              <Icon
                x={px(4)}
                y={px(4)}
                name={line.who === "group" ? "apps" : "network-globe"}
                size={px(16)}
                color={pal.muted}
                symbolic
              />
            </Surface>
          )}
          <TextBlock
            x={px(32)}
            width={inner - control - px(40)}
            height={px(18)}
            text={line.name}
            fontSize={12}
            verticalAlign="center"
            maxLines={1}
            overflow="ellipsis"
          />
          <TextBlock
            x={px(32)}
            y={px(16)}
            width={inner - control - px(40)}
            height={px(16)}
            text={line.role}
            color={pal.muted}
            fontSize={11}
            verticalAlign="center"
            maxLines={1}
            overflow="ellipsis"
          />
          <Box x={inner - control} y={px(3)} width={control} height={px(28)}>
            <AccessControl
              width={control}
              who={line.who}
              value={accessOf(stat.mode, line.who)}
              disabled={!editable}
              onChange={(access) => change(withAccess(stat.mode, line.who, access, stat.isDir))}
            />
          </Box>
        </Box>
      ))}
      {stat.isDir ? null : (
        <>
          <Separator x={px(CARD_PAD)} y={toggleY - px(4)} width={inner} height={1} />
          <TextBlock
            x={px(CARD_PAD)}
            y={toggleY}
            width={inner - px(56)}
            height={px(TOGGLE_ROW - 10)}
            text="Allow running as a program"
            color={editable ? pal.text : pal.muted}
            fontSize={12}
            verticalAlign="center"
            maxLines={1}
            overflow="ellipsis"
          />
          <Toggle
            x={props.width - px(CARD_PAD) - px(40)}
            y={toggleY + px(4)}
            width={px(40)}
            height={px(22)}
            size="small"
            focusId="inspector:executable"
            on={isExecutable(stat.mode)}
            disabled={!editable}
            onChange={(on) => change(withExecutable(stat.mode, on))}
          />
        </>
      )}
    </Card>
  );
}

function AccessControl(props: {
  width: number;
  who: PermissionClass;
  value: Access;
  disabled: boolean;
  onChange(access: Access): void;
}): ReactNode {
  // The owner always reads its own file in this view: None would lock them out.
  const options: Array<{ id: Access; label: string }> =
    props.who === "owner"
      ? [
          { id: "read", label: "Read" },
          { id: "write", label: "Read & write" },
        ]
      : [
          { id: "none", label: "None" },
          { id: "read", label: "Read" },
          { id: "write", label: "Write" },
        ];
  const value = props.who === "owner" && props.value === "none" ? "read" : props.value;
  return (
    <SegmentedControl
      width={props.width}
      height={px(28)}
      size="small"
      options={options.map((option) => ({
        id: `${props.who}:${option.id}`,
        label: option.label,
        disabled: props.disabled,
      }))}
      value={`${props.who}:${value}`}
      onChange={(id) => props.onChange(id.slice(props.who.length + 1) as Access)}
    />
  );
}

export const sharingCardHeight = (isDir: boolean) =>
  cardHeight(px(2) + px(ROW) * 3 + (isDir ? 0 : px(TOGGLE_ROW)) - px(6));
