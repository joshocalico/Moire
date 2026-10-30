/** The calculator's state and transitions, kept pure so they can be tested without a window. */
import { calculate, type AngleUnit, type Calculation } from "./arithmetic";

export type Mode = "standard" | "scientific";
export type CalculatorSettings = { mode: Mode; angle: AngleUnit };
export const DEFAULT_SETTINGS: CalculatorSettings = {
  mode: "standard",
  angle: "degrees",
};

/** Validate stored preferences, keeping the default for anything missing or unknown. */
export function parseSettings(data: unknown): CalculatorSettings {
  const stored = (typeof data === "object" && data ? data : {}) as Record<string, unknown>;
  return {
    mode: stored.mode === "scientific" ? "scientific" : DEFAULT_SETTINGS.mode,
    angle: stored.angle === "radians" ? "radians" : DEFAULT_SETTINGS.angle,
  };
}

export type Outcome =
  | { kind: "empty" }
  | { kind: "result"; calculation: Calculation }
  | { kind: "error"; message: string };

export type CalculatorState = {
  expression: string;
  outcome: Outcome;
  /** Most recent first. */
  history: readonly Calculation[];
  settings: CalculatorSettings;
};

export type CalculatorAction =
  | { type: "edit"; expression: string }
  | { type: "insert"; text: string }
  | { type: "backspace" }
  | { type: "clear" }
  | { type: "evaluate" }
  | { type: "recall"; entry: Calculation }
  | { type: "clearHistory" }
  | { type: "mode"; mode: Mode }
  | { type: "angle"; angle: AngleUnit };

const HISTORY_LIMIT = 50;

export function initialState(settings: CalculatorSettings = DEFAULT_SETTINGS): CalculatorState {
  return { expression: "", outcome: { kind: "empty" }, history: [], settings };
}

/** The result the display is showing for the expression as it stands, if any. */
export function shownResult(state: CalculatorState): Calculation | null {
  return state.outcome.kind === "result" ? state.outcome.calculation : null;
}

/** Text that continues a calculation rather than starting a new one (2+3 = then ×2). */
const CONTINUES = /^[+\-*/%^!×÷−]/;

function insert(state: CalculatorState, text: string): string {
  const result = shownResult(state);
  if (!result || state.expression !== result.expression) return state.expression + text;
  if (!CONTINUES.test(text)) return text;
  return (result.value < 0 ? `(${result.formatted})` : result.formatted) + text;
}

/** Typing straight after = in the field behaves like the keypad: continue or start afresh. */
function edit(state: CalculatorState, expression: string): string {
  const result = shownResult(state);
  const typedAfterResult =
    result &&
    state.expression === result.expression &&
    expression.length > state.expression.length &&
    expression.startsWith(state.expression);
  return typedAfterResult ? insert(state, expression.slice(state.expression.length)) : expression;
}

export function reduce(state: CalculatorState, action: CalculatorAction): CalculatorState {
  switch (action.type) {
    case "edit":
      return {
        ...state,
        expression: edit(state, action.expression),
        outcome: keepResult(state),
      };
    case "insert":
      return {
        ...state,
        expression: insert(state, action.text),
        outcome: keepResult(state),
      };
    case "backspace":
      return {
        ...state,
        expression: Array.from(state.expression).slice(0, -1).join(""),
        outcome: keepResult(state),
      };
    case "clear":
      return { ...state, expression: "", outcome: { kind: "empty" } };
    case "evaluate": {
      try {
        const calculation = calculate(state.expression, {
          angle: state.settings.angle,
        });
        const repeated = state.history[0]?.expression === calculation.expression;
        return {
          ...state,
          outcome: { kind: "result", calculation },
          history: repeated
            ? state.history
            : [calculation, ...state.history].slice(0, HISTORY_LIMIT),
        };
      } catch (failure) {
        const message = failure instanceof Error ? failure.message : String(failure);
        return { ...state, outcome: { kind: "error", message } };
      }
    }
    case "recall":
      return {
        ...state,
        expression: action.entry.expression,
        outcome: { kind: "result", calculation: action.entry },
      };
    case "clearHistory":
      return { ...state, history: [] };
    case "mode":
      return { ...state, settings: { ...state.settings, mode: action.mode } };
    case "angle":
      return { ...state, settings: { ...state.settings, angle: action.angle } };
  }
}

/** Editing clears an error (it described the old text) but keeps the last answer on display. */
function keepResult(state: CalculatorState): Outcome {
  return state.outcome.kind === "error" ? { kind: "empty" } : state.outcome;
}

/** The parts of a key event the calculator reads. */
type KeyInput = {
  code: number;
  text?: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
};

const KEY_ESCAPE = 1;
const KEY_BACKSPACE = 14;
const TYPED = /^[0-9.+\-*/^%()!a-zA-Zπ√×÷−]$/;

/**
 * Keys the calculator handles itself, before the focused control. While the expression field has
 * focus it edits its own text (caret, selection, Backspace), so only Escape and = are taken from
 * it; elsewhere (a focused keypad key, the mode switch) typing goes into the expression.
 */
export function keyboardAction(event: KeyInput, fieldFocused: boolean): CalculatorAction | null {
  if (event.ctrlKey || event.altKey || event.metaKey) return null;
  if (event.code === KEY_ESCAPE) return { type: "clear" };
  if (event.text === "=") return { type: "evaluate" };
  if (fieldFocused) return null;
  if (event.code === KEY_BACKSPACE) return { type: "backspace" };
  if (event.text && TYPED.test(event.text)) return { type: "insert", text: event.text };
  return null;
}

export type KeyRole = "digit" | "operator" | "function" | "clear" | "equals";
export type KeyDefinition = {
  label: string;
  /** Drawn instead of the label, for keys whose symbol the UI font lacks. */
  icon?: "back";
  role: KeyRole;
  action: CalculatorAction;
  /** Stable, so smokes and focus survive layout changes. */
  focusId: string;
};

const key = (
  label: string,
  role: KeyRole,
  action: CalculatorAction,
  id = label,
): KeyDefinition => ({ label, role, action, focusId: `calculator:key:${id}` });
const typed = (label: string, role: KeyRole, text = label, id = label) =>
  key(label, role, { type: "insert", text }, id);

/** The four-column keypad shared by both modes. */
export const STANDARD_KEYS: readonly KeyDefinition[] = [
  key("C", "clear", { type: "clear" }, "clear"),
  {
    ...key("Delete", "clear", { type: "backspace" }, "backspace"),
    icon: "back",
  },
  typed("(", "operator"),
  typed(")", "operator"),
  ...["7", "8", "9"].map((digit) => typed(digit, "digit")),
  typed("÷", "operator", "÷", "divide"),
  ...["4", "5", "6"].map((digit) => typed(digit, "digit")),
  typed("×", "operator", "×", "multiply"),
  ...["1", "2", "3"].map((digit) => typed(digit, "digit")),
  typed("−", "operator", "-", "subtract"),
  typed("0", "digit"),
  typed(".", "digit", ".", "point"),
  key("=", "equals", { type: "evaluate" }, "equals"),
  typed("+", "operator", "+", "add"),
];
export const STANDARD_COLUMNS = 4;

/** The function rows scientific mode adds above (or beside) the keypad. */
export const SCIENTIFIC_KEYS: readonly KeyDefinition[] = [
  typed("sin", "function", "sin("),
  typed("cos", "function", "cos("),
  typed("tan", "function", "tan("),
  typed("ln", "function", "ln("),
  typed("log", "function", "log("),
  typed("asin", "function", "asin("),
  typed("acos", "function", "acos("),
  typed("atan", "function", "atan("),
  typed("π", "function", "π", "pi"),
  typed("e", "function", "e"),
  typed("x²", "function", "^2", "square"),
  typed("x^y", "function", "^", "power"),
  typed("√", "function", "√(", "sqrt"),
  typed("n!", "function", "!", "factorial"),
  typed("%", "function", "%", "remainder"),
];
export const SCIENTIFIC_COLUMNS = 5;
