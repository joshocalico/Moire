/** Colors without rendering: colour math, contrast, editor/palette transitions and palette files. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseGpl, readPaletteFile, writePaletteFile } from "./backend";
import {
  BLACK,
  WHITE,
  contrastCheck,
  formatHsl,
  formatRatio,
  formatRgb,
  parseHex,
  rgbHex,
  rgbToHsl,
} from "./color";
import { editorReducer, initialEditor, paletteFrom, uniqueName, upsertSwatch } from "./model";
import { PaletteStore, type Palette } from "./palettes";
import { PRESETS } from "./presets";

// Conversion.
assert.deepEqual(parseHex("#F80"), { r: 255, g: 136, b: 0 });
assert.equal(rgbHex({ r: 1, g: 2, b: 3 }), "#010203");
assert.throws(() => parseHex("#nope"));
assert.throws(() => rgbHex({ r: 256, g: 0, b: 0 }));
assert.deepEqual(rgbToHsl(parseHex("#FF0000")), { h: 0, s: 100, l: 50 });
assert.deepEqual(rgbToHsl(parseHex("#808080")), { h: 0, s: 0, l: 50 });
assert.equal(formatHsl(parseHex("#BF5AF2")), "hsl(280, 85%, 65%)");
assert.equal(formatRgb(parseHex("#BF5AF2")), "rgb(191, 90, 242)");

// WCAG contrast: black/white is 21:1; #777777 on white is 4.47:1, just under AA.
assert.equal(formatRatio(contrastCheck(BLACK, WHITE).ratio), "21.00:1");
const gray = contrastCheck(parseHex("#777777"), WHITE);
assert.equal(formatRatio(gray.ratio), "4.47:1");
assert.deepEqual([gray.aa, gray.aaa], [false, false]);
const dark = contrastCheck(parseHex("#6B6B6B"), WHITE);
assert.deepEqual([dark.aa, dark.aaa], [true, false]);
assert.ok(contrastCheck(parseHex("#222222"), WHITE).aaa);
assert.equal(formatRatio(4.4999), "4.49:1", "ratios are truncated, never rounded up to a pass");

// Editor transitions.
let editor = initialEditor([]);
assert.deepEqual(editor.selection, { kind: "preset", id: PRESETS[0]!.id });
editor = editorReducer(editor, { type: "hex", value: "#102030" });
editor = editorReducer(editor, { type: "channel", channel: "g", value: "255" });
assert.equal(editor.hex, "#10FF30");
assert.equal(editorReducer(editor, { type: "channel", channel: "g", value: "300" }), editor);
editor = editorReducer(editor, { type: "pick", swatch: PRESETS[0]!.swatches[0]!, editable: false });
assert.equal(editor.swatchId, null, "picking a preset colour does not edit the preset");
const saved: Palette[] = [
  { id: "a", name: "A", swatches: [{ id: "s", name: "S", hex: "#000000" }] },
];
editor = editorReducer(
  { ...editor, selection: { kind: "saved", id: "gone" }, swatchId: "s" },
  { type: "reconcile", palettes: saved },
);
assert.deepEqual([editor.selection.kind, editor.swatchId], ["none", null]);

// Palette transitions.
const updated = upsertSwatch(saved, "a", { id: "s", name: "Ink", hex: "#111111" });
assert.deepEqual(updated[0]!.swatches, [{ id: "s", name: "Ink", hex: "#111111" }]);
assert.equal(uniqueName([...saved, { id: "b", name: "A 2", swatches: [] }], "A"), "A 3");
let n = 0;
const copy = paletteFrom(
  saved,
  { name: "A", colors: [{ name: "x", hex: "#FFFFFF" }] },
  () => `id${n++}`,
);
assert.deepEqual(copy, {
  id: "id0",
  name: "A 2",
  swatches: [{ id: "id1", name: "x", hex: "#FFFFFF" }],
});

// Palette files.
const gpl = parseGpl(
  "GIMP Palette\nName: Sunset\nColumns: 4\n# comment\n255 136   0\tTangerine\n 16  32  48\n",
  "fallback",
);
assert.deepEqual(gpl, {
  name: "Sunset",
  colors: [
    { name: "Tangerine", hex: "#FF8800" },
    { name: "#102030", hex: "#102030" },
  ],
});
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-colors-model-"));
try {
  for (const ext of ["gpl", "json"]) {
    const written = await writePaletteFile(path.join(fixture, `round.${ext}`), gpl);
    assert.ok(written.ok);
    const back = await readPaletteFile(written.value);
    assert.ok(back.ok);
    assert.deepEqual(back.value, gpl, `${ext} round-trips`);
  }
  const bare = await writePaletteFile(path.join(fixture, "bare"), gpl);
  assert.ok(bare.ok && bare.value.endsWith("bare.gpl"), "a name without extension saves as .gpl");
  await fs.writeFile(path.join(fixture, "bad.gpl"), "GIMP Palette\n300 0 0 Too red\n");
  const bad = await readPaletteFile(path.join(fixture, "bad.gpl"));
  assert.ok(!bad.ok && bad.error.kind === "invalid" && /Line 2/.test(bad.error.message));
  await fs.writeFile(path.join(fixture, "list.json"), '["#123", {"name": "Red", "hex": "f00"}]');
  const list = await readPaletteFile(path.join(fixture, "list.json"));
  assert.ok(list.ok);
  assert.deepEqual(list.value, {
    name: "list",
    colors: [
      { name: "#112233", hex: "#112233" },
      { name: "Red", hex: "#FF0000" },
    ],
  });
  const missing = await readPaletteFile(path.join(fixture, "missing.gpl"));
  assert.ok(!missing.ok && missing.error.kind === "io");
  const other = await readPaletteFile(path.join(fixture, "notes.txt"));
  assert.ok(!other.ok && other.error.kind === "unsupported");
  const unwritable = await writePaletteFile(path.join(fixture, "no/such/dir/x.gpl"), gpl);
  assert.ok(!unwritable.ok && unwritable.error.kind === "io");

  // The store still rejects corrupt saved data.
  const store = new PaletteStore(path.join(fixture, "palettes.json"));
  await fs.writeFile(
    store.file,
    JSON.stringify([
      { id: "duplicate", name: "One", swatches: [] },
      { id: "duplicate", name: "Two", swatches: [] },
    ]),
  );
  assert.throws(() => store.read(), /duplicate palette IDs/);
} finally {
  await fs.rm(fixture, { recursive: true, force: true });
}
console.log("[colors/model] colour math, WCAG contrast, transitions and .gpl/.json files passed");
