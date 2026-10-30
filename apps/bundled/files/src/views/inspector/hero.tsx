/**
 * The top of the inspector, by kind: a photo with its facts, a mini player, a poster that plays,
 * a PDF page with a stepper, a code or Markdown excerpt, a font specimen, an archive's entries
 * with Extract, a folder's pictures and sizes. `heroHeight` says how tall each one is drawn.
 */
import React, { useEffect, useState, type ReactNode } from "react";
import {
  Box,
  Button,
  CodeView,
  ColourStrip,
  Histogram,
  IconButton,
  MarkdownView,
  MediaGlyph,
  MetaPill,
  PageStepper,
  ProgressBar,
  SegmentedControl,
  Separator,
  Surface,
  TextBlock,
  colourStripWidth,
  getUiScaleFactor,
  measureWrappedText,
  metaPillWidth,
  mixColor,
  pageStepperWidth,
  usePalette,
} from "@moire/ui";
import type { Entry } from "#files/filesystem";
import { formatBytes } from "#files/format";
import type { InspectorActions } from "#files/inspector-actions";
import { kindTint } from "#files/kind-style";
import type { Preview } from "#files/preview/model";
import { useImageStats } from "#files/preview/use-image-stats";
import { useVideoPlayback } from "#files/preview/use-video-playback";
import { PreviewStage } from "#files/views/preview-stage";
import { Thumbnail } from "#files/views/thumbnail";
import { AudioHero, AUDIO_HERO_HEIGHT } from "./audio-hero";
import { glyph, px } from "./cards";
import { FolderHero, folderHeroHeight } from "./folder-hero";
import { FontHero, fontHeroHeight } from "./font-hero";
import { savedShare } from "./model";

const RADIUS = 10;
/** Room under a photo for its histogram and colours. */
const IMAGE_STRIP = 44;
const IMAGE_MAX = 236;
const IMAGE_MAX_COMPACT = 200;
const VIDEO_MAX = 220;
const PDF_HEIGHT = 268;
const PDF_HEIGHT_COMPACT = 220;
const TEXT_HEIGHT = 236;
const TEXT_HEIGHT_COMPACT = 200;
const TEXT_BAR = 34;
const ARCHIVE_ROW = 30;
const ARCHIVE_ROWS = 6;
const ARCHIVE_FOOT = 56;
const PLAY = 52;

export type HeroProps = {
  entry: Entry;
  preview: Preview | null;
  width: number;
  actions: InspectorActions;
  /** The columns pane: shorter heroes, and the photo keeps to `maxHeight`. */
  compact?: boolean;
  /** An upper bound for the picture (the columns pane gives 40% of its height). */
  maxHeight?: number;
};

export function heroHeight(props: Omit<HeroProps, "actions">): number {
  const { preview, width, compact } = props;
  const cap = (value: number) => (props.maxHeight ? Math.min(props.maxHeight, value) : value);
  switch (preview?.kind) {
    case "image": {
      const ratio = preview.width && preview.height ? preview.height / preview.width : 0.66;
      const picture = Math.min(
        px(compact ? IMAGE_MAX_COMPACT : IMAGE_MAX),
        Math.round(width * ratio),
      );
      return cap(picture) + px(IMAGE_STRIP);
    }
    case "audio":
      return px(AUDIO_HERO_HEIGHT);
    case "video":
      return cap(Math.min(px(VIDEO_MAX), Math.round(width * 0.5625)));
    case "pdf":
      return cap(px(compact ? PDF_HEIGHT_COMPACT : PDF_HEIGHT));
    case "text":
      return cap(px(compact ? TEXT_HEIGHT_COMPACT : TEXT_HEIGHT));
    case "font":
      return fontHeroHeight();
    case "archive":
      return (
        px(Math.max(1, Math.min(ARCHIVE_ROWS, preview.summary.entries.length)) * ARCHIVE_ROW + 24) +
        px(ARCHIVE_FOOT)
      );
    case "folder":
      return folderHeroHeight(preview);
    default:
      return cap(px(compact ? 140 : 160));
  }
}

export function InspectorHero(props: HeroProps): ReactNode {
  const height = heroHeight(props);
  const { preview, entry, width } = props;
  switch (preview?.kind) {
    case "image":
      return <ImageHero {...props} preview={preview} height={height} />;
    case "audio":
      return <AudioHero entry={entry} preview={preview} width={width} height={height} />;
    case "video":
      return <VideoHero {...props} height={height} />;
    case "pdf":
      return <PdfHero {...props} preview={preview} height={height} />;
    case "text":
      return <TextHero {...props} preview={preview} height={height} />;
    case "font":
      return <FontHero entry={entry} width={width} height={height} />;
    case "archive":
      return <ArchiveHero {...props} preview={preview} height={height} />;
    case "folder":
      return <FolderHero entry={entry} preview={preview} width={width} height={height} />;
    default:
      return <PreviewStage subject={entry} preview={preview} width={width} height={height} />;
  }
}

/** A photo fitted whole, its size and camera over it; under it, its tones and colours. */
function ImageHero(
  props: HeroProps & { preview: Extract<Preview, { kind: "image" }>; height: number },
): ReactNode {
  const pal = usePalette();
  const { preview, width, entry } = props;
  const stats = useImageStats(entry);
  const picture = props.height - px(IMAGE_STRIP);
  const pills = [
    preview.width && preview.height ? `${preview.width} × ${preview.height}` : null,
    preview.exposure?.camera ?? null,
  ].filter((text): text is string => !!text);
  let pillX = px(10);
  const colours = stats?.colours.slice(0, 6) ?? [];
  const swatches = colours.length ? colourStripWidth(colours.length) : 0;
  const strip = px(26);
  return (
    <Box width={width} height={props.height}>
      <Surface width={width} height={picture} fill={pal.bg} radius={px(RADIUS)} clip>
        <Thumbnail
          entry={entry}
          width={width}
          height={picture}
          radius={px(RADIUS)}
          backdrop={pal.bg}
          fit="contain"
        />
        {pills.map((text) => {
          const x = pillX;
          pillX += metaPillWidth(text) + px(6);
          return x + metaPillWidth(text) <= width - px(10) ? (
            <MetaPill key={text} x={x} y={picture - px(32)} text={text} />
          ) : null;
        })}
      </Surface>
      {stats ? (
        <Box y={picture + px(10)} width={width} height={strip}>
          <Histogram
            width={Math.max(1, width - swatches - px(16))}
            height={strip}
            values={stats.histogram}
          />
          <ColourStrip
            x={width - swatches}
            y={Math.round((strip - px(18)) / 2)}
            colours={colours}
            onPress={(colour) =>
              props.actions.copyText(
                `#${(colour & 0xffffff).toString(16).padStart(6, "0")}`,
                "Colour",
              )
            }
          />
        </Box>
      ) : null}
    </Box>
  );
}

/** A video's poster with its length; the play button plays it in an mpv window. */
function VideoHero(props: HeroProps & { height: number }): ReactNode {
  const pal = usePalette();
  const playback = useVideoPlayback(props.entry.path);
  const play = px(PLAY);
  const failed = playback.state.kind === "error";
  // Without a player, the file opens in its application instead.
  useEffect(() => {
    if (failed) props.actions.open([props.entry]);
    // Only a new failure opens it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failed]);
  const status =
    playback.state.kind === "opening"
      ? "Starting…"
      : playback.state.kind === "ready"
        ? playback.playing
          ? "Playing in a window"
          : "Paused"
        : null;
  return (
    <Box width={props.width} height={props.height}>
      <PreviewStage
        subject={props.entry}
        preview={props.preview}
        width={props.width}
        height={props.height}
      />
      <IconButton
        x={Math.round((props.width - play) / 2)}
        y={Math.round((props.height - play) / 2)}
        width={play}
        height={play}
        variant="ghost"
        color={0xffffffff}
        focusId="inspector:play"
        tooltip={playback.playing ? "Pause" : "Play"}
        disabled={playback.state.kind === "opening"}
        icon={(style) => (
          <Surface
            width={play}
            height={play}
            radius={play / 2}
            fill={0xa0000000}
            stroke={0x60ffffff}
            strokeWidth={1}
          >
            <MediaGlyph
              x={Math.round((play - px(20)) / 2) + (playback.playing ? 0 : px(2))}
              y={Math.round((play - px(20)) / 2)}
              kind={playback.playing ? "pause" : "play"}
              size={px(20)}
              color={style.color}
            />
          </Surface>
        )}
        onPress={playback.toggle}
      />
      {status ? <MetaPill x={px(10)} y={props.height - px(34)} text={status} /> : null}
      {playback.state.kind === "ready" ? (
        <IconButton
          x={props.width - px(40)}
          y={px(8)}
          width={px(32)}
          height={px(32)}
          variant="ghost"
          color={pal.text}
          tooltip="Stop"
          focusId="inspector:stop"
          icon={(style) => <MediaGlyph kind="stop" size={px(14)} color={style.color} />}
          onPress={playback.stop}
        />
      ) : null}
    </Box>
  );
}

/** A PDF page with "‹ Page n of N ›"; each page renders when it is asked for. */
function PdfHero(
  props: HeroProps & { preview: Extract<Preview, { kind: "pdf" }>; height: number },
): ReactNode {
  const pal = usePalette();
  const [state, setState] = useState({ path: props.entry.path, page: 1 });
  const page = state.path === props.entry.path ? state.page : 1;
  const pages = props.preview.pages;
  const stepper = pageStepperWidth(pages);
  return (
    <Box width={props.width} height={props.height}>
      <Surface width={props.width} height={props.height} fill={pal.bg} radius={px(RADIUS)} clip>
        <Thumbnail
          entry={props.entry}
          width={props.width}
          height={props.height - px(16)}
          radius={px(RADIUS)}
          backdrop={pal.bg}
          fit="contain"
          page={page}
        />
      </Surface>
      {pages !== 1 ? (
        <PageStepper
          x={Math.round((props.width - stepper) / 2)}
          y={props.height - px(44)}
          page={page}
          pages={pages}
          focusId="inspector:page"
          onPage={(next) => setState({ path: props.entry.path, page: next })}
        />
      ) : null}
    </Box>
  );
}

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  tsx: "TSX",
  python: "Python",
  rust: "Rust",
  shell: "Shell",
  json: "JSON",
  css: "CSS",
  html: "HTML",
  yaml: "YAML",
  plain: "Plain text",
};

export function languageLabel(preview: Extract<Preview, { kind: "text" }>): string {
  if (preview.markdown) return "Markdown";
  const name = preview.language;
  return LANGUAGE_NAMES[name] ?? name[0]!.toUpperCase() + name.slice(1);
}

/** Highlighted source, or rendered Markdown with a Source toggle; language, lines, Copy. */
function TextHero(
  props: HeroProps & { preview: Extract<Preview, { kind: "text" }>; height: number },
): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const { preview, width } = props;
  const [mode, setMode] = useState({ path: props.entry.path, source: false });
  const source = mode.path === props.entry.path && mode.source;
  const bar = px(TEXT_BAR);
  const badge = languageLabel(preview);
  const badgeWidth =
    Math.ceil(measureWrappedText(badge, 400 * ui, { fontSize: 11, fontWeight: "medium" }).width) +
    px(16);
  const toggle = preview.markdown ? px(142) : 0;
  const body = props.height - bar - 1;
  const lines = `${preview.lines.toLocaleString()}${preview.truncated ? "+" : ""} ${preview.lines === 1 && !preview.truncated ? "line" : "lines"} · ${preview.encoding}`;
  return (
    <Surface
      width={width}
      height={props.height}
      fill={pal.bg}
      radius={px(RADIUS)}
      stroke={pal.borderSubtle}
      strokeWidth={1}
      clip
    >
      <Surface
        x={px(8)}
        y={px(7)}
        width={badgeWidth}
        height={px(20)}
        radius={px(10)}
        fill={mixColor(pal.bg, kindTint("code", pal), 0.22)}
      >
        <TextBlock
          width={badgeWidth}
          height={px(20)}
          text={badge}
          fontSize={11}
          fontWeight="medium"
          horizontalAlign="center"
          verticalAlign="center"
          maxLines={1}
        />
      </Surface>
      <TextBlock
        x={px(16) + badgeWidth}
        width={Math.max(1, width - badgeWidth - toggle - px(preview.markdown ? 54 : 52))}
        height={bar}
        text={lines}
        color={pal.muted}
        fontSize={11}
        verticalAlign="center"
        maxLines={1}
        overflow="ellipsis"
      />
      {preview.markdown ? (
        <SegmentedControl
          x={width - toggle - px(32)}
          y={px(4)}
          width={toggle}
          height={px(26)}
          size="small"
          options={[
            { id: "rendered", label: "Rendered" },
            { id: "source", label: "Source" },
          ]}
          value={source ? "source" : "rendered"}
          onChange={(id) => setMode({ path: props.entry.path, source: id === "source" })}
        />
      ) : null}
      <IconButton
        x={width - px(32)}
        y={px(4)}
        width={px(26)}
        height={px(26)}
        variant="ghost"
        focusId="inspector:copy-text"
        tooltip="Copy text"
        icon={glyph("copy", 14)}
        onPress={() => props.actions.copyText(preview.text, "Text")}
      />
      <Separator y={bar} width={width} height={1} />
      <Box y={bar + 1} width={width} height={body}>
        {preview.markdown && !source ? (
          <MarkdownView width={width} height={body} markdown={preview.text} fontSize={12} />
        ) : (
          <CodeView
            width={width}
            height={body}
            code={preview.text || " "}
            language={preview.markdown ? "plain" : preview.language}
            lineNumbers
            fontSize={11}
          />
        )}
      </Box>
    </Surface>
  );
}

/** The archive's top entries, packed → unpacked, and Extract here. */
function ArchiveHero(
  props: HeroProps & { preview: Extract<Preview, { kind: "archive" }>; height: number },
): ReactNode {
  const pal = usePalette();
  const { summary } = props.preview;
  const share = savedShare(props.entry.size, summary.totalSize);
  const ratio = summary.totalSize ? Math.min(1, props.entry.size / summary.totalSize) : 1;
  const stage = props.height - px(ARCHIVE_FOOT);
  const extract = px(112);
  return (
    <Box width={props.width} height={props.height}>
      <PreviewStage
        subject={props.entry}
        preview={props.preview}
        width={props.width}
        height={stage}
      />
      <TextBlock
        y={stage + px(10)}
        width={props.width - extract - px(8)}
        height={px(28)}
        text={`${formatBytes(props.entry.size)} → ${formatBytes(summary.totalSize)}${share !== null ? ` · ${share}% smaller` : ""}`}
        color={pal.muted}
        fontSize={11}
        verticalAlign="center"
        maxLines={1}
        overflow="ellipsis"
      />
      <Button
        x={props.width - extract}
        y={stage + px(10)}
        width={extract}
        height={px(28)}
        size="small"
        variant="secondary"
        label="Extract here"
        focusId="inspector:extract"
        disabled={props.actions.busy || props.actions.inTrash}
        onPress={() => props.actions.extract(props.entry)}
      />
      <ProgressBar y={props.height - px(8)} width={props.width} height={px(6)} value={ratio} />
    </Box>
  );
}
