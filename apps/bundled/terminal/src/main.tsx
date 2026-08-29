import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Application,
  Window,
  Label,
  StatusBar,
  Surface,
  TerminalView,
  measureTerminalGrid,
  requestActiveWindowRedraw,
  setUiScaleFactor,
  themePalette,
  type HitKeyEvent,
  type RichTextLine,
  type RichTextRun,
  type WindowSize,
} from "@moire/ui";
import {
  PtySession,
  TERMINAL_DEFAULT_BACKGROUND,
  TerminalBuffer,
  type TerminalCell,
  type TerminalSnapshot,
} from "@moire/terminal";
import { loadSettings } from "@moire/prefs";

const FONT_SIZE = 13;
const PADDING = 10;
const STATUS_HEIGHT = 28;

function sameStyle(a: TerminalCell, b: TerminalCell): boolean {
  return (
    a.foreground === b.foreground &&
    a.background === b.background &&
    a.bold === b.bold
  );
}

function snapshotLines(snapshot: TerminalSnapshot): RichTextLine[] {
  return snapshot.lines.map((cells, lineIndex) => {
    const runs: RichTextRun[] = [];
    let previousCell: TerminalCell | undefined;
    for (const cell of cells) {
      const last = runs.at(-1);
      if (last && previousCell && sameStyle(previousCell, cell)) {
        last.text += cell.char;
      } else {
        runs.push({
          text: cell.char,
          color: cell.foreground,
          background:
            cell.background === TERMINAL_DEFAULT_BACKGROUND
              ? undefined
              : cell.background,
          fontFamily: "mono",
          fontWeight: cell.bold ? "bold" : "regular",
        });
      }
      previousCell = cell;
    }
    return { id: `terminal:${lineIndex}`, runs };
  });
}

function keySequence(event: HitKeyEvent): string | undefined {
  const special = new Map<number, string>([
    [1, "\x1b"],
    [14, "\x7f"],
    [15, "\t"],
    [28, "\r"],
    [102, "\x1b[H"],
    [103, "\x1b[A"],
    [104, "\x1b[5~"],
    [105, "\x1b[D"],
    [106, "\x1b[C"],
    [107, "\x1b[F"],
    [108, "\x1b[B"],
    [109, "\x1b[6~"],
    [110, "\x1b[2~"],
    [111, "\x1b[3~"],
  ]);
  const functionKeys = new Map<number, string>([
    [59, "\x1bOP"], [60, "\x1bOQ"], [61, "\x1bOR"], [62, "\x1bOS"],
    [63, "\x1b[15~"], [64, "\x1b[17~"], [65, "\x1b[18~"],
    [66, "\x1b[19~"], [67, "\x1b[20~"], [68, "\x1b[21~"],
    [87, "\x1b[23~"], [88, "\x1b[24~"],
  ]);
  let sequence = special.get(event.code) ?? functionKeys.get(event.code);
  if (!sequence && event.ctrlKey) {
    const key = event.key ?? event.text;
    if (key && key.length === 1) {
      const code = key.toUpperCase().charCodeAt(0);
      if (code >= 64 && code <= 95) sequence = String.fromCharCode(code & 31);
    } else if (event.code === 57) {
      sequence = "\u0000";
    }
  }
  if (!sequence && event.text && !event.metaKey) sequence = event.text;
  if (sequence && event.altKey) sequence = `\x1b${sequence}`;
  return sequence;
}

function TerminalApp(
  props: WindowSize & {
    command?: string;
    onTitle: (title: string) => void;
  },
): ReactNode {
  const pal = themePalette();
  const viewHeight = Math.max(1, props.height - STATUS_HEIGHT);
  const grid = measureTerminalGrid(props.width, viewHeight, {
    fontSize: FONT_SIZE,
    padding: PADDING,
  });
  const model = useRef<TerminalBuffer | null>(null);
  if (!model.current) model.current = new TerminalBuffer(grid.columns, grid.rows);
  const session = useRef<PtySession | null>(null);
  const [snapshot, setSnapshot] = useState(() => model.current!.snapshot());
  const [status, setStatus] = useState("Starting shell…");
  const [scrollY, setScrollY] = useState(0);
  const followEnd = useRef(true);
  const lines = useMemo(() => snapshotLines(snapshot), [snapshot]);
  const contentHeight = Math.max(
    viewHeight,
    PADDING * 2 + lines.length * grid.lineHeight,
  );
  const maxScroll = Math.max(0, contentHeight - viewHeight);

  useEffect(() => {
    const terminal = model.current!;
    const pty = new PtySession({
      columns: grid.columns,
      rows: grid.rows,
      cwd: process.env.HOME,
      command: props.command,
      onData(data) {
        terminal.write(data);
        for (const response of terminal.drainResponses()) pty.write(response);
        const next = terminal.snapshot();
        setSnapshot(next);
        props.onTitle(next.title);
        setStatus("Connected");
        requestActiveWindowRedraw();
      },
      onExit(code, signal) {
        terminal.write(`\r\n[process exited ${signal ?? code ?? 0}]\r\n`);
        setSnapshot(terminal.snapshot());
        setStatus("Session ended");
        requestActiveWindowRedraw();
      },
      onError(error) {
        setStatus(error.message);
        requestActiveWindowRedraw();
      },
    });
    session.current = pty;
    try {
      pty.start();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
    return () => {
      pty.close();
      session.current = null;
    };
  }, []);

  useEffect(() => {
    model.current!.resize(grid.columns, grid.rows);
    session.current?.resize(grid.columns, grid.rows);
    setSnapshot(model.current!.snapshot());
    requestActiveWindowRedraw();
  }, [grid.columns, grid.rows]);

  useEffect(() => {
    if (followEnd.current) setScrollY(maxScroll);
  }, [maxScroll]);

  return (
    <Surface width={props.width} height={props.height} fill={pal.bg}>
      <TerminalView
        width={props.width}
        height={viewHeight}
        lines={lines}
        cursor={{
          line: snapshot.cursorLine,
          column: snapshot.cursorColumn,
          visible: snapshot.cursorVisible,
        }}
        fontSize={FONT_SIZE}
        lineHeight={grid.lineHeight}
        padding={PADDING}
        scrollY={scrollY}
        onScroll={(next) => {
          setScrollY(next);
          followEnd.current = next >= maxScroll - grid.lineHeight;
        }}
        autoFocus
        focusId="terminal"
        onKeyDown={(event) => {
          if (event.shiftKey && event.code === 104) {
            followEnd.current = false;
            setScrollY(Math.max(0, scrollY - viewHeight));
            return;
          }
          if (event.shiftKey && event.code === 109) {
            const next = Math.min(maxScroll, scrollY + viewHeight);
            setScrollY(next);
            followEnd.current = next >= maxScroll - grid.lineHeight;
            return;
          }
          const sequence = keySequence(event);
          if (sequence) session.current?.write(sequence);
        }}
      />
      <StatusBar y={viewHeight} width={props.width} height={STATUS_HEIGHT}>
        <Label text={status} color={pal.muted} fontSize={10} width={Math.max(80, props.width - 210)} height={18} />
        <Label text={`${grid.columns} × ${grid.rows}`} color={pal.muted} fontSize={10} fontFamily="mono" width={86} height={18} />
        <Label text="xterm-256color" color={pal.accent} fontSize={10} fontFamily="mono" width={100} height={18} />
      </StatusBar>
    </Surface>
  );
}

async function main(): Promise<void> {
  const settings = loadSettings();
  setUiScaleFactor(settings.uiScale);
  const app = new Application();
  const commandIndex = process.argv.indexOf("--command");
  const command = commandIndex >= 0 ? process.argv[commandIndex + 1] : undefined;
  const win = new Window({
    title: "Terminal",
    appId: "org.moire.Terminal",
    width: Math.round(820 * settings.uiScale),
    height: Math.round(520 * settings.uiScale),
    resizable: true,
  });
  win.setContent((size) => (
    <TerminalApp
      {...size}
      command={command}
      onTitle={(title) => win.setTitle(title)}
    />
  ));
  win.onClose(() => app.quit());
  app.addWindow(win);
  await app.run();
}

main().catch((error: unknown) => {
  console.error("[terminal] fatal:", error);
  process.exit(1);
});
