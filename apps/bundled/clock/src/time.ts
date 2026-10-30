/** Timer, stopwatch and alarm arithmetic: pure functions over explicit clock readings. */
export type Countdown =
  | { kind: "idle"; durationMs: number }
  | { kind: "running"; deadlineMs: number }
  | { kind: "paused"; remainingMs: number }
  | { kind: "finished" };
export type Stopwatch =
  | { kind: "paused"; elapsedMs: number; laps: number[] }
  | { kind: "running"; elapsedMs: number; startedAt: number; laps: number[] };
export type Alarm = { id: string; label: string; time: string; enabled: boolean; nextAtMs: number };
export function parseDuration(value: string): number {
  if (!/^\d{1,3}:[0-5]\d(?::[0-5]\d)?$/.test(value))
    throw new Error("Enter minutes:seconds or hours:minutes:seconds.");
  const pieces = value.split(":").map(Number);
  const seconds =
    pieces.length === 3
      ? (pieces[0] ?? 0) * 3600 + (pieces[1] ?? 0) * 60 + (pieces[2] ?? 0)
      : (pieces[0] ?? 0) * 60 + (pieces[1] ?? 0);
  if (seconds <= 0) throw new Error("Choose a duration greater than zero.");
  return seconds * 1000;
}
export function durationText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 3600)).padStart(2, "0")}:${String(Math.floor(total / 60) % 60).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
export function remaining(timer: Countdown, now: number): number {
  return timer.kind === "running"
    ? Math.max(0, timer.deadlineMs - now)
    : timer.kind === "paused"
      ? timer.remainingMs
      : timer.kind === "idle"
        ? timer.durationMs
        : 0;
}
export function pauseTimer(timer: Countdown, now: number): Countdown {
  return timer.kind === "running" ? { kind: "paused", remainingMs: remaining(timer, now) } : timer;
}
export function startTimer(timer: Countdown, now: number): Countdown {
  const ms = remaining(timer, now);
  return ms > 0 ? { kind: "running", deadlineMs: now + ms } : timer;
}
export function stopwatchElapsed(watch: Stopwatch, now: number): number {
  return watch.elapsedMs + (watch.kind === "running" ? Math.max(0, now - watch.startedAt) : 0);
}
export function toggleStopwatch(watch: Stopwatch, now: number): Stopwatch {
  return watch.kind === "running"
    ? { kind: "paused", elapsedMs: stopwatchElapsed(watch, now), laps: watch.laps }
    : { ...watch, kind: "running", startedAt: now };
}
export function nextAlarm(time: string, now: number): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Use a 24-hour time such as 07:30.");
  const [h, m] = time.split(":").map(Number);
  const date = new Date(now);
  date.setHours(h ?? 0, m ?? 0, 0, 0);
  if (date.getTime() <= now) date.setDate(date.getDate() + 1);
  return date.getTime();
}
