/** Application Memory: the low-memory recovery dialog that offers to quit the largest apps. */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { loadSettings } from "@moire/prefs";
import {
  SystemManagementClient,
  memoryPressure,
  type ManagedProcess,
  type SystemSnapshot,
} from "@moire/system-management";
import {
  AppHeaderBar,
  AppStatusLine,
  Application,
  Badge,
  Box,
  Button,
  EmptyState,
  Horizontal,
  Icon,
  ProgressBar,
  ScrollArea,
  Separator,
  Surface,
  TextBlock,
  Vertical,
  Window,
  appChromeBody,
  getUiScaleFactor,
  setUiScaleFactor,
  usePalette,
  type WindowActions,
  type WindowSize,
} from "@moire/ui";

type MemoryClient = Pick<SystemManagementClient, "snapshot" | "terminate">;

function memory(value: number): string {
  const mib = value / 1024 / 1024;
  return mib >= 1024 ? `${(mib / 1024).toFixed(1)} GiB` : `${mib.toFixed(0)} MiB`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function Card(props: {
  x: number;
  y: number;
  width: number;
  height: number;
  children: ReactNode;
}): ReactNode {
  const pal = usePalette();
  return (
    <Surface
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      fill={pal.surface}
      radius={12 * getUiScaleFactor()}
      stroke={pal.borderSubtle}
      strokeWidth={1}
    >
      {props.children}
    </Surface>
  );
}

function pressureBadge(pressure: number) {
  return pressure >= 0.9
    ? ({ text: "Critical", tone: "danger" } as const)
    : pressure >= 0.75
      ? ({ text: "High", tone: "warning" } as const)
      : ({ text: "Normal", tone: "success" } as const);
}

function AppRow(props: {
  width: number;
  height: number;
  item: ManagedProcess;
  share: number;
  busy: boolean;
  onQuit: () => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const buttonW = 76 * ui;
  const textW = Math.max(1, props.width - buttonW - 16 * ui);
  return (
    <Horizontal width={props.width} height={props.height} gap={16 * ui} align="center">
      <Vertical width={textW} gap={6 * ui} justify="center">
        <Horizontal width={textW} height={18 * ui} gap={8 * ui} align="center">
          <TextBlock
            flexGrow={1}
            text={props.item.name}
            fontSize={13}
            fontWeight="medium"
            overflow="ellipsis"
            maxLines={1}
          />
          <TextBlock text={memory(props.item.rssBytes)} color={pal.muted} fontSize={12} />
        </Horizontal>
        <ProgressBar width={textW} value={props.share} size="small" />
      </Vertical>
      <Button
        width={buttonW}
        height={32 * ui}
        label="Quit"
        variant="secondary"
        disabled={props.busy}
        onPress={props.onQuit}
      />
    </Horizontal>
  );
}

export function MemoryPressureDialog(
  props: WindowSize & {
    client: MemoryClient;
    close: () => void;
    /** The window the header bar controls (minimize, maximize, close, move). */
    window?: WindowActions | null;
  },
): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Updates every second");
  const [quitting, setQuitting] = useState<number | null>(null);
  const disposed = useRef(false);

  const refresh = async () => {
    try {
      const next = await props.client.snapshot();
      if (disposed.current) return;
      setSnapshot(next);
      setError("");
    } catch (caught) {
      if (!disposed.current) setError(errorText(caught));
    }
  };

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 1_000);
    return () => {
      disposed.current = true;
      clearInterval(timer);
    };
  }, []);

  const quit = async (item: ManagedProcess) => {
    setQuitting(item.pid);
    try {
      const ok = await props.client.terminate(item.pid, false);
      if (!disposed.current)
        setStatus(ok ? `Asked ${item.name} to quit` : `${item.name} could not be quit`);
      await refresh();
    } catch (caught) {
      if (!disposed.current) setStatus(`Quit failed: ${errorText(caught)}`);
    } finally {
      if (!disposed.current) setQuitting(null);
    }
  };

  const candidates = (snapshot?.processes ?? [])
    .filter((item) => item.appId && !item.protected)
    .sort((a, b) => b.rssBytes - a.rssBytes)
    .slice(0, 8);
  const pressure = snapshot ? memoryPressure(snapshot) : 0;
  const badge = pressureBadge(pressure);
  const pad = 16 * ui;
  const innerW = Math.max(1, props.width - pad * 2);
  const chrome = appChromeBody(props.height);
  const titleH = chrome.y;
  const bannerY = titleH + 12 * ui;
  const bannerH = 80 * ui;
  const summaryY = bannerY + bannerH + 12 * ui;
  const summaryH = 64 * ui;
  const listY = summaryY + summaryH + 12 * ui;
  const footerH = 52 * ui;
  const statusH = props.height - chrome.y - chrome.height;
  const listH = Math.max(80 * ui, props.height - listY - footerH - statusH - 12 * ui);
  const rowH = 60 * ui;
  const cardInner = Math.max(1, innerW - 32 * ui);
  const contentH = candidates.length * rowH + 8 * ui;

  return (
    <Surface width={props.width} height={props.height} fill={pal.bg}>
      <AppHeaderBar
        width={props.width}
        title="Application Memory"
        icon="monitor"
        subtitle="Running low on memory"
        window={props.window}
      />
      <Card x={pad} y={bannerY} width={innerW} height={bannerH}>
        <Horizontal x={pad} width={cardInner} height={bannerH} gap={14 * ui} align="center">
          <Box width={40 * ui} height={40 * ui} flexShrink={0}>
            <Surface
              width={40 * ui}
              height={40 * ui}
              radius={10 * ui}
              fill={((pal.danger & 0x00ffffff) | 0x26000000) >>> 0}
            />
            <Icon
              x={10 * ui}
              y={10 * ui}
              name="monitor"
              size={20 * ui}
              color={pal.danger}
              symbolic
            />
          </Box>
          <Vertical flexGrow={1} gap={3 * ui} justify="center">
            <TextBlock
              text="Your system is running low on application memory"
              fontSize={14}
              fontWeight="medium"
              overflow="ellipsis"
              maxLines={1}
            />
            <TextBlock
              text="Quit applications you are not using. Moire protects the compositor and essential session services."
              color={pal.muted}
              fontSize={12}
              wrap
              overflow="ellipsis"
              maxLines={2}
            />
          </Vertical>
        </Horizontal>
      </Card>
      <Card x={pad} y={summaryY} width={innerW} height={summaryH}>
        <Vertical x={pad} width={cardInner} height={summaryH} gap={8 * ui} justify="center">
          <Horizontal width={cardInner} height={22 * ui} gap={8 * ui} align="center">
            <TextBlock text="Memory" fontSize={13} fontWeight="medium" maxLines={1} />
            <TextBlock
              flexGrow={1}
              text={`${memory(snapshot?.availableMemoryBytes ?? 0)} available · ${Math.round(pressure * 100)}% pressure`}
              color={pal.muted}
              fontSize={12}
              overflow="ellipsis"
              maxLines={1}
            />
            <Badge text={badge.text} tone={badge.tone} />
          </Horizontal>
          <ProgressBar width={cardInner} value={pressure} size="small" />
        </Vertical>
      </Card>
      {error ? (
        <EmptyState
          x={pad}
          y={listY}
          width={innerW}
          height={listH}
          title="Memory information is unavailable"
          message={error}
          icon="monitor"
        />
      ) : candidates.length === 0 ? (
        <EmptyState
          x={pad}
          y={listY}
          width={innerW}
          height={listH}
          title="No applications can be quit"
          message="Only protected session processes are currently running."
          icon="monitor"
        />
      ) : (
        <Card x={pad} y={listY} width={innerW} height={Math.min(listH, contentH + 2)}>
          <ScrollArea
            x={1}
            y={1}
            width={innerW - 2}
            height={Math.min(listH, contentH + 2) - 2}
            contentHeight={contentH}
            fill={0x00000000}
          >
            <Box width={innerW - 2} height={contentH}>
              {candidates.map((item, index) => (
                <Box
                  key={item.pid}
                  x={pad - 1}
                  y={4 * ui + index * rowH}
                  width={cardInner}
                  height={rowH}
                >
                  {index > 0 ? <Separator width={cardInner} color={pal.borderSubtle} /> : null}
                  <AppRow
                    width={cardInner}
                    height={rowH}
                    item={item}
                    share={
                      snapshot && snapshot.totalMemoryBytes > 0
                        ? item.rssBytes / snapshot.totalMemoryBytes
                        : 0
                    }
                    busy={quitting != null}
                    onQuit={() => void quit(item)}
                  />
                </Box>
              ))}
            </Box>
          </ScrollArea>
        </Card>
      )}
      <Surface
        y={props.height - footerH - statusH}
        width={props.width}
        height={footerH}
        fill={pal.panel}
      >
        <Separator width={props.width} color={pal.borderSubtle} />
        <Horizontal
          x={pad}
          width={innerW}
          height={footerH}
          gap={8 * ui}
          justify="end"
          align="center"
        >
          <Button
            width={164 * ui}
            height={32 * ui}
            label="Open System Monitor"
            variant="secondary"
            onPress={() => {
              spawn("moire-process-manager", [], {
                detached: true,
                stdio: "ignore",
              }).unref();
              props.close();
            }}
          />
          <Button
            width={84 * ui}
            height={32 * ui}
            label="Done"
            variant="primary"
            onPress={props.close}
          />
        </Horizontal>
      </Surface>
      <AppStatusLine
        y={props.height - statusH}
        width={props.width}
        status={status}
        end={`${candidates.length} ${candidates.length === 1 ? "application" : "applications"}`}
      />
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
    height: Math.round(620 * settings.uiScale),
    resizable: true,
    // The AppHeaderBar is this window's titlebar.
    decorated: false,
  });
  const close = () => {
    client.close();
    win.destroy();
    app.quit();
  };
  win.setContent((size) => (
    <MemoryPressureDialog {...size} window={win} client={client} close={close} />
  ));
  win.onClose(close);
  app.addWindow(win);
  await app.run();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error: unknown) => {
    console.error("[memory-pressure] fatal:", error);
    process.exit(1);
  });
