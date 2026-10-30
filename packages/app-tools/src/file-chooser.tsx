/**
 * The file chooser shared by Moire's file apps: open a file, choose where to save one, or pick a
 * folder. Places on the left (home folders and the app's recent files), the current folder as
 * breadcrumbs (or a typed path), and its folders and matching files on the right.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React, { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Box,
  Button,
  CollectionList,
  CollectionRow,
  ConfirmationDialog,
  Dialog,
  FocusScope,
  Horizontal,
  Icon,
  IconButton,
  ModalBarrier,
  NavigationSidebar,
  PathBar,
  TextField,
  Vertical,
  getUiScaleFactor,
  type IconName,
  type NavigationSidebarSection,
  type WindowSize,
} from "@moire/ui";
import { formatBytes } from "./format";
import { loadRecentFiles } from "./frame";

export type FileChooserMode = "open" | "save" | "folder";

export type FileChooserProps = WindowSize & {
  mode: FileChooserMode;
  /** The app whose recent files appear under Recent. */
  appId: string;
  title?: string;
  /** File extensions this app opens (without dots); omitted means any file. */
  accept?: readonly string[];
  /** Folder to start in; defaults to the last place used, then the most fitting home folder. */
  directory?: string;
  /** Save mode: the suggested file name. */
  name?: string;
  /** Open mode: let several files be picked; they arrive through `onChooseMany`. */
  multiple?: boolean;
  onChoose(file: string): void;
  onChooseMany?(files: string[]): void;
  onCancel(): void;
};

type Entry = {
  path: string;
  name: string;
  folder: boolean;
  size: number;
  modified: number;
};

const RECENT = "recent:";
const home = () => os.homedir();
/** Each app reopens its chooser where it was last used (kept beside its recent files). */
function lastDirectoryPath(appId: string): string {
  const state = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(state, "moire", "chooser", `${appId.replace(/[^\w.-]/g, "_")}.json`);
}
function loadLastDirectory(appId: string): string | undefined {
  try {
    const value = JSON.parse(fs.readFileSync(lastDirectoryPath(appId), "utf8")) as unknown;
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}
function saveLastDirectory(appId: string, directory: string): void {
  try {
    const target = lastDirectoryPath(appId);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(directory));
  } catch {
    // Remembering the folder is a convenience; an unwritable state directory is not an error.
  }
}

const PLACES: ReadonlyArray<{ id: string; label: string; icon: IconName }> = [
  { id: "", label: "Home", icon: "home" },
  { id: "Desktop", label: "Desktop", icon: "desktop" },
  { id: "Documents", label: "Documents", icon: "document" },
  { id: "Downloads", label: "Downloads", icon: "downloads" },
  { id: "Pictures", label: "Pictures", icon: "image" },
  { id: "Music", label: "Music", icon: "music" },
  { id: "Videos", label: "Videos", icon: "video" },
];

function existingDirectory(candidate: string | undefined): string | null {
  if (!candidate) return null;
  try {
    return fs.statSync(candidate).isDirectory() ? candidate : null;
  } catch {
    return null;
  }
}

/** Where a chooser starts: the given folder, the last one used, or the home folder that fits. */
function startDirectory(props: Pick<FileChooserProps, "directory" | "accept" | "appId">): string {
  const fitting = props.accept?.some((ext) => ["png", "jpg", "jpeg", "webp", "gif"].includes(ext))
    ? "Pictures"
    : props.accept?.some((ext) => ["mp4", "mkv", "webm", "mov"].includes(ext))
      ? "Videos"
      : props.accept?.some((ext) => ["mp3", "flac", "ogg", "wav", "m4a"].includes(ext))
        ? "Music"
        : "Documents";
  return (
    existingDirectory(props.directory) ??
    existingDirectory(loadLastDirectory(props.appId)) ??
    existingDirectory(path.join(home(), fitting)) ??
    home()
  );
}

function readDirectory(directory: string): Entry[] {
  const entries: Entry[] = [];
  for (const dirent of fs.readdirSync(directory, { withFileTypes: true })) {
    if (dirent.name.startsWith(".")) continue;
    const full = path.join(directory, dirent.name);
    try {
      const stat = fs.statSync(full);
      entries.push({
        path: full,
        name: dirent.name,
        folder: stat.isDirectory(),
        size: stat.size,
        modified: stat.mtimeMs,
      });
    } catch {
      // Broken links and unreadable entries are not offered.
    }
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
  return entries.sort((a, b) =>
    a.folder !== b.folder ? (a.folder ? -1 : 1) : collator.compare(a.name, b.name),
  );
}

function formatModified(ms: number): string {
  const date = new Date(ms);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function iconFor(entry: Entry): IconName {
  if (entry.folder) return "folder";
  const ext = path.extname(entry.name).slice(1).toLowerCase();
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff", "svg"].includes(ext)) return "image";
  if (["mp3", "flac", "ogg", "wav", "m4a", "opus"].includes(ext)) return "music";
  if (["mp4", "mkv", "webm", "mov", "avi"].includes(ext)) return "video";
  if (["ttf", "otf", "ttc", "woff", "woff2"].includes(ext)) return "font";
  if (["zip", "tar", "gz", "tgz", "xz", "bz2", "7z"].includes(ext)) return "archive";
  return ext === "pdf" ? "document" : "file";
}

export function FileChooser(props: FileChooserProps): ReactNode {
  const ui = getUiScaleFactor();
  const [directory, setDirectory] = useState(() => startDirectory(props));
  const [name, setName] = useState(props.name ?? "");
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  /** Files picked so far when several may be chosen. */
  const [picked, setPicked] = useState<readonly string[]>([]);
  /** Save mode: an existing file awaiting confirmation before it is replaced. */
  const [replacing, setReplacing] = useState<string | null>(null);
  const many = props.mode === "open" && !!props.multiple && !!props.onChooseMany;
  const accept = useMemo(
    () => (props.accept ? new Set(props.accept.map((ext) => ext.toLowerCase())) : null),
    [props.accept],
  );
  const [entries, setEntries] = useState<Entry[]>([]);
  useEffect(() => {
    setSelected(null);
    if (directory === RECENT) {
      setEntries(
        loadRecentFiles(props.appId).map((file) => {
          const stat = fs.statSync(file);
          return {
            path: file,
            name: path.basename(file),
            folder: false,
            size: stat.size,
            modified: stat.mtimeMs,
          };
        }),
      );
      setError("");
      return;
    }
    try {
      setEntries(readDirectory(directory));
      setError("");
      saveLastDirectory(props.appId, directory);
    } catch (cause) {
      setEntries([]);
      setError(cause instanceof Error ? cause.message : "This folder can't be read.");
    }
  }, [directory, props.appId]);

  const visible = entries.filter((entry) =>
    props.mode === "folder"
      ? entry.folder
      : entry.folder || !accept || accept.has(path.extname(entry.name).slice(1).toLowerCase()),
  );
  const selectedEntry = visible.find((entry) => entry.path === selected) ?? null;

  const choose = (file: string) => {
    if (props.mode !== "save") return props.onChoose(file);
    const target = path.resolve(directory === RECENT ? home() : directory, file);
    // Never replace a file without saying so.
    if (fs.existsSync(target)) setReplacing(target);
    else props.onChoose(target);
  };
  const togglePicked = (file: string) =>
    setPicked((current) =>
      current.includes(file) ? current.filter((entry) => entry !== file) : [...current, file],
    );
  const finishMany = (extra?: string) => {
    const files = extra && !picked.includes(extra) ? [...picked, extra] : picked;
    if (files.length) props.onChooseMany?.([...files]);
  };
  const activate = (entry: Entry) => {
    if (entry.folder) setDirectory(entry.path);
    else if (props.mode === "save") setName(entry.name);
    else if (many) finishMany(entry.path);
    else choose(entry.path);
  };
  const primary = () => {
    if (props.mode === "save") {
      if (name.trim()) choose(name.trim());
    } else if (props.mode === "folder") {
      choose(selectedEntry?.folder ? selectedEntry.path : directory);
    } else if (many && picked.length && !selectedEntry?.folder) finishMany();
    else if (selectedEntry) activate(selectedEntry);
  };
  const primaryLabel =
    props.mode === "save"
      ? "Save"
      : props.mode === "folder"
        ? selectedEntry?.folder
          ? "Choose folder"
          : "Choose this folder"
        : selectedEntry?.folder && !(many && picked.length)
          ? "Open folder"
          : many && picked.length > 1
            ? `Open ${picked.length} files`
            : "Open";
  const primaryDisabled =
    props.mode === "save"
      ? !name.trim() || directory === RECENT
      : props.mode === "open"
        ? !selectedEntry && !(many && picked.length)
        : directory === RECENT;

  // Breadcrumbs from home (shown as "Home") or from the filesystem root.
  const segments = useMemo(() => {
    if (directory === RECENT) return [{ id: RECENT, label: "Recent" }];
    const base =
      directory === home() || directory.startsWith(home() + path.sep)
        ? home()
        : path.parse(directory).root;
    const rest = path.relative(base, directory).split(path.sep).filter(Boolean);
    const out = [{ id: base, label: base === home() ? "Home" : base }];
    let at = base;
    for (const part of rest) {
      at = path.join(at, part);
      out.push({ id: at, label: part });
    }
    return out;
  }, [directory]);

  const sections: NavigationSidebarSection[] = [
    {
      id: "places",
      items: [
        ...(loadRecentFiles(props.appId).length && props.mode !== "folder"
          ? [{ id: RECENT, label: "Recent", icon: "history" as IconName }]
          : []),
        ...PLACES.map((place) => ({
          id: path.join(home(), place.id),
          label: place.label,
          icon: place.icon,
        })).filter((place) => existingDirectory(place.id)),
      ],
    },
  ];

  const width = Math.min(820 * ui, props.width - 32 * ui);
  const height = Math.min(560 * ui, props.height - 32 * ui);
  const sidebarW = Math.min(180 * ui, width * 0.3);
  const bodyW = width - sidebarW - 48 * ui;
  const listH = Math.max(120 * ui, height - 190 * ui - (props.mode === "save" ? 48 * ui : 0));
  const title =
    props.title ??
    (props.mode === "save" ? "Save as" : props.mode === "folder" ? "Choose a folder" : "Open");

  return (
    <Box width={props.width} height={props.height}>
      <ModalBarrier
        width={props.width}
        height={props.height}
        visible
        active
        onDismiss={props.onCancel}
      />
      <FocusScope
        id="file-chooser"
        width={props.width}
        height={props.height}
        trap
        onEscape={props.onCancel}
      >
        <Dialog
          x={(props.width - width) / 2}
          y={(props.height - height) / 2}
          width={width}
          height={height}
          title={title}
          onClose={props.onCancel}
          footer={
            <Horizontal width={width - 40 * ui} height={36 * ui} gap={8 * ui} align="center">
              <Box flexGrow={1} height={1} />
              <Button
                height={34 * ui}
                variant="secondary"
                label="Cancel"
                onPress={props.onCancel}
              />
              <Button
                height={34 * ui}
                variant="primary"
                label={primaryLabel}
                disabled={primaryDisabled}
                onPress={primary}
              />
            </Horizontal>
          }
        >
          <Horizontal
            width={width - 40 * ui}
            height={height - 150 * ui}
            gap={12 * ui}
            align="start"
          >
            <NavigationSidebar
              width={sidebarW}
              height={height - 150 * ui}
              sections={sections}
              selectedId={directory}
              onSelect={(item) => setDirectory(item.id)}
            />
            <Vertical width={bodyW} gap={8 * ui}>
              <Horizontal width={bodyW} height={34 * ui} gap={6 * ui} align="center">
                <IconButton
                  width={34 * ui}
                  height={34 * ui}
                  variant="ghost"
                  tooltip="Enclosing folder"
                  disabled={directory === RECENT || path.dirname(directory) === directory}
                  icon={(style) => <Icon name="up" {...style} />}
                  onPress={() => setDirectory(path.dirname(directory))}
                />
                <PathBar
                  width={bodyW - 40 * ui}
                  height={34 * ui}
                  segments={segments}
                  value={directory === RECENT ? "" : directory}
                  onNavigate={(id) => setDirectory(id)}
                  onCommit={(value) => {
                    const typed = value.trim().replace(/^~(?=$|\/)/, home());
                    if (existingDirectory(typed)) {
                      setDirectory(typed);
                      return undefined;
                    }
                    if (props.mode !== "folder" && fs.existsSync(typed)) {
                      choose(typed);
                      return undefined;
                    }
                    return "No such folder";
                  }}
                />
              </Horizontal>
              <CollectionList
                width={bodyW}
                height={listH}
                items={visible}
                getKey={(entry) => entry.path}
                selectedKey={selected}
                onSelect={(entry, source) => {
                  if (many && !entry.folder && source === "pointer") togglePicked(entry.path);
                  setSelected(entry.path);
                  if (props.mode === "save" && !entry.folder) setName(entry.name);
                }}
                onActivate={activate}
                focusId="file-chooser:list"
                autoFocus
                rowHeight={40 * ui}
                emptyMessage={error || (accept ? "No matching files here" : "This folder is empty")}
                renderItem={(entry, row) => (
                  <CollectionRow
                    width={row.width}
                    height={row.height}
                    selected={row.selected}
                    title={entry.name}
                    metadata={
                      entry.folder
                        ? formatModified(entry.modified)
                        : `${formatModified(entry.modified)} · ${formatBytes(entry.size)}`
                    }
                    leading={
                      <Icon
                        name={many && picked.includes(entry.path) ? "check-circle" : iconFor(entry)}
                        size={20 * ui}
                        symbolic
                      />
                    }
                  />
                )}
              />
              {props.mode === "save" ? (
                <TextField
                  width={bodyW}
                  height={36 * ui}
                  value={name}
                  placeholder="File name"
                  focusId="file-chooser:name"
                  leading={(style) => <Icon name="file" {...style} />}
                  onChange={setName}
                  onSubmit={primary}
                />
              ) : null}
            </Vertical>
          </Horizontal>
        </Dialog>
      </FocusScope>
      <ConfirmationDialog
        open={replacing !== null}
        viewportWidth={props.width}
        viewportHeight={props.height}
        title={`Replace “${replacing ? path.basename(replacing) : ""}”?`}
        message={`A file with this name already exists in ${
          replacing ? path.basename(path.dirname(replacing)) || path.dirname(replacing) : ""
        }. Replacing it overwrites its contents.`}
        confirmLabel="Replace"
        cancelLabel="Cancel"
        danger
        onConfirm={() => {
          const target = replacing;
          setReplacing(null);
          if (target) props.onChoose(target);
        }}
        onDismiss={() => setReplacing(null)}
      />
    </Box>
  );
}
