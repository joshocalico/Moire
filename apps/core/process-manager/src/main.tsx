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
  Badge,
  Box,
  Button,
  ConfirmationDialog,
  EmptyState,
  Horizontal,
  Inset,
  Label,
  OverlayHost,
  ProgressBar,
  SegmentedControl,
  StatusBar,
  Surface,
  TextField,
  Table,
  Toolbar,
  Vertical,
  Window,
  setUiScaleFactor,
  getUiScaleFactor,
  usePalette,
  type TableColumn,
  type TableSort,
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
  props: WindowSize & { client?: MonitorClient; connect?: () => Promise<MonitorClient> },
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
  const tableY = 190 * ui;
  const footerH = 44 * ui;
  const statusH = 28 * ui;
  const tableH = Math.max(120 * ui, props.height - tableY - footerH - statusH);

  return (
    <OverlayHost width={props.width} height={props.height}>
      <Surface width={props.width} height={props.height} fill={pal.bg}>
        <Toolbar width={props.width} height={76 * ui}>
          <Vertical flexGrow={1} gap={3 * ui} justify="center">
            <Label text="System Monitor" fontSize={18} fontWeight="bold" />
            <Label
              text="Applications and processes in this desktop session"
              color={pal.muted}
              fontSize={10}
            />
          </Vertical>
          <Box width={220 * ui} height={32 * ui}>
            <SegmentedControl
              width={220 * ui}
              height={32 * ui}
              value={view}
              options={[
                { id: "processes", label: "Processes" },
                { id: "resources", label: "Resources" },
              ]}
              onChange={setView}
            />
          </Box>
        </Toolbar>
        <Surface y={76 * ui} width={props.width} height={66 * ui} fill={pal.panel}>
          <Inset
            width={props.width}
            height={66 * ui}
            padding={{ horizontal: 18 * ui, vertical: 10 * ui }}
          >
            <Horizontal gap={16 * ui} align="center">
              <Vertical flexGrow={1} gap={6 * ui} justify="center">
                <Horizontal gap={8 * ui} align="center">
                  <Label
                    flexGrow={1}
                    text={`Memory  ${memory(used)} of ${memory(snapshot?.totalMemoryBytes ?? 0)}`}
                    color={pal.text}
                    fontSize={11}
                    fontWeight="medium"
                  />
                  <Box width={pressure >= 0.9 ? 72 : 58} height={22 * ui}>
                    <Badge
                      text={pressure >= 0.9 ? "CRITICAL" : pressure >= 0.75 ? "HIGH" : "NORMAL"}
                      tone={pressure >= 0.9 ? "danger" : pressure >= 0.75 ? "warning" : "success"}
                    />
                  </Box>
                </Horizontal>
                <ProgressBar
                  width={Math.max(1, props.width - 36 * ui)}
                  value={pressure}
                  size="small"
                />
              </Vertical>
            </Horizontal>
          </Inset>
        </Surface>
        <Horizontal
          x={12 * ui}
          y={148 * ui}
          width={Math.max(1, props.width - 24 * ui)}
          height={32 * ui}
          gap={8 * ui}
        >
          <Box flexGrow={1} height={32 * ui}>
            <TextField
              width={Math.max(80, props.width - 268 * ui)}
              height={32 * ui}
              value={query}
              placeholder="Search name, command or PID"
              onChange={setQuery}
            />
          </Box>
          <SegmentedControl
            width={220 * ui}
            height={32 * ui}
            value={scope}
            options={[
              { id: "applications", label: "Apps" },
              { id: "all", label: "All" },
            ]}
            onChange={setScope}
          />
        </Horizontal>
        {error ? (
          <EmptyState
            y={tableY}
            width={props.width}
            height={tableH}
            title="System management is unavailable"
            message={error}
            icon="app"
            action={<Button width={140 * ui} label="Try Again" onPress={() => void refresh()} />}
          />
        ) : view === "resources" ? (
          <Surface
            x={18 * ui}
            y={tableY}
            width={Math.max(1, props.width - 36 * ui)}
            height={tableH}
            fill={pal.panel}
          >
            <Vertical
              x={16 * ui}
              y={16 * ui}
              width={Math.max(1, props.width - 68 * ui)}
              height={Math.max(1, tableH - 32 * ui)}
              gap={14 * ui}
            >
              <Label text="Live resources" fontSize={18} fontWeight="medium" />
              <Label text={`Memory available · ${memory(snapshot?.availableMemoryBytes ?? 0)}`} />
              <ProgressBar width={Math.max(1, props.width - 68 * ui)} value={pressure} />
              <Label
                text={`Swap used · ${memory((snapshot?.swapTotalBytes ?? 0) - (snapshot?.swapFreeBytes ?? 0))} of ${memory(snapshot?.swapTotalBytes ?? 0)}`}
              />
              <ProgressBar
                width={Math.max(1, props.width - 68 * ui)}
                value={
                  snapshot?.swapTotalBytes
                    ? 1 - snapshot.swapFreeBytes / snapshot.swapTotalBytes
                    : 0
                }
              />
              <Label
                text={`Process CPU total · ${(snapshot?.processes.reduce((total, item) => total + item.cpuPercent, 0) ?? 0).toFixed(1)}% · ${os.cpus().length} logical CPUs`}
              />
              <Label
                text={`Load average · ${os
                  .loadavg()
                  .map((value) => value.toFixed(2))
                  .join("  /  ")} (1 / 5 / 15 minutes)`}
              />
              <Label
                text={`${snapshot?.processes.length ?? 0} processes · ${snapshot?.processes.filter((item) => item.appId).length ?? 0} application processes`}
              />
              <Label
                text="CPU is summed per-process use: one fully occupied core is 100%."
                fontSize={11}
                color={pal.muted}
                wrap
              />
            </Vertical>
          </Surface>
        ) : (
          <Table
            x={12 * ui}
            y={tableY + 10 * ui}
            width={Math.max(1, props.width - 24 * ui)}
            height={Math.max(1, tableH - 18 * ui)}
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
                width={Math.max(1, props.width - 24 * ui)}
                height={Math.max(1, tableH - 52 * ui)}
                title="No matching processes"
                message="Switch to All Processes to inspect background services."
                icon="app"
              />
            }
          />
        )}
        <Surface
          y={props.height - footerH - statusH}
          width={props.width}
          height={footerH}
          fill={pal.bg}
        >
          <Inset
            width={props.width}
            height={footerH}
            padding={{ horizontal: 12 * ui, vertical: 6 * ui }}
          >
            <Horizontal gap={8 * ui} justify="end" align="center">
              <Label
                flexGrow={1}
                text={
                  selected
                    ? selected.protected
                      ? `${selected.name} is required by the desktop session`
                      : selected.command
                    : "Select a process to inspect or quit it"
                }
                color={pal.muted}
                fontSize={10}
                overflow="ellipsis"
                maxLines={1}
              />
              <Button
                width={96 * ui}
                label="Force Quit"
                variant="danger"
                disabled={busy || !service.current || !selected || selected.protected}
                onPress={() => setConfirmTarget(selected)}
              />
              <Button
                width={76 * ui}
                label="Quit"
                disabled={busy || !service.current || !selected || selected.protected}
                onPress={() => void terminate(selected, false)}
              />
            </Horizontal>
          </Inset>
        </Surface>
        <StatusBar y={props.height - statusH} width={props.width} height={statusH}>
          <Label flexGrow={1} text={status} color={pal.muted} fontSize={9} />
          <Label
            text={`${rows.length} ${scope === "all" ? "processes" : "application processes"}`}
            color={pal.muted}
            fontSize={9}
            fontFamily="mono"
          />
        </StatusBar>
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
  });
  win.setContent((size) => <SystemMonitor {...size} />);
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
