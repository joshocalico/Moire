/** Desktop feedback drawn in the shell's top layer: operation toasts and confirmations. */
import React, { type ReactNode } from "react";
import { Group, Rect } from "@moire/react-host";
import {
  Button,
  FocusRing,
  Horizontal,
  Icon,
  IconButton,
  Inset,
  Surface,
  TextBlock,
  Vertical,
  getUiScaleFactor,
  themePalette,
} from "@moire/ui";

export type DesktopToast = {
  id: number;
  message: string;
  tone: "info" | "error" | "progress";
  actionLabel?: string;
  onAction?: () => void;
};

const TOAST_W = 420;
const TOAST_H = 48;

export function DesktopToastView(props: {
  toast: DesktopToast;
  screenW: number;
  availH: number;
  onDismiss(): void;
}): ReactNode {
  const pal = themePalette();
  const ui = getUiScaleFactor();
  const width = Math.min(Math.round(TOAST_W * ui), props.screenW - 32);
  const height = Math.round(TOAST_H * ui);
  const action = props.toast.actionLabel ? Math.round(72 * ui) : 0;
  return (
    <Surface
      x={Math.round((props.screenW - width) / 2)}
      y={props.availH - height - 16}
      width={width}
      height={height}
      fill={pal.panel}
      radius={12}
      stroke={props.toast.tone === "error" ? pal.danger : pal.borderSubtle}
      strokeWidth={1}
      elevation="medium"
    >
      <Inset width={width} height={height} padding={{ left: 16 * ui, right: 8 * ui }}>
        <Horizontal gap={8} align="center">
          <TextBlock
            flexGrow={1}
            height={height}
            text={props.toast.message}
            fontSize={13}
            color={props.toast.tone === "error" ? pal.danger : pal.text}
            verticalAlign="center"
            overflow="ellipsis"
            maxLines={1}
          />
          {props.toast.actionLabel ? (
            <Button
              width={action}
              size="small"
              variant="ghost"
              focusId="desktop:toast-action"
              label={props.toast.actionLabel}
              onPress={props.toast.onAction}
            />
          ) : null}
          <IconButton
            width={Math.round(28 * ui)}
            height={Math.round(28 * ui)}
            variant="ghost"
            focusId="desktop:toast-dismiss"
            tooltip="Dismiss"
            icon={<Icon name="close" size={14} symbolic />}
            onPress={props.onDismiss}
          />
        </Horizontal>
      </Inset>
    </Surface>
  );
}

export type DesktopConfirmation = {
  title: string;
  message: string;
  confirmLabel: string;
  /** Which button Enter activates; Cancel first, so a stray Enter never deletes. */
  focus: "cancel" | "confirm";
  onConfirm(): void;
};

const DIALOG_W = 420;
const DIALOG_H = 168;
const BUTTON_W = 112;

export function DesktopConfirmationView(props: {
  confirmation: DesktopConfirmation;
  screenW: number;
  availH: number;
  onCancel(): void;
}): ReactNode {
  const pal = themePalette();
  const ui = getUiScaleFactor();
  const px = (value: number) => Math.round(value * ui);
  const width = Math.min(px(DIALOG_W), props.screenW - 32);
  const dialogH = px(DIALOG_H);
  const buttonW = px(BUTTON_W);
  const buttonH = px(36);
  const x = Math.round((props.screenW - width) / 2);
  const y = Math.round((props.availH - dialogH) / 2);
  const { confirmation } = props;
  const buttonsX = width - px(24) - buttonW * 2 - px(8);
  return (
    <Group x={0} y={0} width={props.screenW} height={props.availH}>
      <Rect
        width={props.screenW}
        height={props.availH}
        fill={pal.overlay}
        onPress={props.onCancel}
        onContextMenu={props.onCancel}
      />
      <Surface
        x={x}
        y={y}
        width={width}
        height={dialogH}
        fill={pal.panel}
        radius={14}
        stroke={pal.borderSubtle}
        strokeWidth={1}
        elevation="high"
        onPress={() => {}}
      >
        <Inset
          width={width}
          height={dialogH - px(64)}
          padding={{ horizontal: px(24), top: px(20) }}
        >
          <Vertical gap={px(8)}>
            <TextBlock
              height={px(24)}
              text={confirmation.title}
              fontSize={17}
              fontWeight="medium"
            />
            <TextBlock
              text={confirmation.message}
              fontSize={13}
              color={pal.muted}
              wrap
              maxLines={3}
              overflow="ellipsis"
            />
          </Vertical>
        </Inset>
        <Group x={buttonsX} y={dialogH - px(52)} width={buttonW * 2 + px(8)} height={buttonH}>
          <Button
            width={buttonW}
            height={buttonH}
            variant="secondary"
            focusId="desktop:confirm-cancel"
            label="Cancel"
            onPress={props.onCancel}
          />
          <Button
            x={buttonW + px(8)}
            width={buttonW}
            height={buttonH}
            variant="danger"
            focusId="desktop:confirm-accept"
            label={confirmation.confirmLabel}
            onPress={confirmation.onConfirm}
          />
          <FocusRing
            x={confirmation.focus === "cancel" ? 0 : buttonW + px(8)}
            width={buttonW}
            height={buttonH}
          />
        </Group>
      </Surface>
    </Group>
  );
}
