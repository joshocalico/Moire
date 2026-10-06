import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Row, TextField, Label, getUiScaleFactor, type WindowSize } from "@moire/ui";
import { AppFrame, errorText, runApp, startMain } from "@moire/app-tools";
import { Recorder, type RecordingState } from "./backend";
export type RecorderControls = Pick<Recorder, "start" | "stop" | "save" | "discard" | "close">;
export type SoundRecorderProps = WindowSize & {
  recorderFactory?: (change: (state: RecordingState) => void) => RecorderControls;
  onCloseGuard?: (guard: (() => boolean) | null) => void;
};
export function SoundRecorderApp(props: SoundRecorderProps): ReactNode {
  const ui = getUiScaleFactor();
  const [state, setState] = useState<RecordingState>({ kind: "idle" }),
    [destination, setDestination] = useState(""),
    [status, setStatus] = useState(""),
    [saved, setSaved] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [busy, setBusy] = useState(false);
  const live = useRef({ state, saved, busy });
  live.current = { state, saved, busy };
  const recorder = useMemo(() => {
    const change = (value: RecordingState) => {
      live.current.state = value;
      setState(value);
      setStatus("");
    };
    return props.recorderFactory?.(change) ?? new Recorder(change);
  }, []);
  useEffect(() => {
    props.onCloseGuard?.(() => {
      const current = live.current;
      if (current.busy || current.state.kind === "starting") {
        setStatus(
          "Close blocked: wait for the current operation, then Stop and Save or Discard take before closing.",
        );
        return false;
      }
      if (current.state.kind === "recording") {
        setStatus(
          "Close blocked: recording is active. Stop, then Save or Discard take before closing.",
        );
        return false;
      }
      if (current.state.kind === "ready" && !current.saved) {
        setStatus(
          "Close blocked: this take is unsaved. Save it or choose Discard take, then close.",
        );
        return false;
      }
      return true;
    });
    return () => props.onCloseGuard?.(null);
  }, [props.onCloseGuard]);
  useEffect(
    () => () => {
      void recorder.close();
    },
    [recorder],
  );
  useEffect(() => {
    if (state.kind !== "recording") return;
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - state.startedAt) / 1000)),
      250,
    );
    return () => clearInterval(timer);
  }, [state]);
  const work = async (action: () => Promise<void>) => {
    if (live.current.busy) return;
    live.current.busy = true;
    setBusy(true);
    setStatus("");
    try {
      await action();
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      live.current.busy = false;
      setBusy(false);
    }
  };
  const message =
    status ||
    (state.kind === "starting"
      ? "Starting the PipeWire recorder…"
      : state.kind === "error"
        ? state.message
        : state.kind === "recording"
          ? `Recording · ${elapsed} seconds`
          : state.kind === "ready"
            ? `${state.seconds.toFixed(1)} seconds captured. Choose a new WAV path to save.`
            : "Record from the default PipeWire input device.");
  return (
    <AppFrame
      {...props}
      status={message}
      header={
        <Row width={props.width} height={44 * ui} padding={6 * ui} gap={6 * ui}>
          <TextField
            height={32 * ui}
            width={Math.max(100 * ui, props.width - 100 * ui)}
            value={destination}
            onChange={setDestination}
            placeholder="New .wav output file path"
          />
          <Button
            height={32 * ui}
            width={76 * ui}
            label="Save"
            disabled={busy || state.kind !== "ready" || !destination}
            onPress={() =>
              void work(async () => {
                const saved = await recorder.save(destination);
                setStatus(`Saved recording: ${saved}`);
                live.current.saved = true;
                setSaved(true);
              })
            }
          />
        </Row>
      }
      controls={
        <Row width={props.width} height={44 * ui} padding={6 * ui} gap={6 * ui}>
          <Button
            height={32 * ui}
            width={90 * ui}
            label="Record"
            disabled={busy || state.kind === "recording" || (state.kind === "ready" && !saved)}
            onPress={() => {
              setSaved(false);
              live.current.saved = false;
              void work(() => recorder.start());
            }}
          />
          <Button
            height={32 * ui}
            width={90 * ui}
            label="Stop"
            disabled={busy || state.kind !== "recording"}
            onPress={() => void work(() => recorder.stop())}
          />
          <Button
            height={32 * ui}
            width={110 * ui}
            label="Discard take"
            disabled={busy || state.kind !== "ready"}
            onPress={() =>
              void work(async () => {
                await recorder.discard();
                live.current.saved = false;
                setSaved(false);
              })
            }
          />
        </Row>
      }
    >
      <Label
        x={24 * ui}
        y={32 * ui}
        width={props.width - 48 * ui}
        height={80 * ui}
        text={message}
        fontSize={20}
        wrap
        maxLines={3}
      />
      <Label
        x={24 * ui}
        y={140 * ui}
        width={props.width - 48 * ui}
        height={100 * ui}
        text="The recording stays private until Save. Existing output files are never replaced. Stop, then Save or Discard take before closing or recording again. If PipeWire or an input device is unavailable, the error appears here."
        wrap
      />
    </AppFrame>
  );
}
startMain(import.meta.url, () =>
  runApp("Sound Recorder", "org.moire.SoundRecorder", (size, window) => (
    <SoundRecorderApp {...size} onCloseGuard={(guard) => window.setCloseGuard(guard)} />
  )),
);
