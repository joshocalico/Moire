import { StorageConflictError, retryStoreCleanup } from "@moire/app-tools/local-store";
import React, { useState, type ReactNode } from "react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  Application,
  Button,
  ConfirmationDialog,
  Label,
  OverlayHost,
  Pressable,
  ScrollArea,
  Surface,
  TextField,
  Toolbar,
  Window,
  usePalette,
  getUiScaleFactor,
  writeClipboardText,
  type WindowSize,
} from "@moire/ui";
import { PaletteStore, colorFill, contrastText, parseHex, rgbHex, type Palette } from "./palettes";

export function ColorsApp(
  props: WindowSize & { store: PaletteStore; copy?: (text: string) => Promise<void> },
): ReactNode {
  const pal = usePalette();
  const uiScale = getUiScaleFactor();
  const [loaded, setLoaded] = useState(() => {
    try {
      const snapshot = props.store.load();
      return { palettes: [...snapshot.items], revision: snapshot.revision, error: "" };
    } catch (error) {
      return { palettes: [], revision: null, error: String(error) };
    }
  });
  const [savedRevision, setSavedRevision] = useState(loaded.revision);
  const [conflict, setConflict] = useState<{
    kind: "recovery" | "cleanup";
    title: string;
    message: string;
  } | null>(null);
  const [palettes, setPalettes] = useState<Palette[]>(loaded.palettes),
    [paletteId, setPaletteId] = useState<string | null>(loaded.palettes[0]?.id ?? null),
    [paletteName, setPaletteName] = useState(loaded.palettes[0]?.name ?? "My palette"),
    [hex, setHex] = useState("#BF5AF2"),
    [name, setName] = useState("Wisteria"),
    [swatchId, setSwatchId] = useState<string | null>(null),
    [status, setStatus] = useState(loaded.error || "Choose a color, then save it in a palette"),
    [deleting, setDeleting] = useState(false);
  const palette = palettes.find((item) => item.id === paletteId);
  let rgb = null,
    error = "";
  try {
    rgb = parseHex(hex);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  const save = (next: Palette[], message: string) => {
    if (loaded.error) {
      setStatus(loaded.error);
      setConflict({
        kind: "recovery",
        title: "Could not save",
        message: loaded.error,
      });
      return false;
    }
    try {
      const saved = props.store.write(next, savedRevision);
      setPalettes([...saved.items]);
      setSavedRevision(saved.revision);
      if (saved.cleanup.kind === "pending") {
        console.warn("[colors] Saved with pending cleanup", saved.cleanup.message);
        setConflict({
          kind: "cleanup",
          title: "Saved; cleanup pending",
          message:
            "Your changes are saved. Cleanup of owned temporary files is pending. Retry cleanup does not save another copy; a later save also retries it.",
        });
      }
      setStatus(saved.cleanup.kind === "pending" ? `${message}. Cleanup pending.` : message);
      return true;
    } catch (caught) {
      setConflict({
        kind: "recovery",
        title: caught instanceof StorageConflictError ? "Saved data changed" : "Could not save",
        message: caught instanceof Error ? caught.message : String(caught),
      });
      setStatus(String(caught));
      return false;
    }
  };
  const retryCleanup = () => {
    const cleanup = retryStoreCleanup();
    if (cleanup.kind === "complete") {
      setConflict(null);
      setStatus("Changes saved; storage cleanup finished.");
    } else {
      console.warn("[colors] Storage cleanup remains pending", cleanup.message);
      setConflict({
        kind: "cleanup",
        title: "Saved; cleanup pending",
        message:
          "Your changes remain saved. Cleanup could not finish. Retry cleanup does not save another copy.",
      });
    }
  };
  const reloadSaved = () => {
    try {
      const snapshot = props.store.load();
      setLoaded({ palettes: [...snapshot.items], revision: snapshot.revision, error: "" });
      setPalettes([...snapshot.items]);
      setSavedRevision(snapshot.revision);
      const target = snapshot.items.find((item) => item.id === paletteId);
      if (!target) {
        setPaletteId(null);
        setSwatchId(null);
      } else if (!target.swatches.some((item) => item.id === swatchId)) setSwatchId(null);
      setDeleting(false);
      setStatus("Reloaded saved data. Your current draft is kept; review it before retrying.");
      setConflict(null);
    } catch (error) {
      setStatus(String(error));
      setConflict({
        kind: "recovery",
        title: "Could not reload saved data",
        message: `${String(error)}. Your draft is still here.`,
      });
    }
  };
  const newPalette = () => {
    const title = paletteName.trim();
    if (!title) {
      setStatus("Give the palette a name.");
      return;
    }
    const item = { id: randomUUID(), name: title, swatches: [] };
    if (save([...palettes, item], `Created ${title}`)) {
      setPaletteId(item.id);
      setSwatchId(null);
    }
  };
  const saveColor = () => {
    if (!palette || !rgb) return;
    const swatch = {
      id: swatchId ?? randomUUID(),
      name: name.trim() || rgbHex(rgb),
      hex: rgbHex(rgb),
    };
    if (
      save(
        palettes.map((item) =>
          item.id === palette.id
            ? {
                ...item,
                swatches: [...item.swatches.filter((color) => color.id !== swatch.id), swatch],
              }
            : item,
        ),
        `Saved ${swatch.name}`,
      )
    )
      setSwatchId(swatch.id);
  };
  const copy = async () => {
    if (!rgb) return;
    try {
      await (props.copy ?? writeClipboardText)(rgbHex(rgb));
      setStatus(`Copied ${rgbHex(rgb)}`);
    } catch (caught) {
      setStatus(`Clipboard unavailable: ${String(caught)}`);
    }
  };
  const editorX = Math.min(290, Math.floor(props.width * 0.36)),
    editorW = Math.max(200, props.width - editorX - 28);
  return (
    <OverlayHost width={props.width} height={props.height}>
      <Surface width={props.width} height={props.height} fill={pal.bg} clip>
        <Toolbar width={props.width} height={68}>
          <Button
            label="Reload saved"
            onPress={() =>
              setConflict({
                kind: "recovery",
                title: "Reload saved data?",
                message: "Current input is kept. Review it before retrying the save.",
              })
            }
          />
          <Label flexGrow={1} text="Colors" fontSize={22} fontWeight="bold" />
          <Button
            width={100 * uiScale}
            label="Copy HEX"
            disabled={!rgb}
            onPress={() => void copy()}
          />
        </Toolbar>
        <Label x={16} y={85} text="Palettes" fontSize={17} />
        <TextField
          x={16}
          y={115}
          width={editorX - 32}
          value={paletteName}
          placeholder="Palette name"
          onChange={setPaletteName}
        />
        <Button
          x={16}
          y={158}
          width={editorX - 32}
          label="Create Palette"
          disabled={!!loaded.error}
          onPress={newPalette}
        />
        <ScrollArea
          x={16}
          y={208}
          width={editorX - 32}
          height={Math.max(80, props.height - 328)}
          contentHeight={Math.max(48, palettes.length * 48)}
        >
          {palettes.map((item, index) => (
            <Button
              key={item.id}
              y={index * 48}
              width={editorX - 48}
              label={`${item.name} · ${item.swatches.length}`}
              variant={item.id === paletteId ? "primary" : "ghost"}
              onPress={() => {
                setPaletteId(item.id);
                setPaletteName(item.name);
                setSwatchId(null);
              }}
            />
          ))}
        </ScrollArea>
        <Button
          x={16}
          y={props.height - 106}
          width={100}
          label="Rename"
          disabled={!palette || !paletteName.trim()}
          onPress={() =>
            palette &&
            save(
              palettes.map((item) =>
                item.id === palette.id ? { ...item, name: paletteName.trim() } : item,
              ),
              "Palette renamed",
            )
          }
        />
        <Button
          x={130}
          y={props.height - 106}
          width={100}
          label="Delete"
          variant="ghost"
          disabled={!palette}
          onPress={() => setDeleting(true)}
        />
        <Surface
          x={editorX}
          y={86}
          width={editorW}
          height={126}
          fill={rgb ? colorFill(rgb) : pal.panel}
          radius={pal.radiusMd}
        >
          <Label
            x={18}
            y={24}
            text={rgb ? rgbHex(rgb) : "Invalid color"}
            color={rgb ? contrastText(rgb) : pal.text}
            fontSize={30}
            fontFamily="mono"
          />
          <Label
            x={18}
            y={76}
            text={rgb ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` : error}
            color={rgb ? contrastText(rgb) : pal.muted}
            fontSize={13}
          />
        </Surface>
        <Label x={editorX} y={228} text="HEX" color={pal.muted} fontSize={11} />
        <TextField
          x={editorX}
          y={247}
          width={editorW}
          value={hex}
          onChange={setHex}
          invalid={!!error}
        />
        {["r", "g", "b"].map((channel, index) => (
          <React.Fragment key={channel}>
            <Label
              x={editorX + (index * editorW) / 3}
              y={296}
              text={channel.toUpperCase()}
              color={pal.muted}
              fontSize={11}
            />
            <TextField
              x={editorX + (index * editorW) / 3}
              y={315}
              width={editorW / 3 - 8}
              value={String(rgb ? (channel === "r" ? rgb.r : channel === "g" ? rgb.g : rgb.b) : "")}
              selectAllOnFocus
              onChange={(value) => {
                if (!rgb) return;
                try {
                  setHex(rgbHex({ ...rgb, [channel]: Number(value) }));
                } catch (caught) {
                  setStatus(String(caught));
                }
              }}
            />
          </React.Fragment>
        ))}
        <TextField
          x={editorX}
          y={366}
          width={Math.max(80, editorW - 120 * uiScale - 10)}
          value={name}
          placeholder="Color name"
          onChange={setName}
        />
        <Button
          x={editorX + editorW - 120 * uiScale}
          y={366}
          width={120 * uiScale}
          label={swatchId ? "Update Color" : "Save Color"}
          variant="primary"
          disabled={!palette || !rgb || !!loaded.error}
          onPress={saveColor}
        />
        <Button
          x={editorX}
          y={410}
          width={100 * uiScale}
          label="New Color"
          onPress={() => {
            setSwatchId(null);
            setName("");
          }}
        />
        <Button
          x={editorX + 100 * uiScale + 12}
          y={410}
          width={120 * uiScale}
          label="Delete Color"
          disabled={!swatchId || !palette}
          variant="ghost"
          onPress={() => {
            if (
              palette &&
              save(
                palettes.map((item) =>
                  item.id === palette.id
                    ? { ...item, swatches: item.swatches.filter((color) => color.id !== swatchId) }
                    : item,
                ),
                "Color deleted",
              )
            )
              setSwatchId(null);
          }}
        />
        <ScrollArea
          x={editorX}
          y={465}
          width={editorW}
          height={Math.max(64, props.height - 510)}
          contentHeight={Math.max(64, Math.ceil((palette?.swatches.length ?? 0) / 3) * 82)}
        >
          {palette?.swatches.map((swatch, index) => (
            <Pressable
              key={swatch.id}
              x={((index % 3) * editorW) / 3}
              y={Math.floor(index / 3) * 82}
              width={editorW / 3 - 8}
              height={74}
              fill={colorFill(parseHex(swatch.hex))}
              onPress={() => {
                setHex(swatch.hex);
                setName(swatch.name);
                setSwatchId(swatch.id);
              }}
            >
              <Label
                x={9}
                y={12}
                width={editorW / 3 - 26}
                text={swatch.name}
                color={contrastText(parseHex(swatch.hex))}
                fontSize={12}
                overflow="ellipsis"
                maxLines={1}
              />
              <Label
                x={9}
                y={42}
                text={swatch.hex}
                color={contrastText(parseHex(swatch.hex))}
                fontSize={11}
              />
            </Pressable>
          ))}
        </ScrollArea>
        <Label
          x={16}
          y={props.height - 28}
          width={props.width - 32}
          text={status}
          color={pal.muted}
          fontSize={10}
          overflow="ellipsis"
          maxLines={1}
        />
      </Surface>
      <ConfirmationDialog
        open={deleting}
        viewportWidth={props.width}
        viewportHeight={props.height}
        title="Delete palette?"
        message={`Delete ${palette?.name ?? "this palette"} and all its saved colors?`}
        confirmLabel="Delete"
        danger
        onDismiss={() => setDeleting(false)}
        onConfirm={() => {
          if (
            palette &&
            save(
              palettes.filter((item) => item.id !== palette.id),
              "Palette deleted",
            )
          ) {
            const next = palettes.find((item) => item.id !== palette.id);
            setPaletteId(next?.id ?? null);
            setPaletteName(next?.name ?? "My palette");
            setSwatchId(null);
            setDeleting(false);
          }
        }}
      />

      <ConfirmationDialog
        open={!!conflict}
        viewportWidth={props.width}
        viewportHeight={props.height}
        title={conflict?.title ?? "Saved data changed"}
        message={conflict?.message ?? ""}
        confirmLabel={conflict?.kind === "cleanup" ? "Retry" : "Reload saved"}
        cancelLabel={conflict?.kind === "cleanup" ? "Close" : "Keep draft"}
        onDismiss={() => setConflict(null)}
        onConfirm={() => (conflict?.kind === "cleanup" ? retryCleanup() : reloadSaved())}
      />
    </OverlayHost>
  );
}
export async function main(): Promise<void> {
  const app = new Application(),
    window = new Window({ title: "Colors", appId: "org.moire.Colors", width: 840, height: 680 }),
    store = new PaletteStore();
  window.setContent((size) => <ColorsApp {...size} store={store} />);
  window.onClose(() => app.quit());
  app.addWindow(window);
  await app.run();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch((error) => {
    console.error("[colors]", error);
    process.exitCode = 1;
  });
