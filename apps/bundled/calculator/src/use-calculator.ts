/** Binds the pure model to React: results and preference changes go to the host, and copy and
 * save outcomes become a one-line notice for the status bar. */
import { useRef, useState } from "react";
import { errorText } from "@moire/app-tools";
import { writeClipboardText } from "@moire/ui";
import type { Calculation } from "./arithmetic";
import {
  initialState,
  reduce,
  shownResult,
  type CalculatorAction,
  type CalculatorSettings,
} from "./model";

export type CalculatorEvents = {
  onResult?: (result: Calculation) => void;
  /** Persist a changed preference; throw to have the calculator say it was not kept. */
  onSettingsChange?: (settings: CalculatorSettings) => void;
  /** Clipboard writer; the system clipboard when omitted. */
  copy?: (text: string) => Promise<void>;
};

type Notice = { text: string; tone: "default" | "error" };

export function useCalculator(settings: CalculatorSettings | undefined, events: CalculatorEvents) {
  const [state, setState] = useState(() => initialState(settings));
  const [notice, setNotice] = useState<Notice | null>(null);
  // Several key events can land before React re-renders; each must see the previous one's result.
  const current = useRef(state);
  const dispatch = (action: CalculatorAction) => {
    const previous = current.current;
    const next = reduce(previous, action);
    current.current = next;
    setState(next);
    // A notice answers the last command; the next one returns the status line to its hint.
    setNotice(null);
    if (action.type === "evaluate" && next.outcome.kind === "result")
      events.onResult?.(next.outcome.calculation);
    if (next.settings !== previous.settings) {
      try {
        events.onSettingsChange?.(next.settings);
      } catch (error) {
        setNotice({ text: `Preference not saved: ${errorText(error)}`, tone: "error" });
      }
    }
  };
  const copyResult = async () => {
    const result = shownResult(current.current);
    if (!result) {
      setNotice({ text: "Calculate something to copy its result.", tone: "default" });
      return;
    }
    try {
      await (events.copy ?? writeClipboardText)(result.formatted);
      setNotice({ text: `Copied ${result.formatted}`, tone: "default" });
    } catch (error) {
      setNotice({ text: `Clipboard unavailable: ${errorText(error)}`, tone: "error" });
    }
  };
  return { state, dispatch, notice, copyResult };
}
