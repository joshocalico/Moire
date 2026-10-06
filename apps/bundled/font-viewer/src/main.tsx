import React, { useEffect, useState, type ReactNode } from "react";
import {
  Button,
  Row,
  TextArea,
  ImageWidget,
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
import { fontPreview } from "./backend";
export function FontViewerApp(props: WindowSize & { initialPath?: string }): ReactNode {
  const ui = getUiScaleFactor();
  const [file, setFile] = useState(props.initialPath ?? ""),
    [sample, setSample] = useState("The quick brown fox jumps over the lazy dog. 0123456789"),
    [renderedSample, setRenderedSample] = useState(
      "The quick brown fox jumps over the lazy dog. 0123456789",
    ),
    [size, setSize] = useState(36),
    [page, setPage] = useState(0),
    [pageCount, setPageCount] = useState(0),
    [preview, setPreview] = useState<Preview | null>(null),
    [status, setStatus] = useState("Open a TTF, OTF or TTC font."),
    [revision, setRevision] = useState(0);
  const viewportWidth = Math.min(4096, Math.max(160, Math.floor(props.width - 24 * ui))),
    viewportHeight = Math.min(2048, Math.max(160, Math.floor(props.height - 278 * ui)));
  useEffect(() => {
    if (!file) {
      setPreview(null);
      setPageCount(0);
      setStatus("Open a TTF, OTF or TTC font.");
      return;
    }
    let alive = true,
      loaded: Preview | null = null;
    const controller = new AbortController();
    setPreview(null);
    setStatus("Rendering selected font…");
    void fontPreview(file, renderedSample, size, controller.signal, {
      width: viewportWidth,
      height: viewportHeight,
      page,
    }).then(
      (value) => {
        loaded = value.preview;
        if (alive) {
          setPreview(value.preview);
          setPage(value.page);
          setPageCount(value.pageCount);
          setStatus(`${value.family} · ${value.style} · ${size} px · first face in collections`);
        } else void value.preview.dispose();
      },
      (error) => {
        if (alive) {
          setPageCount(0);
          setStatus(errorText(error));
        }
      },
    );
    return () => {
      alive = false;
      controller.abort();
      if (loaded) void loaded.dispose();
    };
  }, [file, size, revision, renderedSample, page, viewportWidth, viewportHeight]);
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
            setPage(0);
            setFile(value);
            setRevision((revision) => revision + 1);
          }}
        />
      }
      controls={
        <Row width={props.width} height={44 * ui} padding={6 * ui} gap={6 * ui}>
          <Button
            height={32 * ui}
            width={44 * ui}
            label="−"
            disabled={size <= 12}
            onPress={() => {
              setPage(0);
              setSize((value) => value - 4);
            }}
          />
          <Label width={50 * ui} height={30 * ui} text={`${size} px`} />
          <Button
            height={32 * ui}
            width={44 * ui}
            label="+"
            disabled={size >= 96}
            onPress={() => {
              setPage(0);
              setSize((value) => value + 4);
            }}
          />
          <Button
            height={32 * ui}
            width={76 * ui}
            label="Preview"
            onPress={() => {
              setPage(0);
              setRenderedSample(sample);
              setRevision((value) => value + 1);
            }}
          />
        </Row>
      }
    >
      <TextArea
        x={12 * ui}
        y={8 * ui}
        width={props.width - 24 * ui}
        height={94 * ui}
        value={sample}
        onChange={setSample}
        placeholder="Sample text in the selected font"
      />
      <Row
        x={12 * ui}
        y={108 * ui}
        width={Math.max(1, props.width - 24 * ui)}
        height={32 * ui}
        gap={8 * ui}
      >
        <Button
          minWidth={82 * ui}
          height={32 * ui}
          label="Previous"
          focusId="font-page-previous"
          disabled={pageCount === 0 || page <= 0}
          onPress={() => setPage((value) => value - 1)}
        />
        <Label
          width={110 * ui}
          height={32 * ui}
          text={pageCount ? `Page ${page + 1} of ${pageCount}` : "No preview"}
        />
        <Button
          minWidth={58 * ui}
          height={32 * ui}
          label="Next"
          focusId="font-page-next"
          disabled={pageCount === 0 || page + 1 >= pageCount}
          onPress={() => setPage((value) => value + 1)}
        />
      </Row>
      {preview ? (
        <ImageWidget
          x={10 * ui}
          y={152 * ui}
          width={props.width - 20 * ui}
          height={Math.max(1, props.height - 278 * ui)}
          bitmap={preview.bitmap}
          fit="contain"
        />
      ) : (
        <Label
          x={20 * ui}
          y={152 * ui}
          width={props.width - 40 * ui}
          height={Math.max(1, props.height - 278 * ui)}
          text={status}
          wrap
        />
      )}
    </AppFrame>
  );
}
startMain(import.meta.url, () =>
  runApp("Font Viewer", "org.moire.FontViewer", (size) => (
    <FontViewerApp {...size} initialPath={initialFile()} />
  )),
);
