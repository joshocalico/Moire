import React, { useEffect, useState, type ReactNode } from "react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Application,
  Window,
  Surface,
  OverlayHost,
  Toolbar,
  SearchField,
  Select,
  Button,
  Label,
  ScrollArea,
  StatusBar,
  writeClipboardText,
  setUiScaleFactor,
  getUiScaleFactor,
  getFontEngine,
  type FontEngine,
  usePalette,
  type WindowSize,
} from "@moire/ui";
import { loadSettings } from "@moire/prefs";
import { CHARACTERS, findCharacters, unicodeCode } from "./catalog";
export function CharactersApp(props: WindowSize): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const [font, setFont] = useState<FontEngine | null>(null);
  useEffect(() => {
    let active = true;
    void getFontEngine().then((engine) => {
      if (active) setFont(engine);
    });
    return () => {
      active = false;
    };
  }, []);
  const [query, setQuery] = useState(""),
    [category, setCategory] = useState("All"),
    [selected, setSelected] = useState(CHARACTERS[0]!),
    [status, setStatus] = useState("Choose a character, then copy it");
  const items = findCharacters(query, category),
    columns = Math.max(1, Math.floor((props.width - 32) / (64 * ui))),
    cellW = (props.width - 32) / columns,
    gridH = Math.ceil(items.length / columns) * 60 * ui;
  const copy = async () => {
    try {
      await writeClipboardText(selected.glyph);
      setStatus(`Copied ${selected.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <OverlayHost width={props.width} height={props.height}>
      <Surface width={props.width} height={props.height} fill={pal.bg}>
        <Toolbar width={props.width} height={52}>
          <Label flexGrow={1} text="Characters" fontSize={20} fontWeight="medium" />
          <Button width={84 * ui} label="Copy" variant="primary" onPress={() => void copy()} />
        </Toolbar>
        <SearchField
          x={16}
          y={64}
          width={Math.max(1, props.width - 32)}
          value={query}
          onChange={setQuery}
          placeholder="Search name, symbol, or U+ code"
          autoFocus
        />
        <Select
          x={16}
          y={112}
          width={Math.max(1, props.width - 32)}
          value={category}
          viewportWidth={props.width}
          viewportHeight={props.height}
          options={["All", ...new Set(CHARACTERS.map((item) => item.category))].map((value) => ({
            id: value,
            label: value,
          }))}
          onChange={setCategory}
        />
        <Label
          x={16}
          y={166}
          width={Math.max(1, props.width - 32)}
          height={40}
          text={`${font?.supportsText(selected.glyph) ? selected.glyph : unicodeCode(selected.glyph)}   ${selected.name} · ${unicodeCode(selected.glyph)}`}
          fontSize={17}
          overflow="ellipsis"
          maxLines={1}
        />
        <ScrollArea
          x={16}
          y={214}
          width={Math.max(1, props.width - 32)}
          height={Math.max(1, props.height - 256)}
          contentHeight={Math.max(40, gridH)}
        >
          {items.length ? (
            items.map((item, index) => (
              <Button
                key={item.glyph}
                x={(index % columns) * cellW}
                y={Math.floor(index / columns) * 60 * ui}
                width={Math.max(1, cellW - 8 * ui)}
                height={50 * ui}
                label={
                  font?.supportsText(item.glyph, { weight: "medium" })
                    ? item.glyph
                    : unicodeCode(item.glyph)
                }
                fontSize={font?.supportsText(item.glyph, { weight: "medium" }) ? 24 : 10}
                variant={item.glyph === selected.glyph ? "primary" : "secondary"}
                onPress={() => {
                  setSelected(item);
                  setStatus(
                    `${item.name} · ${unicodeCode(item.glyph)}${font?.supportsText(item.glyph) ? "" : " · glyph unavailable in bundled font; Copy still copies the character"}`,
                  );
                }}
              />
            ))
          ) : (
            <Label
              y={16}
              width={props.width - 48}
              text="No characters match this search."
              color={pal.muted}
            />
          )}
        </ScrollArea>
        <StatusBar y={props.height - 30} width={props.width} height={30}>
          <Label text={status} color={pal.muted} fontSize={11} overflow="ellipsis" maxLines={1} />
        </StatusBar>
      </Surface>
    </OverlayHost>
  );
}
export async function main(): Promise<void> {
  const settings = loadSettings();
  setUiScaleFactor(settings.uiScale);
  const app = new Application();
  const win = new Window({
    title: "Characters",
    appId: "org.moire.Characters",
    width: Math.round(620 * settings.uiScale),
    height: Math.round(650 * settings.uiScale),
    resizable: true,
  });
  win.setContent((size) => <CharactersApp {...size} />);
  app.addWindow(win);
  await app.run();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch((error) => {
    console.error("[characters]", error);
    process.exitCode = 1;
  });
