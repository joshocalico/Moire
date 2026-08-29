import React, { useEffect, useMemo, useState, type ReactNode } from "react";
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
  Table,
  Toolbar,
  Vertical,
  Window,
  setUiScaleFactor,
  themePalette,
  type TableColumn,
  type TableSort,
  type WindowSize,
} from "@moire/ui";

function memory(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const mib = value / 1024 / 1024;
  return mib >= 1024 ? `${(mib / 1024).toFixed(1)} GiB` : `${mib.toFixed(1)} MiB`;
}

function ProcessManager(props: WindowSize & { client: SystemManagementClient }): ReactNode {
  const pal = themePalette();
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Connecting to system management…");
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [scope, setScope] = useState("applications");
  const [sort, setSort] = useState<TableSort>({
    columnId: "memory",
    direction: "descending",
  });
  const [confirmForceQuit, setConfirmForceQuit] = useState(false);

  const refresh = async () => {
    try {
      const next = await props.client.snapshot();
      setSnapshot(next);
      setError("");
      setStatus(`Updated ${new Date().toLocaleTimeString()}`);
      if (selectedPid != null && !next.processes.some((item) => item.pid === selectedPid)) {
        setSelectedPid(null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setStatus("System management service unavailable");
    }
  };

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 1_000);
    return () => clearInterval(timer);
  }, []);

  const rows = useMemo(
    () => (snapshot?.processes ?? []).filter((item) => scope === "all" || item.appId.length > 0),
    [scope, snapshot],
  );
  const selected = rows.find((item) => item.pid === selectedPid) ?? null;
  const columns = useMemo<readonly TableColumn<ManagedProcess>[]>(
    () => [
      {
        id: "name",
        label: "Process",
        minWidth: 220,
        sortable: true,
        getValue: (item) => item.name,
      },
      {
        id: "pid",
        label: "PID",
        width: 80,
        align: "right",
        sortable: true,
        getValue: (item) => item.pid,
      },
      {
        id: "cpu",
        label: "CPU",
        width: 90,
        align: "right",
        sortable: true,
        getValue: (item) => item.cpuPercent,
        renderCell: (item) => (
          <Label
            width={80}
            height={38}
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
        width: 126,
        align: "right",
        sortable: true,
        getValue: (item) => item.rssBytes,
        renderCell: (item) => (
          <Label
            width={116}
            height={38}
            text={memory(item.rssBytes)}
            horizontalAlign="end"
            verticalAlign="center"
            fontFamily="mono"
            fontSize={11}
          />
        ),
      },
    ],
    [],
  );

  const terminate = async (force: boolean) => {
    if (!selected || selected.protected) return;
    const ok = await props.client.terminate(selected.pid, force);
    setStatus(
      ok
        ? `${force ? "Force quit" : "Quit"} requested for ${selected.name}`
        : `${selected.name} could not be stopped`,
    );
    await refresh();
  };

  const pressure = snapshot ? memoryPressure(snapshot) : 0;
  const used = snapshot ? snapshot.totalMemoryBytes - snapshot.availableMemoryBytes : 0;
  const tableY = 142;
  const footerH = 44;
  const statusH = 28;
  const tableH = Math.max(120, props.height - tableY - footerH - statusH);

  return (
    <OverlayHost width={props.width} height={props.height}>
      <Surface width={props.width} height={props.height} fill={pal.bg}>
        <Toolbar width={props.width} height={76}>
          <Vertical flexGrow={1} gap={3} justify="center">
            <Label text="Process Manager" fontSize={18} fontWeight="bold" />
            <Label
              text="Applications and processes in this desktop session"
              color={pal.muted}
              fontSize={10}
            />
          </Vertical>
          <Box width={220} height={32}>
            <SegmentedControl
              width={220}
              height={32}
              value={scope}
              options={[
                { id: "applications", label: "Applications" },
                { id: "all", label: "All Processes" },
              ]}
              onChange={setScope}
            />
          </Box>
        </Toolbar>
        <Surface y={76} width={props.width} height={66} fill={pal.panel}>
          <Inset width={props.width} height={66} padding={{ horizontal: 18, vertical: 10 }}>
            <Horizontal gap={16} align="center">
              <Vertical flexGrow={1} gap={6} justify="center">
                <Horizontal gap={8} align="center">
                  <Label
                    flexGrow={1}
                    text={`Memory  ${memory(used)} of ${memory(snapshot?.totalMemoryBytes ?? 0)}`}
                    color={pal.text}
                    fontSize={11}
                    fontWeight="medium"
                  />
                  <Box width={pressure >= 0.9 ? 72 : 58} height={22}>
                    <Badge
                      text={pressure >= 0.9 ? "CRITICAL" : pressure >= 0.75 ? "HIGH" : "NORMAL"}
                      tone={pressure >= 0.9 ? "danger" : pressure >= 0.75 ? "warning" : "success"}
                    />
                  </Box>
                </Horizontal>
                <ProgressBar width={Math.max(1, props.width - 36)} value={pressure} size="small" />
              </Vertical>
            </Horizontal>
          </Inset>
        </Surface>
        {error ? (
          <EmptyState
            y={tableY}
            width={props.width}
            height={tableH}
            title="System management is unavailable"
            message={error}
            icon="app"
            action={<Button width={140} label="Try Again" onPress={() => void refresh()} />}
          />
        ) : (
          <Table
            x={12}
            y={tableY + 10}
            width={Math.max(1, props.width - 24)}
            height={Math.max(1, tableH - 18)}
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
                width={Math.max(1, props.width - 24)}
                height={Math.max(1, tableH - 52)}
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
          <Inset width={props.width} height={footerH} padding={{ horizontal: 12, vertical: 6 }}>
            <Horizontal gap={8} justify="end" align="center">
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
                width={96}
                label="Force Quit"
                variant="danger"
                disabled={!selected || selected.protected}
                onPress={() => setConfirmForceQuit(true)}
              />
              <Button
                width={76}
                label="Quit"
                disabled={!selected || selected.protected}
                onPress={() => void terminate(false)}
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
        open={confirmForceQuit}
        viewportWidth={props.width}
        viewportHeight={props.height}
        title={`Force quit ${selected?.name ?? "this process"}?`}
        message="The process will stop immediately and may lose unsaved work. Use Force Quit only when a normal Quit does not work."
        confirmLabel="Force Quit"
        danger
        onConfirm={() => {
          setConfirmForceQuit(false);
          void terminate(true);
        }}
        onDismiss={() => setConfirmForceQuit(false)}
      />
    </OverlayHost>
  );
}

async function main(): Promise<void> {
  const settings = loadSettings();
  setUiScaleFactor(settings.uiScale);
  const client = await SystemManagementClient.connect();
  const app = new Application();
  const win = new Window({
    title: "Process Manager",
    appId: "org.moire.ProcessManager",
    width: Math.round(860 * settings.uiScale),
    height: Math.round(620 * settings.uiScale),
    resizable: true,
  });
  win.setContent((size) => <ProcessManager {...size} client={client} />);
  win.onClose(() => {
    client.close();
    app.quit();
  });
  app.addWindow(win);
  await app.run();
}

main().catch((error: unknown) => {
  console.error("[process-manager] fatal:", error);
  process.exit(1);
});
