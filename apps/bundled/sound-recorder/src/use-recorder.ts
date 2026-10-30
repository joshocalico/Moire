/**
 * Sound Recorder's live state and I/O: the capture stream, the input check, saving takes,
 * the recordings list and playing one back. The stream and every process stop when the window goes away.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PlaybackSession,
  errorText,
  freePath,
  loadRecentFiles,
  moveToTrash,
  rememberRecentFile,
  showInFiles,
  type PlaybackState,
} from "@moire/app-tools";
import { Recorder, listRecordings, probeInput, type RecordingState } from "./backend";
import {
  closeBlockReason,
  defaultRecordingName,
  withWavExtension,
  type InputDevice,
  type Recording,
} from "./model";

export const APP_ID = "org.moire.SoundRecorder";
const LEVEL_STEPS = 24;

export type RecorderControls = Pick<Recorder, "start" | "stop" | "save" | "discard" | "close">;
export type Player = Pick<PlaybackSession, "open" | "control" | "close">;

export type RecorderOptions = {
  recorderFactory?: (
    change: (state: RecordingState) => void,
    onLevel: (peak: number) => void,
  ) => RecorderControls;
  playerFactory?: (change: (state: PlaybackState) => void, ended: () => void) => Player;
  probeInput?: () => Promise<InputDevice>;
  /** Where takes are saved by default; ~/Music/Recordings unless a test says otherwise. */
  recordingsFolder?: string;
  onCloseGuard?: (guard: (() => boolean) | null) => void;
};

export type Playing = { file: string; state: PlaybackState };

export function useRecorder(options: RecorderOptions) {
  const folder = options.recordingsFolder ?? path.join(os.homedir(), "Music", "Recordings");
  const [state, setState] = useState<RecordingState>({ kind: "idle" });
  const [device, setDevice] = useState<InputDevice>({ kind: "checking" });
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  /** The input's peak while recording, in meter steps so quiet changes don't re-render. */
  const [level, setLevel] = useState(0);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [playing, setPlaying] = useState<Playing | null>(null);
  const [choosing, setChoosing] = useState<{ name: string } | null>(null);
  // Named when recording starts, so the name says when the take was made.
  const [takeName, setTakeName] = useState(() => defaultRecordingName(new Date()));
  const live = useRef({ state, saved: false, busy: false });
  live.current.state = state;
  const player = useRef<Player | null>(null);

  const recorder = useMemo(() => {
    const change = (value: RecordingState) => {
      live.current.state = value;
      setState(value);
      setNotice("");
    };
    const onLevel = (peak: number) =>
      setLevel(Math.round(Math.min(1, Math.max(0, peak)) * LEVEL_STEPS) / LEVEL_STEPS);
    return options.recorderFactory?.(change, onLevel) ?? new Recorder(change, { onLevel });
  }, []);
  const refresh = () =>
    void listRecordings(folder, loadRecentFiles(APP_ID)).then(setRecordings, (error: unknown) =>
      setNotice(errorText(error)),
    );
  const checkInput = () => {
    setDevice({ kind: "checking" });
    void (options.probeInput ?? probeInput)().then(setDevice, (error: unknown) =>
      setDevice({ kind: "unavailable", message: errorText(error) }),
    );
  };
  useEffect(() => {
    checkInput();
    refresh();
    return () => {
      void recorder.close();
      void player.current?.close();
    };
  }, [recorder]);
  useEffect(() => {
    options.onCloseGuard?.(() => {
      const reason = closeBlockReason(live.current.state, live.current.saved, live.current.busy);
      if (reason) setNotice(reason);
      return !reason;
    });
    return () => options.onCloseGuard?.(null);
  }, [options.onCloseGuard]);
  useEffect(() => {
    if (state.kind !== "recording") {
      setLevel(0);
      return;
    }
    const tick = () => setElapsed(Math.floor((Date.now() - state.startedAt) / 1000));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [state]);

  const work = async (action: () => Promise<void>) => {
    if (live.current.busy) return;
    live.current.busy = true;
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      live.current.busy = false;
      setBusy(false);
    }
  };
  const markSaved = (file: string | null) => {
    live.current.saved = file !== null;
    setSaved(file);
  };
  const saveTo = (file: string) =>
    void work(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const output = await recorder.save(file);
      rememberRecentFile(APP_ID, output);
      markSaved(output);
      refresh();
    });
  const stopPlayback = async () => {
    const current = player.current;
    player.current = null;
    setPlaying(null);
    await current?.close();
  };

  return {
    folder,
    state,
    device,
    notice,
    saved,
    elapsed,
    level,
    busy,
    takeName,
    recordings,
    playing,
    choosing,
    checkInput,
    toggleRecording: () => {
      if (live.current.state.kind === "recording") void work(() => recorder.stop());
      else {
        markSaved(null);
        setElapsed(0);
        setTakeName(defaultRecordingName(new Date()));
        void stopPlayback();
        void work(() => recorder.start());
      }
    },
    /** Save the take under its automatic name in the recordings folder. */
    save: () => saveTo(freePath(folder, takeName, ".wav")),
    saveAs: () => setChoosing({ name: `${takeName}.wav` }),
    chooseSave: (file: string) => {
      setChoosing(null);
      saveTo(withWavExtension(file));
    },
    cancelChooser: () => setChoosing(null),
    discard: () =>
      void work(async () => {
        await recorder.discard();
        markSaved(null);
        setElapsed(0);
      }),
    /** Play a recording, or stop it if it is the one playing. */
    togglePlayback: (file: string) =>
      void (async () => {
        const wasPlaying = player.current && playing?.file === file;
        await stopPlayback();
        if (wasPlaying) return;
        const change = (value: PlaybackState) =>
          setPlaying((old) => (old?.file === file ? { file, state: value } : old));
        const ended = () => void stopPlayback();
        const session =
          options.playerFactory?.(change, ended) ?? new PlaybackSession(change, { onEnded: ended });
        player.current = session;
        setPlaying({ file, state: { kind: "opening" } });
        try {
          await session.open(file);
          await session.control(["set_property", "pause", false]);
        } catch (error) {
          await stopPlayback();
          setNotice(`Can't play ${path.basename(file)}: ${errorText(error)}`);
        }
      })(),
    trash: (file: string) =>
      void (async () => {
        if (playing?.file === file) await stopPlayback();
        try {
          await moveToTrash(file);
          setNotice(`Moved ${path.basename(file)} to the Trash`);
        } catch (error) {
          setNotice(errorText(error));
        }
        refresh();
      })(),
    show: (file: string) =>
      void showInFiles(file).catch((error: unknown) => setNotice(errorText(error))),
  };
}

export type RecorderModel = ReturnType<typeof useRecorder>;
