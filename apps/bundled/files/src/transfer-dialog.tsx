import path from "node:path";
import os from "node:os";
import React, { useEffect, useState, type ReactNode } from "react";
import {
  Box,
  Column,
  Row,
  TextBlock,
  Icon,
  Button,
  Dialog,
  ContentCard,
  FocusScope,
  ModalBarrier,
  ScrollColumn,
  Measure,
  Separator,
  ProgressBar,
  getUiScaleFactor,
  useWidgetTheme,
  measureColumnContent,
  type IconName,
} from "@moire/ui";
import { formatBytes, formatTimestamp } from "./format";
import { iconFor } from "./model";
import type { ConflictChoice, Progress, TransferKind } from "@moire/file-operations";
import {
  transferOutcomeDetail,
  transferOutcomeHeading,
  transferElapsedLabel,
  transferSourceFolder,
  type TransferOutcome,
  type TransferRequest,
} from "./transfer-outcome";
import { readTransferConflictMetadata, type TransferItemMetadata } from "./transfer-metadata";

export type TransferDisplay = {
  kind: TransferKind;
  request: TransferRequest;
  progress: Progress;
  outcome: "running" | "complete" | "stopped";
  message?: string;
  result?: TransferOutcome;
  navigationError?: string;
};
export type TransferConflict = {
  source: string;
  destination: string;
  choose: (choice: ConflictChoice) => void;
};

export function displayTransferPath(file: string): string {
  const home = os.homedir();
  return file === home || file.startsWith(home + path.sep) ? `~${file.slice(home.length)}` : file;
}

function itemIcon(name: string, kind?: TransferItemMetadata): IconName {
  return iconFor({ name, isDir: kind?.state === "available" && kind.kind === "folder" });
}

/** Static transfer presentation. Counts and timing come only from real operation receipts. */
export function TransferDialog(props: {
  width: number;
  height: number;
  value: TransferDisplay;
  conflict: TransferConflict | null;
  onCancel: () => void;
  onDismiss: () => void;
  onShowInFolder?: () => void;
}): ReactNode {
  const theme = useWidgetTheme(),
    pal = theme.foundations.palette,
    ui = getUiScaleFactor(),
    gap = theme.foundations.space.md;
  const width = Math.max(1, Math.min(props.width - 8, Math.round(560 * ui)));
  const { progress, request, result } = props.value;
  const running = props.value.outcome === "running";
  const dismiss = () => (running ? props.onCancel() : props.onDismiss());
  const [observation, setObservation] = useState<{
    conflict: TransferConflict;
    metadata: Awaited<ReturnType<typeof readTransferConflictMetadata>>;
  } | null>(null);
  useEffect(() => {
    let current = true;
    const conflict = props.conflict;
    if (conflict)
      void readTransferConflictMetadata(conflict.source, conflict.destination).then((metadata) => {
        if (current) setObservation({ conflict, metadata });
      });
    return () => {
      current = false;
    };
  }, [props.conflict]);
  // Identity also prevents a previous conflict flashing before the new effect runs.
  const metadata = observation?.conflict === props.conflict ? observation.metadata : null;
  const moving = props.value.kind === "move";
  const byteProgress = !moving && (progress.bytesTotal ?? 0) > 0;
  const fraction =
    progress.phase === "preparing"
      ? 0
      : byteProgress
        ? (progress.bytes ?? 0) / (progress.bytesTotal ?? 1)
        : (progress.done + (progress.skipped ?? 0)) / Math.max(1, progress.total);
  const action = moving ? "moved" : "copied";
  const heading = props.conflict
    ? "This item already exists"
    : result
      ? transferOutcomeHeading(result)
      : `${moving ? "Moving" : "Copying"} ${progress.total} ${progress.total === 1 ? "item" : "items"}`;
  const entirelyCompleted =
    result?.state === "complete" &&
    progress.total > 0 &&
    progress.done === progress.total &&
    !progress.skipped;
  const actions = props.conflict
    ? [
        <Button key="cancel" label="Cancel transfer" onPress={props.onCancel} />,
        <Button key="skip" label="Skip this item" onPress={() => props.conflict?.choose("skip")} />,
        <Button
          key="keep"
          label="Keep both"
          variant="primary"
          onPress={() => props.conflict?.choose("keep-both")}
        />,
      ]
    : running
      ? [<Button key="cancel" label="Cancel transfer" onPress={props.onCancel} />]
      : [
          ...(props.onShowInFolder
            ? [<Button key="show" label="Show in folder" onPress={props.onShowInFolder} />]
            : []),
          <Button key="done" label="Done" variant="primary" onPress={props.onDismiss} />,
        ];
  const availableFooterWidth = Math.max(
    1,
    width - theme.recipes.dialog.medium.metrics.bodyPaddingX * 2,
  );
  // Row's intrinsic provider measures wrapping at the actual recipe allocation.
  const footer = (
    <Row width={availableFooterWidth} gap={theme.foundations.space.sm} justify="end" wrap>
      {actions}
    </Row>
  );

  const renderContent = (inner: number) => {
    const text = (value: string, muted = true, fontSize = 13) => (
      <TextBlock
        width={inner}
        text={value}
        color={muted ? pal.muted : pal.text}
        fontSize={fontSize}
        wrap
      />
    );
    const folder = (label: string, value: string) => (
      <Row width={inner} align="start" gap={theme.foundations.space.sm}>
        <Box width={20 * ui} height={20 * ui}>
          <Icon name="folder" size={20 * ui} color={pal.muted} symbolic />
        </Box>
        <TextBlock width={40 * ui} text={label} color={pal.muted} fontSize={13} />
        <TextBlock
          width={Math.max(1, inner - 60 * ui - theme.foundations.space.sm * 2)}
          text={displayTransferPath(value)}
          fontSize={13}
          wrap
        />
      </Row>
    );
    const comparison = (
      label: string,
      file: string,
      item: TransferItemMetadata | undefined,
      cardWidth: number,
    ) => {
      const cardPadding = theme.foundations.space.md;
      const contentWidth = Math.max(1, cardWidth - cardPadding * 2);
      const kind =
        item?.state === "available"
          ? item.kind === "folder"
            ? "Folder"
            : item.kind === "link"
              ? "Symbolic link"
              : item.kind === "other"
                ? "Special item"
                : undefined
          : undefined;
      return (
        <ContentCard
          width={cardWidth}
          padding={cardPadding}
          gap={theme.foundations.space.sm}
          fill={pal.bg}
        >
          <TextBlock width={contentWidth} text={label} fontSize={11} color={pal.muted} />
          <Row width={contentWidth} gap={theme.foundations.space.sm} align="start">
            <Box width={26 * ui} height={26 * ui}>
              <Icon
                name={itemIcon(path.basename(file), item)}
                size={26 * ui}
                color={pal.accent}
                symbolic
              />
            </Box>
            <TextBlock
              width={Math.max(1, contentWidth - 26 * ui - theme.foundations.space.sm)}
              text={path.basename(file)}
              fontSize={13}
              wrap
            />
          </Row>
          {item?.state === "available" ? (
            <>
              <TextBlock
                width={contentWidth}
                text={item.bytes === undefined ? (kind ?? "Item") : formatBytes(item.bytes)}
                fontSize={13}
                color={pal.muted}
                wrap
              />
              <TextBlock
                width={contentWidth}
                text={`Modified ${formatTimestamp(item.modified, true)}`}
                fontSize={12}
                color={pal.muted}
                wrap
              />
            </>
          ) : (
            <TextBlock
              width={contentWidth}
              text={item ? "Metadata unavailable" : "Reading metadata…"}
              fontSize={13}
              color={pal.muted}
              wrap
            />
          )}
        </ContentCard>
      );
    };
    const conflict = props.conflict;
    const compareWidth = (inner - theme.foundations.space.sm) / 2;
    const stacked = compareWidth < 210 * ui;
    const incoming = conflict
      ? comparison("INCOMING", conflict.source, metadata?.incoming, stacked ? inner : compareWidth)
      : null;
    const existing = conflict
      ? comparison(
          "EXISTING",
          conflict.destination,
          metadata?.existing,
          stacked ? inner : compareWidth,
        )
      : null;
    const count = `${progress.done} ${progress.done === 1 ? "item" : "items"} ${action}${progress.skipped ? ` · ${progress.skipped} skipped` : ""}${result && result.state !== "complete" && progress.total - progress.done - (progress.skipped ?? 0) > 0 ? ` · ${progress.total - progress.done - (progress.skipped ?? 0)} unfinished` : ""}`;
    return (
      <Column width={inner} gap={gap}>
        {entirelyCompleted ? (
          <Row width={inner} gap={theme.foundations.space.md} align="center">
            <Box width={44 * ui} height={44 * ui}>
              <Icon name="check-circle" size={44 * ui} color={pal.accent} symbolic />
            </Box>
            <TextBlock
              width={Math.max(1, inner - 44 * ui - theme.foundations.space.md)}
              text={heading}
              fontSize={24}
              fontWeight="medium"
              wrap
            />
          </Row>
        ) : (
          <TextBlock
            width={inner}
            text={heading}
            fontSize={24}
            fontWeight="medium"
            wrap
            color={result?.state === "failed" ? pal.danger : pal.text}
          />
        )}
        {conflict ? (
          <>
            {text(`Choose what to do with ${path.basename(conflict.source)}.`)}
            {stacked ? (
              <Column width={inner} gap={theme.foundations.space.sm}>
                {incoming}
                {existing}
              </Column>
            ) : (
              <Row width={inner} align="start" gap={theme.foundations.space.sm}>
                {incoming}
                {existing}
              </Row>
            )}
            {text("Keep both saves the incoming item with an available numbered name.")}
            {text(
              "Skip leaves the existing item untouched. Cancel keeps completed items.",
              true,
              12,
            )}
          </>
        ) : running ? (
          <>
            <Column width={inner} gap={theme.foundations.space.sm}>
              {folder("From", transferSourceFolder(request))}
              {folder("To", progress.validatedDirectory ?? request.directory)}
            </Column>
            {progress.phase === "preparing" ? (
              <>
                {text("Preparing: counting files and checking the destination…")}
                {progress.filesTotal
                  ? text(
                      `${progress.filesTotal} ${progress.filesTotal === 1 ? "entry" : "entries"} planned · ${formatBytes(progress.bytesTotal ?? 0)} planned`,
                      true,
                      12,
                    )
                  : null}
              </>
            ) : (
              <>
                {text(
                  `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}% of ${byteProgress ? "planned bytes copied" : "items resolved"}`,
                  false,
                  18,
                )}
                <ProgressBar width={inner} value={Math.max(0, Math.min(1, fraction))} />
                {text(count)}
                {!moving && progress.bytesTotal !== undefined
                  ? text(
                      `${formatBytes(progress.bytes ?? 0)} of ${formatBytes(progress.bytesTotal)} planned`,
                    )
                  : null}
              </>
            )}
            <Separator width={inner} />
            <Row width={inner} align="start" gap={theme.foundations.space.sm}>
              <Box width={28 * ui} height={28 * ui}>
                <Icon name={itemIcon(progress.name)} size={28 * ui} color={pal.accent} symbolic />
              </Box>
              <Column
                width={Math.max(1, inner - 28 * ui - theme.foundations.space.sm)}
                gap={theme.foundations.space.sm}
              >
                <TextBlock text={progress.name} fontSize={14} wrap />
                <TextBlock
                  text={
                    progress.phase === "preparing"
                      ? "Preparing"
                      : moving
                        ? "Moving now"
                        : "Copying now"
                  }
                  fontSize={12}
                  color={pal.muted}
                  wrap
                />
              </Column>
            </Row>
          </>
        ) : (
          <>
            {text(count, true, 15)}
            {folder("To", progress.validatedDirectory ?? request.directory)}
            <Separator width={inner} />
            {progress.committedBytes !== undefined
              ? text(`${formatBytes(progress.committedBytes)} ${action}`, false, 15)
              : null}
            {result ? text(transferElapsedLabel(result.elapsedMs), true, 13) : null}
            {result
              ? text(transferOutcomeDetail(result), true, 11)
              : props.value.message
                ? text(props.value.message)
                : null}
            {progress.skipped ? text("Skipped items remain in their original folders.") : null}
            {result?.state === "failed" ? (
              <TextBlock width={inner} text={result.error} fontSize={13} color={pal.danger} wrap />
            ) : null}
            {props.value.navigationError ? (
              <TextBlock
                width={inner}
                text={props.value.navigationError}
                fontSize={13}
                color={pal.danger}
                wrap
              />
            ) : null}
          </>
        )}
        {transferSourceFolder(request) === "Multiple folders" ? (
          <Column width={inner} gap={theme.foundations.space.sm}>
            {text("Source items", true, 12)}
            {request.sources.map((source) => (
              <TextBlock
                key={source}
                width={inner}
                text={displayTransferPath(source)}
                fontSize={12}
                color={pal.muted}
                wrap
              />
            ))}
          </Column>
        ) : null}
      </Column>
    );
  };
  const metrics = theme.recipes.dialog.medium.metrics;
  const inner = Math.max(1, width - metrics.bodyPaddingX * 2);
  const bodyExtent = measureColumnContent(
    { width: inner, gap: 0, children: renderContent(inner) },
    theme,
  ).height;
  const footerExtent = measureColumnContent(
    {
      width,
      gap: 0,
      padding: {
        top: theme.foundations.space.sm,
        right: metrics.bodyPaddingX,
        bottom: metrics.bodyPaddingBottom,
        left: metrics.bodyPaddingX,
      },
      children: footer,
    },
    theme,
  ).height;
  const height = Math.max(
    1,
    Math.min(
      props.height - 8,
      Math.ceil(metrics.titlebarHeight + metrics.bodyPaddingTop + bodyExtent + footerExtent),
    ),
  );
  return (
    <>
      <ModalBarrier width={props.width} height={props.height} visible />
      <FocusScope
        x={Math.round((props.width - width) / 2)}
        y={Math.round((props.height - height) / 2)}
        width={width}
        height={height}
        trap
        onEscape={dismiss}
      >
        <Dialog
          width={width}
          height={height}
          title="File transfer"
          onClose={dismiss}
          footer={footer}
        >
          <Measure flexGrow={1} minHeight={1}>
            {(size) => (
              <ScrollColumn width={size.width} height={size.height} gap={0} smooth={false}>
                {renderContent(size.width)}
              </ScrollColumn>
            )}
          </Measure>
        </Dialog>
      </FocusScope>
    </>
  );
}
