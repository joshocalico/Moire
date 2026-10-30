import React, { useState, type ReactNode } from "react";
import {
  Box,
  formatPlaybackTime,
  getUiScaleFactor,
  type WindowActions,
  type WindowSize,
} from "@moire/ui";
import {
  AppFrame,
  FileChooser,
  TitleActions,
  ToolButton,
  appFrameBody,
  runApp,
  startMain,
} from "@moire/app-tools";
import { deviceName, describe } from "./model";
import { RecordPanel, recordPanelHeight } from "./record-panel";
import { RecordingsList } from "./recordings-list";
import { APP_ID, useRecorder, type RecorderOptions } from "./use-recorder";

const TITLE = "Sound Recorder";
const PAD = 16;
const GAP = 12;
/** Side by side from this width; stacked below it. */
const WIDE = 820;
const LIST_WIDTH = 380;
const MIN_LIST = 170;

export type SoundRecorderProps = WindowSize &
  RecorderOptions & {
    /** The window the header bar controls. */
    window?: WindowActions | null;
  };
export type { RecorderControls } from "./use-recorder";

export function SoundRecorderApp(props: SoundRecorderProps): ReactNode {
  const ui = getUiScaleFactor();
  const recorder = useRecorder(props);
  const [selected, setSelected] = useState<string | null>(null);
  const { state, device, notice, saved, busy } = recorder;
  const recording = state.kind === "recording";
  const unsavedTake = state.kind === "ready" && saved === null;
  const deviceProblem = device.kind === "no-device" || device.kind === "unavailable";
  const { label, detail } = describe(state, saved, device);
  const message =
    notice || (state.kind === "error" || (state.kind === "idle" && deviceProblem) ? detail : "");
  const body = appFrameBody({ height: props.height, title: TITLE });
  const pad = PAD * ui;
  const wide = props.width >= WIDE * ui;
  const listW = wide ? Math.min(LIST_WIDTH * ui, props.width * 0.42) : props.width - pad * 2;
  const panelW = wide ? props.width - listW - pad * 2 - GAP * ui : props.width;
  const retry = deviceProblem && !recording;
  const wantedPanel = recordPanelHeight({ message: !!message, retry, take: unsavedTake });
  const panelH = wide
    ? body.height
    : Math.max(120 * ui, Math.min(wantedPanel, body.height - MIN_LIST * ui - pad));
  const listH = wide ? body.height - pad * 2 : body.height - panelH - pad;
  return (
    <Box width={props.width} height={props.height}>
      <AppFrame
        {...props}
        title={TITLE}
        icon="recorder"
        subtitle={deviceName(device) === "the default input" ? undefined : deviceName(device)}
        status={notice || detail}
        statusEnd={`${recorder.recordings.length} ${recorder.recordings.length === 1 ? "recording" : "recordings"}`}
        actions={
          <TitleActions>
            <ToolButton
              icon="folder"
              tooltip="Show recordings in Files"
              focusId="recorder:folder"
              onPress={() => recorder.show(recorder.folder)}
            />
          </TitleActions>
        }
      >
        <RecordPanel
          width={panelW}
          height={panelH}
          recording={recording}
          level={recorder.level}
          canToggle={!busy && state.kind !== "starting" && !unsavedTake && !deviceProblem}
          onToggle={recorder.toggleRecording}
          time={formatPlaybackTime(
            state.kind === "ready" ? state.seconds : recording ? recorder.elapsed : 0,
          )}
          label={label}
          message={message}
          danger={state.kind === "error" || deviceProblem || notice.startsWith("Close blocked")}
          onRetry={retry ? recorder.checkInput : undefined}
          take={
            unsavedTake ? { name: `${recorder.takeName}.wav`, folder: recorder.folder, busy } : null
          }
          takeActions={{
            onSave: recorder.save,
            onSaveAs: recorder.saveAs,
            onDiscard: recorder.discard,
          }}
        />
        <Box
          x={wide ? panelW + GAP * ui : pad}
          y={wide ? pad : panelH}
          width={listW}
          height={listH}
        >
          <RecordingsList
            width={listW}
            height={listH}
            recordings={recorder.recordings}
            selected={selected}
            playing={recorder.playing}
            onSelect={setSelected}
            onPlay={recorder.togglePlayback}
            onShow={recorder.show}
            onTrash={(file) => {
              if (file === selected) setSelected(null);
              recorder.trash(file);
            }}
          />
        </Box>
      </AppFrame>
      {recorder.choosing ? (
        <FileChooser
          width={props.width}
          height={props.height}
          mode="save"
          appId={APP_ID}
          title="Save recording as"
          accept={["wav"]}
          directory={recorder.folder}
          name={recorder.choosing.name}
          onChoose={recorder.chooseSave}
          onCancel={recorder.cancelChooser}
        />
      ) : null}
    </Box>
  );
}

startMain(import.meta.url, () =>
  runApp(TITLE, APP_ID, (size, window) => (
    <SoundRecorderApp
      {...size}
      window={window}
      onCloseGuard={(guard) => window.setCloseGuard(guard)}
    />
  )),
);
