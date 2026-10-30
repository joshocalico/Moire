import React, { useState, type ReactNode } from "react";
import {
  Button,
  Dialog,
  Horizontal,
  Measure,
  ScrollColumn,
  TextBlock,
  getUiScaleFactor,
  measureColumnContent,
  useWidgetTheme,
  type WindowSize,
} from "@moire/ui";

export type RingNotice =
  | { readonly id: string; readonly kind: "timer"; readonly message: string }
  | {
      readonly id: string;
      readonly kind: "alarm";
      readonly message: string;
      readonly alarmId: string;
    };

/** One independently dismissible receipt per due source; controls never share the text viewport. */
export function RingNotices(
  props: WindowSize & {
    notices: readonly RingNotice[];
    onDismiss: (id: string) => void;
    onSnooze: (notice: Extract<RingNotice, { kind: "alarm" }>) => void;
  },
): ReactNode {
  const theme = useWidgetTheme();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIndex = Math.max(
    0,
    props.notices.findIndex((notice) => notice.id === selectedId),
  );
  const notice = props.notices[selectedIndex];
  if (!notice) return null;
  const spacing = theme.foundations.space;
  const width = Math.max(1, props.width - spacing.md * 2);
  const metrics = theme.recipes.dialog.medium.metrics;
  const inner = Math.max(1, width - metrics.bodyPaddingX * 2);
  const footer = (
    <Horizontal width={inner} wrap gap={spacing.sm} align="center">
      <Button label="Dismiss" onPress={() => props.onDismiss(notice.id)} />
      {notice.kind === "alarm" ? (
        <Button label="Snooze 5m" variant="primary" onPress={() => props.onSnooze(notice)} />
      ) : null}
      {props.notices.length > 1 ? (
        <Button
          label="Next notice"
          onPress={() =>
            setSelectedId(props.notices[(selectedIndex + 1) % props.notices.length]!.id)
          }
        />
      ) : null}
    </Horizontal>
  );
  const body = (
    <TextBlock width={inner} text={notice.message} fontSize={15} fontWeight="medium" wrap />
  );
  const bodyHeight = measureColumnContent({ width: inner, gap: 0, children: body }, theme).height;
  const footerHeight = measureColumnContent(
    {
      width,
      padding: {
        top: spacing.sm,
        right: metrics.bodyPaddingX,
        bottom: metrics.bodyPaddingBottom,
        left: metrics.bodyPaddingX,
      },
      gap: 0,
      children: footer,
    },
    theme,
  ).height;
  const bottom = 44 * getUiScaleFactor();
  const available = Math.max(1, props.height - bottom - spacing.md);
  const height = Math.min(
    available,
    Math.ceil(metrics.titlebarHeight + metrics.bodyPaddingTop + bodyHeight + footerHeight),
  );
  return (
    <Dialog
      x={spacing.md}
      y={Math.max(0, props.height - bottom - height)}
      width={width}
      height={height}
      title={`${notice.kind === "timer" ? "Timer" : "Alarm"} · ${selectedIndex + 1} of ${props.notices.length} notices`}
      onClose={() => props.onDismiss(notice.id)}
      footer={footer}
    >
      <Measure flexGrow={1} minHeight={1}>
        {(size) => (
          <ScrollColumn width={size.width} height={size.height} gap={0} smooth={false}>
            {body}
          </ScrollColumn>
        )}
      </Measure>
    </Dialog>
  );
}
