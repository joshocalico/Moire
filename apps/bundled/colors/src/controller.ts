/**
 * Colors' actions: wires the editor reducer to saved palettes, the clipboard and palette files.
 * Views receive what this returns; they never touch the store or the filesystem.
 */
import { randomUUID } from "node:crypto";
import path from "node:path";
import { useReducer, useState } from "react";
import { writeClipboardText } from "@moire/ui";
import { rememberRecentFile } from "@moire/app-tools";
import { readPaletteFile, writePaletteFile } from "./backend";
import { COPY_FORMATS, rgbHex, tryParseHex, type CopyFormat } from "./color";
import {
  DEFAULT_PALETTE_NAME,
  addPalette,
  editorReducer,
  initialEditor,
  paletteFrom,
  removePalette,
  removeSwatch,
  renamePalette,
  selectedPalette,
  toPaletteFile,
  upsertSwatch,
} from "./model";
import type { PaletteStore } from "./palettes";
import { usePaletteStore } from "./use-palette-store";

export const APP_ID = "org.moire.Colors";

export type ColorsController = ReturnType<typeof useColors>;

export function useColors(store: PaletteStore, copyText = writeClipboardText) {
  const [status, setStatus] = useState("");
  const saved = usePaletteStore(store, setStatus);
  const [editor, dispatch] = useReducer(editorReducer, saved.palettes, initialEditor);
  const palette = selectedPalette(saved.palettes, editor.selection);
  const editable = editor.selection.kind === "saved" && !!palette;
  const rgb = tryParseHex(editor.hex);
  const closeOverlay = () => dispatch({ type: "overlay", overlay: { kind: "none" } });

  const createPalette = () => {
    const name = editor.paletteName.trim();
    if (!name) return setStatus("Give the palette a name.");
    const item = { id: randomUUID(), name, swatches: [] };
    if (saved.commit(addPalette(saved.palettes, item), `Created ${name}`))
      dispatch({
        type: "select",
        selection: { kind: "saved", id: item.id },
        paletteName: name,
      });
  };

  /** Save a preset or an imported file as a new palette of the user's own, and select it. */
  const adopt = (source: Parameters<typeof paletteFrom>[1], message: string) => {
    const item = paletteFrom(saved.palettes, source, randomUUID);
    const ok = saved.commit(addPalette(saved.palettes, item), `${message} ${item.name}`);
    if (ok)
      dispatch({
        type: "select",
        selection: { kind: "saved", id: item.id },
        paletteName: item.name,
      });
    return ok;
  };

  const saveColor = () => {
    if (!editable || !rgb) return;
    const hex = rgbHex(rgb);
    const swatch = {
      id: editor.swatchId ?? randomUUID(),
      name: editor.colorName.trim() || hex,
      hex,
    };
    if (saved.commit(upsertSwatch(saved.palettes, palette.id, swatch), `Saved ${swatch.name}`))
      dispatch({ type: "saved-swatch", id: swatch.id });
  };

  const copy = async (format: CopyFormat) => {
    if (!rgb) return;
    const text = COPY_FORMATS.find((item) => item.id === format)!.format(rgb);
    try {
      await copyText(text);
      setStatus(`Copied ${text}`);
    } catch (caught) {
      setStatus(`Clipboard unavailable: ${String(caught)}`);
    }
  };

  const importFile = async (file: string) => {
    closeOverlay();
    const result = await readPaletteFile(file);
    if (!result.ok)
      return setStatus(`Could not import ${path.basename(file)}: ${result.error.message}`);
    if (adopt(result.value, "Imported")) rememberRecentFile(APP_ID, file);
  };

  const exportFile = async (file: string) => {
    closeOverlay();
    if (!palette) return;
    const result = await writePaletteFile(file, toPaletteFile(palette));
    setStatus(
      result.ok
        ? `Exported ${palette.name} to ${result.value}`
        : `Could not export ${palette.name}: ${result.error.message}`,
    );
  };

  return {
    editor,
    dispatch,
    palettes: saved.palettes,
    palette,
    editable,
    rgb,
    status:
      status ||
      saved.loadError ||
      (editable
        ? "Choose a color, then save it in a palette"
        : "Presets are read-only; save one as a palette to edit it"),
    notice: saved.notice,
    dismissNotice: saved.dismissNotice,
    loadError: saved.loadError,
    createPalette,
    saveColor,
    copy,
    importFile,
    exportFile,
    savePresetAsPalette: () => palette && adopt(toPaletteFile(palette), "Saved"),
    renamePalette: () => {
      if (editable)
        saved.commit(
          renamePalette(saved.palettes, palette.id, editor.paletteName.trim()),
          "Palette renamed",
        );
    },
    deleteColor: () => {
      if (
        editable &&
        editor.swatchId &&
        saved.commit(removeSwatch(saved.palettes, palette.id, editor.swatchId), "Color deleted")
      )
        dispatch({ type: "forget-swatch" });
    },
    deletePalette: () => {
      if (!editable) return;
      const rest = removePalette(saved.palettes, palette.id);
      if (!saved.commit(rest, "Palette deleted")) return;
      const next = rest[0];
      dispatch({
        type: "select",
        selection: next ? { kind: "saved", id: next.id } : { kind: "none" },
        paletteName: next?.name ?? DEFAULT_PALETTE_NAME,
      });
      closeOverlay();
    },
    reload: () => {
      closeOverlay();
      const palettes = saved.reload();
      if (palettes) dispatch({ type: "reconcile", palettes });
    },
    retryCleanup: saved.retryCleanup,
  };
}
