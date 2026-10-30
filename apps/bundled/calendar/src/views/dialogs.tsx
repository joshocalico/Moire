/** Modal messages: leaving an unsaved event, and the outcome of an .ics import. */
import React, { type ReactNode } from "react";
import {
  Button,
  Dialog,
  FocusScope,
  Horizontal,
  Measure,
  ModalBarrier,
  ScrollColumn,
  TextBlock,
  Vertical,
  getUiScaleFactor,
  measureColumnContent,
  useWidgetTheme,
  type ButtonVariant,
  type WindowSize,
} from "@moire/ui";

const MESSAGE_WIDTH = 480;

type DialogAction = {
  label: string;
  variant?: ButtonVariant;
  onPress: () => void;
};

/** A sized-to-fit modal with paragraphs of text and a row of actions. */
function MessageDialog(
  props: WindowSize & {
    title: string;
    paragraphs: readonly { text: string; tone?: "danger" | "muted" }[];
    actions: readonly DialogAction[];
    onCancel: () => void;
  },
): ReactNode {
  const theme = useWidgetTheme(),
    pal = theme.foundations.palette,
    spacing = theme.foundations.space,
    metrics = theme.recipes.dialog.medium.metrics;
  const width = Math.max(
      1,
      Math.min(MESSAGE_WIDTH * getUiScaleFactor(), props.width - spacing.md * 2),
    ),
    inner = Math.max(1, width - metrics.bodyPaddingX * 2);
  const body = (
    <Vertical width={inner} gap={spacing.md}>
      {props.paragraphs.map((paragraph, index) => (
        <TextBlock
          key={index}
          text={paragraph.text}
          color={
            paragraph.tone === "danger"
              ? pal.danger
              : paragraph.tone === "muted"
                ? pal.muted
                : pal.text
          }
          fontSize={paragraph.tone === "muted" ? 12 : 13}
          wrap
        />
      ))}
    </Vertical>
  );
  const footer = (
    <Horizontal width={inner} wrap align="center" gap={spacing.sm}>
      {props.actions.map((action) => (
        <Button
          key={action.label}
          label={action.label}
          variant={action.variant}
          onPress={action.onPress}
        />
      ))}
    </Horizontal>
  );
  const bodyHeight = measureColumnContent({ width: inner, gap: 0, children: body }, theme).height,
    footerHeight = measureColumnContent(
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
  const height = Math.max(
    1,
    Math.min(
      props.height - spacing.md * 2,
      Math.ceil(metrics.titlebarHeight + metrics.bodyPaddingTop + bodyHeight + footerHeight),
    ),
  );
  return (
    <>
      <ModalBarrier width={props.width} height={props.height} visible />
      <FocusScope
        x={(props.width - width) / 2}
        y={(props.height - height) / 2}
        width={width}
        height={height}
        trap
        onEscape={props.onCancel}
      >
        <Dialog
          width={width}
          height={height}
          title={props.title}
          onClose={props.onCancel}
          footer={footer}
        >
          <Measure flexGrow={1} minHeight={1}>
            {(size) => (
              <ScrollColumn {...size} gap={0} smooth={false}>
                {body}
              </ScrollColumn>
            )}
          </Measure>
        </Dialog>
      </FocusScope>
    </>
  );
}

export function LeaveDraftDialog(
  props: WindowSize & {
    error: string;
    onSave: () => void;
    onDiscard: () => void;
    onCancel: () => void;
  },
): ReactNode {
  return (
    <MessageDialog
      {...props}
      title="Save event before leaving?"
      paragraphs={[
        {
          text: "This event has unsaved changes. Save the event, discard the changes, or keep editing.",
        },
        ...(props.error ? [{ text: props.error, tone: "danger" as const }] : []),
      ]}
      actions={[
        { label: "Save", variant: "primary", onPress: props.onSave },
        { label: "Discard", variant: "danger", onPress: props.onDiscard },
        { label: "Cancel", onPress: props.onCancel },
      ]}
    />
  );
}

/** What an import did, including every event it skipped or changed and why. */
export type ImportReport = {
  title: string;
  summary: string;
  details: readonly string[];
};

export function ImportReportDialog(
  props: WindowSize & { report: ImportReport; onClose: () => void },
): ReactNode {
  return (
    <MessageDialog
      {...props}
      title={props.report.title}
      paragraphs={[
        { text: props.report.summary },
        ...props.report.details.map((text) => ({
          text,
          tone: "muted" as const,
        })),
      ]}
      actions={[{ label: "OK", variant: "primary", onPress: props.onClose }]}
      onCancel={props.onClose}
    />
  );
}
