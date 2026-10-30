import path from "node:path";
import React, { useCallback, useReducer, useState, type ReactNode } from "react";
import {
  Button,
  ShortcutManager,
  getUiScaleFactor,
  usePalette,
  type WindowActions,
  type WindowSize,
} from "@moire/ui";
import {
  AppFrame,
  FileChooser,
  OpenButton,
  OpenFileState,
  TitleActions,
  appFrameBody,
  errorText,
  initialFile,
  localPath,
  rememberRecentFile,
  runApp,
  startMain,
} from "@moire/app-tools";
import { useInstalledCheck } from "./hooks";
import { installFont } from "./install";
import { FONT_EXTENSIONS, initialState, installMessage, reduce, type Face } from "./model";
import { FontToolbar } from "./views/font-toolbar";
import { Specimen } from "./views/specimen";
import { TypeTester } from "./views/type-tester";

const APP_ID = "org.moire.FontViewer";
const TITLE = "Font Viewer";
const INSTALL_BUTTON_WIDTH = 92;

export function FontViewerApp(
  props: WindowSize & { initialPath?: string; window?: WindowActions | null },
): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const [state, dispatch] = useReducer(reduce, props.initialPath, initialState);
  const [choosing, setChoosing] = useState(false);
  useInstalledCheck(state, dispatch);
  const file = state.kind === "open" ? state.file : "";
  const body = appFrameBody({ height: props.height, title: TITLE, controls: !!file });

  const open = (value: string) => {
    try {
      dispatch({ type: "open", file: localPath(value) });
    } catch (error) {
      dispatch({ type: "close", error: errorText(error) });
    }
  };
  const onFace = useCallback(
    (face: Face) => {
      dispatch({ type: "face", face });
      rememberRecentFile(APP_ID, file);
    },
    [file],
  );
  const onError = useCallback((message: string) => dispatch({ type: "error", message }), []);
  const install = async () => {
    dispatch({ type: "install-state", file, install: { kind: "installing" } });
    try {
      const result = await installFont(file);
      dispatch({ type: "install-state", file, install: { kind: "installed", result } });
    } catch (error) {
      const message = errorText(error);
      dispatch({ type: "install-state", file, install: { kind: "failed", message } });
    }
  };

  const status =
    state.kind !== "open"
      ? "Open a TTF, OTF or TTC font"
      : state.error ||
        installMessage(state.install) ||
        (!state.face
          ? "Rendering selected font…"
          : state.mode === "tester"
            ? `${state.face.family} · ${state.face.style} · ${state.tester.rendered.size} px · first face in collections`
            : `${state.face.family} · ${state.face.style}`);
  const installKind = state.kind === "open" ? state.install.kind : "unknown";

  return (
    <ShortcutManager
      width={props.width}
      height={props.height}
      enabled={!choosing}
      shortcuts={[{ id: "open", key: "o", ctrl: true, onInvoke: () => setChoosing(true) }]}
    >
      <AppFrame
        {...props}
        title={TITLE}
        icon="font"
        subtitle={
          state.kind === "open"
            ? state.face
              ? `${state.face.family} ${state.face.style}`
              : path.basename(file)
            : undefined
        }
        status={status}
        actions={
          state.kind === "open" ? (
            <TitleActions>
              <Button
                width={INSTALL_BUTTON_WIDTH * ui}
                height={32 * ui}
                size="small"
                variant="primary"
                focusId="font:install"
                label={
                  installKind === "installed"
                    ? "Installed"
                    : installKind === "installing"
                      ? "Installing…"
                      : "Install"
                }
                disabled={installKind !== "not-installed" && installKind !== "failed"}
                onPress={() => void install()}
              />
              <OpenButton focusId="font:open" onPress={() => setChoosing(true)} />
            </TitleActions>
          ) : null
        }
        controls={
          state.kind === "open" ? (
            <FontToolbar
              width={props.width}
              mode={state.mode}
              size={state.tester.rendered.size}
              onMode={(mode) => dispatch({ type: "mode", mode })}
              onResize={(by) => dispatch({ type: "resize", by })}
              onPreview={() => dispatch({ type: "preview" })}
            />
          ) : undefined
        }
      >
        {state.kind !== "open" ? (
          <OpenFileState
            width={props.width}
            height={body.height}
            appId={APP_ID}
            icon="font"
            title="Open a font"
            message="Preview TrueType, OpenType and collection fonts, and install them for your apps."
            placeholder="Path to a .ttf, .otf or .ttc file"
            error={state.error}
            onBrowse={() => setChoosing(true)}
            onOpen={open}
          />
        ) : state.mode === "specimen" ? (
          <Specimen
            key={`${file}:${state.attempt}`}
            file={file}
            width={props.width}
            height={body.height}
            color={pal.text}
            onFace={onFace}
            onError={onError}
          />
        ) : (
          <TypeTester
            key={`${file}:${state.attempt}`}
            file={file}
            width={props.width}
            height={body.height}
            sample={state.tester.draft}
            onSample={(sample) => dispatch({ type: "draft", sample })}
            rendered={state.tester.rendered}
            onPage={(page) => dispatch({ type: "page", page })}
            pageCount={state.tester.pageCount}
            onPageCount={(count) => dispatch({ type: "page-count", count })}
            onFace={onFace}
            onError={onError}
          />
        )}
      </AppFrame>
      {choosing ? (
        <FileChooser
          width={props.width}
          height={props.height}
          mode="open"
          title="Open a font"
          appId={APP_ID}
          accept={FONT_EXTENSIONS}
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
    <FontViewerApp {...size} window={window} initialPath={initialFile()} />
  )),
);
