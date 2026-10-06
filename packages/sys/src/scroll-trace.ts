/** Opt-in pointer-only diagnostics. No raw buffers, keys, app text or file contents. */
export type ScrollTraceBounds = { x: number; y: number; width: number; height: number };
export type ScrollTraceEvent =
  | { stage: "raw"; device: string; type: number; code: number; value: number; timeMs: number }
  | { stage: "axis"; value: number; timeMs: number; x: number; y: number }
  | { stage: "route"; popupBlocksShell: boolean; consumed: boolean; x: number; y: number }
  | {
      stage: "hit";
      popup: string | null;
      view: string;
      x: number;
      y: number;
      deltaY: number;
      before: number;
      after: number;
      bounds: ScrollTraceBounds | null;
      clip: ScrollTraceBounds | null;
    }
  | {
      stage: "offset";
      popup: string | null;
      view: string;
      offset: number;
      contentHeight: number | null;
      viewportHeight: number | null;
      maxScroll: number | null;
    }
  | {
      stage: "paint";
      popup: string | null;
      view: string;
      revision: number;
      offset: number;
      bodyChecksum: number | null;
      footerChecksum: number | null;
    };

export type ScrollTraceRecord =
  | (ScrollTraceEvent & { sequence: number; elapsedMs: number })
  | {
      stage: "start";
      durationMs: number;
      maxRecords: number;
      maxWheelRecords: number;
      context: readonly ScrollTraceEvent[];
    }
  | {
      stage: "end";
      reason: "deadline" | "record-limit" | "wheel-limit";
      records: number;
      wheelRecords: number;
    };

export function isScrollPointerEvent(type: number, code: number): boolean {
  return (
    (type === 2 && [0, 1, 8, 11].includes(code)) ||
    (type === 3 && (code === 0 || code === 1)) ||
    (type === 0 && (code === 0 || code === 3))
  );
}

/** One shared trace per compositor; starts on the first wheel, then stops permanently. */
export function createScrollTrace(
  options: {
    enabled?: boolean;
    now?: () => number;
    emit?: (record: ScrollTraceRecord) => void;
  } = {},
) {
  const enabled = options.enabled ?? process.env.MOIRE_SCROLL_TRACE === "1";
  const now = options.now ?? (() => performance.now());
  const sink =
    options.emit ?? ((record) => console.log(`[scroll-trace] ${JSON.stringify(record)}`));
  const context: ScrollTraceEvent[] = [];
  let started: number | null = null,
    count = 0,
    wheelRecords = 0,
    ended = false;
  // Diagnostics are an input boundary: a broken sink cannot interrupt dispatch.
  const emit = (record: ScrollTraceRecord) => {
    try {
      sink(record);
      return true;
    } catch {
      ended = true;
      return false;
    }
  };
  const end = (reason: "deadline" | "record-limit" | "wheel-limit") => {
    ended = true;
    emit({ stage: "end", reason, records: count, wheelRecords });
  };
  const write = (event: ScrollTraceEvent) => {
    if (!enabled || ended) return;
    if (event.stage === "raw" && !isScrollPointerEvent(event.type, event.code)) return;
    const wheel =
      event.stage === "axis" ||
      (event.stage === "raw" && event.type === 2 && (event.code === 8 || event.code === 11));
    const time = now();
    if (started === null) {
      if (!wheel) {
        if (event.stage === "raw") {
          context.push(event);
          if (context.length > 16) context.shift();
        }
        return;
      }
      started = time;
      const emitted = emit({
        stage: "start",
        durationMs: 120000,
        maxRecords: 512,
        maxWheelRecords: 128,
        context: [...context],
      });
      context.length = 0;
      if (!emitted) return;
    }
    if (time - started >= 120000) {
      end("deadline");
      return;
    }
    if (count >= 512) {
      end("record-limit");
      return;
    }
    if (wheel && wheelRecords >= 128) {
      end("wheel-limit");
      return;
    }
    if (wheel) wheelRecords++;
    emit({ sequence: ++count, elapsedMs: time - started, ...event });
  };
  const active = () => {
    if (!enabled || ended) return false;
    if (started !== null && now() - started >= 120000) end("deadline");
    return started !== null && !ended;
  };
  return { enabled, write: Object.assign(write, { active }), active };
}
