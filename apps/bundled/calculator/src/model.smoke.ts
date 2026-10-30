/** Evaluator, reducer, key mapping and layout checks; no window needed. */
import assert from "node:assert/strict";
import { calculate } from "./arithmetic";
import { calculatorLayout, type Box } from "./layout";
import {
  DEFAULT_SETTINGS,
  initialState,
  keyboardAction,
  parseSettings,
  reduce,
  shownResult,
  type CalculatorAction,
  type CalculatorState,
} from "./model";

// Arithmetic precedence and the standard operators.
for (const [expression, value] of [
  ["2+3*4", 14],
  ["(2+3)*4", 20],
  ["2^3^2", 512],
  ["-2^2", -4],
  [".5+1e2", 100.5],
  ["8%3", 2],
  ["5×2÷4", 2.5],
  ["7−2", 5],
] as const)
  assert.equal(calculate(expression).value, value, expression);
assert.equal(calculate("0.1+0.2").formatted, "0.3", "results round to 12 significant digits");
assert.equal(calculate("-0*5").formatted, "0", "negative zero reads as 0");

// Scientific functions, constants and angle units.
const degrees = { angle: "degrees" } as const;
const radians = { angle: "radians" } as const;
for (const [expression, value, options] of [
  ["sin(30)", 0.5, degrees],
  ["cos(60)", 0.5, degrees],
  ["tan(45)", 1, degrees],
  ["sin(180)", 0, degrees],
  ["asin(1)", 90, degrees],
  ["atan(1)", 45, degrees],
  ["sin(π/2)", 1, radians],
  ["cos(pi)", -1, radians],
  ["sin(pi)", 0, radians],
  ["ln(e)", 1, radians],
  ["log(1000)", 3, radians],
  ["√(16)", 4, radians],
  ["sqrt(2)^2", 2, radians],
  ["3^2", 9, radians],
  ["5!", 120, radians],
  ["3!!", 720, radians],
  ["2*sin(30)+√(9)", 4, degrees],
] as const)
  assert.equal(Number(calculate(expression, options).formatted), value, expression);
assert.equal(calculate("acos(-1)", radians).value, Math.PI);
assert.equal(calculate("π").formatted, "3.14159265359");
assert.equal(calculate("e").formatted, "2.71828182846");
assert.equal(calculate("1e3").value, 1000, "scientific notation is a number, not e");
assert.notEqual(
  calculate("sin(30)", degrees).value,
  calculate("sin(30)", radians).value,
  "the angle unit changes trig results",
);

for (const expression of [
  "1/0",
  "2(3)",
  "2π",
  "(1+2",
  "process.exit()",
  "1;2",
  "1e9999",
  "",
  "sin 30",
  "foo(2)",
  "ln(0)",
  "log(-1)",
  "√(-1)",
  "asin(2)",
  "(-1)!",
  "2.5!",
  "171!",
])
  assert.throws(() => calculate(expression), expression);
assert.throws(() => calculate("tan(90)", degrees), /undefined/);
assert.throws(() => calculate("tan(pi/2)", radians), /undefined/);

// The reducer.
const run = (state: CalculatorState, ...actions: CalculatorAction[]) =>
  actions.reduce(reduce, state);
const typed = (text: string): CalculatorAction[] =>
  Array.from(text, (character) => ({ type: "insert", text: character }));
let state = run(initialState(), ...typed("2+3"), { type: "evaluate" });
assert.equal(shownResult(state)?.value, 5);
assert.equal(state.history.length, 1);
assert.equal(
  run(state, { type: "edit", expression: "2+38" }).expression,
  "8",
  "typing a digit in the field after = starts afresh",
);
assert.equal(run(state, { type: "edit", expression: "2+3*2" }).expression, "5*2");
assert.equal(run(state, { type: "edit", expression: "2+" }).expression, "2+", "deleting edits");
state = run(state, { type: "insert", text: "×" }, { type: "insert", text: "2" });
assert.equal(state.expression, "5×2", "an operator after = continues from the result");
state = run(state, { type: "evaluate" }, { type: "insert", text: "7" });
assert.equal(state.expression, "7", "a digit after = starts a new calculation");
assert.equal(shownResult(state)?.value, 10, "the last answer stays shown while typing");
state = run(state, { type: "clear" }, ...typed("1-4"), { type: "evaluate" }, ...typed("^2"));
assert.equal(state.expression, "(-3)^2", "a negative result is parenthesised when continued");
state = run(state, { type: "backspace" }, { type: "backspace" });
assert.equal(state.expression, "(-3)");
state = run(state, ...typed("/0"), { type: "evaluate" });
assert.equal(state.outcome.kind, "error");
assert.equal(state.history.length, 3, "a failed calculation is not added to history");
state = run(state, { type: "backspace" });
assert.equal(state.outcome.kind, "empty", "editing clears the error it described");
const before = state.history.length;
state = run(state, { type: "edit", expression: "8/2" }, { type: "evaluate" }, { type: "evaluate" });
assert.equal(state.history.length, before + 1, "repeating = does not duplicate history");
state = run(state, { type: "recall", entry: state.history[2]! });
assert.equal(state.expression, "5×2");
assert.equal(shownResult(state)?.value, 10);
state = run(state, { type: "clearHistory" });
assert.deepEqual(state.history, []);
for (let index = 0; index < 60; index++)
  state = run(state, { type: "edit", expression: `${index}+1` }, { type: "evaluate" });
assert.equal(state.history.length, 50, "history keeps the 50 most recent");
assert.equal(state.history[0]?.expression, "59+1");

state = run(
  initialState(),
  { type: "mode", mode: "scientific" },
  { type: "angle", angle: "radians" },
);
assert.deepEqual(state.settings, { mode: "scientific", angle: "radians" });
state = run(state, { type: "edit", expression: "sin(90)" }, { type: "evaluate" });
assert.notEqual(shownResult(state)?.value, 1, "radians mode evaluates sin(90) in radians");
state = run(state, { type: "angle", angle: "degrees" }, { type: "evaluate" });
assert.equal(shownResult(state)?.value, 1);

// Stored preferences.
assert.deepEqual(parseSettings(undefined), DEFAULT_SETTINGS);
assert.deepEqual(parseSettings({ mode: "nonsense", angle: 3 }), DEFAULT_SETTINGS);
assert.deepEqual(parseSettings({ mode: "scientific", angle: "radians" }), {
  mode: "scientific",
  angle: "radians",
});

// Keyboard mapping: the field edits itself; elsewhere typing goes into the expression.
const key = (code: number, text?: string, ctrlKey = false) => ({
  code,
  text,
  ctrlKey,
  altKey: false,
  metaKey: false,
});
assert.deepEqual(keyboardAction(key(1), true), { type: "clear" });
assert.deepEqual(keyboardAction(key(13, "="), true), { type: "evaluate" });
assert.equal(keyboardAction(key(2, "1"), true), null);
assert.equal(keyboardAction(key(14), true), null);
assert.deepEqual(keyboardAction(key(2, "1"), false), {
  type: "insert",
  text: "1",
});
assert.deepEqual(keyboardAction(key(10, "("), false), {
  type: "insert",
  text: "(",
});
assert.deepEqual(keyboardAction(key(14), false), { type: "backspace" });
assert.equal(keyboardAction(key(28), false), null, "Enter activates the focused key");
assert.equal(keyboardAction(key(57, " "), false), null, "Space activates the focused key");
assert.equal(keyboardAction(key(30, "a", true), false), null, "shortcuts are not typed");

// Layout holds inside the body at the gallery's sizes, in both modes.
const inside = (box: Box, width: number, height: number) =>
  box.x >= 0 &&
  box.y >= 0 &&
  box.x + box.width <= width + 0.5 &&
  box.y + box.height <= height + 0.5;
for (const [width, height, ui] of [
  [430, 578, 1],
  [640, 578, 1],
  [1020, 873, 1.5],
  [640, 867, 1.5],
] as const)
  for (const mode of ["standard", "scientific"] as const) {
    const layout = calculatorLayout(width, height, mode, ui);
    const boxes = [layout.display, layout.modeBar, layout.keypad];
    if (layout.scientific) boxes.push(layout.scientific);
    if (layout.history) boxes.push(layout.history);
    for (const box of boxes)
      assert.ok(inside(box, width, height), `${mode} ${width}x${height}@${ui} overflows`);
    assert.equal(Boolean(layout.scientific), mode === "scientific");
    assert.ok(layout.keyHeight >= 30 * ui);
  }

console.log("[calculator/model] evaluator, functions/angles, reducer, keys and layout passed");
