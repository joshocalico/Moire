import React, { useEffect, useState, type ReactNode } from "react";
import {
  Button,
  Row,
  TextField,
  ImageWidget,
  ScrollArea,
  Slider,
  Label,
  getUiScaleFactor,
  type WindowSize,
} from "@moire/ui";
import {
  AppFrame,
  FileHeader,
  errorText,
  initialFile,
  runApp,
  startMain,
  type Preview,
} from "@moire/app-tools";
import { documentInfo, renderPage } from "./backend";
export function DocumentViewerApp(props: WindowSize & { initialPath?: string }): ReactNode {
  const ui = getUiScaleFactor();
  const [file, setFile] = useState(props.initialPath ?? ""),
    [document, setDocument] = useState<Awaited<ReturnType<typeof documentInfo>> | null>(null);
  const [page, setPage] = useState(1),
    [draft, setDraft] = useState("1"),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState(0.5),
    [revision, setRevision] = useState(0),
    [preview, setPreview] = useState<Preview | null>(null),
    [status, setStatus] = useState("Open a PDF document.");
  useEffect(() => {
    if (!file) return;
    let alive = true;
    const controller = new AbortController();
    setDocument(null);
    setPreview(null);
    setStatus("Reading PDF…");
    void documentInfo(file, controller.signal).then(
      (value) => {
        if (alive) {
          setDocument(value);
          setPage(1);
          setDraft("1");
        }
      },
      (error) => {
        if (alive) setStatus(errorText(error));
      },
    );
    return () => {
      alive = false;
      controller.abort();
    };
  }, [file, revision]);
  useEffect(() => {
    if (!document) return;
    let alive = true,
      loaded: Preview | null = null;
    const controller = new AbortController();
    setPreview(null);
    setDraft(String(page));
    setStatus(`Rendering page ${page}…`);
    void renderPage(document.file, page, document.pages, controller.signal).then(
      (value) => {
        loaded = value;
        if (alive) {
          setPreview(value);
          setStatus(`${document.title} · page ${page} of ${document.pages}`);
        } else void value.dispose();
      },
      (error) => {
        if (alive) setStatus(errorText(error));
      },
    );
    return () => {
      alive = false;
      controller.abort();
      if (loaded) void loaded.dispose();
    };
  }, [document, page]);
  const body = Math.max(1, props.height - 118 * ui),
    width = Math.max(1, (props.width - 30 * ui) * zoom),
    height = preview ? (width * preview.height) / preview.width : 1;
  return (
    <AppFrame
      {...props}
      status={status}
      header={
        <FileHeader
          key={file}
          width={props.width}
          value={file}
          onOpen={(value) => {
            setFile(value);
            setRevision((revision) => revision + 1);
          }}
        />
      }
      controls={
        <Row width={props.width} height={44 * ui} padding={6 * ui} gap={6 * ui}>
          <Button
            height={32 * ui}
            width={80 * ui}
            label="Previous"
            disabled={!document || page === 1}
            onPress={() => setPage((value) => value - 1)}
          />
          <TextField
            height={32 * ui}
            width={64 * ui}
            value={draft}
            onChange={setDraft}
            onSubmit={() => {
              const next = Number(draft);
              if (document && Number.isInteger(next) && next >= 1 && next <= document.pages)
                setPage(next);
              else setStatus("Enter a valid page number.");
            }}
          />
          <Button
            height={32 * ui}
            width={66 * ui}
            label="Next"
            disabled={!document || page >= document.pages}
            onPress={() => setPage((value) => value + 1)}
          />
          <Button
            height={32 * ui}
            width={44 * ui}
            label="−"
            onPress={() => setZoom((value) => Math.max(0.25, value / 1.25))}
          />
          <Button
            height={32 * ui}
            width={44 * ui}
            label="+"
            onPress={() => setZoom((value) => Math.min(3, value * 1.25))}
          />
          <Button height={32 * ui} width={80 * ui} label="Fit width" onPress={() => setZoom(1)} />
          <Label width={36 * ui} height={32 * ui} text="Pan" />
          <Slider
            width={Math.max(50 * ui, Math.min(130 * ui, props.width - 620 * ui))}
            height={32 * ui}
            value={pan}
            disabled={width <= props.width}
            onChange={setPan}
          />
        </Row>
      }
    >
      {preview ? (
        <ScrollArea
          width={props.width}
          height={body}
          contentHeight={Math.max(body, height + 20 * ui)}
        >
          <ImageWidget
            x={width > props.width ? -(width - props.width) * pan : (props.width - width) / 2}
            y={10 * ui}
            width={width}
            height={height}
            bitmap={preview.bitmap}
            fit="fill"
          />
        </ScrollArea>
      ) : (
        <Label
          x={20 * ui}
          y={20 * ui}
          width={props.width - 40 * ui}
          height={100 * ui}
          text={status}
          wrap
        />
      )}
    </AppFrame>
  );
}
startMain(import.meta.url, () =>
  runApp("Document Viewer", "org.moire.DocumentViewer", (size) => (
    <DocumentViewerApp {...size} initialPath={initialFile()} />
  )),
);
