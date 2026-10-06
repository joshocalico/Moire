import { randomUUID } from "node:crypto";
import { useEffect, useRef, useState } from "react";
import { PlaybackSession, type PlaybackState, errorText } from "@moire/app-tools";
import type { Track } from "./library";
import { MusicQueueStore, type QueueSnapshot } from "./queue-store";
export type { QueueEntry } from "./queue-store";
export type MusicPlaybackOptions = { binary?: string; extraArgs?: string[] };
const CHECKPOINT_INTERVAL_MS = 5000;
/** Queue drafts retain their loaded revision until an explicit successful save. */
export function useMusicPlayback(options: MusicPlaybackOptions = {}, queueStore?: MusicQueueStore) {
  const [store] = useState(() => queueStore ?? new MusicQueueStore());
  const [initial] = useState(() => {
    try {
      return { snapshot: store.load(), error: "" };
    } catch (error) {
      const snapshot: QueueSnapshot = {
        entries: [],
        currentEntryId: null,
        position: 0,
        revision: null,
      };
      return { snapshot, error: errorText(error) };
    }
  });
  const [snapshot, setSnapshot] = useState(initial.snapshot);
  const draft = useRef(initial.snapshot);
  const dirty = useRef(false),
    blocked = useRef(!!initial.error),
    alive = useRef(true);
  const [queueSaveError, setQueueSaveError] = useState(initial.error);
  const [queueSaveWarning, setQueueSaveWarning] = useState("");
  const [stopped, setStopped] = useState(true);
  const [restored, setRestored] = useState(initial.snapshot.entries.length > 0);
  const [restart, setRestart] = useState(0);
  const [state, setState] = useState<PlaybackState>({ kind: "idle" });
  const [error, setError] = useState("");
  const generation = useRef(0),
    session = useRef<PlaybackSession | null>(null);
  const autoPlay = useRef(false),
    lastCheckpoint = useRef(0);
  const optionsRef = useRef(options);
  const publishDraft = () => {
    if (alive.current) setSnapshot(draft.current);
  };
  const flush = (retry = false) => {
    if ((!dirty.current && !retry) || (blocked.current && !retry)) return;
    try {
      const saved = store.save(draft.current);
      draft.current = {
        entries: saved.entries,
        currentEntryId: saved.currentEntryId,
        position: saved.position,
        revision: saved.revision,
      };
      dirty.current = false;
      blocked.current = false;
      lastCheckpoint.current = Date.now();
      if (alive.current) {
        setQueueSaveError("");
        setQueueSaveWarning(saved.cleanup.kind === "pending" ? saved.cleanup.message : "");
        publishDraft();
      }
    } catch (error) {
      blocked.current = true;
      if (alive.current) setQueueSaveError(errorText(error));
    }
  };
  const update = (value: QueueSnapshot) => {
    if (value.currentEntryId !== draft.current.currentEntryId) generation.current++;
    draft.current = value;
    dirty.current = true;
    publishDraft();
    flush();
  };
  const stop = () => {
    generation.current++;
    flush();
    publishDraft();
    setStopped(true);
    setState({ kind: "idle" });
  };
  const select = (id: string, play = true) => {
    if (!draft.current.entries.some((entry) => entry.id === id)) return;
    autoPlay.current = play;
    setRestored(false);
    const same = draft.current.currentEntryId === id;
    if (!same) update({ ...draft.current, currentEntryId: id, position: 0 });
    setStopped(false);
    if (same && session.current) {
      generation.current++;
      setRestart((old) => old + 1);
    }
  };
  const advance = () => {
    const index = draft.current.entries.findIndex(
      (entry) => entry.id === draft.current.currentEntryId,
    );
    const next = draft.current.entries[index + 1];
    if (next) select(next.id);
    else {
      update({ ...draft.current, position: 0 });
      stop();
    }
  };
  const advanceRef = useRef(advance),
    flushRef = useRef(flush);
  advanceRef.current = advance;
  flushRef.current = flush;
  const entry = snapshot.entries.find((entry) => entry.id === snapshot.currentEntryId);
  useEffect(() => {
    const token = ++generation.current;
    if (stopped || !entry) return;
    let active = true,
      initialized = false;
    let observed: PlaybackState = { kind: "idle" };
    let pendingSeek: {
      target: number;
      resolve: () => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    } | null = null;
    const finishSeek = (error?: Error) => {
      const pending = pendingSeek;
      if (!pending) return;
      pendingSeek = null;
      clearTimeout(pending.timer);
      if (error) pending.reject(error);
      else pending.resolve();
    };
    const wantedPosition = draft.current.position;
    const record = (value: PlaybackState) => {
      if (value.kind !== "ready" || draft.current.currentEntryId !== entry.id) return;
      if (draft.current.position !== value.position) {
        draft.current = { ...draft.current, position: value.position };
        dirty.current = true;
      }
      if (value.paused || Date.now() - lastCheckpoint.current >= CHECKPOINT_INTERVAL_MS)
        flushRef.current();
    };
    setError("");
    const current = new PlaybackSession(
      (value) => {
        if (!active || generation.current !== token) return;
        observed = value;
        if (pendingSeek) {
          if (value.kind === "error") finishSeek(new Error(value.message));
          else if (value.kind === "idle")
            finishSeek(new Error("Playback ended before the saved position was restored."));
          else if (
            value.kind === "ready" &&
            value.paused &&
            Math.abs(value.position - pendingSeek.target) <= 0.1
          )
            finishSeek();
        }
        if (initialized || value.kind !== "ready") setState(value);
        if (initialized) record(value);
      },
      {
        ...optionsRef.current,
        onEnded: () => {
          if (active && initialized && generation.current === token) advanceRef.current();
        },
      },
    );
    session.current = current;
    const shouldPlay = autoPlay.current;
    void current
      .open(entry.track.path)
      .then(async () => {
        if (!active || generation.current !== token || observed.kind !== "ready") return;
        if (wantedPosition > 0) {
          if (observed.duration > 0 && wantedPosition >= observed.duration)
            throw new Error(
              "The saved position is beyond this file's duration. Choose another entry or remove it.",
            );
          // A command reply acknowledges the seek, not the decoder's new position.
          // Only subsequent paused readback can authorize checkpointing or unpause.
          const settled = new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () =>
                finishSeek(
                  new Error(
                    "The saved playback position was not observed. The checkpoint is preserved.",
                  ),
                ),
              5000,
            );
            pendingSeek = { target: wantedPosition, resolve, reject, timer };
          });
          await Promise.all([current.control(["seek", wantedPosition, "absolute+exact"]), settled]);
        }
        if (!active || generation.current !== token) return;
        initialized = true;
        setState(observed);
        record(observed);
        if (shouldPlay) await current.control(["set_property", "pause", false]);
      })
      .catch((error) => {
        finishSeek(error instanceof Error ? error : new Error(errorText(error)));
        if (active && generation.current === token) {
          const message = errorText(error);
          setError(message);
          setState({ kind: "error", message });
          void current.close();
        }
      });
    return () => {
      active = false;
      finishSeek(new Error("Playback restoration was cancelled."));
      flushRef.current();
      if (session.current === current) session.current = null;
      void current.close();
    };
  }, [entry?.id, stopped, restart]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      flushRef.current();
    };
  }, []);
  const entries = (tracks: readonly Track[]) =>
    tracks.map((track) => ({ id: randomUUID(), track }));
  const control = (command: readonly (string | number | boolean)[]) => {
    const current = session.current;
    if (!current) return;
    void current.control(command).catch((error) => {
      if (session.current === current) setError(errorText(error));
    });
  };
  const queue = snapshot.entries;
  const index = Math.max(
    0,
    queue.findIndex((item) => item.id === snapshot.currentEntryId),
  );
  return {
    queue,
    index,
    entry,
    state,
    error,
    stopped,
    restored,
    position: state.kind === "ready" ? state.position : snapshot.position,
    queueSaveError,
    queueSaveWarning,
    retrySave: () => flush(true),
    reloadSavedQueue: () => {
      try {
        const saved = store.load();
        // A deliberate reload revokes the old playback callbacks immediately.
        generation.current++;
        setStopped(true);
        setState({ kind: "idle" });
        draft.current = saved;
        dirty.current = false;
        blocked.current = false;
        setSnapshot(saved);
        setRestored(saved.entries.length > 0);
        setError("");
        setQueueSaveError("");
        setQueueSaveWarning("");
      } catch (error) {
        setQueueSaveError(errorText(error));
      }
    },
    play: (tracks: readonly Track[], start = 0, paused = false) => {
      if (!tracks.length) return;
      const added = entries(tracks);
      const current = added[Math.max(0, Math.min(tracks.length - 1, start))];
      if (!current) return;
      autoPlay.current = !paused;
      setRestored(false);
      update({ ...draft.current, entries: added, currentEntryId: current.id, position: 0 });
      setStopped(false);
    },
    enqueue: (tracks: readonly Track[]) => {
      const added = entries(tracks);
      if (!added.length) return;
      update({
        ...draft.current,
        entries: [...draft.current.entries, ...added],
        currentEntryId: draft.current.currentEntryId ?? added[0]!.id,
      });
    },
    jump: (nextIndex: number) => {
      const next = draft.current.entries[nextIndex];
      if (!next) return;
      if (next.id === draft.current.currentEntryId && state.kind === "ready")
        control(["set_property", "pause", false]);
      else select(next.id);
    },
    next: index + 1 < queue.length ? advance : undefined,
    previous:
      index > 0
        ? () => {
            const previous = draft.current.entries[index - 1];
            if (previous) select(previous.id);
          }
        : undefined,
    togglePause: () => {
      if (state.kind === "ready") control(["cycle", "pause"]);
      else if (entry && state.kind !== "opening") select(entry.id);
    },
    stop,
    seek: (seconds: number) => control(["seek", Math.max(0, seconds), "absolute+exact"]),
    volume: (value: number) =>
      control(["set_property", "volume", Math.max(0, Math.min(100, value))]),
    remove: (id: string) => {
      const current = draft.current;
      const index = current.entries.findIndex((item) => item.id === id);
      if (index < 0) return;
      if (current.currentEntryId === id) autoPlay.current = state.kind === "ready" && !state.paused;
      const remaining = current.entries.filter((item) => item.id !== id);
      const replacement = remaining[Math.min(index, remaining.length - 1)];
      update({
        ...current,
        entries: remaining,
        currentEntryId:
          current.currentEntryId === id ? (replacement?.id ?? null) : current.currentEntryId,
        position: current.currentEntryId === id ? 0 : current.position,
      });
      if (!remaining.length) stop();
    },
    clearUpcoming: () =>
      update({
        ...draft.current,
        entries: draft.current.entries.filter((_, position) => position <= index),
      }),
  };
}
