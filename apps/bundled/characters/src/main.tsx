import React, { useEffect, useState, type ReactNode } from "react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Application,
  Window,
  Surface,
  OverlayHost,
  SearchField,
  Select,
  Button,
  EmptyState,
  Pressable,
  ScrollArea,
  TextBlock,
  writeClipboardText,
  setUiScaleFactor,
  getUiScaleFactor,
  getFontEngine,
  type FontEngine,
  usePalette,
  type WindowActions,
  type WindowSize,
  APP_HEADER_HEIGHT,
  APP_STATUS_HEIGHT,
  AppHeaderBar,
  AppStatusLine,
} from "@moire/ui";
import { loadSettings } from "@moire/prefs";
import { CHARACTERS, findCharacters, unicodeCode, type Character } from "./catalog";

const CATEGORIES = ["All", ...new Set(CHARACTERS.map((item) => item.category))].map((value) => ({
  id: value,
  label: value,
}));

/** A translucent wash of a color. */
const tint = (color: number, alpha: number) => (color & 0x00ffffff) | (alpha << 24);

export function CharactersApp(props: WindowSize & { window?: WindowActions | null }): ReactNode {
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
  const supports = (glyph: string) => !!font?.supportsText(glyph, { weight: "medium" });
  const copy = async () => {
    try {
      await writeClipboardText(selected.glyph);
      setStatus(`Copied ${selected.name}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const choose = (item: Character) => {
    setSelected(item);
    setStatus(
      `${item.name} · ${unicodeCode(item.glyph)}${supports(item.glyph) ? "" : " · glyph unavailable in bundled font; Copy still copies the character"}`,
    );
  };

  const items = findCharacters(query, category);
  const pad = 16 * ui,
    gap = 8 * ui;
  const innerW = Math.max(1, props.width - pad * 2);
  const toolY = APP_HEADER_HEIGHT * ui + 12 * ui;
  const selectW = Math.min(180 * ui, innerW * 0.4);
  const detailY = toolY + 36 * ui + 12 * ui;
  const detailH = 84 * ui;
  const gridY = detailY + detailH + 12 * ui;
  const gridH = Math.max(1, props.height - gridY - APP_STATUS_HEIGHT * ui - 8 * ui);
  const columns = Math.max(1, Math.floor((innerW + gap) / (60 * ui + gap)));
  const cellW = (innerW - gap * (columns - 1)) / columns;
  const cellH = 52 * ui;
  return (
    <OverlayHost width={props.width} height={props.height}>
      <Surface width={props.width} height={props.height} fill={pal.bg}>
        <AppHeaderBar
          width={props.width}
          title="Characters"
          icon="characters"
          window={props.window}
          actions={
            <Button
              width={84 * ui}
              height={32 * ui}
              label="Copy"
              variant="primary"
              onPress={() => void copy()}
            />
          }
        />
        <SearchField
          x={pad}
          y={toolY}
          width={innerW - selectW - gap}
          height={36 * ui}
          value={query}
          onChange={setQuery}
          placeholder="Search name, symbol, or U+ code"
          autoFocus
        />
        <Select
          x={pad + innerW - selectW}
          y={toolY}
          width={selectW}
          height={36 * ui}
          value={category}
          viewportWidth={props.width}
          viewportHeight={props.height}
          options={CATEGORIES}
          onChange={setCategory}
        />
        <CharacterDetail
          x={pad}
          y={detailY}
          width={innerW}
          height={detailH}
          character={selected}
          renderable={supports(selected.glyph)}
        />
        {items.length ? (
          <ScrollArea
            x={pad}
            y={gridY}
            width={innerW + 12 * ui}
            height={gridH}
            contentHeight={Math.ceil(items.length / columns) * (cellH + gap)}
            fill={0x00000000}
          >
            {items.map((item, index) => {
              const active = item.glyph === selected.glyph;
              const renderable = supports(item.glyph);
              return (
                <Pressable
                  key={item.glyph}
                  x={(index % columns) * (cellW + gap)}
                  y={Math.floor(index / columns) * (cellH + gap)}
                  width={cellW}
                  height={cellH}
                  radius={10 * ui}
                  fill={active ? tint(pal.accent, 0x30) : pal.surface}
                  stroke={active ? pal.accent : undefined}
                  strokeWidth={active ? 2 : undefined}
                  onPress={() => choose(item)}
                >
                  <TextBlock
                    width={cellW}
                    height={cellH}
                    text={renderable ? item.glyph : unicodeCode(item.glyph)}
                    color={renderable ? pal.text : pal.muted}
                    fontSize={renderable ? 22 : 9}
                    fontWeight="medium"
                    horizontalAlign="center"
                    verticalAlign="center"
                    maxLines={1}
                    overflow="ellipsis"
                  />
                </Pressable>
              );
            })}
          </ScrollArea>
        ) : (
          <EmptyState
            y={gridY}
            width={props.width}
            height={gridH}
            icon="search"
            title="No characters found"
            message="Try another name, a symbol, or a code such as U+00A9."
          />
        )}
        <AppStatusLine
          y={props.height - APP_STATUS_HEIGHT * ui}
          width={props.width}
          status={status}
          end={`${items.length} of ${CHARACTERS.length}`}
        />
      </Surface>
    </OverlayHost>
  );
}

/** The selected character, large, with its name and code point. */
function CharacterDetail(props: {
  x: number;
  y: number;
  width: number;
  height: number;
  character: Character;
  renderable: boolean;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const tile = props.height - 20 * ui;
  const textX = 10 * ui + tile + 14 * ui;
  const textW = Math.max(1, props.width - textX - 14 * ui);
  return (
    <Surface
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      fill={pal.surface}
      radius={12 * ui}
      stroke={pal.borderSubtle}
      strokeWidth={1}
    >
      <Surface
        x={10 * ui}
        y={10 * ui}
        width={tile}
        height={tile}
        radius={10 * ui}
        fill={tint(pal.accent, 0x26)}
      >
        <TextBlock
          width={tile}
          height={tile}
          text={props.renderable ? props.character.glyph : "?"}
          color={props.renderable ? pal.text : pal.muted}
          fontSize={34}
          horizontalAlign="center"
          verticalAlign="center"
          maxLines={1}
        />
      </Surface>
      <TextBlock
        x={textX}
        y={props.height / 2 - 22 * ui}
        width={textW}
        height={22 * ui}
        text={props.character.name}
        fontSize={15}
        fontWeight="medium"
        maxLines={1}
        overflow="ellipsis"
      />
      <TextBlock
        x={textX}
        y={props.height / 2 + 2 * ui}
        width={textW}
        height={18 * ui}
        text={`${unicodeCode(props.character.glyph)} · ${props.character.category}`}
        color={pal.muted}
        fontSize={12}
        maxLines={1}
        overflow="ellipsis"
      />
    </Surface>
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
    decorated: false,
  });
  win.setContent((size) => <CharactersApp {...size} window={win} />);
  app.addWindow(win);
  await app.run();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch((error) => {
    console.error("[characters]", error);
    process.exitCode = 1;
  });
