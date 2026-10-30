/**
 * The shared shape of a Moire app window: the header bar (the window's own titlebar: icon, title,
 * the open document, actions, window controls),
 * an optional tool row, the body and a status line. File-based apps also share how a file is
 * opened: a path field, and an empty state that offers the files opened recently.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tidyPath } from "./format";
import React, { Children, isValidElement, useState, type ReactNode } from "react";
import {
  APP_HEADER_HEIGHT,
  APP_STATUS_HEIGHT,
  AppHeaderBar,
  AppStatusLine,
  Box,
  Button,
  Horizontal,
  Icon,
  IconButton,
  Pressable,
  Separator,
  Surface,
  TextBlock,
  TextField,
  Vertical,
  getUiScaleFactor,
  registerIntrinsicSize,
  usePalette,
  type IconName,
  type WindowActions,
  type WindowSize,
} from "@moire/ui";

const TOOL_ROW = 44;

export type AppFrameProps = WindowSize & {
  /** App name, shown with its icon in the header bar (the window's titlebar). */
  title?: string;
  icon?: IconName;
  /** The open document (a file name), shown beside the title. */
  subtitle?: string;
  /** Header bar actions, right-aligned before the window controls. */
  actions?: ReactNode;
  /**
   * The window the header bar belongs to: adds minimize/maximize/close, dragging and
   * double-click maximize. Pass it and open the window undecorated so it has one titlebar.
   */
  window?: WindowActions | null;
  /** Legacy top row (a path field) for apps not yet using `title`. */
  header?: ReactNode;
  /** A tool row under the header bar (playback, zoom, page controls). */
  controls?: ReactNode;
  controlsHeight?: number;
  status: string;
  /** Right side of the status line (counts, position). */
  statusEnd?: string;
  children?: ReactNode;
};

function frameTop(props: Pick<AppFrameProps, "title" | "header">): number {
  const ui = getUiScaleFactor();
  return props.title ? Math.round(APP_HEADER_HEIGHT * ui) : props.header ? 44 * ui : 0;
}

/** The geometry AppFrame gives its body, for apps that lay out against it. */
export function appFrameBody(
  props: Pick<AppFrameProps, "height" | "title" | "header" | "controls" | "controlsHeight">,
) {
  const ui = getUiScaleFactor();
  const controls = props.controls ? (props.controlsHeight ?? TOOL_ROW * ui) : 0;
  const y = frameTop(props) + controls;
  return { y, height: Math.max(1, props.height - y - Math.round(APP_STATUS_HEIGHT * ui)) };
}

export function AppFrame(props: AppFrameProps): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const top = frameTop(props);
  const controlsHeight = props.controls ? (props.controlsHeight ?? TOOL_ROW * ui) : 0;
  const body = appFrameBody(props);
  return (
    <Surface width={props.width} height={props.height} fill={pal.bg}>
      {props.title ? (
        <AppHeaderBar
          width={props.width}
          title={props.title}
          icon={props.icon}
          subtitle={props.subtitle}
          actions={props.actions}
          window={props.window}
        />
      ) : (
        props.header
      )}
      {props.controls ? (
        <Surface y={top} width={props.width} height={controlsHeight} fill={pal.panel}>
          {props.controls}
          <Separator y={controlsHeight - 1} width={props.width} color={pal.borderSubtle} />
        </Surface>
      ) : null}
      <Surface y={body.y} width={props.width} height={body.height} clip>
        {props.children}
      </Surface>
      <AppStatusLine
        y={props.height - Math.round(APP_STATUS_HEIGHT * ui)}
        width={props.width}
        status={props.status}
        end={props.statusEnd}
      />
    </Surface>
  );
}

/** Media and viewer glyphs the shared UI icon set does not carry, kept beside this package. */
const TOOL_ICONS = [
  "extract",
  "fullscreen",
  "pause",
  "play",
  "record",
  "rotate-left",
  "rotate-right",
  "skip-next",
  "skip-previous",
  "stop",
  "zoom-fit",
  "zoom-in",
  "zoom-out",
] as const;
export type ToolIconName = (typeof TOOL_ICONS)[number] | IconName;
const toolIconSet = new Set<string>(TOOL_ICONS);

/** A symbolic icon from the shared set or this package's tool glyphs. */
export function ToolIcon(props: {
  name: ToolIconName;
  size: number;
  color: number;
  x?: number;
  y?: number;
}): ReactNode {
  return (
    <Icon
      x={props.x}
      y={props.y}
      name={props.name}
      path={
        toolIconSet.has(props.name)
          ? fileURLToPath(new URL(`../icons/${props.name}.svg`, import.meta.url))
          : undefined
      }
      size={props.size}
      color={props.color}
      symbolic
    />
  );
}

/** A 32px ghost icon button with a tooltip, for tool rows and title bar actions. */
export function ToolButton(props: {
  icon: ToolIconName;
  /** Short text drawn instead of the icon (e.g. "1:1"). */
  text?: string;
  tooltip: string;
  onPress?: () => void;
  disabled?: boolean;
  selected?: boolean;
  focusId?: string;
  tooltipPlacement?: "top" | "bottom";
}): ReactNode {
  const ui = getUiScaleFactor();
  const size = 32 * ui;
  const glyph = 18 * ui;
  return (
    <Box width={size} height={size} flexShrink={0}>
      <IconButton
        width={size}
        height={size}
        variant="ghost"
        tooltip={props.tooltip}
        tooltipPlacement={props.tooltipPlacement ?? "bottom"}
        focusId={props.focusId}
        disabled={props.disabled}
        selected={props.selected}
        onPress={props.onPress}
        icon={(style) =>
          props.text ? (
            <TextBlock
              x={(style.size - size) / 2}
              y={(style.size - size) / 2}
              width={size}
              height={size}
              text={props.text}
              color={style.color}
              fontSize={12}
              fontWeight="medium"
              horizontalAlign="center"
              verticalAlign="center"
              maxLines={1}
            />
          ) : (
            <ToolIcon
              name={props.icon}
              x={(style.size - glyph) / 2}
              y={(style.size - glyph) / 2}
              size={glyph}
              color={style.color}
            />
          )
        }
      />
    </Box>
  );
}

/**
 * Title bar actions: a right-aligned run of ToolButtons and fixed-width buttons. Children other
 * than ToolButton need an explicit `width`.
 */
export function TitleActions(props: { children?: ReactNode }): ReactNode {
  const ui = getUiScaleFactor();
  return (
    <Horizontal
      width={titleActionsWidth(props.children)}
      height={32 * ui}
      gap={4 * ui}
      align="center"
    >
      {props.children}
    </Horizontal>
  );
}
function titleActionsWidth(children: ReactNode): number {
  const ui = getUiScaleFactor();
  const widths = Children.toArray(children)
    .filter(isValidElement)
    .map((child) =>
      child.type === ToolButton
        ? 32 * ui
        : child.type === OpenButton
          ? OPEN_BUTTON_WIDTH * ui
          : Number((child.props as { width?: number }).width ?? 0),
    );
  return widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * 4 * ui;
}

const OPEN_BUTTON_WIDTH = 76;

/** The header bar's "Open…" button, which shows the app's file chooser. */
export function OpenButton(props: {
  onPress: () => void;
  label?: string;
  focusId?: string;
  disabled?: boolean;
}): ReactNode {
  const ui = getUiScaleFactor();
  return (
    <Button
      width={OPEN_BUTTON_WIDTH * ui}
      height={32 * ui}
      size="small"
      variant="secondary"
      label={props.label ?? "Open…"}
      focusId={props.focusId}
      disabled={props.disabled}
      onPress={props.onPress}
    />
  );
}

/** Lays out a tool row: grouped controls on the left, optional controls or a readout on the right. */
export function ToolRow(props: {
  width: number;
  children?: ReactNode;
  end?: ReactNode;
}): ReactNode {
  const ui = getUiScaleFactor();
  return (
    <Horizontal
      x={10 * ui}
      width={props.width - 20 * ui}
      height={TOOL_ROW * ui}
      gap={2 * ui}
      align="center"
    >
      {props.children}
      <Box flexGrow={1} height={1} />
      {props.end ?? null}
    </Horizontal>
  );
}

/** A hairline between groups in a tool row. */
export function ToolSeparator(): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  return (
    <Box width={13 * ui} height={20 * ui} flexShrink={0}>
      <Separator x={6 * ui} width={1} height={20 * ui} color={pal.borderSubtle} />
    </Box>
  );
}

/** A muted, fixed-width readout in a tool row (zoom level, page count, dimensions). */
export function ToolReadout(props: {
  text: string;
  width?: number;
  align?: "start" | "center" | "end";
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  return (
    <TextBlock
      width={props.width ?? 52 * ui}
      height={32 * ui}
      flexShrink={0}
      text={props.text}
      color={pal.muted}
      fontSize={12}
      horizontalAlign={props.align ?? "center"}
      verticalAlign="center"
      maxLines={1}
      overflow="ellipsis"
    />
  );
}

/** A titled card (Surface fill, subtle stroke) used to group a section of an app's body. */
export function Card(props: {
  x?: number;
  y?: number;
  width: number;
  height: number;
  title?: string;
  /** Right-aligned beside the title (a count, a small action). */
  aside?: ReactNode;
  children?: ReactNode;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const pad = 14 * ui;
  const head = props.title ? 34 * ui : 0;
  return (
    <Surface
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      fill={pal.surface}
      stroke={pal.borderSubtle}
      strokeWidth={1}
      radius={12 * ui}
    >
      {props.title ? (
        <Horizontal
          x={pad}
          y={6 * ui}
          width={props.width - pad * 2}
          height={28 * ui}
          gap={8 * ui}
          align="center"
        >
          <TextBlock
            flexGrow={1}
            text={props.title}
            fontSize={13}
            fontWeight="medium"
            maxLines={1}
            overflow="ellipsis"
          />
          {props.aside ?? null}
        </Horizontal>
      ) : null}
      <Box x={pad} y={head + (props.title ? 4 : 14) * ui} width={props.width - pad * 2}>
        {props.children}
      </Box>
    </Surface>
  );
}
/** Inner size of a Card's content area. */
export function cardContent(width: number, height: number, titled = true) {
  const ui = getUiScaleFactor();
  const head = titled ? 38 * ui : 14 * ui;
  return {
    width: width - 28 * ui,
    height: Math.max(1, height - head - 14 * ui),
  };
}

registerIntrinsicSize(ToolButton, () => ({
  width: 32 * getUiScaleFactor(),
  height: 32 * getUiScaleFactor(),
}));
registerIntrinsicSize(ToolSeparator, () => ({
  width: 13 * getUiScaleFactor(),
  height: 20 * getUiScaleFactor(),
}));
registerIntrinsicSize(ToolReadout, (props) => ({
  width: props.width ?? 52 * getUiScaleFactor(),
  height: 32 * getUiScaleFactor(),
}));
registerIntrinsicSize(OpenButton, () => ({
  width: OPEN_BUTTON_WIDTH * getUiScaleFactor(),
  height: 32 * getUiScaleFactor(),
}));
registerIntrinsicSize(TitleActions, (props) => ({
  width: titleActionsWidth(props.children),
  height: 32 * getUiScaleFactor(),
}));

/** A compact path field with an Open button, for a title bar's actions or a tool row. */
export function FileHeader(props: {
  width: number;
  value: string;
  onOpen: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}): ReactNode {
  const ui = getUiScaleFactor();
  const [draft, setDraft] = useState(props.value);
  return (
    <Horizontal
      x={8 * ui}
      width={props.width - 16 * ui}
      height={44 * ui}
      gap={8 * ui}
      align="center"
    >
      <TextField
        width={Math.max(80 * ui, props.width - 16 * ui - 8 * ui - 72 * ui)}
        height={32 * ui}
        value={draft}
        disabled={props.disabled}
        selectAllOnFocus
        leading={(style) => <Icon name="folder" {...style} />}
        onChange={setDraft}
        onSubmit={() => props.onOpen(draft)}
        placeholder={props.placeholder ?? "Path or file URL"}
      />
      <Button
        width={72 * ui}
        height={32 * ui}
        variant="primary"
        disabled={props.disabled || !draft.trim()}
        label="Open"
        onPress={() => props.onOpen(draft)}
      />
    </Horizontal>
  );
}

/** A path field with a primary Open button; the field keeps its own draft. */
export function OpenPathRow(props: {
  width: number;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  label?: string;
  /** Secondary when another control (a Browse button) is the view's primary action. */
  variant?: "primary" | "secondary";
  onOpen: (file: string) => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const [draft, setDraft] = useState("");
  const buttonW = 80 * ui;
  const submit = () => {
    if (draft.trim() && !props.disabled) props.onOpen(draft.trim());
  };
  return (
    <Horizontal width={props.width} height={36 * ui} gap={8 * ui} align="center">
      <TextField
        width={props.width - 8 * ui - buttonW}
        height={36 * ui}
        value={draft}
        autoFocus={props.autoFocus}
        disabled={props.disabled}
        leading={(style) => <Icon name="folder" {...style} />}
        onChange={setDraft}
        onSubmit={submit}
        placeholder={props.placeholder ?? "Path or file URL"}
      />
      <Button
        width={buttonW}
        height={36 * ui}
        variant={props.variant ?? "primary"}
        label={props.label ?? "Open"}
        disabled={props.disabled || !draft.trim()}
        onPress={submit}
      />
    </Horizontal>
  );
}

/** Height RecentFiles occupies for `count` rows (0 when there are none). */
export function recentFilesHeight(count: number): number {
  const ui = getUiScaleFactor();
  return count ? 24 * ui + count * 40 * ui : 0;
}

/** The files an app opened recently, as pressable rows under a RECENT caption. */
export function RecentFiles(props: {
  width: number;
  files: readonly string[];
  disabled?: boolean;
  onOpen: (file: string) => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const rowH = 40 * ui;
  // Row padding, icon and gaps leave this for the name and its folder, which share it.
  const textW = Math.max(1, props.width - 20 * ui - 18 * ui - 20 * ui);
  const nameW = Math.round(textW * 0.5);
  if (!props.files.length) return null;
  return (
    <Vertical width={props.width} height={recentFilesHeight(props.files.length)} gap={0}>
      <TextBlock
        width={props.width}
        height={24 * ui}
        text="RECENT"
        color={pal.muted}
        fontSize={11}
        fontWeight="medium"
      />
      {props.files.map((file) => (
        <Pressable
          key={file}
          width={props.width}
          height={rowH}
          fill={0x00000000}
          hoverFill={pal.hover}
          pressedFill={pal.pressed}
          radius={8 * ui}
          disabled={props.disabled}
          onPress={() => props.onOpen(file)}
        >
          <Horizontal
            x={10 * ui}
            width={props.width - 20 * ui}
            height={rowH}
            gap={10 * ui}
            align="center"
          >
            <Box width={18 * ui} height={18 * ui} flexShrink={0}>
              <Icon name="file" size={18 * ui} color={pal.muted} symbolic />
            </Box>
            <TextBlock
              width={nameW}
              text={path.basename(file)}
              fontSize={13}
              maxLines={1}
              overflow="ellipsis"
            />
            <TextBlock
              width={textW - nameW}
              text={tidyPath(path.dirname(file))}
              color={pal.muted}
              fontSize={11}
              maxLines={1}
              overflow="ellipsis"
              horizontalAlign="end"
            />
          </Horizontal>
        </Pressable>
      ))}
    </Vertical>
  );
}

/** The accent-tinted rounded tile that carries an app's icon in empty states. */
export function IconTile(props: { icon: ToolIconName; size?: number; color?: number }): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const size = (props.size ?? 56) * ui;
  const color = props.color ?? pal.accent;
  return (
    <Box width={size} height={size} flexShrink={0}>
      <Surface
        width={size}
        height={size}
        radius={size * 0.28}
        fill={(color & 0x00ffffff) | 0x26000000}
      />
      <ToolIcon x={size / 4} y={size / 4} name={props.icon} size={size / 2} color={color} />
    </Box>
  );
}

registerIntrinsicSize(IconTile, (props) => ({
  width: (props.size ?? 56) * getUiScaleFactor(),
  height: (props.size ?? 56) * getUiScaleFactor(),
}));
registerIntrinsicSize(OpenPathRow, (props) => ({
  width: props.width,
  height: 36 * getUiScaleFactor(),
}));
registerIntrinsicSize(RecentFiles, (props) => ({
  width: props.width,
  height: recentFilesHeight(props.files.length),
}));

/**
 * A centred message in an app body: loading, an error, or nothing to show yet. `tone` "danger"
 * tints the icon for errors.
 */
export function CenteredMessage(
  props: WindowSize & {
    icon: ToolIconName;
    title: string;
    message?: string;
    tone?: "accent" | "danger" | "muted";
    action?: ReactNode;
    actionWidth?: number;
  },
): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const contentW = Math.min(420 * ui, props.width - 48 * ui);
  const color =
    props.tone === "danger" ? pal.danger : props.tone === "muted" ? pal.muted : pal.accent;
  const contentH =
    56 * ui + 14 * ui + 26 * ui + (props.message ? 40 * ui : 0) + (props.action ? 52 * ui : 0);
  return (
    <Box width={props.width} height={props.height}>
      <Vertical
        x={(props.width - contentW) / 2}
        y={Math.max(12 * ui, (props.height - contentH) / 2.2)}
        width={contentW}
        gap={0}
        align="center"
      >
        <IconTile icon={props.icon} color={color} />
        <Box width={contentW} height={14 * ui} />
        <TextBlock
          width={contentW}
          height={26 * ui}
          text={props.title}
          fontSize={15}
          fontWeight="medium"
          horizontalAlign="center"
          maxLines={1}
          overflow="ellipsis"
        />
        {props.message ? (
          <TextBlock
            width={contentW}
            height={40 * ui}
            text={props.message}
            color={pal.muted}
            fontSize={12}
            wrap
            maxLines={2}
            overflow="ellipsis"
            horizontalAlign="center"
          />
        ) : null}
        {props.action ? (
          <Box width={props.actionWidth ?? 140 * ui} height={52 * ui}>
            <Box y={16 * ui} width={props.actionWidth ?? 140 * ui} height={36 * ui}>
              {props.action}
            </Box>
          </Box>
        ) : null}
      </Vertical>
    </Box>
  );
}

/**
 * What a file app shows before anything is open: its icon, what it opens, a path field and the
 * files opened recently.
 */
export function OpenFileState(
  props: WindowSize & {
    appId: string;
    icon: ToolIconName;
    title: string;
    message: string;
    placeholder?: string;
    /** An error from the last attempt, shown under the field. */
    error?: string;
    onOpen: (file: string) => void;
    /**
     * Opens the app's file chooser. When given, an "Open…" button is the primary action and the
     * typed path field becomes the secondary way in.
     */
    onBrowse?: () => void;
    browseLabel?: string;
  },
): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const recent = loadRecentFiles(props.appId).slice(0, 5);
  const contentW = Math.min(440 * ui, props.width - 48 * ui);
  const errorH = props.error ? 40 * ui : 0;
  const browseH = props.onBrowse ? 36 * ui + 12 * ui : 0;
  const contentH =
    56 * ui +
    14 * ui +
    26 * ui +
    36 * ui +
    18 * ui +
    browseH +
    36 * ui +
    errorH +
    (recent.length ? 20 * ui + recentFilesHeight(recent.length) : 0);
  return (
    <Box width={props.width} height={props.height}>
      <Vertical
        x={(props.width - contentW) / 2}
        y={Math.max(16 * ui, (props.height - contentH) / 2.4)}
        width={contentW}
        gap={0}
        align="center"
      >
        <IconTile icon={props.icon} />
        <Box width={contentW} height={14 * ui} />
        <TextBlock
          width={contentW}
          text={props.title}
          fontSize={17}
          fontWeight="medium"
          horizontalAlign="center"
        />
        <TextBlock
          width={contentW}
          text={props.message}
          color={pal.muted}
          fontSize={12}
          wrap
          maxLines={2}
          horizontalAlign="center"
        />
        <Box width={contentW} height={18 * ui} />
        {props.onBrowse ? (
          <>
            <Button
              width={Math.min(200 * ui, contentW)}
              height={36 * ui}
              variant="primary"
              label={props.browseLabel ?? "Open…"}
              focusId="open-file:browse"
              autoFocus
              onPress={props.onBrowse}
            />
            <Box width={contentW} height={12 * ui} />
          </>
        ) : null}
        <OpenPathRow
          width={contentW}
          autoFocus={!props.onBrowse}
          variant={props.onBrowse ? "secondary" : "primary"}
          placeholder={props.placeholder}
          onOpen={props.onOpen}
        />
        {props.error ? (
          <TextBlock
            width={contentW}
            height={errorH}
            text={props.error}
            color={pal.danger}
            fontSize={12}
            wrap
            maxLines={2}
            verticalAlign="center"
            horizontalAlign="center"
          />
        ) : null}
        {recent.length ? (
          <>
            <Box width={contentW} height={20 * ui} />
            <RecentFiles width={contentW} files={recent} onOpen={props.onOpen} />
          </>
        ) : null}
      </Vertical>
    </Box>
  );
}

function recentDirectory(): string {
  const state = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(state, "moire", "recent");
}

function recentPath(appId: string): string {
  return path.join(recentDirectory(), `${appId.replace(/[^\w.-]/g, "_")}.json`);
}

/** How many files every app remembers as recent, for Settings' privacy page. */
export function countRecentFiles(): number {
  try {
    return fs
      .readdirSync(recentDirectory())
      .filter((name) => name.endsWith(".json"))
      .reduce((sum, name) => sum + loadRecentFiles(name.slice(0, -".json".length)).length, 0);
  } catch {
    return 0;
  }
}

/** Forget every app's recent files. Throws when a list can't be removed. */
export function clearRecentFiles(): void {
  let names: string[];
  try {
    names = fs.readdirSync(recentDirectory());
  } catch {
    return;
  }
  for (const name of names.filter((entry) => entry.endsWith(".json")))
    fs.rmSync(path.join(recentDirectory(), name), { force: true });
}

/** Files this app opened, most recent first (missing files dropped). */
export function loadRecentFiles(appId: string): string[] {
  try {
    const value = JSON.parse(fs.readFileSync(recentPath(appId), "utf8")) as unknown;
    return Array.isArray(value)
      ? value.filter((file): file is string => typeof file === "string" && fs.existsSync(file))
      : [];
  } catch {
    return [];
  }
}

/** Record a successfully opened file at the top of this app's recent list. */
export function rememberRecentFile(appId: string, file: string): void {
  try {
    const absolute = path.resolve(file);
    const next = [absolute, ...loadRecentFiles(appId).filter((entry) => entry !== absolute)].slice(
      0,
      12,
    );
    const target = recentPath(appId);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(next));
  } catch {
    // Recent files are a convenience; an unwritable state directory is not an error.
  }
}
