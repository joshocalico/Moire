import React, { useRef, type ReactNode } from "react";
import {
  APP_STATUS_HEIGHT,
  AppHeaderBar,
  AppStatusLine,
  Button,
  ShortcutManager,
  Surface,
  appChromeBody,
  getUiScaleFactor,
  usePalette,
  type WindowActions,
  type WindowSize,
} from "@moire/ui";
import { runApp, startMain } from "@moire/app-tools";
import { calculatorLayout } from "./layout";
import {
  SCIENTIFIC_COLUMNS,
  SCIENTIFIC_KEYS,
  STANDARD_COLUMNS,
  STANDARD_KEYS,
  keyboardAction,
  shownResult,
  type CalculatorSettings,
} from "./model";
import { APP_ID, loadPreferences, savePreferences } from "./preferences";
import { useCalculator, type CalculatorEvents } from "./use-calculator";
import { Display } from "./views/display";
import { History } from "./views/history";
import { KeyGrid } from "./views/keypad";
import { ModeBar } from "./views/mode-bar";

const HEADER_BUTTON_WIDTH = 72;
const HEADER_BUTTON_HEIGHT = 32;
const KEY_M = 50;
const KEY_D = 32;
const KEY_C = 46;

export type CalculatorProps = WindowSize &
  CalculatorEvents & {
    /** Preferences to start with; the defaults when omitted. */
    settings?: CalculatorSettings;
    /** The window the header bar controls (minimize, maximize, close, move). */
    window?: WindowActions | null;
  };

export function CalculatorApp(props: CalculatorProps): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const { state, dispatch, notice, copyResult } = useCalculator(props.settings, props);
  // Read by the window-level key handler, which runs before the focused field.
  const fieldFocused = useRef(false);
  const { mode, angle } = state.settings;
  const toggleMode = () =>
    dispatch({ type: "mode", mode: mode === "scientific" ? "standard" : "scientific" });
  const toggleAngle = () =>
    dispatch({ type: "angle", angle: angle === "degrees" ? "radians" : "degrees" });

  const body = appChromeBody(props.height);
  const layout = calculatorLayout(props.width, body.height, mode, ui);
  const hint =
    mode === "scientific"
      ? "Enter calculates · Esc clears · Ctrl+D Deg/Rad · Ctrl+M standard"
      : "Enter calculates · Esc clears · Ctrl+M scientific · Ctrl+Shift+C copies";
  return (
    <ShortcutManager
      width={props.width}
      height={props.height}
      shortcuts={[
        { id: "mode", code: KEY_M, ctrl: true, onInvoke: toggleMode },
        { id: "angle", code: KEY_D, ctrl: true, onInvoke: toggleAngle },
        { id: "copy", code: KEY_C, ctrl: true, shift: true, onInvoke: () => void copyResult() },
      ]}
      onKeyDown={(event) => {
        const action = keyboardAction(event, fieldFocused.current);
        if (!action) return false;
        dispatch(action);
        return true;
      }}
    >
      <Surface width={props.width} height={props.height} fill={pal.bg}>
        <AppHeaderBar
          width={props.width}
          title="Calculator"
          icon="calculator"
          subtitle={mode === "scientific" ? "Scientific" : undefined}
          window={props.window}
          actions={
            <>
              <Button
                width={HEADER_BUTTON_WIDTH * ui}
                height={HEADER_BUTTON_HEIGHT * ui}
                label="Copy"
                variant="ghost"
                focusId="calculator:copy"
                disabled={!shownResult(state)}
                onPress={() => void copyResult()}
              />
              <Button
                width={HEADER_BUTTON_WIDTH * ui}
                height={HEADER_BUTTON_HEIGHT * ui}
                label="Clear"
                variant="ghost"
                focusId="calculator:clear"
                onPress={() => dispatch({ type: "clear" })}
              />
            </>
          }
        />
        <Surface y={body.y} width={props.width} height={body.height} fill={pal.bg} clip>
          <Display
            {...layout.display}
            expression={state.expression}
            outcome={state.outcome}
            onChange={(expression) => dispatch({ type: "edit", expression })}
            onSubmit={() => dispatch({ type: "evaluate" })}
            onFocusChange={(focused) => {
              fieldFocused.current = focused;
            }}
          />
          <ModeBar
            {...layout.modeBar}
            mode={mode}
            angle={angle}
            onMode={(next) => dispatch({ type: "mode", mode: next })}
            onAngle={(next) => dispatch({ type: "angle", angle: next })}
          />
          {layout.scientific ? (
            <KeyGrid
              {...layout.scientific}
              keys={SCIENTIFIC_KEYS}
              columns={SCIENTIFIC_COLUMNS}
              keyHeight={layout.keyHeight}
              gap={layout.gap}
              onAction={dispatch}
            />
          ) : null}
          <KeyGrid
            {...layout.keypad}
            keys={STANDARD_KEYS}
            columns={STANDARD_COLUMNS}
            keyHeight={layout.keyHeight}
            gap={layout.gap}
            onAction={dispatch}
          />
          {layout.history ? (
            <History
              {...layout.history}
              entries={state.history}
              onPick={(entry) => dispatch({ type: "recall", entry })}
              onClear={() => dispatch({ type: "clearHistory" })}
            />
          ) : null}
        </Surface>
        <AppStatusLine
          y={props.height - APP_STATUS_HEIGHT * ui}
          width={props.width}
          status={notice?.text ?? hint}
          tone={notice?.tone}
          end={mode === "scientific" ? (angle === "degrees" ? "Degrees" : "Radians") : undefined}
        />
      </Surface>
    </ShortcutManager>
  );
}

export async function main(): Promise<void> {
  const settings = loadPreferences();
  await runApp(
    "Calculator",
    APP_ID,
    (size, window) => (
      <CalculatorApp
        {...size}
        window={window}
        settings={settings}
        onSettingsChange={savePreferences}
      />
    ),
    { width: 430, height: 650 },
  );
}

startMain(import.meta.url, main);
