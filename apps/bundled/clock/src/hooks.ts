/** Clock's live state: world cities, the countdown, the stopwatch, and the ticker driving them. */
import { useEffect, useRef, useState } from "react";
import { randomUUID } from "node:crypto";
import { errorText } from "@moire/app-tools";
import type { CityStore } from "./backend";
import {
  nextAlarm,
  parseDuration,
  pauseTimer,
  remaining,
  startTimer,
  stopwatchElapsed,
  toggleStopwatch,
  type Alarm,
  type Countdown,
  type Stopwatch,
} from "./time";
import { addCity, removeCity, zoneOf } from "./world";
import type { RingNotice } from "./views/notices";

export function useCities(store: CityStore, report: (s: string) => void) {
  const [cities, setCities] = useState(() => store.load());
  const save = (next: string[], message: string) => {
    try {
      store.save(next);
      setCities(next);
      report(message);
    } catch (error) {
      report(`Could not save world clocks: ${errorText(error)}`);
    }
  };
  return {
    cities,
    add: (zone: string) => save(addCity(cities, zone), `Added ${zoneOf(zone).city}`),
    remove: (zone: string) => save(removeCity(cities, zone), `Removed ${zoneOf(zone).city}`),
  };
}

const DEFAULT_TIMER: Countdown = { kind: "idle", durationMs: 5 * 60_000 };
const RESET_STOPWATCH: Stopwatch = { kind: "paused", elapsedMs: 0, laps: [] };

/** The countdown and the duration typed for it; bad input is reported, never thrown. */
export function useCountdown(monotonicNow: () => number, report: (s: string) => void) {
  const [timer, setTimer] = useState<Countdown>(DEFAULT_TIMER);
  const [duration, setDuration] = useState("05:00");
  const attempt = (work: () => Countdown) => {
    try {
      setTimer(work());
    } catch (error) {
      report(errorText(error));
    }
  };
  return {
    timer,
    duration,
    setDuration,
    finish: () => setTimer({ kind: "finished" }),
    startPause: () =>
      attempt(() =>
        timer.kind === "running"
          ? pauseTimer(timer, monotonicNow())
          : startTimer(
              timer.kind === "paused"
                ? timer
                : { kind: "idle", durationMs: parseDuration(duration) },
              monotonicNow(),
            ),
      ),
    reset: () => attempt(() => ({ kind: "idle", durationMs: parseDuration(duration) })),
  };
}

export function useStopwatch(monotonicNow: () => number) {
  const [watch, setWatch] = useState<Stopwatch>(RESET_STOPWATCH);
  return {
    watch,
    toggle: () => setWatch(toggleStopwatch(watch, monotonicNow())),
    lap: () =>
      setWatch({ ...watch, laps: [...watch.laps, stopwatchElapsed(watch, monotonicNow())] }),
    reset: () => setWatch(RESET_STOPWATCH),
  };
}

/** How often the displayed time and due timers/alarms are checked. */
const TICK_MS = 100;

/**
 * Drive the clock: every tick read both clocks, finish a due timer (monotonic, so wall-clock
 * changes cannot end it early) and reschedule due alarms (wall clock), reporting each once.
 */
export function useTicker(options: {
  wallNow: () => number;
  monotonicNow: () => number;
  timer: Countdown;
  alarms: readonly Alarm[];
  onTimerDone: () => void;
  onAlarmsDue: (next: Alarm[]) => void;
  onRing: (notices: RingNotice[]) => void;
}): { wall: number; mono: number } {
  const [wall, setWall] = useState(options.wallNow);
  const [mono, setMono] = useState(options.monotonicNow);
  // The interval outlives renders; read the latest timer, alarms and callbacks through a ref.
  const live = useRef(options);
  live.current = options;
  useEffect(() => {
    const tick = () => {
      const current = live.current;
      const now = current.wallNow();
      const monotonic = current.monotonicNow();
      setWall(now);
      setMono(monotonic);
      const delivered: RingNotice[] = [];
      if (current.timer.kind === "running" && remaining(current.timer, monotonic) === 0) {
        // Until the parent re-renders, later ticks must see the timer as already finished.
        live.current = { ...live.current, timer: { kind: "finished" } };
        current.onTimerDone();
        delivered.push({ id: randomUUID(), kind: "timer", message: "Timer finished" });
      }
      const due = current.alarms.filter((alarm) => alarm.enabled && alarm.nextAtMs <= now);
      if (due.length) {
        const next = current.alarms.map((alarm) =>
          due.includes(alarm) ? { ...alarm, nextAtMs: nextAlarm(alarm.time, now) } : alarm,
        );
        live.current = { ...live.current, alarms: next };
        current.onAlarmsDue(next);
        for (const alarm of due)
          delivered.push({
            id: randomUUID(),
            kind: "alarm",
            message: alarm.label,
            alarmId: alarm.id,
          });
      }
      if (delivered.length) current.onRing(delivered);
    };
    tick();
    const interval = setInterval(tick, TICK_MS);
    return () => clearInterval(interval);
  }, []);
  return { wall, mono };
}
