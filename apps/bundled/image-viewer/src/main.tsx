import path from "node:path";
import React, { useReducer, useState, type ReactNode } from "react";
import { ShortcutManager, type WindowActions, type WindowSize } from "@moire/ui";
import {
  AppFrame,
  FileChooser,
  OpenButton,
  OpenFileState,
  TitleActions,
  ToolButton,
  appFrameBody,
  errorText,
  initialFile,
  localPath,
  runApp,
  showInFiles,
  startMain,
  useShownSize,
  useZoom,
  zoomShortcuts,
} from "@moire/app-tools";
import { useDecodedImage, useFolderImages, useScaledImage } from "./hooks";
import { IMAGE_EXTENSIONS, folderPosition, initialState, neighbour, reduce } from "./model";
import { ImageBody } from "./views/image-body";
import { ImageToolbar } from "./views/image-toolbar";

const APP_ID = "org.moire.ImageViewer";
const TITLE = "Image Viewer";

export function ImageViewerApp(
  props: WindowSize & { initialPath?: string; window?: WindowActions | null },
): ReactNode {
  const [state, dispatch] = useReducer(reduce, props.initialPath, initialState);
  const [choosing, setChoosing] = useState(false);
  const [notice, setNotice] = useState("");
  const file = state.kind === "open" ? state.file : "";
  const load = useDecodedImage(state, APP_ID);
  const folder = useFolderImages(file);
  const position = file ? folderPosition(folder.images, file) : null;
  const body = appFrameBody({
    height: props.height,
    title: TITLE,
    controls: !!file,
  });
  const preview = load.kind === "ready" ? load.preview : null;
  const zoom = useZoom(`${file}:${state.kind === "open" ? state.turns : 0}`, preview, {
    width: props.width,
    height: body.height,
  });
  // Shown smaller than its size, the image is drawn from a copy decoded at the shown size.
  const scaled = useScaledImage(state, preview, useShownSize(zoom, !!preview));

  const open = (value: string) => {
    setNotice("");
    try {
      dispatch({ type: "open", file: localPath(value) });
    } catch (error) {
      dispatch({ type: "close", error: errorText(error) });
    }
  };
  const step = (delta: 1 | -1) => {
    const next = neighbour(folder.images, file, delta);
    if (next) open(next);
  };
  const reveal = () =>
    showInFiles(file).then(
      () => setNotice(`Opened ${path.basename(path.dirname(file))} in Files`),
      (error: unknown) => setNotice(errorText(error)),
    );

  const status =
    notice ||
    (load.kind === "loading"
      ? "Decoding image…"
      : load.kind === "error"
        ? load.message
        : preview
          ? state.kind === "open" && state.turns % 4
            ? "Rotation is a preview; the original file is unchanged"
            : "Scroll to zoom, drag to move, ← → for the folder's other images"
          : folder.error || "Open a PNG, JPEG, WebP, GIF, BMP or TIFF image");
  const statusEnd = [
    position && position.total > 1 ? `${position.index + 1} of ${position.total}` : "",
    preview ? `${preview.width} × ${preview.height}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <ShortcutManager
      width={props.width}
      height={props.height}
      enabled={!!file && !choosing}
      shortcuts={[
        {
          id: "previous",
          key: "ArrowLeft",
          allowRepeat: true,
          onInvoke: () => step(-1),
        },
        {
          id: "next",
          key: "ArrowRight",
          allowRepeat: true,
          onInvoke: () => step(1),
        },
        { id: "open", key: "o", ctrl: true, onInvoke: () => setChoosing(true) },
        ...zoomShortcuts(zoom, !preview),
      ]}
    >
      <AppFrame
        {...props}
        title={TITLE}
        icon="image"
        subtitle={file ? path.basename(file) : undefined}
        status={status}
        statusEnd={statusEnd || undefined}
        actions={
          file ? (
            <TitleActions>
              <ToolButton
                icon="folder"
                tooltip="Show in Files"
                focusId="image:show-in-files"
                onPress={() => void reveal()}
              />
              <OpenButton focusId="image:open" onPress={() => setChoosing(true)} />
            </TitleActions>
          ) : null
        }
        controls={
          file ? (
            <ImageToolbar
              width={props.width}
              zoom={zoom}
              ready={!!preview}
              position={position}
              onStep={step}
              onRotate={(by) => dispatch({ type: "rotate", by })}
            />
          ) : undefined
        }
      >
        {file ? (
          <ImageBody
            width={props.width}
            height={body.height}
            file={file}
            load={load}
            scaled={scaled}
            zoom={zoom}
            onRetry={() => dispatch({ type: "retry" })}
          />
        ) : (
          <OpenFileState
            width={props.width}
            height={body.height}
            appId={APP_ID}
            icon="image"
            title="Open an image"
            message="PNG, JPEG, WebP, GIF, BMP and TIFF. Step through a folder with ← and →."
            error={state.kind === "empty" ? state.error : undefined}
            onBrowse={() => setChoosing(true)}
            onOpen={open}
          />
        )}
      </AppFrame>
      {choosing ? (
        <FileChooser
          width={props.width}
          height={props.height}
          mode="open"
          title="Open an image"
          appId={APP_ID}
          accept={IMAGE_EXTENSIONS}
          directory={file ? path.dirname(file) : undefined}
          onChoose={(chosen) => {
            setChoosing(false);
            open(chosen);
          }}
          onCancel={() => setChoosing(false)}
        />
      ) : null}
    </ShortcutManager>
  );
}

startMain(import.meta.url, () =>
  runApp(TITLE, APP_ID, (size, window) => (
    <ImageViewerApp {...size} window={window} initialPath={initialFile()} />
  )),
);
