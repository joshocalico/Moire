import React, { type ReactNode } from "react";
import { useWidgetTheme, getUiScaleFactor } from "@moire/ui";
import {
  DesktopPopup,
  desktopPopupGeometry,
  NOTIFICATIONS_SCOPE,
  type PopupAnchor,
} from "./QuickSettings";
import {
  NotificationTrayContent,
  measureNotificationTrayContent,
  type NotificationTrayContentProps,
} from "./NotificationTrayContent";

export type NotificationsTrayProps = Omit<NotificationTrayContentProps, "width" | "height"> & {
  open: boolean;
  screenW: number;
  screenH: number;
  anchor: PopupAnchor;
  onClose(): void;
};
export function NotificationsTray(props: NotificationsTrayProps): ReactNode {
  const theme = useWidgetTheme();
  if (!props.open) return null;
  const width = desktopPopupGeometry(props.screenW, props.screenH, props.anchor, 0).width;
  const provisional = { ...props, width, height: 0 };
  const natural = measureNotificationTrayContent(provisional, theme).height;
  // The quiet-empty illustration needs a comfortable allocation; populated content is measured.
  const requested = Math.max(natural, 240 * getUiScaleFactor());
  const geometry = desktopPopupGeometry(props.screenW, props.screenH, props.anchor, requested);
  return (
    <DesktopPopup
      screenW={props.screenW}
      screenH={props.screenH}
      anchor={props.anchor}
      naturalHeight={requested}
      scope={NOTIFICATIONS_SCOPE}
      onDismiss={props.onClose}
    >
      <NotificationTrayContent {...props} width={width} height={geometry.height} />
    </DesktopPopup>
  );
}
