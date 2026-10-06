import React, { useState, type ReactNode } from "react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Application,
  Window,
  Surface,
  Toolbar,
  TextField,
  Label,
  Button,
  ScrollArea,
  ListItem,
  StatusBar,
  ShortcutManager,
  setUiScaleFactor,
  getUiScaleFactor,
  usePalette,
  type WindowSize,
} from "@moire/ui";
import { loadSettings } from "@moire/prefs";
import { calculate, type Calculation } from "./arithmetic";
export type CalculatorProps = WindowSize & { onResult?: (result: Calculation) => void };
export function CalculatorApp(props: CalculatorProps): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const [expression, setExpression] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<Calculation[]>([]);
  const evaluate = () => {
    try {
      const next = calculate(expression);
      props.onResult?.(next);
      setResult(next.formatted);
      setError("");
      setHistory((previous) => [next, ...previous].slice(0, 50));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  };
  const clear = () => {
    setExpression("");
    setResult("");
    setError("");
  };
  const keys = [
    "(",
    ")",
    "^",
    "C",
    "7",
    "8",
    "9",
    "÷",
    "4",
    "5",
    "6",
    "×",
    "1",
    "2",
    "3",
    "−",
    "0",
    ".",
    "=",
    "+",
  ];
  const pad = 16,
    gap = 8,
    keyW = Math.max(1, (props.width - pad * 2 - gap * 3) / 4),
    keyH = 42;
  const keypadY = 172;
  const keypadHeight = Math.max(1, Math.min(5 * (keyH + gap), props.height - keypadY - 42));
  const historyY = keypadY + keypadHeight + 16;
  return (
    <ShortcutManager
      width={props.width}
      height={props.height}
      shortcuts={[{ id: "clear", code: 1, onInvoke: clear }]}
    >
      <Surface width={props.width} height={props.height} fill={pal.bg}>
        <Toolbar width={props.width} height={46}>
          <Label flexGrow={1} text="Calculator" fontSize={18} fontWeight="medium" />
          <Button width={70 * ui} label="Clear" onPress={clear} />
        </Toolbar>
        <TextField
          x={pad}
          y={60}
          width={props.width - pad * 2}
          height={40}
          value={expression}
          onChange={(value) => {
            setExpression(value);
            setError("");
          }}
          placeholder="2 × (3 + 4)"
          autoFocus
          onSubmit={evaluate}
        />
        <Label
          x={pad}
          y={112}
          width={props.width - pad * 2}
          height={44}
          text={error || result || "0"}
          color={error ? pal.danger : pal.text}
          fontSize={error ? 14 : 28}
          fontFamily="mono"
          overflow="ellipsis"
          maxLines={1}
        />
        <ScrollArea
          x={0}
          y={keypadY}
          width={props.width}
          height={keypadHeight}
          contentHeight={5 * (keyH + gap)}
        >
          {keys.map((key, index) => (
            <Button
              key={key}
              x={pad + (index % 4) * (keyW + gap)}
              y={Math.floor(index / 4) * (keyH + gap)}
              width={keyW}
              height={keyH}
              label={key}
              variant={key === "=" ? "primary" : "secondary"}
              onPress={() => {
                if (key === "C") clear();
                else if (key === "=") evaluate();
                else setExpression((previous) => previous + (key === "−" ? "-" : key));
              }}
            />
          ))}
        </ScrollArea>
        {props.height > historyY + 66 ? (
          <>
            <Label
              x={pad}
              y={historyY}
              text="RECENT CALCULATIONS"
              fontSize={11}
              color={pal.muted}
            />
            <ScrollArea
              x={pad}
              y={historyY + 26}
              width={props.width - pad * 2}
              height={Math.max(1, props.height - historyY - 62)}
              contentHeight={Math.max(1, history.length * 38)}
            >
              {history.map((entry, index) => (
                <ListItem
                  key={`${index}:${entry.expression}`}
                  y={index * 38}
                  width={props.width - pad * 2 - 12}
                  height={38}
                  title={`${entry.expression} = ${entry.formatted}`}
                  onPress={() => {
                    setExpression(entry.expression);
                    setResult(entry.formatted);
                    setError("");
                  }}
                />
              ))}
            </ScrollArea>
          </>
        ) : null}
        <StatusBar y={props.height - 30} width={props.width} height={30}>
          <Label
            text="Enter in expression = calculate · Escape = clear · ^ = power · % = remainder"
            color={pal.muted}
            fontSize={10}
            maxLines={1}
            overflow="ellipsis"
          />
        </StatusBar>
      </Surface>
    </ShortcutManager>
  );
}
export async function main(): Promise<void> {
  const settings = loadSettings();
  setUiScaleFactor(settings.uiScale);
  const app = new Application();
  const win = new Window({
    title: "Calculator",
    appId: "org.moire.Calculator",
    width: Math.round(430 * settings.uiScale),
    height: Math.round(650 * settings.uiScale),
    resizable: true,
  });
  win.setContent((size) => <CalculatorApp {...size} />);
  app.addWindow(win);
  await app.run();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch((error) => {
    console.error("[calculator]", error);
    process.exitCode = 1;
  });
