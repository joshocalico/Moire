import React, { useState, type ReactNode } from "react";
import {
  ConfirmationDialog,
  Icon,
  IconButton,
  OverlayHost,
  SegmentedControl,
  getUiScaleFactor,
  useWidgetTheme,
  type WindowActions,
  type WindowSize,
} from "@moire/ui";
import { AppFrame, appFrameBody, runApp, startMain } from "@moire/app-tools";
import { useAlarms } from "./alarms";
import { AlarmStore, CLOCK_APP_ID, settingsCityStore, type CityStore } from "./backend";
import { useCities, useCountdown, useStopwatch, useTicker } from "./hooks";
import { durationText, remaining, stopwatchElapsed } from "./time";
import { AddCityDialog } from "./views/add-city";
import { AlarmsPanel } from "./views/alarms";
import { RingNotices, type RingNotice } from "./views/notices";
import { StopwatchPanel } from "./views/stopwatch";
import { TimerPanel } from "./views/timer";
import { WorldPanel } from "./views/world";

type Tab = "world" | "timer" | "stopwatch" | "alarms";
const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "world", label: "World" },
  { id: "timer", label: "Timer" },
  { id: "stopwatch", label: "Stopwatch" },
  { id: "alarms", label: "Alarms" },
];
const TABS_MAX_WIDTH = 440;
const TOOL_ROW_HEIGHT = 44;

export function ClockApp(
  props: WindowSize & {
    store: AlarmStore;
    /** World-clock cities; the user's Clock preferences by default. */
    cityStore?: CityStore;
    wallNow?: () => number;
    monotonicNow?: () => number;
    onRing?: (message: string) => void;
    /** The window the header bar controls (minimize, maximize, close, move). */
    window?: WindowActions | null;
  },
): ReactNode {
  const theme = useWidgetTheme(),
    ui = getUiScaleFactor(),
    wallNow = props.wallNow ?? Date.now,
    monotonicNow = props.monotonicNow ?? (() => performance.now());
  const [status, setStatus] = useState("Timers and alarms run while Clock is open");
  const alarms = useAlarms(props.store, wallNow, setStatus);
  const world = useCities(props.cityStore ?? settingsCityStore, setStatus);
  const countdown = useCountdown(monotonicNow, setStatus);
  const stopwatch = useStopwatch(monotonicNow);
  const [tab, setTab] = useState<Tab>("world"),
    [adding, setAdding] = useState(false),
    [alarmTime, setAlarmTime] = useState("07:30"),
    [alarmLabel, setAlarmLabel] = useState("Wake up"),
    [notices, setNotices] = useState<RingNotice[]>([]);
  const { wall, mono } = useTicker({
    wallNow,
    monotonicNow,
    timer: countdown.timer,
    alarms: alarms.alarms,
    onTimerDone: countdown.finish,
    onAlarmsDue: alarms.setAlarms,
    onRing: (delivered) => {
      for (const notice of delivered) props.onRing?.(notice.message);
      setNotices((pending) => [...pending, ...delivered]);
    },
  });
  const dismiss = (id: string) => setNotices((pending) => pending.filter((item) => item.id !== id));
  const tabsW = Math.min(TABS_MAX_WIDTH * ui, props.width - 24 * ui);
  const tabsH = theme.recipes.tabs.medium.metrics.height;
  const panel = {
    width: props.width,
    height: appFrameBody({ height: props.height, title: "Clock", controls: true }).height,
  };
  const timer = countdown.timer;
  const storage = alarms.notice;
  return (
    <OverlayHost width={props.width} height={props.height}>
      <AppFrame
        width={props.width}
        height={props.height}
        title="Clock"
        icon="clock"
        window={props.window}
        actions={
          <IconButton
            icon={(style) => <Icon name="restart" {...style} symbolic />}
            variant="ghost"
            tooltip="Reload saved alarms"
            focusId="clock:reload"
            onPress={() =>
              alarms.setNotice({
                kind: "recovery",
                title: "Reload saved data?",
                message: "Current input is kept. Review it before retrying the save.",
              })
            }
          />
        }
        controls={
          <SegmentedControl
            x={(props.width - tabsW) / 2}
            y={Math.max(0, (TOOL_ROW_HEIGHT * ui - tabsH) / 2)}
            width={tabsW}
            value={tab}
            options={TABS}
            onChange={(id) => setTab(id as Tab)}
          />
        }
        status={alarms.loadError || status}
      >
        {tab === "world" && (
          <WorldPanel
            {...panel}
            now={wall}
            cities={world.cities}
            onAdd={() => setAdding(true)}
            onRemove={world.remove}
          />
        )}
        {tab === "timer" && (
          <TimerPanel
            {...panel}
            readout={timer.kind === "finished" ? "Finished" : durationText(remaining(timer, mono))}
            duration={countdown.duration}
            timer={timer}
            onDuration={countdown.setDuration}
            onStartPause={countdown.startPause}
            onReset={countdown.reset}
          />
        )}
        {tab === "stopwatch" && (
          <StopwatchPanel
            {...panel}
            elapsed={stopwatchElapsed(stopwatch.watch, mono)}
            watch={stopwatch.watch}
            onToggle={stopwatch.toggle}
            onLap={stopwatch.lap}
            onReset={stopwatch.reset}
          />
        )}
        {tab === "alarms" && (
          <AlarmsPanel
            {...panel}
            alarms={alarms.alarms}
            time={alarmTime}
            label={alarmLabel}
            disabled={!!alarms.loadError}
            onTime={setAlarmTime}
            onLabel={setAlarmLabel}
            onAdd={() => alarms.add(alarmTime, alarmLabel)}
            onEnable={alarms.setEnabled}
            onDelete={alarms.remove}
          />
        )}
      </AppFrame>
      {adding ? (
        <AddCityDialog
          width={props.width}
          height={props.height}
          now={wall}
          existing={world.cities}
          onAdd={(zone) => {
            world.add(zone);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}
      <RingNotices
        width={props.width}
        height={props.height}
        notices={notices}
        onDismiss={dismiss}
        onSnooze={(notice) => {
          if (alarms.snooze(notice.alarmId)) dismiss(notice.id);
        }}
      />
      <ConfirmationDialog
        open={!!storage}
        viewportWidth={props.width}
        viewportHeight={props.height}
        title={storage?.title ?? "Saved data changed"}
        message={storage?.message ?? ""}
        confirmLabel={storage?.kind === "cleanup" ? "Retry" : "Reload saved"}
        cancelLabel={storage?.kind === "cleanup" ? "Close" : "Keep draft"}
        onDismiss={() => alarms.setNotice(null)}
        onConfirm={() => (storage?.kind === "cleanup" ? alarms.retryCleanup() : alarms.reload())}
      />
    </OverlayHost>
  );
}

startMain(import.meta.url, () => {
  const store = new AlarmStore();
  return runApp(
    "Clock",
    CLOCK_APP_ID,
    (size, window) => (
      <ClockApp
        {...size}
        window={window}
        store={store}
        onRing={() => process.stdout.write("\u0007")}
      />
    ),
    { width: 760, height: 520 },
  );
});
