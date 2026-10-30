/**
 * Real Window workflow: typing, keypad and keyboard entry, copy to the clipboard, history, and
 * scientific mode with its preferences kept across a remount.
 */
import assert from "node:assert/strict";
import React from "react";
import { readClipboardText } from "@moire/ui";
import { mountWindow, withFixture } from "@moire/app-tools/testing";
import type { Calculation } from "./arithmetic";
import { CalculatorApp, type CalculatorProps } from "./main";
import { loadPreferences, savePreferences } from "./preferences";

const ENTER = 28;
const ESCAPE = 1;
const BACKSPACE = 14;
const TAB = 15;
const SPACE = 57;
const KEY_C = 46;
const KEY_D = 32;
const KEY_M = 50;

async function mount(props: Partial<CalculatorProps> = {}) {
  const results: Calculation[] = [];
  const app = await mountWindow(
    (size) => <CalculatorApp {...size} onResult={(result) => results.push(result)} {...props} />,
    { width: 430, height: 650, title: "Calculator smoke" },
  );
  const tap = (focusId: string) => app.press({ focusId: `calculator:key:${focusId}` });
  return {
    ...app,
    results,
    last: () => Number(results.at(-1)?.formatted),
    tap,
  };
}

await withFixture(async () => {
  const app = await mount({
    settings: loadPreferences(),
    onSettingsChange: savePreferences,
  });
  assert.ok(app.texts().includes("Standard"));
  assert.ok(!app.texts().includes("sin"), "standard mode has no function keys");

  // The expression field has focus on open: type, Enter, =, Backspace and Escape.
  app.type("2*(3+4)");
  app.key(ENTER, "Enter");
  assert.equal(app.last(), 14, "Enter in the field calculates");
  assert.ok(app.texts().includes("14"));
  app.type("+1=");
  assert.equal(app.last(), 15, "= calculates instead of being typed");
  app.key(BACKSPACE, "Backspace");
  app.type("2=");
  assert.equal(app.last(), 16, "Backspace edits the field");
  app.key(ESCAPE, "Escape");
  assert.ok(!app.texts().includes("2*(3+4)+2 ="), "Escape clears the expression and answer");
  app.key(ENTER, "Enter");
  assert.ok(app.texts().includes("Enter an expression."), "errors are shown in the display");

  // Keypad keys, then typing while a key (not the field) has focus.
  for (const id of ["7", "multiply", "6", "equals"]) app.tap(id);
  assert.equal(app.last(), 42);
  app.type("9");
  app.key(BACKSPACE, "Backspace");
  app.type("8-3=");
  assert.equal(app.last(), 5, "typing reaches the expression from a focused key");
  app.type("*2=");
  assert.equal(app.last(), 10, "an operator after = continues from the answer");

  // Tab moves between keys; Enter and Space activate the focused key rather than calculating.
  app.key(ESCAPE, "Escape");
  app.tap("2");
  const evaluations = app.results.length;
  app.key(TAB, "Tab");
  app.key(ENTER, "Enter");
  assert.equal(app.results.length, evaluations, "Enter on a key activates it");
  app.key(SPACE, " ", { text: " " });
  app.type("=");
  assert.equal(app.last(), 233, "Tab reached the 3 key; Enter and Space typed it");

  // Copy: the header button and Ctrl+Shift+C both reach the clipboard.
  app.press({ focusId: "calculator:copy" });
  await app.settle(2);
  assert.equal(await readClipboardText(), "233");
  app.type("*2=");
  app.key(KEY_C, "c", { ctrl: true, shift: true });
  await app.settle(2);
  assert.equal(await readClipboardText(), "466");
  assert.ok(app.texts().includes("Copied 466"), "the status line confirms the copy");

  // History: choosing an entry restores it without calculating; = calculates it again.
  const before = app.results.length;
  app.press({ focusId: "calculator:history:1" });
  assert.equal(app.results.length, before, "picking history does not calculate");
  app.type("=");
  assert.equal(app.last(), 233, "the second entry (233, not 233*2) was restored");
  app.press({ focusId: "calculator:clear-history" });
  assert.ok(app.texts().includes("No calculations yet"));

  // Scientific mode: function keys, degrees and radians, and the setting is saved.
  app.press({ text: "Scientific" });
  assert.ok(app.texts().includes("sin") && app.texts().includes("Deg"));
  assert.deepEqual(loadPreferences(), { mode: "scientific", angle: "degrees" });
  app.key(ESCAPE, "Escape");
  app.tap("sin");
  app.type("30)=");
  assert.equal(app.last(), 0.5, "sin works in degrees");
  app.key(KEY_D, "d", { ctrl: true });
  assert.ok(app.texts().includes("Radians"));
  for (const id of ["cos", "pi"]) app.tap(id);
  app.type(")=");
  assert.equal(app.last(), -1, "cos(π) in radians");
  app.key(ESCAPE, "Escape");
  for (const id of ["sqrt", "1", "6"]) app.tap(id);
  app.type(")");
  app.tap("equals");
  app.tap("square");
  app.tap("equals");
  assert.equal(app.last(), 16, "√(16) then x² of the answer");
  app.key(ESCAPE, "Escape");
  for (const id of ["5", "factorial", "equals"]) app.tap(id);
  assert.equal(app.last(), 120);
  for (const id of ["ln", "e"]) app.tap(id);
  app.type(")=");
  assert.equal(app.last(), 1);
  app.key(KEY_M, "m", { ctrl: true });
  assert.ok(!app.texts().includes("sin"), "Ctrl+M switches back to standard");
  assert.equal(loadPreferences().mode, "standard");
  app.key(KEY_M, "m", { ctrl: true });
  assert.deepEqual(loadPreferences(), { mode: "scientific", angle: "radians" });
  app.destroy();

  // A fresh window starts in the saved mode and angle unit.
  const reopened = await mount({
    settings: loadPreferences(),
    onSettingsChange: savePreferences,
  });
  assert.ok(reopened.texts().includes("sin") && reopened.texts().includes("Radians"));
  reopened.destroy();
});

// Failures are shown, not swallowed.
const failing = await mount({
  copy: () => Promise.reject(new Error("no clipboard owner")),
  onSettingsChange: () => {
    throw new Error("read-only config");
  },
});
failing.type("1+1=");
failing.press({ focusId: "calculator:copy" });
await failing.until(
  () => failing.texts().some((text) => text.startsWith("Clipboard unavailable")),
  "a clipboard failure is reported",
);
failing.press({ text: "Scientific" });
assert.ok(failing.texts().some((text) => text.startsWith("Preference not saved")));
assert.ok(failing.texts().includes("sin"), "the mode still changes for this session");
failing.destroy();

console.log("[calculator/smoke] keyboard, keypad, copy, history and scientific mode passed");
