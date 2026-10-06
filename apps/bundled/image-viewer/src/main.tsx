import React, { useEffect, useState, type ReactNode } from "react";
import {
  Button,
  Row,
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
import { decodeImage } from "./backend";
export function ImageViewerApp(props: WindowSize & { initialPath?: string }): ReactNode {
  const ui = getUiScaleFactor();
  const [file, setFile] = useState(props.initialPath ?? "");
  const [turns, setTurns] = useState(0),
    [zoom, setZoom] = useState<number | null>(null),
    [pan, setPan] = useState(0.5),
    [revision, setRevision] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null),
    [status, setStatus] = useState("Open an image using its path or file URL.");
  useEffect(() => {
    if (!file) return;
    let alive = true,
      loaded: Preview | null = null;
    const controller = new AbortController();
    setPreview(null);
    setStatus("Decoding image…");
    void decodeImage(file, turns, controller.signal).then(
      (value) => {
        loaded = value;
        if (alive) {
          setPreview(value);
          setStatus(
            `${value.width} × ${value.height} · rotation is a preview; original file unchanged`,
          );
        } else void value.dispose();
      },
      (error: unknown) => {
        if (alive) setStatus(errorText(error));
      },
    );
    return () => {
      alive = false;
      controller.abort();
      if (loaded) void loaded.dispose();
    };
  }, [file, turns, revision]);
  const bodyHeight = Math.max(1, props.height - 118 * ui);
  const scale = preview
    ? (zoom ??
      Math.min((props.width - 20 * ui) / preview.width, (bodyHeight - 20) / preview.height))
    : 1;
  const width = preview ? Math.max(1, Math.round(preview.width * scale)) : 1;
  const height = preview ? Math.max(1, Math.round(preview.height * scale)) : 1;
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
            setTurns(0);
            setZoom(null);
          }}
        />
      }
      controls={
        <Row width={props.width} height={44 * ui} padding={6 * ui} gap={6 * ui}>
          <Button height={32 * ui} label="Fit" width={48 * ui} onPress={() => setZoom(null)} />
          <Button height={32 * ui} label="100%" width={60 * ui} onPress={() => setZoom(1)} />
          <Button
            height={32 * ui}
            label="−"
            width={40 * ui}
            disabled={!preview}
            onPress={() => setZoom(Math.max(0.05, scale / 1.25))}
          />
          <Button
            height={32 * ui}
            label="+"
            width={40 * ui}
            disabled={!preview}
            onPress={() => setZoom(Math.min(8, scale * 1.25))}
          />
          <Button
            height={32 * ui}
            label={props.width < 720 * ui ? "Left" : "Rotate left"}
            width={props.width < 720 * ui ? 54 * ui : 98 * ui}
            disabled={!preview}
            onPress={() => setTurns((value) => value - 1)}
          />
          <Button
            height={32 * ui}
            label={props.width < 720 * ui ? "Right" : "Rotate right"}
            width={props.width < 720 * ui ? 54 * ui : 100 * ui}
            disabled={!preview}
            onPress={() => setTurns((value) => value + 1)}
          />
          <Label width={36 * ui} height={32 * ui} text="Pan" />
          <Slider
            height={32 * ui}
            width={props.width < 720 * ui ? 90 * ui : 130 * ui}
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
          height={bodyHeight}
          contentHeight={Math.max(bodyHeight, height + 20 * ui)}
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
  runApp("Image Viewer", "org.moire.ImageViewer", (size) => (
    <ImageViewerApp {...size} initialPath={initialFile()} />
  )),
);
