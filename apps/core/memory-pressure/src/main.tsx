import { spawn } from "node:child_process";
import React, { useEffect, useState, type ReactNode } from "react";
import { loadSettings } from "@moire/prefs";
import {
  SystemManagementClient,
  memoryPressure,
  type SystemSnapshot,
} from "@moire/system-management";
import {
  Application,
  Banner,
  Box,
  Button,
  EmptyState,
  Horizontal,
  Inset,
  Label,
  ProgressBar,
  ProgressRow,
  ScrollArea,
  Separator,
  StatusBar,
  Surface,
  Vertical,
  Window,
  setUiScaleFactor,
  themePalette,
  type WindowSize,
} from "@moire/ui";

function memory(value: number): string {
  const mib = value / 1024 / 1024;
  return mib >= 1024 ? `${(mib / 1024).toFixed(1)} GiB` : `${mib.toFixed(0)} MiB`;
}

function MemoryPressureDialog(
  props: WindowSize & {
    client: SystemManagementClient;
    close: () => void;
  },
): ReactNode {
  const pal = themePalette();
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Reviewing application memory…");

  const refresh = async () => {
    try {
      setSnapshot(await props.client.snapshot());
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 1_000);
    return () => clearInterval(timer);
  }, []);

  const candidates = (snapshot?.processes ?? [])
    .filter((item) => item.appId && !item.protected)
    .sort((a, b) => b.rssBytes - a.rssBytes)
    .slice(0, 8);
  const pressure = snapshot ? memoryPressure(snapshot) : 0;
  const available = snapshot?.availableMemoryBytes ?? 0;
  const contentY = 170;
  const footerH = 50;
  const statusH = 28;
  const contentH = Math.max(1, props.height - contentY - footerH - statusH);

  const quit = async (pid: number, name: string) => {
    const ok = await props.client.terminate(pid, false);
    setStatus(ok ? `Asked ${name} to quit` : `${name} could not be quit`);
    await refresh();
  };

  return (
    <Surface width={props.width} height={props.height} fill={pal.bg}>
      <Inset
        width={props.width}
        height={contentY}
        padding={{ top: 18, right: 18, bottom: 12, left: 18 }}
      >
        <Vertical gap={12}>
          <Banner
            width={Math.max(1, props.width - 36)}
            height={76}
            title="Your system is running low on application memory"
            message="Quit applications you are not using. Moire protects the compositor and essential session services."
            tone="danger"
            icon="app"
          />
          <Vertical gap={6}>
            <Horizontal align="center">
              <Label
                flexGrow={1}
                text={`${memory(available)} available`}
                color={pal.text}
                fontSize={11}
                fontWeight="medium"
              />
              <Label
                text={`${Math.round(pressure * 100)}% pressure`}
                color={pressure >= 0.9 ? pal.danger : pal.muted}
                fontSize={10}
                fontFamily="mono"
              />
            </Horizontal>
            <ProgressBar width={Math.max(1, props.width - 36)} value={pressure} />
          </Vertical>
        </Vertical>
      </Inset>
      <Separator y={contentY - 1} width={props.width} />
      {error ? (
        <EmptyState
          y={contentY}
          width={props.width}
          height={contentH}
          title="Memory information is unavailable"
          message={error}
          icon="app"
        />
      ) : (
        <ScrollArea
          y={contentY}
          width={props.width}
          height={contentH}
          contentHeight={Math.max(contentH, candidates.length * 86 + 24)}
        >
          <Inset
            width={props.width}
            height={Math.max(contentH, candidates.length * 86 + 24)}
            padding={{ horizontal: 18, vertical: 12 }}
          >
            <Vertical gap={8}>
              {candidates.map((item) => (
                <ProgressRow
                  key={item.pid}
                  width={Math.max(1, props.width - 36)}
                  title={item.name}
                  detail={`PID ${item.pid} · ${item.cpuPercent.toFixed(1)}% CPU`}
                  status={memory(item.rssBytes)}
                  value={
                    snapshot && snapshot.totalMemoryBytes > 0
                      ? item.rssBytes / snapshot.totalMemoryBytes
                      : 0
                  }
                  action={
                    <Button
                      width={90}
                      label="Quit"
                      onPress={() => void quit(item.pid, item.name)}
                    />
                  }
                  actionWidth={90}
                />
              ))}
              {candidates.length === 0 ? (
                <Box width={Math.max(1, props.width - 36)} height={contentH - 24}>
                  <EmptyState
                    width={Math.max(1, props.width - 36)}
                    height={Math.max(1, contentH - 24)}
                    title="No applications can be quit"
                    message="Only protected session processes are currently visible."
                    icon="app"
                  />
                </Box>
              ) : null}
            </Vertical>
          </Inset>
        </ScrollArea>
      )}
      <Surface
        y={props.height - footerH - statusH}
        width={props.width}
        height={footerH}
        fill={pal.panel}
      >
        <Inset width={props.width} height={footerH} padding={{ horizontal: 14, vertical: 7 }}>
          <Horizontal gap={8} justify="end" align="center">
            <Button
              width={156}
              label="Open Process Manager"
              onPress={() => {
                spawn("moire-process-manager", [], { detached: true, stdio: "ignore" }).unref();
                props.close();
              }}
            />
            <Button width={76} label="Done" variant="primary" onPress={props.close} />
          </Horizontal>
        </Inset>
      </Surface>
      <StatusBar y={props.height - statusH} width={props.width} height={statusH}>
        <Label flexGrow={1} text={status} color={pal.muted} fontSize={9} />
        <Label text="System Management" color={pal.muted} fontSize={9} fontFamily="mono" />
      </StatusBar>
    </Surface>
  );
}

async function main(): Promise<void> {
  const settings = loadSettings();
  setUiScaleFactor(settings.uiScale);
  const client = await SystemManagementClient.connect();
  const app = new Application();
  const win = new Window({
    title: "Application Memory",
    appId: "org.moire.MemoryPressure",
    width: Math.round(640 * settings.uiScale),
    height: Math.round(590 * settings.uiScale),
    resizable: true,
  });
  const close = () => {
    client.close();
    win.destroy();
    app.quit();
  };
  win.setContent((size) => <MemoryPressureDialog {...size} client={client} close={close} />);
  win.onClose(close);
  app.addWindow(win);
  await app.run();
}

main().catch((error: unknown) => {
  console.error("[memory-pressure] fatal:", error);
  process.exit(1);
});
