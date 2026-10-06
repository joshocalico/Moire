import React, { useEffect, useRef, useState, type ReactNode } from "react";
import os from "node:os";
import {
  Button,
  Label,
  Row,
  Column,
  TextField,
  SearchField,
  ScrollArea,
  Pressable,
  ProgressBar,
  Surface,
  usePalette,
  getUiScaleFactor,
  type WindowSize,
} from "@moire/ui";
import { initialFile, localPath, runApp, startMain } from "@moire/app-tools";
import { scanUsage, sizeLabel, type UsageScan, type UsageNode } from "./scan";

export function DiskUsageApp(props: WindowSize & { initialPath?: string }): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette(),
    [location, setLocation] = useState(props.initialPath ?? os.homedir());
  const [scan, setScan] = useState<UsageScan | null>(null),
    [trail, setTrail] = useState<UsageNode[]>([]);
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("Choose a folder to explore its allocated storage"),
    [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null),
    disposed = useRef(false);
  const scanFolder = async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setStatus("Scanning…");
    setScan(null);
    setTrail([]);
    try {
      const result = await scanUsage(localPath(location), {
        signal: controller.signal,
        onProgress: (entries) => {
          if (!disposed.current && !controller.signal.aborted)
            setStatus(`Scanning · ${entries.toLocaleString()} entries`);
        },
      });
      if (disposed.current || controller.signal.aborted) return;
      setScan(result);
      setTrail([result.root]);
      setStatus(
        `${result.entries.toLocaleString()} entries · ${result.skipped.length} skipped${result.truncated ? " · Partial scan: limit reached" : ""} · symlinks and other filesystems are not followed`,
      );
    } catch (error) {
      if (!disposed.current && !controller.signal.aborted)
        setStatus(`Scan failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (active.current === controller && !disposed.current) setBusy(false);
    }
  };
  useEffect(
    () => () => {
      disposed.current = true;
      active.current?.abort();
    },
    [],
  );
  const current = trail.at(-1),
    width = Math.max(1, props.width - 32 * ui),
    listHeight = Math.max(80 * ui, props.height - 254 * ui);
  const children = (current?.children ?? []).filter((item) =>
    item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <Surface width={props.width} height={props.height} fill={pal.bg}>
      <Column x={16 * ui} y={16 * ui} width={width} height={props.height - 32 * ui} gap={12 * ui}>
        <Row width={width} height={32 * ui} gap={10 * ui}>
          <Label
            width={Math.max(1, width - 100 * ui)}
            height={32 * ui}
            text="Disk Usage"
            fontSize={22}
            fontWeight="medium"
          />
          <Button
            width={90 * ui}
            height={32 * ui}
            label={busy ? "Cancel" : "Scan"}
            onPress={() => {
              if (busy) {
                active.current?.abort();
                setBusy(false);
                setStatus("Scan cancelled");
              } else void scanFolder();
            }}
          />
        </Row>
        <TextField
          width={width}
          height={34 * ui}
          value={location}
          onChange={setLocation}
          onSubmit={() => void scanFolder()}
          placeholder="Folder path"
        />
        <Row width={width} height={32 * ui} gap={10 * ui}>
          <Button
            width={70 * ui}
            height={32 * ui}
            label="Up"
            disabled={trail.length < 2}
            onPress={() => setTrail((items) => items.slice(0, -1))}
          />
          <Label
            width={Math.max(1, width - 80 * ui)}
            height={32 * ui}
            text={
              current
                ? `${current.name} · ${sizeLabel(current.allocated)} allocated · ${sizeLabel(current.logical)} logical`
                : "Scan a folder, then open its largest subfolders"
            }
            overflow="ellipsis"
          />
        </Row>
        <SearchField
          width={width}
          height={32 * ui}
          value={query}
          onChange={setQuery}
          placeholder="Filter this folder"
        />
        <ScrollArea
          width={width}
          height={listHeight}
          contentHeight={Math.max(listHeight, children.length * 58 * ui)}
        >
          <Column
            width={width - 12 * ui}
            height={Math.max(listHeight, children.length * 58 * ui)}
            gap={4 * ui}
          >
            {children.map((item) => (
              <Pressable
                key={item.path}
                width={width - 12 * ui}
                height={54 * ui}
                focusId={`usage:${item.path}`}
                focusable={item.kind === "directory"}
                disabled={item.kind !== "directory"}
                onPress={
                  item.kind !== "directory"
                    ? undefined
                    : () => {
                        setTrail((items) => [...items, item]);
                        setQuery("");
                      }
                }
              >
                <Column x={8 * ui} y={5 * ui} width={width - 28 * ui} height={44 * ui} gap={5 * ui}>
                  <Row width={width - 28 * ui} height={22 * ui} justify="space-between">
                    <Label
                      width={Math.max(1, width - 165 * ui)}
                      height={22 * ui}
                      text={`${item.kind === "directory" ? "> " : item.kind === "symlink" ? "@ " : ""}${item.name}`}
                      overflow="ellipsis"
                    />
                    <Label
                      width={120 * ui}
                      height={22 * ui}
                      text={sizeLabel(item.allocated)}
                      horizontalAlign="end"
                      fontFamily="mono"
                    />
                  </Row>
                  <ProgressBar
                    width={width - 28 * ui}
                    height={7 * ui}
                    value={current?.allocated ? item.allocated / current.allocated : 0}
                  />
                </Column>
              </Pressable>
            ))}
            {scan && children.length === 0 && (
              <Label
                width={width - 20 * ui}
                height={40 * ui}
                text={query ? "No matching entries" : "This folder is empty"}
                color={pal.muted}
              />
            )}
          </Column>
        </ScrollArea>
        <Label
          width={width}
          height={32 * ui}
          text={status}
          fontSize={11}
          color={pal.muted}
          wrap
          maxLines={2}
        />
      </Column>
    </Surface>
  );
}
startMain(import.meta.url, () =>
  runApp("Disk Usage", "org.moire.DiskUsage", (size) => (
    <DiskUsageApp {...size} initialPath={initialFile() || undefined} />
  )),
);
