/** Colors: pick, name and save colors in palettes; copy values, check contrast, import/export. */
import React, { type ReactNode } from "react";
import {
  Icon,
  IconButton,
  OverlayHost,
  ScrollArea,
  ShortcutManager,
  getUiScaleFactor,
  type WindowActions,
  type WindowSize,
} from "@moire/ui";
import { AppFrame, appFrameBody, runApp, startMain } from "@moire/app-tools";
import { APP_ID, useColors } from "./controller";
import { PaletteStore } from "./palettes";
import { ColorEditor, ColorPreview, EDITOR_H, PREVIEW_H } from "./views/editor";
import { ContrastCard, FormatsCard, contrastHeight, formatsHeight } from "./views/details";
import { SwatchesCard, swatchesHeight } from "./views/swatches";
import { PaletteSidebar } from "./views/sidebar";
import { ColorsOverlays } from "./views/overlays";

const PAD = 16;
const SIDEBAR_W = 260;
/** Below this editor width the Copy and Contrast cards stack instead of sitting side by side. */
const TWO_COLUMN_MIN = 600;

export function ColorsApp(
  props: WindowSize & {
    store: PaletteStore;
    copy?: (text: string) => Promise<void>;
    /** The window the header bar controls (minimize, maximize, close, move). */
    window?: WindowActions | null;
  },
): ReactNode {
  const ui = getUiScaleFactor();
  const app = useColors(props.store, props.copy);
  const { editor, dispatch, palette, rgb } = app;
  const overlay = editor.overlay.kind;
  const show = (kind: "delete-palette" | "reload" | "import" | "export") =>
    dispatch({ type: "overlay", overlay: { kind } });

  const body = appFrameBody({ height: props.height, title: "Colors" });
  const pad = PAD * ui;
  const sidebarW = Math.min(SIDEBAR_W * ui, Math.floor(props.width * 0.36));
  const editorX = pad + sidebarW + pad;
  const editorW = Math.max(1, props.width - editorX - pad);
  const twoColumn = editorW >= TWO_COLUMN_MIN * ui;
  const halfW = (editorW - pad) / 2;
  const editorY = pad + PREVIEW_H * ui + pad;
  const swatchesY = editorY + EDITOR_H * ui + pad;
  const detailsY = swatchesY + swatchesHeight(editorW, palette?.swatches.length ?? 0) + pad;
  const contrastY = twoColumn ? detailsY : detailsY + formatsHeight() + pad;
  const contentH =
    (twoColumn
      ? detailsY + Math.max(formatsHeight(), contrastHeight())
      : contrastY + contrastHeight()) + pad;

  return (
    <OverlayHost width={props.width} height={props.height}>
      <ShortcutManager
        width={props.width}
        height={props.height}
        enabled={overlay === "none"}
        shortcuts={[
          { id: "import", key: "o", platformModifier: true, onInvoke: () => show("import") },
          {
            id: "export",
            key: "e",
            platformModifier: true,
            onInvoke: () => palette && show("export"),
          },
          {
            id: "copy-hex",
            key: "c",
            platformModifier: true,
            shift: true,
            onInvoke: () => void app.copy("hex"),
          },
        ]}
      >
        <AppFrame
          width={props.width}
          height={props.height}
          title="Colors"
          icon="colors"
          window={props.window}
          subtitle={palette?.name}
          status={app.status}
          actions={
            <>
              <IconButton
                icon={(style) => <Icon name="folder" {...style} symbolic />}
                variant="ghost"
                tooltip="Import palette… (Ctrl+O)"
                focusId="colors:import"
                onPress={() => show("import")}
              />
              <IconButton
                icon={(style) => <Icon name="downloads" {...style} symbolic />}
                variant="ghost"
                tooltip="Export palette… (Ctrl+E)"
                focusId="colors:export"
                disabled={!palette}
                onPress={() => show("export")}
              />
              <IconButton
                icon={(style) => <Icon name="restart" {...style} symbolic />}
                variant="ghost"
                tooltip="Reload saved palettes"
                focusId="colors:reload"
                onPress={() => show("reload")}
              />
            </>
          }
        >
          <PaletteSidebar
            x={pad}
            y={pad}
            width={sidebarW}
            height={body.height - pad * 2}
            palettes={app.palettes}
            selection={editor.selection}
            name={editor.paletteName}
            disabled={!!app.loadError}
            canRename={app.editable && !!editor.paletteName.trim()}
            canDelete={app.editable}
            onName={(value) => dispatch({ type: "palette-name", value })}
            onSelect={(selection, item) =>
              dispatch({ type: "select", selection, paletteName: item.name })
            }
            onCreate={app.createPalette}
            onRename={app.renamePalette}
            onDelete={() => show("delete-palette")}
          />
          <ScrollArea
            x={editorX}
            width={editorW + pad}
            height={body.height}
            contentHeight={contentH}
            fill={0x00000000}
          >
            <ColorPreview
              y={pad}
              width={editorW}
              rgb={rgb}
              title={editor.colorName.trim() || "New color"}
              error="Use a HEX color such as #BF5AF2 or #F80."
            />
            <ColorEditor
              y={editorY}
              width={editorW}
              hex={editor.hex}
              rgb={rgb}
              name={editor.colorName}
              editing={!!editor.swatchId}
              canSave={app.editable && !!rgb && !app.loadError}
              canDelete={app.editable && !!editor.swatchId}
              onHex={(value) => dispatch({ type: "hex", value })}
              onChannel={(channel, value) => dispatch({ type: "channel", channel, value })}
              onName={(value) => dispatch({ type: "color-name", value })}
              onSave={app.saveColor}
              onNew={() => dispatch({ type: "new-color" })}
              onDelete={app.deleteColor}
            />
            <FormatsCard
              y={detailsY}
              width={twoColumn ? halfW : editorW}
              rgb={rgb}
              onCopy={(f) => void app.copy(f)}
            />
            <ContrastCard
              x={twoColumn ? halfW + pad : 0}
              y={contrastY}
              width={twoColumn ? halfW : editorW}
              rgb={rgb}
            />
            <SwatchesCard
              y={swatchesY}
              width={editorW}
              palette={palette}
              readOnly={editor.selection.kind === "preset"}
              selectedId={editor.swatchId}
              onPick={(swatch) => dispatch({ type: "pick", swatch, editable: app.editable })}
              onSaveAsPalette={app.savePresetAsPalette}
            />
          </ScrollArea>
        </AppFrame>
      </ShortcutManager>
      <ColorsOverlays width={props.width} height={props.height} app={app} />
    </OverlayHost>
  );
}

startMain(import.meta.url, () => {
  const store = new PaletteStore();
  return runApp(
    "Colors",
    APP_ID,
    (size, window) => <ColorsApp {...size} window={window} store={store} />,
    { width: 840, height: 680 },
  );
});
