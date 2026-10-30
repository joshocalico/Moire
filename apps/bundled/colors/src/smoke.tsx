/**
 * Colors workflows through real input: presets by keyboard, copy as HEX/RGB/HSL, contrast badges,
 * palette and swatch create/update/delete, .gpl import and export through the file chooser, and
 * the save-conflict dialog.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import React from "react";
import { readClipboardText } from "@moire/ui";
import { loadRecentFiles } from "@moire/app-tools";
import { mountWindow, withFixture } from "@moire/app-tools/testing";
import { readPaletteFile } from "./backend";
import { WHITE, contrastCheck, formatRatio, parseHex } from "./color";
import { APP_ID } from "./controller";
import { ColorsApp } from "./main";
import { PaletteStore } from "./palettes";

const A = 30;
const TAB = 15;
const ENTER = 28;
const DOWN = 108;

await withFixture(async (home) => {
  await fs.mkdir(path.join(home, "Documents"), { recursive: true });
  const store = new PaletteStore(path.join(home, "palettes.json"));
  const ui = await mountWindow((size) => <ColorsApp {...size} store={store} />, {
    width: 840,
    height: 680,
  });
  const focused = () => (ui.window as unknown as { focusedId: string | null }).focusedId;
  const has = (text: string) => ui.texts().includes(text);
  const fill = (focusId: string, value: string) => {
    ui.press({ focusId });
    ui.key(A, "a", { ctrl: true });
    ui.type(value);
  };
  const saved = () => store.read();
  /** Tab to a control and press Enter: keyboard reachability, and works for scrolled-off cards. */
  const activate = (focusId: string) => {
    for (let i = 0; i < 80 && focused() !== focusId; i++) ui.key(TAB, "Tab");
    assert.equal(focused(), focusId, `${focusId} is reachable by Tab`);
    ui.key(ENTER, "Enter");
  };
  try {
    // With nothing saved the first preset is shown, read-only.
    assert.ok(has("Basics") && has("Save as Palette"));
    assert.throws(
      () => ui.press({ focusId: "colors:save-color" }),
      "Save Color is disabled on presets",
    );
    assert.equal(saved().length, 0);

    // Keyboard: Tab from a preset row to its second swatch, Enter picks it.
    ui.press({ focusId: "colors:preset:pastel" });
    assert.ok(has("Pastel"));
    for (let i = 0; i < 40 && focused() !== "colors:swatch:preset:pastel:1"; i++)
      ui.key(TAB, "Tab");
    assert.equal(focused(), "colors:swatch:preset:pastel:1", "swatches are reachable by Tab");
    ui.key(ENTER, "Enter");
    assert.ok(has("#FFE5B4") && has("Peach"), "Enter on a swatch makes it the current color");

    // Contrast against white and black, with AA/AAA verdicts.
    const onWhite = contrastCheck(parseHex("#FFE5B4"), WHITE);
    assert.ok(has(`On white  ${formatRatio(onWhite.ratio)}`));
    assert.ok(has("AA Fail") && has("AAA Fail") && has("AA Pass") && has("AAA Pass"));

    // Copy in each format, and by shortcut.
    for (const [id, expected] of [
      ["hex", "#FFE5B4"],
      ["rgb", "rgb(255, 229, 180)"],
      ["hsl", "hsl(39, 100%, 85%)"],
    ] as const) {
      activate(`colors:copy-${id}`);
      await ui.until(() => has(`Copied ${expected}`), `copy ${id}`);
      assert.equal(await readClipboardText(), expected);
    }

    // Save a preset as an editable palette.
    if (process.env.MOIRE_COLORS_SHOT) ui.screenshot(process.env.MOIRE_COLORS_SHOT + ".preset.png");
    ui.press({ focusId: "colors:save-preset" });
    assert.deepEqual(
      saved().map((palette) => [palette.name, palette.swatches.length]),
      [["Pastel", 7]],
    );
    assert.ok(!has("Save as Palette"), "the copy is the user's own, so it is editable");

    // Create, fill, edit and rename a palette.
    fill("colors:palette-name", "Warm colors");
    ui.press({ focusId: "colors:new-palette" });
    assert.equal(saved()[1]?.name, "Warm colors");
    fill("colors:hex", "#FF8800");
    fill("colors:color-name", "Tangerine");
    ui.press({ focusId: "colors:save-color" });
    assert.deepEqual(
      saved()[1]?.swatches.map((s) => [s.name, s.hex]),
      [["Tangerine", "#FF8800"]],
    );
    fill("colors:red", "16");
    assert.ok(has("#108800"), "an RGB channel edits the HEX value");
    ui.press({ text: "Update Color" });
    assert.deepEqual(
      saved()[1]?.swatches.map((s) => s.hex),
      ["#108800"],
    );
    ui.key(1, "c", { ctrl: true, shift: true });
    await ui.until(() => has("Copied #108800"), "Ctrl+Shift+C copies HEX");
    fill("colors:palette-name", "Greens");
    ui.press({ focusId: "colors:rename-palette" });
    assert.equal(saved()[1]?.name, "Greens");
    ui.press({ focusId: "colors:delete-color" });
    assert.equal(saved()[1]?.swatches.length, 0);

    // Delete a palette after confirming.
    ui.press({ focusId: "colors:delete-palette" });
    ui.press({ text: "Delete" });
    await ui.settle();
    assert.deepEqual(
      saved().map((palette) => palette.name),
      ["Pastel"],
    );

    // Import a GIMP palette through the file chooser (Ctrl+O), then remember it as recent. Its
    // file name differs from the later "Sunset.gpl" export even on a case-insensitive disk.
    const sunset = path.join(home, "Documents", "sunset-swatches.gpl");
    await fs.writeFile(
      sunset,
      "GIMP Palette\nName: Sunset\n#\n255 136 0\tTangerine\n200 40 90\tRose\n",
    );
    await fs.writeFile(path.join(home, "Documents", "broken.gpl"), "GIMP Palette\nnot a color\n");
    ui.key(24, "o", { ctrl: true });
    await ui.settle();
    assert.ok(has("Import a palette") && has("sunset-swatches.gpl"));
    ui.key(DOWN, "ArrowDown"); // broken.gpl
    ui.key(DOWN, "ArrowDown"); // sunset-swatches.gpl
    ui.key(ENTER, "Enter");
    await ui.until(() => saved().length === 2, "import saves a new palette");
    assert.deepEqual(
      saved()[1]?.swatches.map((s) => [s.name, s.hex]),
      [
        ["Tangerine", "#FF8800"],
        ["Rose", "#C8285A"],
      ],
    );
    assert.deepEqual(loadRecentFiles(APP_ID), [sunset]);
    assert.ok(has("Imported Sunset"));

    // A malformed file is reported, not imported.
    ui.press({ focusId: "colors:import" });
    await ui.settle();
    ui.key(DOWN, "ArrowDown");
    ui.key(ENTER, "Enter");
    await ui.until(
      () => ui.texts().some((text) => text.startsWith("Could not import broken.gpl: Line 2")),
      "import errors reach the status line",
    );
    assert.equal(saved().length, 2);

    // Export the selected palette as .gpl through the save chooser.
    ui.press({ focusId: "colors:export" });
    await ui.settle();
    assert.ok(has("Export Sunset"));
    ui.press({ text: "Save" });
    const exported = path.join(home, "Documents", "Sunset.gpl");
    await ui.until(() => has(`Exported Sunset to ${exported}`), "export finishes");
    const back = await readPaletteFile(exported);
    assert.ok(back.ok && back.value.colors.length === 2 && back.value.name === "Sunset");

    // A save over changed data offers Reload saved / Keep draft; reloading picks up the change.
    store.write(
      [...saved(), { id: "external", name: "External", swatches: [] }],
      store.load().revision,
    );
    ui.press({ focusId: "colors:save-color" });
    await ui.settle();
    assert.ok(has("Saved data changed") && has("Keep draft"));
    ui.press({ text: "Reload saved" });
    await ui.settle();
    assert.ok(has("External"), "reloaded palettes appear in the sidebar");
    assert.ok(ui.native.lastFrame?.some((byte) => byte !== 0));
    if (process.env.MOIRE_COLORS_SHOT) ui.screenshot(process.env.MOIRE_COLORS_SHOT);
  } finally {
    ui.destroy();
  }
});
console.log(
  "[colors/smoke] presets by keyboard, copy HEX/RGB/HSL, contrast, palette CRUD, .gpl import/export and conflict reload passed",
);
