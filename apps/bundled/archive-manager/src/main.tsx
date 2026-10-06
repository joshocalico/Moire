import React, { useEffect, useState, type ReactNode } from "react";
import {
  Button,
  Row,
  Column,
  TextField,
  TextArea,
  ScrollArea,
  Label,
  getUiScaleFactor,
  type WindowSize,
} from "@moire/ui";
import { AppFrame, FileHeader, errorText, initialFile, runApp, startMain } from "@moire/app-tools";
import { createArchive, extractArchive, listArchive } from "./backend";
export function ArchiveManagerApp(props: WindowSize & { initialPath?: string }): ReactNode {
  const ui = getUiScaleFactor();
  const [file, setFile] = useState(props.initialPath ?? ""),
    [entries, setEntries] = useState<string[]>([]),
    [destination, setDestination] = useState(""),
    [sources, setSources] = useState("");
  const [status, setStatus] = useState(
      "Open an archive, or enter source paths and a new .tar.gz output path.",
    ),
    [controller, setController] = useState<AbortController | null>(null),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!file) return;
    let alive = true;
    const operation = new AbortController();
    setEntries([]);
    setStatus("Reading archive…");
    void listArchive(file, operation.signal).then(
      (value) => {
        if (alive) {
          setEntries(value.entries);
          setStatus(`${value.entries.length} entries · extraction always uses a new folder`);
        }
      },
      (error) => {
        if (alive) setStatus(errorText(error));
      },
    );
    return () => {
      alive = false;
      operation.abort();
    };
  }, [file, revision]);
  useEffect(
    () => () => {
      controller?.abort();
    },
    [controller],
  );
  const perform = async (kind: "extract" | "create") => {
    if (controller) return;
    const operation = new AbortController();
    setController(operation);
    setStatus(kind === "extract" ? "Extracting archive…" : "Creating archive…");
    try {
      const result =
        kind === "extract"
          ? await extractArchive(file, destination, operation.signal)
          : await createArchive(
              sources
                .split("\n")
                .map((value) => value.trim())
                .filter(Boolean),
              destination,
              operation.signal,
            );
      setStatus(`Completed: ${result}`);
      if (kind === "create") {
        setFile(result);
        setRevision((value) => value + 1);
      }
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setController(null);
    }
  };
  const compact = props.width < 560 * ui;
  const controlsHeight = (compact ? 82 : 44) * ui;
  const body = Math.max(1, props.height - 74 * ui - controlsHeight);
  const actions = (
    <>
      <Button
        height={32 * ui}
        width={compact ? (props.width - 24 * ui) / 3 : 72 * ui}
        label="Extract"
        disabled={!file || !destination || !!controller}
        onPress={() => void perform("extract")}
      />
      <Button
        height={32 * ui}
        width={compact ? (props.width - 24 * ui) / 3 : 72 * ui}
        label="Create"
        disabled={!sources || !destination || !!controller}
        onPress={() => void perform("create")}
      />
      <Button
        height={32 * ui}
        width={compact ? (props.width - 24 * ui) / 3 : 72 * ui}
        label="Cancel"
        disabled={!controller}
        onPress={() => controller?.abort()}
      />
    </>
  );
  const destinationInput = (
    <TextField
      height={32 * ui}
      width={Math.max(1, props.width - (compact ? 12 : 246) * ui)}
      value={destination}
      onChange={setDestination}
      placeholder="New extraction folder or .tar.gz output path"
      disabled={!!controller}
    />
  );
  return (
    <AppFrame
      {...props}
      status={status}
      controlsHeight={controlsHeight}
      header={
        <FileHeader
          key={file}
          disabled={!!controller}
          width={props.width}
          value={file}
          onOpen={(value) => {
            if (!controller) {
              setFile(value);
              setRevision((value) => value + 1);
            }
          }}
        />
      }
      controls={
        compact ? (
          <Column width={props.width} height={controlsHeight} padding={6 * ui} gap={6 * ui}>
            {destinationInput}
            <Row width={props.width - 12 * ui} height={32 * ui} gap={6 * ui}>
              {actions}
            </Row>
          </Column>
        ) : (
          <Row width={props.width} height={controlsHeight} padding={6 * ui} gap={6 * ui}>
            {destinationInput}
            {actions}
          </Row>
        )
      }
    >
      <Label
        x={12 * ui}
        y={10 * ui}
        width={props.width - 24 * ui}
        height={24 * ui}
        text="Create from one local path per line:"
      />
      <TextArea
        height={94 * ui}
        x={12 * ui}
        y={40 * ui}
        width={props.width - 24 * ui}
        value={sources}
        onChange={setSources}
        placeholder="/path/to/file\n/path/to/folder"
        disabled={!!controller}
      />
      <ScrollArea
        y={150 * ui}
        width={props.width}
        height={Math.max(1, body - 150 * ui)}
        contentHeight={Math.max(body - 150 * ui, entries.length * 26 * ui + 10 * ui)}
      >
        {entries.map((entry, index) => (
          <Label
            key={`${index}:${entry}`}
            x={12 * ui}
            y={index * 26 * ui + 6 * ui}
            width={props.width - 30 * ui}
            height={24 * ui}
            text={entry}
            fontFamily="mono"
            fontSize={11}
          />
        ))}
      </ScrollArea>
    </AppFrame>
  );
}
startMain(import.meta.url, () =>
  runApp("Archive Manager", "org.moire.ArchiveManager", (size) => (
    <ArchiveManagerApp {...size} initialPath={initialFile()} />
  )),
);
