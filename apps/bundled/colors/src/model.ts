/** Colors' state: palette-list transitions and the editor reducer, all pure. */
import type { PaletteFile } from "./backend";
import { isChannel, rgbHex, tryParseHex, type RGB } from "./color";
import type { Palette, Swatch } from "./palettes";
import { PRESETS } from "./presets";

/** Which palette the swatch grid shows: one of the user's, a read-only preset, or none. */
export type Selection =
  | { kind: "none" }
  | { kind: "saved"; id: string }
  | { kind: "preset"; id: string };

export type Overlay =
  | { kind: "none" }
  | { kind: "delete-palette" }
  | { kind: "reload" }
  | { kind: "import" }
  | { kind: "export" };

export type EditorState = {
  selection: Selection;
  /** The palette-name field in the sidebar. */
  paletteName: string;
  hex: string;
  colorName: string;
  /** The saved swatch being edited; null while composing a new color. */
  swatchId: string | null;
  overlay: Overlay;
};

export type EditorAction =
  | { type: "select"; selection: Selection; paletteName: string }
  | { type: "palette-name"; value: string }
  | { type: "hex"; value: string }
  | { type: "channel"; channel: keyof RGB; value: string }
  | { type: "color-name"; value: string }
  | { type: "pick"; swatch: Swatch; editable: boolean }
  | { type: "new-color" }
  | { type: "saved-swatch"; id: string }
  | { type: "forget-swatch" }
  | { type: "reconcile"; palettes: readonly Palette[] }
  | { type: "overlay"; overlay: Overlay };

export const DEFAULT_PALETTE_NAME = "My palette";

export function initialEditor(palettes: readonly Palette[]): EditorState {
  const first = palettes[0];
  return {
    selection: first ? { kind: "saved", id: first.id } : { kind: "preset", id: PRESETS[0]!.id },
    paletteName: first?.name ?? DEFAULT_PALETTE_NAME,
    hex: "#BF5AF2",
    colorName: "Wisteria",
    swatchId: null,
    overlay: { kind: "none" },
  };
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "select":
      return {
        ...state,
        selection: action.selection,
        paletteName: action.paletteName,
        swatchId: null,
      };
    case "palette-name":
      return { ...state, paletteName: action.value };
    case "hex":
      return { ...state, hex: action.value };
    case "channel": {
      const rgb = tryParseHex(state.hex);
      const value = action.value.trim() === "" ? 0 : Number(action.value);
      if (!rgb || !isChannel(value)) return state;
      return { ...state, hex: rgbHex({ ...rgb, [action.channel]: value }) };
    }
    case "color-name":
      return { ...state, colorName: action.value };
    case "pick":
      return {
        ...state,
        hex: action.swatch.hex,
        colorName: action.swatch.name,
        swatchId: action.editable ? action.swatch.id : null,
      };
    case "new-color":
      return { ...state, swatchId: null, colorName: "" };
    case "saved-swatch":
      return { ...state, swatchId: action.id };
    case "forget-swatch":
      return { ...state, swatchId: null };
    case "reconcile":
      return reconcile(state, action.palettes);
    case "overlay":
      return { ...state, overlay: action.overlay };
  }
}

/** The palette a selection names, looked up in the user's palettes or the presets. */
export function selectedPalette(
  palettes: readonly Palette[],
  selection: Selection,
): Palette | null {
  if (selection.kind === "none") return null;
  const source = selection.kind === "saved" ? palettes : PRESETS;
  return source.find((item) => item.id === selection.id) ?? null;
}

/** After saved data changes underneath, keep the selection only if it still exists. */
function reconcile(state: EditorState, palettes: readonly Palette[]): EditorState {
  const palette = selectedPalette(palettes, state.selection);
  if (!palette) return { ...state, selection: { kind: "none" }, swatchId: null };
  return palette.swatches.some((swatch) => swatch.id === state.swatchId)
    ? state
    : { ...state, swatchId: null };
}

/** `name`, or `name 2`, `name 3`… so imported and copied palettes stay distinguishable. */
export function uniqueName(palettes: readonly Palette[], name: string): string {
  const taken = new Set(palettes.map((item) => item.name));
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name} ${n}`)) n++;
  return `${name} ${n}`;
}

export const addPalette = (palettes: readonly Palette[], palette: Palette): Palette[] => [
  ...palettes,
  palette,
];

export const renamePalette = (palettes: readonly Palette[], id: string, name: string): Palette[] =>
  palettes.map((item) => (item.id === id ? { ...item, name } : item));

export const removePalette = (palettes: readonly Palette[], id: string): Palette[] =>
  palettes.filter((item) => item.id !== id);

/** Add a swatch, or replace the one with the same id in place. */
export function upsertSwatch(palettes: readonly Palette[], id: string, swatch: Swatch): Palette[] {
  return palettes.map((item) => {
    if (item.id !== id) return item;
    const index = item.swatches.findIndex((existing) => existing.id === swatch.id);
    const swatches = [...item.swatches];
    if (index >= 0) swatches[index] = swatch;
    else swatches.push(swatch);
    return { ...item, swatches };
  });
}

export const removeSwatch = (
  palettes: readonly Palette[],
  id: string,
  swatchId: string,
): Palette[] =>
  palettes.map((item) =>
    item.id === id
      ? {
          ...item,
          swatches: item.swatches.filter((swatch) => swatch.id !== swatchId),
        }
      : item,
  );

/** A new saved palette from a file or preset, with fresh ids. */
export function paletteFrom(
  palettes: readonly Palette[],
  source: PaletteFile,
  newId: () => string,
): Palette {
  return {
    id: newId(),
    name: uniqueName(palettes, source.name),
    swatches: source.colors.map((color) => ({
      id: newId(),
      name: color.name,
      hex: color.hex,
    })),
  };
}

export const toPaletteFile = (palette: Palette): PaletteFile => ({
  name: palette.name,
  colors: palette.swatches.map(({ name, hex }) => ({ name, hex })),
});
