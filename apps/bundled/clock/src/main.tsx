import { StorageConflictError, retryStoreCleanup } from "@moire/app-tools/local-store";
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  Application,
  Button,
  Checkbox,
  ConfirmationDialog,
  Dialog,
  Horizontal,
  Measure,
  ScrollColumn,
  TextBlock,
  measureColumnContent,
  useWidgetTheme,
  OverlayHost,
  Label,
  ScrollArea,
  SegmentedControl,
  Surface,
  TextField,
  Toolbar,
  Window,
  usePalette,
  getUiScaleFactor,
  type WindowSize,
} from "@moire/ui";
import {
  AlarmStore,
  durationText,
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

export type RingNotice =
  | { readonly id: string; readonly kind: "timer"; readonly message: string }
  | {
      readonly id: string;
      readonly kind: "alarm";
      readonly message: string;
      readonly alarmId: string;
    };

/** One independently dismissible receipt per due source; controls never share the text viewport. */
export function RingNotices(
  props: WindowSize & {
    notices: readonly RingNotice[];
    onDismiss: (id: string) => void;
    onSnooze: (notice: Extract<RingNotice, { kind: "alarm" }>) => void;
  },
): ReactNode {
  const theme = useWidgetTheme();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIndex = Math.max(
    0,
    props.notices.findIndex((notice) => notice.id === selectedId),
  );
  const notice = props.notices[selectedIndex];
  if (!notice) return null;
  const spacing = theme.foundations.space;
  const width = Math.max(1, props.width - spacing.md * 2);
  const metrics = theme.recipes.dialog.medium.metrics;
  const inner = Math.max(1, width - metrics.bodyPaddingX * 2);
  const footer = (
    <Horizontal width={inner} wrap gap={spacing.sm} align="center">
      <Button label="Dismiss" onPress={() => props.onDismiss(notice.id)} />
      {notice.kind === "alarm" ? (
        <Button label="Snooze 5m" variant="primary" onPress={() => props.onSnooze(notice)} />
      ) : null}
      {props.notices.length > 1 ? (
        <Button
          label="Next notice"
          onPress={() =>
            setSelectedId(props.notices[(selectedIndex + 1) % props.notices.length]!.id)
          }
        />
      ) : null}
    </Horizontal>
  );
  const body = (
    <TextBlock width={inner} text={notice.message} fontSize={15} fontWeight="medium" wrap />
  );
  const bodyHeight = measureColumnContent({ width: inner, gap: 0, children: body }, theme).height;
  const footerHeight = measureColumnContent(
    {
      width,
      padding: {
        top: spacing.sm,
        right: metrics.bodyPaddingX,
        bottom: metrics.bodyPaddingBottom,
        left: metrics.bodyPaddingX,
      },
      gap: 0,
      children: footer,
    },
    theme,
  ).height;
  const bottom = 44 * getUiScaleFactor();
  const available = Math.max(1, props.height - bottom - spacing.md);
  const height = Math.min(
    available,
    Math.ceil(metrics.titlebarHeight + metrics.bodyPaddingTop + bodyHeight + footerHeight),
  );
  return (
    <Dialog
      x={spacing.md}
      y={Math.max(0, props.height - bottom - height)}
      width={width}
      height={height}
      title={`${notice.kind === "timer" ? "Timer" : "Alarm"} · ${selectedIndex + 1} of ${props.notices.length} notices`}
      onClose={() => props.onDismiss(notice.id)}
      footer={footer}
    >
      <Measure flexGrow={1} minHeight={1}>
        {(size) => (
          <ScrollColumn width={size.width} height={size.height} gap={0} smooth={false}>
            {body}
          </ScrollColumn>
        )}
      </Measure>
    </Dialog>
  );
}

export function ClockApp(
  props: WindowSize & {
    store: AlarmStore;
    wallNow?: () => number;
    monotonicNow?: () => number;
    onRing?: (message: string) => void;
  },
): ReactNode {
  const pal = usePalette(),
    uiScale = getUiScaleFactor(),
    wallNow = props.wallNow ?? Date.now,
    monotonicNow = props.monotonicNow ?? (() => performance.now());
  const [loaded, setLoaded] = useState(() => {
    try {
      const snapshot = props.store.load(wallNow());
      return { alarms: [...snapshot.items], revision: snapshot.revision, error: "" };
    } catch (error) {
      return { alarms: [], revision: null, error: String(error) };
    }
  });
  const [savedRevision, setSavedRevision] = useState(loaded.revision);
  const [conflict, setConflict] = useState<{
    kind: "recovery" | "cleanup";
    title: string;
    message: string;
  } | null>(null);
  const [alarms, setAlarms] = useState<Alarm[]>(loaded.alarms),
    [tab, setTab] = useState("time"),
    [wall, setWall] = useState(wallNow),
    [mono, setMono] = useState(monotonicNow),
    [timer, setTimer] = useState<Countdown>({ kind: "idle", durationMs: 300000 }),
    [watch, setWatch] = useState<Stopwatch>({ kind: "paused", elapsedMs: 0, laps: [] }),
    [duration, setDuration] = useState("05:00"),
    [alarmTime, setAlarmTime] = useState("07:30"),
    [alarmLabel, setAlarmLabel] = useState("Wake up"),
    [status, setStatus] = useState(loaded.error || "Timers and alarms run while Clock is open"),
    [notices, setNotices] = useState<RingNotice[]>([]);
  const live = useRef({ alarms, timer });
  live.current = { alarms, timer };
  const persist = (next: Alarm[], message = "Saved alarms") => {
    if (loaded.error) {
      setStatus(loaded.error);
      setConflict({
        kind: "recovery",
        title: "Could not save",
        message: loaded.error,
      });
      return false;
    }
    try {
      const saved = props.store.write(next, savedRevision, wallNow());
      setAlarms([...saved.items]);
      setSavedRevision(saved.revision);
      if (saved.cleanup.kind === "pending") {
        console.warn("[clock] Saved with pending cleanup", saved.cleanup.message);
        setConflict({
          kind: "cleanup",
          title: "Saved; cleanup pending",
          message:
            "Your changes are saved. Cleanup of owned temporary files is pending. Retry cleanup does not save another copy; a later save also retries it.",
        });
      }
      setStatus(saved.cleanup.kind === "pending" ? `${message}. Cleanup pending.` : message);
      return true;
    } catch (error) {
      setConflict({
        kind: "recovery",
        title: error instanceof StorageConflictError ? "Saved data changed" : "Could not save",
        message: error instanceof Error ? error.message : String(error),
      });
      setStatus(String(error));
      return false;
    }
  };
  const retryCleanup = () => {
    const cleanup = retryStoreCleanup();
    if (cleanup.kind === "complete") {
      setConflict(null);
      setStatus("Changes saved; storage cleanup finished.");
    } else {
      console.warn("[clock] Storage cleanup remains pending", cleanup.message);
      setConflict({
        kind: "cleanup",
        title: "Saved; cleanup pending",
        message:
          "Your changes remain saved. Cleanup could not finish. Retry cleanup does not save another copy.",
      });
    }
  };
  const reloadSaved = () => {
    try {
      const snapshot = props.store.load(wallNow());
      setLoaded({ alarms: [...snapshot.items], revision: snapshot.revision, error: "" });
      setAlarms([...snapshot.items]);
      setSavedRevision(snapshot.revision);
      setStatus("Reloaded saved data. Your current draft is kept; review it before retrying.");
      setConflict(null);
    } catch (error) {
      setStatus(String(error));
      setConflict({
        kind: "recovery",
        title: "Could not reload saved data",
        message: `${String(error)}. Your draft is still here.`,
      });
    }
  };
  useEffect(() => {
    const tick = () => {
      const now = wallNow();
      setWall(now);
      const monotonic = monotonicNow();
      setMono(monotonic);
      const current = live.current;
      const delivered: RingNotice[] = [];
      if (current.timer.kind === "running" && remaining(current.timer, monotonic) === 0) {
        live.current = { ...current, timer: { kind: "finished" } };
        setTimer({ kind: "finished" });
        delivered.push({ id: randomUUID(), kind: "timer", message: "Timer finished" });
        props.onRing?.("Timer finished");
      }
      const due = current.alarms.filter((alarm) => alarm.enabled && alarm.nextAtMs <= now);
      if (due.length) {
        const next = current.alarms.map((alarm) =>
          due.includes(alarm) ? { ...alarm, nextAtMs: nextAlarm(alarm.time, now) } : alarm,
        );
        live.current = { ...live.current, alarms: next };
        setAlarms(next);
        for (const alarm of due) {
          delivered.push({
            id: randomUUID(),
            kind: "alarm",
            message: alarm.label,
            alarmId: alarm.id,
          });
          props.onRing?.(alarm.label);
        }
      }
      if (delivered.length) setNotices((pending) => [...pending, ...delivered]);
    };
    tick();
    const interval = setInterval(tick, 100);
    return () => clearInterval(interval);
  }, []);
  const runTimer = () => {
    try {
      const next =
        timer.kind === "paused"
          ? startTimer(timer, monotonicNow())
          : startTimer({ kind: "idle", durationMs: parseDuration(duration) }, monotonicNow());
      setTimer(next);
    } catch (error) {
      setStatus(String(error));
    }
  };
  const addAlarm = () => {
    try {
      persist(
        [
          ...alarms,
          {
            id: randomUUID(),
            label: alarmLabel.trim() || "Alarm",
            time: alarmTime,
            enabled: true,
            nextAtMs: nextAlarm(alarmTime, wallNow()),
          },
        ],
        `Alarm set for ${alarmTime}`,
      );
    } catch (error) {
      setStatus(String(error));
    }
  };
  const bodyW = Math.max(1, props.width - 40),
    elapsed = stopwatchElapsed(watch, mono);
  return (
    <OverlayHost width={props.width} height={props.height}>
      <Surface width={props.width} height={props.height} fill={pal.bg} clip>
        <Toolbar width={props.width} height={70}>
          <Button
            label="Reload saved"
            onPress={() =>
              setConflict({
                kind: "recovery",
                title: "Reload saved data?",
                message: "Current input is kept. Review it before retrying the save.",
              })
            }
          />
          <Label flexGrow={1} text="Clock" fontSize={22} fontWeight="bold" />
          <SegmentedControl
            width={Math.min(360 * uiScale, Math.max(280, props.width - 130))}
            value={tab}
            options={[
              { id: "time", label: "Time" },
              { id: "timer", label: "Timer" },
              { id: "stopwatch", label: "Stopwatch" },
              { id: "alarms", label: "Alarms" },
            ]}
            onChange={setTab}
          />
        </Toolbar>
        {tab === "time" && (
          <>
            <Label
              x={28}
              y={120}
              width={bodyW}
              text={new Date(wall).toLocaleTimeString()}
              fontSize={52}
              fontFamily="mono"
            />
            <Label
              x={28}
              y={200 + (uiScale - 1) * 32}
              text={new Date(wall).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
              fontSize={22}
            />
            <Label
              x={28}
              y={245 + (uiScale - 1) * 32}
              text={Intl.DateTimeFormat().resolvedOptions().timeZone}
              color={pal.muted}
            />
          </>
        )}
        {tab === "timer" && (
          <>
            <Label
              x={24}
              y={100}
              text={timer.kind === "finished" ? "Finished" : durationText(remaining(timer, mono))}
              fontSize={48}
              fontFamily="mono"
            />
            <Label
              x={24}
              y={180}
              text="Duration · minutes:seconds or hours:minutes:seconds"
              color={pal.muted}
              fontSize={11}
            />
            <TextField
              x={24}
              y={205}
              width={220}
              value={duration}
              disabled={timer.kind === "running" || timer.kind === "paused"}
              onChange={setDuration}
            />
            <Button
              x={24}
              y={260}
              width={120 * uiScale}
              label={
                timer.kind === "running"
                  ? "Pause"
                  : timer.kind === "paused"
                    ? "Resume"
                    : "Start Timer"
              }
              variant="primary"
              onPress={() =>
                timer.kind === "running" ? setTimer(pauseTimer(timer, monotonicNow())) : runTimer()
              }
            />
            <Button
              x={36 + 120 * uiScale}
              y={260}
              width={100 * uiScale}
              label="Reset"
              onPress={() => {
                try {
                  setTimer({ kind: "idle", durationMs: parseDuration(duration) });
                } catch (error) {
                  setStatus(String(error));
                }
              }}
            />
            <Label
              x={24}
              y={315}
              text="A visible alert appears when the countdown ends."
              color={pal.muted}
              fontSize={12}
            />
          </>
        )}
        {tab === "stopwatch" && (
          <>
            <Label
              x={24}
              y={100}
              text={`${durationText(Math.floor(elapsed / 1000) * 1000)}.${String(Math.floor((elapsed % 1000) / 10)).padStart(2, "0")}`}
              fontSize={44}
              fontFamily="mono"
            />
            <Button
              x={24}
              y={180}
              width={112 * uiScale}
              label={watch.kind === "running" ? "Pause" : "Start"}
              variant="primary"
              onPress={() => setWatch(toggleStopwatch(watch, monotonicNow()))}
            />
            <Button
              x={36 + 112 * uiScale}
              y={180}
              width={90 * uiScale}
              label="Lap"
              disabled={watch.kind !== "running"}
              onPress={() =>
                setWatch({
                  ...watch,
                  laps: [...watch.laps, stopwatchElapsed(watch, monotonicNow())],
                })
              }
            />
            <Button
              x={48 + 202 * uiScale}
              y={180}
              width={90 * uiScale}
              label="Reset"
              onPress={() => setWatch({ kind: "paused", elapsedMs: 0, laps: [] })}
            />
            <ScrollArea
              x={24}
              y={238}
              width={bodyW}
              height={Math.max(80, props.height - 290)}
              contentHeight={Math.max(40, watch.laps.length * 32)}
            >
              {watch.laps.map((lap, index) => (
                <Label
                  key={index}
                  y={index * 32}
                  text={`Lap ${index + 1}     ${durationText(lap)}     +${((lap - (watch.laps[index - 1] ?? 0)) / 1000).toFixed(2)}s`}
                  fontFamily="mono"
                />
              ))}
            </ScrollArea>
          </>
        )}
        {tab === "alarms" && (
          <>
            <Label x={24} y={92} text="Daily alarms · local time" fontSize={18} />
            <TextField
              x={24}
              y={128}
              width={120}
              value={alarmTime}
              placeholder="HH:MM"
              onChange={setAlarmTime}
            />
            <TextField
              x={156}
              y={128}
              width={Math.max(100, props.width - 200 - 120 * uiScale)}
              value={alarmLabel}
              placeholder="Alarm name"
              onChange={setAlarmLabel}
            />
            <Button
              x={props.width - 28 - 120 * uiScale}
              y={128}
              width={120 * uiScale}
              label="Add Alarm"
              disabled={!!loaded.error}
              onPress={addAlarm}
            />
            <ScrollArea
              x={24}
              y={186}
              width={bodyW}
              height={Math.max(80, props.height - 244)}
              contentHeight={Math.max(60, alarms.length * 76)}
            >
              {alarms.map((alarm, index) => (
                <Surface
                  key={alarm.id}
                  y={index * 76}
                  width={bodyW - 12}
                  height={68}
                  fill={pal.panel}
                >
                  <Checkbox
                    x={12}
                    y={20}
                    label={`${alarm.time} · ${alarm.label}`}
                    checked={alarm.enabled}
                    onChange={(enabled) =>
                      persist(
                        alarms.map((item) =>
                          item.id === alarm.id
                            ? { ...item, enabled, nextAtMs: nextAlarm(item.time, wallNow()) }
                            : item,
                        ),
                      )
                    }
                  />
                  <Button
                    x={bodyW - 24 - 84 * uiScale}
                    y={16}
                    width={84 * uiScale}
                    label="Delete"
                    variant="ghost"
                    onPress={() => persist(alarms.filter((item) => item.id !== alarm.id))}
                  />
                </Surface>
              ))}
            </ScrollArea>
          </>
        )}
        <RingNotices
          width={props.width}
          height={props.height}
          notices={notices}
          onDismiss={(id) => setNotices((pending) => pending.filter((notice) => notice.id !== id))}
          onSnooze={(notice) => {
            const target = alarms.find((alarm) => alarm.id === notice.alarmId);
            if (!target || !target.enabled) {
              setStatus(
                "This alarm is no longer enabled. The notice remains available to dismiss.",
              );
              return;
            }
            if (
              persist(
                alarms.map((alarm) =>
                  alarm.id === target.id ? { ...alarm, nextAtMs: wallNow() + 300000 } : alarm,
                ),
              )
            )
              setNotices((pending) => pending.filter((item) => item.id !== notice.id));
          }}
        />
        <Label
          x={20}
          y={props.height - 28}
          width={bodyW}
          text={status}
          color={pal.muted}
          fontSize={10}
          overflow="ellipsis"
          maxLines={1}
        />
      </Surface>
      <ConfirmationDialog
        open={!!conflict}
        viewportWidth={props.width}
        viewportHeight={props.height}
        title={conflict?.title ?? "Saved data changed"}
        message={conflict?.message ?? ""}
        confirmLabel={conflict?.kind === "cleanup" ? "Retry" : "Reload saved"}
        cancelLabel={conflict?.kind === "cleanup" ? "Close" : "Keep draft"}
        onDismiss={() => setConflict(null)}
        onConfirm={() => (conflict?.kind === "cleanup" ? retryCleanup() : reloadSaved())}
      />
    </OverlayHost>
  );
}
export async function main(): Promise<void> {
  const app = new Application(),
    window = new Window({ title: "Clock", appId: "org.moire.Clock", width: 760, height: 520 }),
    store = new AlarmStore();
  window.setContent((size) => (
    <ClockApp {...size} store={store} onRing={() => process.stdout.write("\u0007")} />
  ));
  window.onClose(() => app.quit());
  app.addWindow(window);
  await app.run();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch((error) => {
    console.error("[clock]", error);
    process.exitCode = 1;
  });
