/** The media player's queue: what is playing, what comes next, and whether to start playing. */

export type QueueEntry = {
  /** Distinct per entry, so the same file queued twice still gets its own playback session. */
  id: number;
  path: string;
};

export type PlayerQueue = {
  entries: QueueEntry[];
  index: number;
  /** Start playing (rather than open paused) when the current entry opens. */
  play: boolean;
  /** The last entry finished; Play replays it. */
  ended: boolean;
  /** Bumped to open the current entry afresh (replay, reopen). */
  revision: number;
  nextId: number;
};

export type QueueAction =
  /** Open these files as the whole queue, paused at the first. */
  | { type: "replace"; paths: readonly string[] }
  /** Add files after the queue; an empty queue opens the first of them. */
  | { type: "append"; paths: readonly string[] }
  /** Drop everything but the current entry. */
  | { type: "clear" }
  | { type: "select"; index: number; play: boolean }
  /** The current entry played to its end. */
  | { type: "ended" }
  /** Open the current entry again, playing or paused. */
  | { type: "restart"; play: boolean }
  /** Playback was stopped: the entry stays, ready to start again. */
  | { type: "stopped" }
  | { type: "close" };

export function initialQueue(paths: readonly string[] = []): PlayerQueue {
  return reduceQueue(
    { entries: [], index: 0, play: false, ended: false, revision: 0, nextId: 1 },
    { type: "replace", paths },
  );
}

export function currentEntry(queue: PlayerQueue): QueueEntry | null {
  return queue.entries[queue.index] ?? null;
}

export function reduceQueue(queue: PlayerQueue, action: QueueAction): PlayerQueue {
  switch (action.type) {
    case "replace": {
      const entries = action.paths.map((path, offset) => ({ id: queue.nextId + offset, path }));
      return {
        ...queue,
        entries,
        index: 0,
        play: false,
        ended: false,
        nextId: queue.nextId + entries.length,
      };
    }
    case "append": {
      if (!queue.entries.length) return reduceQueue(queue, { ...action, type: "replace" });
      const added = action.paths.map((path, offset) => ({ id: queue.nextId + offset, path }));
      return {
        ...queue,
        entries: [...queue.entries, ...added],
        nextId: queue.nextId + added.length,
      };
    }
    case "clear": {
      const current = currentEntry(queue);
      return current ? { ...queue, entries: [current], index: 0 } : queue;
    }
    case "select":
      if (action.index < 0 || action.index >= queue.entries.length) return queue;
      return {
        ...queue,
        index: action.index,
        play: action.play,
        ended: false,
        revision: queue.revision + (action.index === queue.index ? 1 : 0),
      };
    case "ended":
      return queue.index + 1 < queue.entries.length
        ? { ...queue, index: queue.index + 1, play: true, ended: false }
        : { ...queue, ended: true };
    case "restart":
      return { ...queue, play: action.play, ended: false, revision: queue.revision + 1 };
    case "stopped":
      return { ...queue, play: false, ended: false };
    case "close":
      return { ...queue, entries: [], index: 0, play: false, ended: false };
  }
}
