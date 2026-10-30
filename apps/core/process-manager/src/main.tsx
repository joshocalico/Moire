import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSettings } from "@moire/prefs";
import {
  SystemManagementClient,
  memoryPressure,
  type ManagedProcess,
  type SystemSnapshot,
} from "@moire/system-management";
import {
  Application,
  AppHeaderBar,
  AppStatusLine,
  Badge,
  Box,
  Button,
  ConfirmationDialog,
  EmptyState,
  Horizontal,
  Label,
  OverlayHost,
  ProgressBar,
  ScrollArea,
  SearchField,
  SegmentedControl,
  Surface,
  Table,
  TextBlock,
  Vertical,
  Window,
  setUiScaleFactor,
  appChromeBody,
  getUiScaleFactor,
  usePalette,
  type TableColumn,
  type TableSort,
  type WindowActions,
  type WindowSize,
} from "@moire/ui";

function memory(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const mib = value / 1024 / 1024;
  return mib >= 1024 ? `${(mib / 1024).toFixed(1)} GiB` : `${mib.toFixed(1)} MiB`;
}

type MonitorClient = Pick<SystemManagementClient, "snapshot" | "terminate"> &
  Partial<Pick<SystemManagementClient, "close">>;
export function SystemMonitor(
  props: WindowSize & {
    client?: MonitorClient;
    connect?: () => Promise<MonitorClient>;
    /** The window the header bar controls (minimize, maximize, close, move). */
    window?: WindowActions | null;
  },
): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Connecting to system management…");
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [scope, setScope] = useState("applications");
  const [sort, setSort] = useState<TableSort>({
    columnId: "memory",
    direction: "descending",
  });
  const [confirmTarget, setConfirmTarget] = useState<ManagedProcess | null>(null);
  const [view, setView] = useState("processes"),
    [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const service = useRef<MonitorClient | null>(props.client ?? null);
  const refreshing = useRef(false),
    acting = useRef(false),
    disposed = useRef(false);

  const refresh = async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      if (!service.current)
        service.current = await (props.connect ?? SystemManagementClient.connect)();
      if (disposed.current) {
        service.current.close?.();
        return;
      }
      const next = await service.current.snapshot();
      if (disposed.current) return;
      setSnapshot(next);
      setError("");
      setSelectedPid((current) =>
        current != null && next.processes.some((item) => item.pid === current) ? current : null,
      );
      setStatus((current) =>
        current === "Connecting to system management…" ||
        current === "System management service unavailable"
          ? "Connected · refreshes every second"
          : current,
      );
    } catch (caught) {
      if (!disposed.current) {
        setError(caught instanceof Error ? caught.message : String(caught));
        setStatus("System management service unavailable");
      }
      service.current?.close?.();
      service.current = null;
    } finally {
      refreshing.current = false;
    }
  };
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 1_000);
    return () => {
      disposed.current = true;
      clearInterval(timer);
      service.current?.close?.();
    };
  }, []);

  const rows = useMemo(
    () =>
      (snapshot?.processes ?? []).filter(
        (item) =>
          (scope === "all" || item.appId.length > 0) &&
          `${item.name} ${item.command} ${item.pid}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [scope, snapshot, query],
  );
  const selected = rows.find((item) => item.pid === selectedPid) ?? null;
  const columns = useMemo<readonly TableColumn<ManagedProcess>[]>(
    () => [
      {
        id: "name",
        label: "Process",
        minWidth: 120 * ui,
        sortable: true,
        getValue: (item) => item.name,
      },
      {
        id: "pid",
        label: "PID",
        width: 80 * ui,
        align: "right",
        sortable: true,
        getValue: (item) => item.pid,
      },
      {
        id: "cpu",
        label: "CPU",
        width: 90 * ui,
        align: "right",
        sortable: true,
        getValue: (item) => item.cpuPercent,
        renderCell: (item) => (
          <Label
            width={80 * ui}
            height={38 * ui}
            text={`${item.cpuPercent.toFixed(1)}%`}
            horizontalAlign="end"
            verticalAlign="center"
            fontFamily="mono"
            fontSize={11}
          />
        ),
      },
      {
        id: "memory",
        label: "Memory",
        width: 126 * ui,
        align: "right",
        sortable: true,
        getValue: (item) => item.rssBytes,
        renderCell: (item) => (
          <Label
            width={116 * ui}
            height={38 * ui}
            text={memory(item.rssBytes)}
            horizontalAlign="end"
            verticalAlign="center"
            fontFamily="mono"
            fontSize={11}
          />
        ),
      },
    ],
    [ui],
  );

  const terminate = async (target: ManagedProcess | null, force: boolean) => {
    if (!target || target.protected || !service.current || acting.current) return;
    acting.current = true;
    setBusy(true);
    try {
      // Revalidate the process before a destructive action: PID reuse or an
      // exited row must not redirect confirmation to a different application.
      const fresh = await service.current.snapshot();
      const current = fresh.processes.find(
        (item) =>
          item.pid === target.pid && item.command === target.command && item.name === target.name,
      );
      if (!current || current.protected) {
        setStatus("That process exited or changed; select it again");
        return;
      }
      const ok = await service.current.terminate(target.pid, force);
      if (!disposed.current)
        setStatus(
          ok
            ? `${force ? "Force quit" : "Quit"} requested for ${target.name}`
            : `${target.name} could not be stopped`,
        );
      await refresh();
    } catch (caught) {
      if (!disposed.current)
        setStatus(`Quit failed: ${caught instanceof Error ? caught.message : String(caught)}`);
    } finally {
      acting.current = false;
      if (!disposed.current) setBusy(false);
    }
  };

  const pressure = snapshot ? memoryPressure(snapshot) : 0;
  const used = snapshot ? snapshot.totalMemoryBytes - snapshot.availableMemoryBytes : 0;
  const pad = 16 * ui;
  const chrome = appChromeBody(props.height);
  const titleH = chrome.y;
  const memoryY = titleH + 12 * ui;
  const memoryH = 64 * ui;
  const filterY = memoryY + memoryH + 12 * ui;
  const filterH = 32 * ui;
  const footerH = view === "processes" ? 52 * ui : 0;
  const statusH = props.height - chrome.y - chrome.height;
  const bodyY = view === "resources" ? filterY : filterY + filterH + 12 * ui;
  const bodyH = Math.max(120 * ui, props.height - bodyY - footerH - statusH - 12 * ui);
  const innerW = Math.max(1, props.width - pad * 2);
  const actionable = !busy && service.current != null && selected != null && !selected.protected;

  return (
    <OverlayHost width={props.width} height={props.height}>
      <Surface width={props.width} height={props.height} fill={pal.bg}>
        <AppHeaderBar
          width={props.width}
          title="System Monitor"
          icon="monitor"
          subtitle="Applications and processes"
          window={props.window}
          actions={
            <SegmentedControl
              width={Math.min(220 * ui, props.width * 0.4)}
              height={32 * ui}
              value={view}
              options={[
                { id: "processes", label: "Processes" },
                { id: "resources", label: "Resources" },
              ]}
              onChange={setView}
            />
          }
        />
        <MemoryCard
          x={pad}
          y={memoryY}
          width={innerW}
          height={memoryH}
          used={used}
          total={snapshot?.totalMemoryBytes ?? 0}
          pressure={pressure}
        />
        {view === "processes" ? (
          <Horizontal x={pad} y={filterY} width={innerW} height={filterH} gap={8 * ui}>
            <SearchField
              width={Math.max(80 * ui, innerW - 188 * ui)}
              height={filterH}
              value={query}
              placeholder="Search name, command or PID"
              onChange={setQuery}
              onClear={() => setQuery("")}
            />
            <SegmentedControl
              width={180 * ui}
              height={filterH}
              value={scope}
              options={[
                { id: "applications", label: "Apps" },
                { id: "all", label: "All" },
              ]}
              onChange={setScope}
            />
          </Horizontal>
        ) : null}
        {error ? (
          <EmptyState
            y={bodyY}
            width={props.width}
            height={bodyH}
            title="System management is unavailable"
            message={error}
            icon="monitor"
            action={<Button width={140 * ui} label="Try Again" onPress={() => void refresh()} />}
          />
        ) : view === "resources" ? (
          <ResourcesCard x={pad} y={bodyY} width={innerW} height={bodyH} snapshot={snapshot} />
        ) : (
          <Table
            x={pad}
            y={bodyY}
            width={innerW}
            height={bodyH}
            headerHeight={34 * ui}
            rowHeight={38 * ui}
            columns={columns}
            rows={rows}
            getRowKey={(item) => String(item.pid)}
            selectedKey={selectedPid == null ? null : String(selectedPid)}
            onSelect={(item) => setSelectedPid(item.pid)}
            sort={sort}
            onSortChange={setSort}
            striped
            emptyState={
              <EmptyState
                width={innerW}
                height={Math.max(1, bodyH - 34 * ui)}
                title="No matching processes"
                message={
                  scope === "all"
                    ? "Try a different name, command or PID."
                    : "Choose All to include background services."
                }
                icon="search"
              />
            }
          />
        )}
        {footerH ? (
          <Surface
            y={props.height - footerH - statusH}
            width={props.width}
            height={footerH}
            fill={pal.panel}
          >
            <Surface width={props.width} height={1} fill={pal.borderSubtle} />
            <Horizontal x={pad} width={innerW} height={footerH} gap={8 * ui} align="center">
              <Vertical flexGrow={1} gap={1 * ui} justify="center">
                <TextBlock
                  text={selected ? `${selected.name} · PID ${selected.pid}` : "No process selected"}
                  fontSize={13}
                  fontWeight="medium"
                  overflow="ellipsis"
                  maxLines={1}
                />
                <TextBlock
                  text={
                    selected
                      ? selected.protected
                        ? "Required by the desktop session"
                        : selected.command
                      : "Select a process to inspect or quit it"
                  }
                  color={pal.muted}
                  fontSize={11}
                  overflow="ellipsis"
                  maxLines={1}
                />
              </Vertical>
              <Button
                width={104 * ui}
                height={32 * ui}
                label="Force Quit"
                variant="danger"
                disabled={!actionable}
                onPress={() => setConfirmTarget(selected)}
              />
              <Button
                width={84 * ui}
                height={32 * ui}
                label="Quit"
                variant="secondary"
                disabled={!actionable}
                onPress={() => void terminate(selected, false)}
              />
            </Horizontal>
          </Surface>
        ) : null}
        <AppStatusLine
          y={props.height - statusH}
          width={props.width}
          status={status}
          end={`${rows.length} ${scope === "all" ? "processes" : "application processes"}`}
        />
      </Surface>
      <ConfirmationDialog
        open={confirmTarget != null}
        viewportWidth={props.width}
        viewportHeight={props.height}
        title={`Force quit ${confirmTarget?.name ?? "this process"}?`}
        message="The process will stop immediately and may lose unsaved work. Use Force Quit only when a normal Quit does not work."
        confirmLabel="Force Quit"
        danger
        onConfirm={() => {
          const target = confirmTarget;
          setConfirmTarget(null);
          void terminate(target, true);
        }}
        onDismiss={() => setConfirmTarget(null)}
      />
    </OverlayHost>
  );
}

function pressureTone(pressure: number) {
  return pressure >= 0.9
    ? ({ text: "Critical", tone: "danger" } as const)
    : pressure >= 0.75
      ? ({ text: "High", tone: "warning" } as const)
      : ({ text: "Normal", tone: "success" } as const);
}

function Card(props: {
  x: number;
  y: number;
  width: number;
  height: number;
  children: ReactNode;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  return (
    <Surface
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      fill={pal.surface}
      radius={12 * ui}
      stroke={pal.borderSubtle}
      strokeWidth={1}
    >
      {props.children}
    </Surface>
  );
}

function MemoryCard(props: {
  x: number;
  y: number;
  width: number;
  height: number;
  used: number;
  total: number;
  pressure: number;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const badge = pressureTone(props.pressure);
  const inner = Math.max(1, props.width - 32 * ui);
  return (
    <Card x={props.x} y={props.y} width={props.width} height={props.height}>
      <Vertical x={16 * ui} width={inner} height={props.height} gap={8 * ui} justify="center">
        <Horizontal width={inner} height={22 * ui} gap={8 * ui} align="center">
          <TextBlock text="Memory" fontSize={13} fontWeight="medium" maxLines={1} />
          <TextBlock
            flexGrow={1}
            text={`${memory(props.used)} of ${memory(props.total)} in use`}
            color={pal.muted}
            fontSize={12}
            overflow="ellipsis"
            maxLines={1}
          />
          <Badge text={badge.text} tone={badge.tone} />
        </Horizontal>
        <ProgressBar width={inner} value={props.pressure} size="small" />
      </Vertical>
    </Card>
  );
}

function ResourceRow(props: {
  width: number;
  label: string;
  value: string;
  detail?: string;
  progress?: number;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  return (
    <Vertical width={props.width} height={64 * ui} gap={6 * ui} justify="center">
      <Horizontal width={props.width} height={18 * ui} gap={12 * ui} align="center">
        <TextBlock text={props.label} fontSize={13} fontWeight="medium" maxLines={1} />
        <TextBlock
          flexGrow={1}
          text={props.value}
          color={pal.muted}
          fontSize={12}
          horizontalAlign="end"
          overflow="ellipsis"
          maxLines={1}
        />
      </Horizontal>
      {props.progress != null ? (
        <ProgressBar width={props.width} value={props.progress} size="small" />
      ) : (
        <TextBlock
          text={props.detail ?? ""}
          color={pal.muted}
          fontSize={11}
          overflow="ellipsis"
          maxLines={1}
        />
      )}
    </Vertical>
  );
}

function ResourcesCard(props: {
  x: number;
  y: number;
  width: number;
  height: number;
  snapshot: SystemSnapshot | null;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const snapshot = props.snapshot;
  const inner = Math.max(1, props.width - 32 * ui);
  const swapUsed = (snapshot?.swapTotalBytes ?? 0) - (snapshot?.swapFreeBytes ?? 0);
  const cpu = snapshot?.processes.reduce((total, item) => total + item.cpuPercent, 0) ?? 0;
  const rows = [
    {
      label: "Memory pressure",
      value: `${Math.round((snapshot ? memoryPressure(snapshot) : 0) * 100)}% · ${memory(snapshot?.availableMemoryBytes ?? 0)} available`,
      progress: snapshot ? memoryPressure(snapshot) : 0,
    },
    {
      label: "Swap",
      value: `${memory(swapUsed)} of ${memory(snapshot?.swapTotalBytes ?? 0)}`,
      progress: snapshot?.swapTotalBytes ? swapUsed / snapshot.swapTotalBytes : 0,
    },
    {
      label: "CPU",
      value: `${os.cpus().length} logical CPUs`,
      detail: `Process CPU total · ${cpu.toFixed(1)}% · one busy core is 100%`,
    },
    {
      label: "Load average",
      value: os
        .loadavg()
        .map((value) => value.toFixed(2))
        .join("  /  "),
      detail: "Over 1, 5 and 15 minutes",
    },
    {
      label: "Running",
      value: `${snapshot?.processes.length ?? 0} processes`,
      detail: `${snapshot?.processes.filter((item) => item.appId).length ?? 0} belong to applications`,
    },
  ];
  const contentH = rows.length * 64 * ui + 16 * ui;
  return (
    <Card x={props.x} y={props.y} width={props.width} height={props.height}>
      <ScrollArea
        x={1}
        y={1}
        width={props.width - 2}
        height={props.height - 2}
        contentHeight={contentH}
        fill={0x00000000}
      >
        <Vertical x={16 * ui} y={8 * ui} width={inner} height={contentH - 16 * ui} gap={0}>
          {rows.map((row, index) => (
            <Box key={row.label} width={inner} height={64 * ui}>
              {index > 0 ? <Surface width={inner} height={1} fill={pal.borderSubtle} /> : null}
              <ResourceRow width={inner} {...row} />
            </Box>
          ))}
        </Vertical>
      </ScrollArea>
    </Card>
  );
}

async function main(): Promise<void> {
  const settings = loadSettings();
  setUiScaleFactor(settings.uiScale);
  const app = new Application();
  const win = new Window({
    title: "System Monitor",
    appId: "org.moire.ProcessManager",
    width: Math.round(860 * settings.uiScale),
    height: Math.round(620 * settings.uiScale),
    resizable: true,
    // The AppHeaderBar is this window's titlebar.
    decorated: false,
  });
  win.setContent((size) => <SystemMonitor {...size} window={win} />);
  win.onClose(() => {
    app.quit();
  });
  app.addWindow(win);
  await app.run();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error: unknown) => {
    console.error("[process-manager] fatal:", error);
    process.exit(1);
  });
