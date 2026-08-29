import os from "node:os";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Application,
  Badge,
  AreaChart,
  Box,
  Button,
  Grid,
  Horizontal,
  Inset,
  Label,
  LineChart,
  Measure,
  ProgressBar,
  PropertyList,
  ScrollArea,
  SegmentedControl,
  Separator,
  StatusBar,
  Surface,
  Tabs,
  Toolbar,
  Vertical,
  Window,
  setUiScaleFactor,
  themePalette,
  useOscillation,
  type PlatformDiagnostics,
  type WindowPerformanceSnapshot,
  type WindowSize,
  type UiPresentationMode,
} from "@moire/ui";
import { loadSettings } from "@moire/prefs";

type LiveMetrics = {
  cpuPercent: number;
  compositorCpuPercent: number | null;
  compositorPid: number | null;
  rssBytes: number;
  heapBytes: number;
  freeMemoryBytes: number;
  loadAverage: number;
  window: WindowPerformanceSnapshot;
  platform: PlatformDiagnostics | null;
};

type BenchmarkResult = {
  submittedFrames: number;
  compositorFrames: number;
  presentedFrames: number;
  discardedFrames: number;
  fps: number;
  cpuPercent: number;
  compositorCpuPercent: number | null;
  averageFrameMs: number;
  peakRssBytes: number;
  durationMs: number;
  presentationFrameMsP95: number;
};

type HistorySample = {
  sequence: number;
  cpuPercent: number;
  compositorCpuPercent: number;
  submittedFps: number;
  compositorFps: number;
  presentedFps: number;
  frameMs: number;
  sceneMs: number;
  rasterMs: number;
  submitMs: number;
  copyMs: number;
  releaseMs: number;
  rssMiB: number;
};

const BENCHMARK_DURATION_MS = 5000;
const STRESS_ITEMS = Array.from({ length: 96 }, (_, index) => index);
const LOGICAL_PROCESSORS = os.cpus().length;
const CLOCK_TICKS = (() => {
  if (process.platform !== "linux") return 100;
  try {
    return Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim()) || 100;
  } catch {
    return 100;
  }
})();

function findCompositorPid(): number | null {
  if (process.platform !== "linux") return null;
  try {
    let launcherPid: number | null = null;
    for (const entry of fs.readdirSync("/proc")) {
      if (!/^\d+$/.test(entry) || Number(entry) === process.pid) continue;
      try {
        const command = fs
          .readFileSync(`/proc/${entry}/cmdline`, "utf8")
          .replace(/\0/g, " ")
          .trim();
        // tsx's loader process executes the compositor; its pnpm/tsx parents
        // mostly wait and would misleadingly report ~0% CPU.
        if (/tsx\/dist\/loader\.mjs .*src\/main\.ts$/.test(command)) {
          return Number(entry);
        }
        if (/@moire\/compositor|apps\/compositor|moire-compositor/.test(command)) {
          launcherPid = Number(entry);
        }
      } catch {
        // Process exited while /proc was being inspected.
      }
    }
    return launcherPid;
  } catch {
    // Non-procfs platform.
  }
  return null;
}

function processTicks(pid: number | null): number | null {
  if (!pid) return null;
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
    return Number(fields[11] ?? 0) + Number(fields[12] ?? 0);
  } catch {
    return null;
  }
}

function bytes(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value / 1024 / 1024).toFixed(value >= 1024 ** 3 ? 0 : 1)} MiB`;
}

function milliseconds(value: number): string {
  return value > 0 ? `${value.toFixed(2)} ms` : "—";
}

function frameRate(value: number): string {
  return value > 0 ? `${value.toFixed(1)} fps` : "idle";
}

function withAlpha(color: number, opacity: number): number {
  const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255);
  return ((alpha << 24) | (color & 0x00ffffff)) >>> 0;
}

function initialMetrics(win: Window): LiveMetrics {
  const memory = process.memoryUsage();
  return {
    cpuPercent: 0,
    compositorCpuPercent: null,
    compositorPid: findCompositorPid(),
    rssBytes: memory.rss,
    heapBytes: memory.heapUsed,
    freeMemoryBytes: os.freemem(),
    loadAverage: os.loadavg()[0] ?? 0,
    window: win.getPerformanceSnapshot(),
    platform: win.getPlatformDiagnostics(),
  };
}

function MetricCard(props: {
  width: number;
  height: number;
  label: string;
  value: string;
  detail: string;
  accent?: boolean;
}): ReactNode {
  const pal = themePalette();
  return (
    <Surface
      width={props.width}
      height={props.height}
      fill={pal.surface}
      radius={10}
      stroke={props.accent ? pal.accentLine : pal.borderSubtle}
      strokeWidth={1}
    >
      <Inset width={props.width} height={props.height} padding={{ horizontal: 16, vertical: 13 }}>
        <Vertical gap={4} justify="center">
          <Label text={props.label.toUpperCase()} color={pal.muted} fontSize={9} fontWeight="medium" />
          <Label text={props.value} color={props.accent ? pal.accent : pal.text} fontSize={22} fontWeight="bold" />
          <Label text={props.detail} color={pal.muted} fontSize={10} overflow="ellipsis" maxLines={1} />
        </Vertical>
      </Inset>
    </Surface>
  );
}

function StressScene(props: { width: number; height: number; animating: boolean }): ReactNode {
  const pal = themePalette();
  const itemWidth = Math.max(48, Math.floor((props.width - 72) / 12));
  const focusWidth = itemWidth * 2 + 18;
  const focusHeight = 58;
  const focusX = useOscillation({
    from: 12,
    to: Math.max(12, props.width - 12 - focusWidth),
    period: 4_900,
    phase: -Math.PI / 2,
    playing: props.animating,
  });
  const focusY = useOscillation({
    from: 12,
    to: Math.max(12, props.height - 12 - focusHeight),
    period: 6_300,
    phase: 1.1,
    playing: props.animating,
  });
  const scanX = useOscillation({
    from: 12,
    to: Math.max(12, props.width - 14),
    period: 3_700,
    phase: -0.8,
    playing: props.animating,
  });
  return (
    <Surface width={props.width} height={props.height} fill={pal.panel} radius={10} stroke={pal.borderSubtle} strokeWidth={1} clip>
      <Grid
        x={12}
        y={12}
        width={props.width - 24}
        height={props.height - 24}
        items={STRESS_ITEMS}
        itemWidth={itemWidth}
        itemHeight={26}
        gap={5}
        scrollbar={false}
        renderItem={(item) => {
          return (
            <Surface
              width={itemWidth}
              height={26}
              fill={pal.surface}
              radius={5}
              stroke={pal.borderSubtle}
              strokeWidth={1}
            >
              <Label
                width={itemWidth}
                height={26}
                text={String(item + 1).padStart(2, "0")}
                color={pal.muted}
                fontSize={9}
                fontFamily="mono"
                horizontalAlign="center"
                verticalAlign="center"
              />
            </Surface>
          );
        }}
      />
      {props.animating ? (
        <>
          <Surface
            translateX={focusX}
            translateY={focusY}
            width={focusWidth}
            height={focusHeight}
            fill={withAlpha(pal.accent, 0.22)}
            radius={18}
            stroke={withAlpha(pal.accent, 0.78)}
            strokeWidth={2}
            elevation="medium"
          >
            <Label
              width={focusWidth}
              height={focusHeight}
              text="LIVE PROBE"
              color={pal.text}
              fontSize={10}
              fontWeight="bold"
              horizontalAlign="center"
              verticalAlign="center"
            />
          </Surface>
          <Surface
            translateX={scanX}
            y={12}
            width={3}
            height={props.height - 24}
            fill={withAlpha(pal.accent, 0.82)}
            radius={2}
          />
        </>
      ) : null}
    </Surface>
  );
}

function Overview(props: {
  width: number;
  height: number;
  win: Window;
  metrics: LiveMetrics;
  mode: UiPresentationMode;
  onModeChange: (mode: UiPresentationMode) => void;
}): ReactNode {
  const pal = themePalette();
  const [running, setRunning] = useState(
    process.env.MOIRE_BENCH_AUTORUN === "1",
  );
  const [animating, setAnimating] = useState(
    process.env.MOIRE_BENCH_ANIMATE !== "0",
  );
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const peakRss = useRef(0);

  useEffect(() => {
    if (!running) return;
    const startedAt = performance.now();
    const startingWindow = props.win.getPerformanceSnapshot();
    const startingCpu = process.cpuUsage();
    const startingCompositorPid = findCompositorPid();
    const startingCompositorTicks = processTicks(startingCompositorPid);
    peakRss.current = process.memoryUsage().rss;
    let finished = false;
    const finish = () => {
      if (finished) return;
      const elapsed = performance.now() - startedAt;
      if (elapsed < BENCHMARK_DURATION_MS) return;
      finished = true;
      const endingWindow = props.win.getPerformanceSnapshot();
      const cpu = process.cpuUsage(startingCpu);
      const endingCompositorTicks = processTicks(startingCompositorPid);
      const submittedFrames = Math.max(0, endingWindow.frames - startingWindow.frames);
      const compositorFrames = Math.max(
        0,
        endingWindow.compositorFrames - startingWindow.compositorFrames,
      );
      const presentedFrames = Math.max(
        0,
        endingWindow.presentedFrames - startingWindow.presentedFrames,
      );
      setResult({
        submittedFrames,
        compositorFrames,
        presentedFrames,
        discardedFrames: Math.max(
          0,
          endingWindow.discardedFrames - startingWindow.discardedFrames,
        ),
        fps: (presentedFrames || compositorFrames) / (elapsed / 1000),
        cpuPercent: ((cpu.user + cpu.system) / 1000 / elapsed) * 100,
        compositorCpuPercent:
          startingCompositorTicks != null && endingCompositorTicks != null
            ? ((endingCompositorTicks - startingCompositorTicks) / CLOCK_TICKS) /
              (elapsed / 1_000) * 100
            : null,
        averageFrameMs: endingWindow.averageFrameMs,
        peakRssBytes: peakRss.current,
        durationMs: elapsed,
        presentationFrameMsP95: endingWindow.presentationFrameMsP95,
      });
      setRunning(false);
    };
    const unsubscribe = props.win.onCompositorFrame(() => {
      const elapsed = performance.now() - startedAt;
      peakRss.current = Math.max(peakRss.current, process.memoryUsage().rss);
      setProgress(Math.min(1, elapsed / BENCHMARK_DURATION_MS));
      if (elapsed >= BENCHMARK_DURATION_MS) {
        finish();
      }
    });
    const watchdog = setTimeout(finish, BENCHMARK_DURATION_MS + 1_000);
    return () => {
      unsubscribe();
      clearTimeout(watchdog);
    };
  }, [props.win, running]);

  const presentation = props.metrics.platform?.presentation ?? "connecting";
  const contentWidth = props.width - 48;
  const contentHeight = 650;
  return (
    <ScrollArea width={props.width} height={props.height} contentHeight={contentHeight}>
      <Inset width={props.width} height={contentHeight} padding={{ horizontal: 24, vertical: 20 }}>
        <Vertical gap={14}>
          <Horizontal height={112} gap={12} align="stretch">
            <Measure flexGrow={1}>{({ width, height }) => (
              <MetricCard width={width} height={height} label="Presented" value={frameRate(props.metrics.window.presentedFramesPerSecond)} detail={`${props.metrics.window.displayRefreshHz.toFixed(1)} Hz · p95 ${milliseconds(props.metrics.window.presentationFrameMsP95)}`} accent={running} />
            )}</Measure>
            <Measure flexGrow={1}>{({ width, height }) => (
              <MetricCard width={width} height={height} label="Submitted" value={frameRate(props.metrics.window.submittedFramesPerSecond)} detail={`${props.metrics.window.lastTransport ?? "waiting"} · ${props.metrics.window.discardedFrames} discarded`} />
            )}</Measure>
            <Measure flexGrow={1}>{({ width, height }) => (
              <MetricCard width={width} height={height} label="Client CPU" value={`${props.metrics.cpuPercent.toFixed(1)}%`} detail={`compositor ${props.metrics.compositorCpuPercent?.toFixed(1) ?? "—"}% · ${LOGICAL_PROCESSORS} CPUs`} />
            )}</Measure>
            <Measure flexGrow={1}>{({ width, height }) => (
              <MetricCard width={width} height={height} label="Frame work" value={milliseconds(props.metrics.window.averageFrameMs)} detail={`${milliseconds(props.metrics.window.averageRasterMs)} raster`} />
            )}</Measure>
          </Horizontal>

          <Surface height={86} width={contentWidth} fill={pal.surface} radius={10} stroke={pal.borderSubtle} strokeWidth={1}>
            <Inset width={contentWidth} height={86} padding={{ horizontal: 16, vertical: 12 }}>
              <Horizontal gap={14} align="center">
                <Vertical flexGrow={1} gap={4} justify="center">
                  <Horizontal height={22} gap={8} align="center">
                    <Label text="Current presentation path" fontSize={13} fontWeight="medium" />
                    <Box width={presentation.length * 7 + 20} height={22}><Badge text={presentation} tone={props.metrics.platform?.accelerated ? "success" : "warning"} /></Box>
                  </Horizontal>
                  <Label text={props.metrics.platform?.glRenderer ?? props.metrics.platform?.fallbackReason ?? "Waiting for the platform backend"} color={pal.muted} fontSize={10} overflow="ellipsis" maxLines={1} />
                  <Label text={`Copy ${milliseconds(props.metrics.window.averageCopyMs)} · release ${milliseconds(props.metrics.window.averageBufferReleaseMs)} · damage ${props.metrics.window.averageDamagePercent.toFixed(0)}% · RSS ${bytes(props.metrics.rssBytes)}`} color={pal.muted} fontSize={9} overflow="ellipsis" maxLines={1} />
                </Vertical>
                <SegmentedControl
                  width={240}
                  options={[
                    { id: "auto", label: "Auto" },
                    { id: "egl", label: "EGL" },
                    { id: "shm", label: "SHM" },
                  ]}
                  value={props.mode}
                  onChange={(value) => props.onModeChange(value as UiPresentationMode)}
                />
                <Button
                  width={132}
                  label={animating ? "Pause motion" : "Resume motion"}
                  variant="secondary"
                  onPress={() => setAnimating((value) => !value)}
                />
                <Button
                  width={170}
                  label={running ? "Benchmarking…" : "Run 5 second test"}
                  variant="primary"
                  disabled={running}
                  onPress={() => {
                    setAnimating(true);
                    setResult(null);
                    setProgress(0);
                    setRunning(true);
                  }}
                />
              </Horizontal>
            </Inset>
          </Surface>

          <ProgressBar width={contentWidth} value={progress} />
          <StressScene width={contentWidth} height={260} animating={animating} />

          <Surface width={contentWidth} height={76} fill={pal.surface} radius={10} stroke={pal.borderSubtle} strokeWidth={1}>
            <Inset width={contentWidth} height={76} padding={{ horizontal: 16, vertical: 10 }}>
              {result ? (
                <Horizontal gap={24} align="center">
                  <Label flexGrow={1} text={`Result: ${result.fps.toFixed(1)} fps · ${result.cpuPercent.toFixed(1)}% client · ${result.compositorCpuPercent?.toFixed(1) ?? "—"}% compositor · ${milliseconds(result.averageFrameMs)} work · p95 ${milliseconds(result.presentationFrameMsP95)}`} fontSize={12} fontWeight="medium" overflow="ellipsis" maxLines={1} />
                  <Label text={`${result.presentedFrames} presented · ${result.compositorFrames} compositor · ${result.submittedFrames} submitted · ${result.discardedFrames} discarded`} color={pal.muted} fontSize={10} />
                </Horizontal>
              ) : (
                <Vertical gap={4} justify="center">
                  <Label text="Continuous native-client workload" fontSize={12} fontWeight="medium" />
                  <Label text="The 96-surface animation stays active for meaningful live FPS. Run the timed test for a repeatable EGL/SHM score, or pause motion to observe retained idle behavior." color={pal.muted} fontSize={10} wrap maxLines={2} />
                </Vertical>
              )}
            </Inset>
          </Surface>
        </Vertical>
      </Inset>
    </ScrollArea>
  );
}

function Environment(props: { width: number; height: number; metrics: LiveMetrics }): ReactNode {
  const platform = props.metrics.platform;
  const cpu = os.cpus()[0];
  return (
    <Inset width={props.width} height={props.height} padding={{ horizontal: 24, vertical: 20 }}>
      <PropertyList
        width={props.width - 48}
        height={props.height - 40}
        labelWidth={190}
        striped
        sections={[
          {
            id: "session",
            label: "Moire session",
            items: [
              { id: "platform", label: "Platform", value: platform?.platform ?? "Connecting" },
              { id: "display", label: "Display server", value: `${platform?.displayServer ?? "—"} · ${platform?.display ?? "—"}` },
              { id: "transport", label: "Protocol transport", value: platform?.transport ?? "—" },
              { id: "presentation", label: "Presentation", value: platform?.presentation ?? "—" },
              { id: "window-transport", label: "Window transport", value: props.metrics.window.lastTransport ?? "Waiting" },
              { id: "acceleration", label: "Requested acceleration", value: platform?.requestedAcceleration ?? "—" },
              { id: "render-node", label: "Render node", value: platform?.renderNode ?? "None" },
              { id: "window", label: "Window buffer", value: `${props.metrics.window.width} × ${props.metrics.window.height}` },
            ],
          },
          {
            id: "graphics",
            label: "Graphics",
            items: [
              { id: "gl-renderer", label: "GL renderer", value: platform?.glRenderer ?? "Software" },
              { id: "gl-version", label: "GL version", value: platform?.glVersion ?? "—" },
              { id: "egl", label: "EGL", value: [platform?.eglVendor, platform?.eglVersion].filter(Boolean).join(" · ") || "—" },
              { id: "frames", label: "Submitted frames", value: `${props.metrics.window.dmabufFrames} dma-buf · ${props.metrics.window.shmFrames} SHM` },
              { id: "reconciliation", label: "React reconciliations", value: `${props.metrics.window.reconciledFrames} total · presentation motion bypasses React` },
              { id: "compositor", label: "Compositor callbacks", value: `${props.metrics.window.compositorFrames} · ${frameRate(props.metrics.window.compositorFramesPerSecond)}` },
              { id: "presented", label: "Presentation feedback", value: `${props.metrics.window.presentedFrames} presented · ${props.metrics.window.discardedFrames} discarded` },
              { id: "refresh", label: "Display refresh", value: props.metrics.window.displayRefreshHz > 0 ? `${props.metrics.window.displayRefreshHz.toFixed(2)} Hz` : "Unknown" },
              { id: "work", label: "Scene / raster / submit", value: `${milliseconds(props.metrics.window.averageSceneMs)} · ${milliseconds(props.metrics.window.averageRasterMs)} · ${milliseconds(props.metrics.window.averageSubmitMs)}` },
              { id: "shm", label: "Copy / buffer release", value: `${milliseconds(props.metrics.window.averageCopyMs)} · ${milliseconds(props.metrics.window.averageBufferReleaseMs)}` },
              { id: "cadence", label: "Presentation p50 / p95", value: `${milliseconds(props.metrics.window.presentationFrameMsP50)} · ${milliseconds(props.metrics.window.presentationFrameMsP95)}` },
              { id: "latency", label: "Commit feedback avg / p95", value: `${milliseconds(props.metrics.window.averagePresentationLatencyMs)} · ${milliseconds(props.metrics.window.presentationLatencyMsP95)}` },
              { id: "damage", label: "Surface damage", value: `${props.metrics.window.averageDamagePercent.toFixed(1)}% of pixels per commit` },
            ],
          },
          {
            id: "runtime",
            label: "Runtime",
            items: [
              { id: "node", label: "Node", value: `${process.version} · ${process.arch}` },
              { id: "kernel", label: "Kernel", value: `${os.type()} ${os.release()}` },
              { id: "cpu", label: "CPU", value: cpu?.model.trim() ?? "—" },
              { id: "memory", label: "Memory", value: `${bytes(os.totalmem())} total · ${bytes(props.metrics.freeMemoryBytes)} free` },
              { id: "load", label: "Load average", value: props.metrics.loadAverage.toFixed(2) },
              { id: "pid", label: "Benchmark process", value: `PID ${process.pid} · ${bytes(props.metrics.rssBytes)} resident` },
              { id: "compositor-pid", label: "Compositor process", value: props.metrics.compositorPid ? `PID ${props.metrics.compositorPid} · ${props.metrics.compositorCpuPercent?.toFixed(1) ?? "—"}% CPU` : "Not found" },
            ],
          },
        ]}
      />
    </Inset>
  );
}

function Timeline(props: { width: number; height: number; history: readonly HistorySample[] }): ReactNode {
  const pal = themePalette();
  const contentWidth = props.width - 48;
  const cardWidth = Math.floor((contentWidth - 12) / 2);
  const cardHeight = 240;
  const series = (id: string, label: string, value: (sample: HistorySample) => number) => [{
    id,
    label,
    points: props.history.map((sample) => ({ x: sample.sequence, y: value(sample) })),
  }];
  const chartCard = (title: string, detail: string, chart: ReactNode) => (
    <Surface width={cardWidth} height={cardHeight} fill={pal.panel} radius={10} stroke={pal.borderSubtle} strokeWidth={1} clip>
      <Label x={14} y={11} width={cardWidth - 28} height={16} text={title} fontSize={12} fontWeight="medium" />
      <Label x={14} y={29} width={cardWidth - 28} height={13} text={detail} color={pal.muted} fontSize={8} />
      <Surface x={8} y={48} width={cardWidth - 16} height={cardHeight - 56} fill={0x00000000}>{chart}</Surface>
    </Surface>
  );
  const multiSeries = (
    specs: readonly [string, string, (sample: HistorySample) => number][],
  ) => specs.map(([id, label, value]) => ({
    id,
    label,
    points: props.history.map((sample) => ({ x: sample.sequence, y: value(sample) })),
  }));
  return (
    <ScrollArea width={props.width} height={props.height} contentHeight={788}>
      <Inset width={props.width} height={788} padding={{ horizontal: 24, vertical: 20 }}>
        <Vertical gap={12}>
          <Horizontal width={contentWidth} height={cardHeight} gap={12} align="stretch">
            {chartCard("Process CPU", "Client and compositor · percent of one logical processor", <LineChart width={cardWidth - 16} height={cardHeight - 56} series={multiSeries([
              ["client", "Client", (sample) => sample.cpuPercent],
              ["compositor-cpu", "Compositor", (sample) => sample.compositorCpuPercent],
            ])} yMin={0} formatValue={(value) => `${value.toFixed(0)}%`} />)}
            {chartCard("Frame delivery", "Presented · compositor callback · submitted", <LineChart width={cardWidth - 16} height={cardHeight - 56} series={multiSeries([
              ["presented", "Presented", (sample) => sample.presentedFps],
              ["compositor", "Compositor", (sample) => sample.compositorFps],
              ["submitted", "Submitted", (sample) => sample.submittedFps],
            ])} yMin={0} yMax={65} />)}
          </Horizontal>
          <Horizontal width={contentWidth} height={cardHeight} gap={12} align="stretch">
            {chartCard("Frame pipeline", "Scene · raster · platform submit", <LineChart width={cardWidth - 16} height={cardHeight - 56} series={multiSeries([
              ["scene", "Scene", (sample) => sample.sceneMs],
              ["raster", "Raster", (sample) => sample.rasterMs],
              ["submit", "Submit", (sample) => sample.submitMs],
            ])} yMin={0} formatValue={(value) => `${value.toFixed(1)} ms`} />)}
            {chartCard("SHM transport", "Pixel copy · commit-to-buffer-release latency", <LineChart width={cardWidth - 16} height={cardHeight - 56} series={multiSeries([
              ["copy", "Copy", (sample) => sample.copyMs],
              ["release", "Release", (sample) => sample.releaseMs],
            ])} yMin={0} formatValue={(value) => `${value.toFixed(1)} ms`} />)}
          </Horizontal>
          <Horizontal width={contentWidth} height={cardHeight} gap={12} align="stretch">
            {chartCard("Resident memory", "Process RSS observed by Node", <AreaChart width={cardWidth - 16} height={cardHeight - 56} series={series("rss", "RSS", (sample) => sample.rssMiB)} formatValue={(value) => `${value.toFixed(0)} MiB`} />)}
            {chartCard("Total frame work", "All retained-scene, raster and submit work", <LineChart width={cardWidth - 16} height={cardHeight - 56} series={series("frame", "Milliseconds", (sample) => sample.frameMs)} yMin={0} formatValue={(value) => `${value.toFixed(1)} ms`} />)}
          </Horizontal>
        </Vertical>
      </Inset>
    </ScrollArea>
  );
}

function Protocols(props: { width: number; height: number; metrics: LiveMetrics }): ReactNode {
  const capabilities = props.metrics.platform?.capabilities ?? [];
  return (
    <Inset width={props.width} height={props.height} padding={{ horizontal: 24, vertical: 20 }}>
      <PropertyList
        width={props.width - 48}
        height={props.height - 40}
        labelWidth={250}
        striped
        emptyState={<Label text="No protocol globals reported" />}
        sections={[{
          id: "globals",
          label: `Advertised Wayland globals · ${capabilities.length}`,
          items: capabilities.map((capability, index) => ({
            id: `${index}:${capability}`,
            label: capability,
            value: "available",
          })),
        }]}
      />
    </Inset>
  );
}

function BenchmarkApp(props: WindowSize & { win: Window }): ReactNode {
  const pal = themePalette();
  const [tab, setTab] = useState(0);
  const [presentationMode, setPresentationMode] = useState<UiPresentationMode>(
    process.env.MOIRE_UI_ACCELERATION === "software" ? "shm" : "auto",
  );
  const [metrics, setMetrics] = useState(() => initialMetrics(props.win));
  const [history, setHistory] = useState<HistorySample[]>([]);
  const cpuSample = useRef({ at: performance.now(), usage: process.cpuUsage() });
  const compositorSample = useRef<{
    pid: number | null;
    ticks: number | null;
    at: number;
  }>({
    pid: metrics.compositorPid,
    ticks: processTicks(metrics.compositorPid),
    at: performance.now(),
  });

  useEffect(() => {
    props.win.setPresentationMode(presentationMode);
  }, [presentationMode, props.win]);

  useEffect(() => {
    const update = () => {
      const now = performance.now();
      const usage = process.cpuUsage(cpuSample.current.usage);
      const elapsed = Math.max(1, now - cpuSample.current.at);
      const memory = process.memoryUsage();
      let compositorPid = compositorSample.current.pid;
      let ticks = processTicks(compositorPid);
      if (ticks == null) {
        compositorPid = findCompositorPid();
        ticks = processTicks(compositorPid);
      }
      const compositorElapsed = Math.max(1, now - compositorSample.current.at);
      const compositorCpuPercent = ticks != null &&
        compositorSample.current.ticks != null &&
        compositorPid === compositorSample.current.pid
        ? ((ticks - compositorSample.current.ticks) / CLOCK_TICKS) /
          (compositorElapsed / 1_000) * 100
        : null;
      cpuSample.current = { at: now, usage: process.cpuUsage() };
      compositorSample.current = { pid: compositorPid, ticks, at: now };
      const nextMetrics: LiveMetrics = {
        cpuPercent: ((usage.user + usage.system) / 1000 / elapsed) * 100,
        compositorCpuPercent,
        compositorPid,
        rssBytes: memory.rss,
        heapBytes: memory.heapUsed,
        freeMemoryBytes: os.freemem(),
        loadAverage: os.loadavg()[0] ?? 0,
        window: props.win.getPerformanceSnapshot(),
        platform: props.win.getPlatformDiagnostics(),
      };
      setMetrics(nextMetrics);
      setHistory((current) => [...current, {
        sequence: (current[current.length - 1]?.sequence ?? 0) + 1,
        cpuPercent: nextMetrics.cpuPercent,
        compositorCpuPercent: nextMetrics.compositorCpuPercent ?? 0,
        submittedFps: nextMetrics.window.submittedFramesPerSecond,
        compositorFps: nextMetrics.window.compositorFramesPerSecond,
        presentedFps: nextMetrics.window.presentedFramesPerSecond,
        frameMs: nextMetrics.window.averageFrameMs,
        sceneMs: nextMetrics.window.averageSceneMs,
        rasterMs: nextMetrics.window.averageRasterMs,
        submitMs: nextMetrics.window.averageSubmitMs,
        copyMs: nextMetrics.window.averageCopyMs,
        releaseMs: nextMetrics.window.averageBufferReleaseMs,
        rssMiB: nextMetrics.rssBytes / 1024 / 1024,
      }].slice(-75));
    };
    update();
    const timer = setInterval(update, 400);
    return () => clearInterval(timer);
  }, [props.win]);

  const bodyY = 108;
  const statusH = 28;
  const bodyH = Math.max(1, props.height - bodyY - statusH);
  const platform = metrics.platform;
  const mode = metrics.window.lastTransport === "dmabuf" ? "DMA-BUF" :
    metrics.window.lastTransport === "shm" ? "CPU / SHM" : "WAITING";
  const tabContent = useMemo(() => {
    if (tab === 1) return <Timeline width={props.width} height={bodyH} history={history} />;
    if (tab === 2) return <Environment width={props.width} height={bodyH} metrics={metrics} />;
    if (tab === 3) return <Protocols width={props.width} height={bodyH} metrics={metrics} />;
    return <Overview width={props.width} height={bodyH} win={props.win} metrics={metrics} mode={presentationMode} onModeChange={setPresentationMode} />;
  }, [bodyH, history, metrics, presentationMode, props.width, props.win, tab]);

  return (
    <Surface width={props.width} height={props.height} fill={pal.bg}>
      <Toolbar width={props.width} height={70}>
        <Vertical flexGrow={1} gap={3} justify="center">
          <Label text="Moire Bench" fontSize={18} fontWeight="bold" />
          <Label text="Renderer truth, live process telemetry, and a repeatable UI workload" color={pal.muted} fontSize={10} />
        </Vertical>
        <Box width={mode.length * 7 + 22} height={22}><Badge text={mode} tone={metrics.window.lastTransport === "dmabuf" ? "success" : "warning"} /></Box>
      </Toolbar>
      <Separator y={69} width={props.width} />
      <Tabs y={70} width={props.width} height={38} tabs={["Overview", "Timeline", "Environment", "Wayland globals"]} active={tab} onChange={setTab} />
      <Surface y={bodyY} width={props.width} height={bodyH} fill={pal.bg}>{tabContent}</Surface>
      <StatusBar y={props.height - statusH} width={props.width} height={statusH}>
        <Label flexGrow={1} text={`${platform?.presentation ?? "connecting"} · ${platform?.transport ?? "initialising"}`} color={pal.muted} fontSize={9} overflow="ellipsis" maxLines={1} />
        <Label text={`${metrics.window.presentedFrames} presented · ${metrics.window.frames} submitted`} color={pal.muted} fontSize={9} fontFamily="mono" />
      </StatusBar>
    </Surface>
  );
}

async function main(): Promise<void> {
  const settings = loadSettings();
  setUiScaleFactor(settings.uiScale);
  const app = new Application();
  const win = new Window({
    title: "Moire Bench",
    appId: "org.moire.Benchmark",
    width: Math.round(1080 * settings.uiScale),
    height: Math.round(760 * settings.uiScale),
    resizable: true,
  });
  win.setContent((size) => <BenchmarkApp {...size} win={win} />);
  win.onClose(() => app.quit());
  app.addWindow(win);
  await app.run();
}

main().catch((error: unknown) => {
  console.error("[benchmark] fatal:", error);
  process.exit(1);
});
