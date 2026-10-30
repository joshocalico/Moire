/**
 * The large part of a preview, by kind: the picture (photos, video frames, a PDF's first page),
 * highlighted source, rendered Markdown, a document's opening words, album art with play/pause,
 * an archive's or folder's top entries, or a font's specimen. Shared by the Space sheet and the
 * columns preview pane; it only draws what `usePreview` and the thumbnail workers produced.
 */
import React, { type ReactNode } from "react";
import {
  Box,
  CodeView,
  Icon,
  IconButton,
  ImageWidget,
  MarkdownView,
  MediaGlyph,
  Surface,
  TextBlock,
  formatPlaybackTime,
  getUiScaleFactor,
  usePalette,
  type FontSampleLine,
} from "@moire/ui";
import { countLabel, formatBytes } from "#files/format";
import { entryKind, kindIcon, kindTint } from "#files/kind-style";
import type { Preview, PreviewSubject } from "#files/preview/model";
import type { AudioPlayback } from "#files/preview/use-audio-playback";
import { useFontSample } from "#files/preview/use-font-sample";
import { Thumbnail } from "./thumbnail";

const ROW = 30;
const CORNER = 10;
const INSET = 12;
/** A PDF's first page takes this share of the stage; its opening words take the rest. */
const PDF_PAGE_SHARE = 0.62;

export type StageProps = {
  subject: PreviewSubject;
  preview: Preview | null;
  width: number;
  height: number;
  /** Present for audio previews that can play. */
  playback?: AudioPlayback;
  /** A small stage (the columns pane): pictures stand in for players and specimens. */
  compact?: boolean;
};

export function PreviewStage(props: StageProps): ReactNode {
  const { preview } = props;
  if (
    props.compact &&
    (preview?.kind === "audio" || preview?.kind === "font" || preview?.kind === "pdf")
  )
    return <PictureStage {...props} />;
  switch (preview?.kind) {
    case "image":
    case "video":
      return <PictureStage {...props} />;
    case "text":
      return preview.markdown ? (
        <Card {...props}>
          <MarkdownView width={props.width} height={props.height} markdown={preview.text} />
        </Card>
      ) : (
        <CodeView
          width={props.width}
          height={props.height}
          code={preview.text || " "}
          language={preview.language}
          fontSize={12}
        />
      );
    case "pdf":
      return <PdfStage {...props} preview={preview} />;
    case "document":
      return <WordsStage {...props} words={preview.excerpt} />;
    case "audio":
      return <AudioStage {...props} preview={preview} />;
    case "archive":
      return (
        <ListStage
          {...props}
          rows={preview.summary.entries.map((entry) => ({
            name: entry.name,
            isDir: entry.isDir,
            detail: entry.isDir
              ? `${countLabel(entry.items)} · ${formatBytes(entry.size)}`
              : formatBytes(entry.size),
          }))}
          total={preview.summary.entries.length}
        />
      );
    case "folder":
      return (
        <ListStage
          {...props}
          rows={preview.children.map((child) => ({
            ...child,
            detail: child.isDir ? "Folder" : "",
          }))}
          total={preview.items}
          empty="This folder is empty"
        />
      );
    case "font":
      return <FontStage {...props} />;
    default:
      return <PictureStage {...props} />;
  }
}

/** A rounded panel in the page colour that clips what it holds. */
function Card(props: { width: number; height: number; children: ReactNode }): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  return (
    <Surface
      width={props.width}
      height={props.height}
      fill={pal.bg}
      radius={Math.round(CORNER * ui)}
      stroke={pal.borderSubtle}
      strokeWidth={1}
      clip
    >
      {props.children}
    </Surface>
  );
}

/** The item's picture fitted whole into the stage, or its kind tile while there is none. */
function PictureStage(props: StageProps): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const px = (value: number) => Math.round(value * ui);
  const duration = props.preview?.kind === "video" ? props.preview.duration : null;
  return (
    <Card {...props}>
      <Thumbnail
        entry={props.subject}
        width={props.width}
        height={props.height}
        radius={px(CORNER)}
        iconScale={0.3}
        backdrop={pal.panel}
        fit="contain"
      />
      {duration ? (
        <Surface
          x={props.width - px(72)}
          y={props.height - px(34)}
          width={px(60)}
          height={px(22)}
          radius={px(11)}
          fill={0xb0000000}
        >
          <TextBlock
            width={px(60)}
            height={px(22)}
            text={formatPlaybackTime(duration)}
            color={0xffffffff}
            fontSize={11}
            horizontalAlign="center"
            verticalAlign="center"
            maxLines={1}
          />
        </Surface>
      ) : null}
    </Card>
  );
}

/** Words on a page-coloured card: a document's or PDF's opening text. */
function WordsStage(props: StageProps & { words: string; y?: number }): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const px = (value: number) => Math.round(value * ui);
  const lineHeight = px(19);
  return (
    <Box y={props.y ?? 0} width={props.width} height={props.height}>
      <Card width={props.width} height={props.height}>
        <TextBlock
          x={px(16)}
          y={px(14)}
          width={props.width - px(32)}
          height={props.height - px(28)}
          text={props.words || "No text in this document."}
          color={props.words ? pal.text : pal.muted}
          fontSize={13}
          wrap
          overflow="ellipsis"
          maxLines={Math.max(1, Math.floor((props.height - px(28)) / lineHeight))}
        />
      </Card>
    </Box>
  );
}

function PdfStage(props: StageProps & { preview: Extract<Preview, { kind: "pdf" }> }): ReactNode {
  const ui = getUiScaleFactor();
  const gap = Math.round(INSET * ui);
  // Short stages (the columns pane) keep to the page; the words need room to be worth showing.
  const words = props.preview.excerpt && props.height >= 320 * ui;
  const pageHeight = words ? Math.round(props.height * PDF_PAGE_SHARE) : props.height;
  return (
    <>
      <PictureStage {...props} height={pageHeight} />
      {words ? (
        <WordsStage
          {...props}
          y={pageHeight + gap}
          height={props.height - pageHeight - gap}
          words={props.preview.excerpt}
        />
      ) : null}
    </>
  );
}

function AudioStage(
  props: StageProps & { preview: Extract<Preview, { kind: "audio" }> },
): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const px = (value: number) => Math.round(value * ui);
  const { preview, playback } = props;
  const art = Math.max(px(48), Math.min(props.width - px(48), props.height - px(132)));
  const title = preview.title ?? props.subject.name;
  const byline = [preview.artist, preview.album].filter(Boolean).join(" — ");
  const state = playback?.state;
  const playing = state?.kind === "ready" && !state.paused;
  const status =
    state?.kind === "error"
      ? state.message
      : state?.kind === "opening"
        ? "Starting…"
        : state?.kind === "ready"
          ? `${formatPlaybackTime(state.position)} / ${formatPlaybackTime(state.duration || preview.duration || 0)}`
          : preview.duration
            ? formatPlaybackTime(preview.duration)
            : "";
  const textWidth = props.width - px(32);
  const textY = px(16) + art + px(12);
  return (
    <Card {...props}>
      <Box x={Math.round((props.width - art) / 2)} y={px(16)} width={art} height={art}>
        <Thumbnail
          entry={props.subject}
          width={art}
          height={art}
          radius={px(8)}
          iconScale={0.4}
          backdrop={pal.bg}
        />
      </Box>
      <TextBlock
        x={px(16)}
        y={textY}
        width={textWidth}
        height={px(22)}
        text={title}
        fontSize={15}
        fontWeight="medium"
        horizontalAlign="center"
        verticalAlign="center"
        overflow="ellipsis"
        maxLines={1}
      />
      <TextBlock
        x={px(16)}
        y={textY + px(22)}
        width={textWidth}
        height={px(18)}
        text={byline}
        color={pal.muted}
        fontSize={12}
        horizontalAlign="center"
        verticalAlign="center"
        overflow="ellipsis"
        maxLines={1}
      />
      {playback ? (
        <IconButton
          x={Math.round(props.width / 2 - px(18))}
          y={textY + px(46)}
          width={px(36)}
          height={px(36)}
          variant="standard"
          focusId="preview:play"
          tooltip={playing ? "Pause" : "Play"}
          disabled={state?.kind === "opening"}
          icon={(style) => (
            <MediaGlyph kind={playing ? "pause" : "play"} size={px(16)} color={style.color} />
          )}
          onPress={playback.toggle}
        />
      ) : null}
      <TextBlock
        x={px(16)}
        y={textY + px(playback ? 86 : 46)}
        width={textWidth}
        height={px(16)}
        text={status}
        color={state?.kind === "error" ? pal.danger : pal.muted}
        fontSize={11}
        horizontalAlign="center"
        verticalAlign="center"
        overflow="ellipsis"
        maxLines={1}
      />
    </Card>
  );
}

type ListRow = { name: string; isDir: boolean; detail: string };

/** Top entries of an archive or folder, one row each, with "and N more" when they don't fit. */
function ListStage(
  props: StageProps & { rows: readonly ListRow[]; total: number; empty?: string },
): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const px = (value: number) => Math.round(value * ui);
  const row = px(ROW);
  const fits = Math.max(1, Math.floor((props.height - px(INSET) * 2) / row));
  const more = props.total - Math.min(props.rows.length, fits);
  const shown = props.rows.slice(0, more > 0 ? fits - 1 : fits);
  const remaining = props.total - shown.length;
  const icon = px(16);
  const detailWidth = Math.min(px(150), Math.round(props.width * 0.4));
  return (
    <Card {...props}>
      {!props.rows.length ? (
        <TextBlock
          width={props.width}
          height={props.height}
          text={props.empty ?? "Nothing inside"}
          color={pal.muted}
          fontSize={13}
          horizontalAlign="center"
          verticalAlign="center"
        />
      ) : null}
      {shown.map((entry, index) => {
        const kind = entryKind(entry);
        return (
          <Box
            key={entry.name}
            x={px(INSET)}
            y={px(INSET) + index * row}
            width={props.width - px(INSET) * 2}
            height={row}
          >
            <Icon
              y={Math.round((row - icon) / 2)}
              name={kindIcon(kind)}
              size={icon}
              color={kindTint(kind, pal)}
              symbolic
            />
            <TextBlock
              x={icon + px(10)}
              width={props.width - px(INSET) * 2 - icon - px(10) - detailWidth - px(8)}
              height={row}
              text={entry.name}
              fontSize={13}
              verticalAlign="center"
              overflow="ellipsis"
              maxLines={1}
            />
            <TextBlock
              x={props.width - px(INSET) * 2 - detailWidth}
              width={detailWidth}
              height={row}
              text={entry.detail}
              color={pal.muted}
              fontSize={11}
              horizontalAlign="end"
              verticalAlign="center"
              overflow="ellipsis"
              maxLines={1}
            />
          </Box>
        );
      })}
      {remaining > 0 && props.rows.length ? (
        <TextBlock
          x={px(INSET) + icon + px(10)}
          y={px(INSET) + shown.length * row}
          width={props.width - px(INSET) * 2}
          height={row}
          text={`and ${remaining.toLocaleString()} more`}
          color={pal.muted}
          fontSize={12}
          verticalAlign="center"
          maxLines={1}
        />
      ) : null}
    </Card>
  );
}

const SPECIMEN: readonly FontSampleLine[] = [
  { text: "Aa Bb Cc Gg Qq", size: 44 },
  { text: "The quick brown fox jumps over the lazy dog", size: 20 },
  { text: "Sphinx of black quartz, judge my vow.", size: 15 },
  { text: "0123456789 & ! ? @ ( ) — “ ”", size: 15 },
];

function FontStage(props: StageProps): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const px = (value: number) => Math.round(value * ui);
  const inner = props.width - px(32);
  const lines = SPECIMEN.map((line) => ({ ...line, size: Math.round(line.size * ui) }));
  const sample = useFontSample(props.subject.path, lines, pal.text, inner);
  if (!sample) return <PictureStage {...props} />;
  return (
    <Card {...props}>
      <ImageWidget
        x={px(16)}
        y={px(16)}
        width={Math.min(inner, sample.width)}
        height={Math.min(props.height - px(32), sample.height)}
        bitmap={sample}
        fit="contain"
        placeholder={false}
      />
    </Card>
  );
}
