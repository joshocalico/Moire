import assert from "node:assert/strict";
import React from "react";
import { createShellRoot, renderShell, type SceneNode } from "@moire/react-host";
import { calculate } from "./arithmetic";
import { CalculatorApp } from "./main";
import { harness } from "./testing";
for (const [expression, value] of [
  ["2+3*4", 14],
  ["(2+3)*4", 20],
  ["2^3^2", 512],
  ["-2^2", -4],
  [".5+1e2", 100.5],
  ["8%3", 2],
  ["5×2÷4", 2.5],
] as const)
  assert.equal(calculate(expression).value, value);
for (const expression of ["1/0", "2(3)", "(1+2", "process.exit()", "1;2", "1e9999", ""])
  assert.throws(() => calculate(expression));
let observed: number | null = null;
let evaluations = 0;
const app = await harness(
  (size) => (
    <CalculatorApp
      {...size}
      onResult={(result) => {
        observed = result.value;
        evaluations++;
      }}
    />
  ),
  430,
  650,
);
app.text("2*(3+4)");
app.key(28, "Enter");
assert.equal(observed, 14, "actual Window Enter did not calculate the typed expression");
app.key(15, "Tab");
app.key(28, "Enter");
assert.equal(evaluations, 1, "focused keypad Enter must activate the key, not evaluate globally");
// Tab from '(' to C. Its Enter activation must clear the expression.
for (let step = 0; step < 3; step++) app.key(15, "Tab");
app.key(28, "Enter");
app.click(100, 80);
app.text("7");
app.key(28, "Enter");
assert.equal(observed, 7, "focused keypad C clears before the next expression");
app.key(15, "Tab", { shift: true });
app.key(28, "Enter");
app.click(100, 80);
app.text("9");
app.key(28, "Enter");
assert.equal(observed, 9, "focused toolbar Clear activates through Enter");
app.key(30, "a", { ctrl: true });
app.text("123");
const beforeHistory = evaluations;
// Expression -> twenty keypad buttons -> first history row.
for (let step = 0; step < 21; step++) app.key(15, "Tab");
app.key(28, "Enter");
assert.equal(
  evaluations,
  beforeHistory,
  "history Enter reuses the entry without calculating again",
);
app.click(100, 80);
app.key(28, "Enter");
assert.equal(
  observed,
  9,
  "history activation restored the selected expression instead of leaving 123",
);
assert.equal(evaluations, beforeHistory + 1);
app.key(1, "Escape");
app.click(100, 80);
app.key(15, "Tab");
app.key(57, " ");
app.click(100, 80);
app.text("2+3)");
app.key(28, "Enter");
assert.equal(observed, 5, "Space inserts the focused '(' keypad action");
app.key(1, "Escape");
app.text("1/0");
app.key(28, "Enter");
assert.ok(app.native.lastFrame);
app.destroy();
const root = createShellRoot();
renderShell(root, <CalculatorApp width={430} height={650} />);
const texts = (node: SceneNode): string[] => [
  ...(node.kind === "text" ? [node.text ?? ""] : []),
  ...node.children.flatMap(texts),
];
assert.ok(texts(root.container).includes("Calculator"));
renderShell(root, null);
console.log("Calculator precedence/parser rejection and actual Window keyboard flow passed");
