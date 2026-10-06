import React, { useEffect, useRef, useState, type ReactNode } from "react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Application,
  Window,
  Surface,
  Toolbar,
  SearchField,
  Button,
  Label,
  ScrollColumn,
  ContentCard,
  StatusBar,
  setUiScaleFactor,
  getUiScaleFactor,
  getFontEngine,
  usePalette,
  type WindowSize,
} from "@moire/ui";
import { loadSettings } from "@moire/prefs";
import { DictionaryService, type DictionaryEntry } from "./dictionary";
type State =
  | { kind: "empty" }
  | { kind: "loading" }
  | { kind: "entry"; entry: DictionaryEntry }
  | { kind: "error"; message: string };
export type DictionaryProps = WindowSize & { service: DictionaryService };
export function DictionaryApp(props: DictionaryProps): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const [font] = useState(() => getFontEngine());
  const [phoneticSupported, setPhoneticSupported] = useState(false);
  const [query, setQuery] = useState(""),
    [state, setState] = useState<State>({ kind: "empty" }),
    [status, setStatus] = useState("English definitions · saved words work offline");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const lookup = async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setState({ kind: "loading" });
    setStatus("Looking up word…");
    try {
      const [result, engine] = await Promise.all([
        props.service.lookup(query, controller.signal),
        font,
      ]);
      if (request.current !== controller || controller.signal.aborted) return;
      setState({ kind: "entry", entry: result.entry });
      setPhoneticSupported(engine.supportsText(result.entry.phonetic));
      setStatus(
        result.source === "cache"
          ? "Saved definition · offline ready"
          : result.cached
            ? "Free Dictionary API · saved for offline use"
            : "Free Dictionary API · local cache unavailable",
      );
    } catch (error) {
      if (request.current !== controller || controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      setState({ kind: "error", message });
      setStatus(message);
    }
  };
  const bodyW = Math.max(1, props.width - 48);
  return (
    <Surface width={props.width} height={props.height} fill={pal.bg}>
      <Toolbar width={props.width} height={52}>
        <Label flexGrow={1} text="Dictionary" fontSize={20} fontWeight="medium" />
        <Button width={82 * ui} label="Look up" onPress={() => void lookup()} />
      </Toolbar>
      <SearchField
        x={16}
        y={64}
        width={Math.max(1, props.width - 32)}
        value={query}
        onChange={setQuery}
        onSubmit={() => void lookup()}
        autoFocus
        placeholder="English word or phrase"
      />
      <ScrollColumn
        key={state.kind === "entry" ? `entry:${state.entry.word}` : state.kind}
        x={24}
        y={116}
        width={bodyW}
        height={Math.max(1, props.height - 158)}
        gap={12 * ui}
      >
        {state.kind === "entry" ? (
          <>
            <Label text={state.entry.word} fontSize={26} fontWeight="medium" wrap />
            <Label
              wrap
              text={
                state.entry.phonetic
                  ? phoneticSupported
                    ? state.entry.phonetic
                    : "Pronunciation symbols unavailable in the bundled font"
                  : "Pronunciation not supplied"
              }
              color={pal.muted}
              fontSize={14}
            />
            {state.entry.definitions.map((definition, index) => (
              <ContentCard key={`definition:${index}`} padding={12 * ui} gap={8 * ui}>
                {definition.partOfSpeech && (
                  <Label
                    text={definition.partOfSpeech.toLocaleUpperCase()}
                    color={pal.accent}
                    fontSize={11}
                    wrap
                  />
                )}
                <Label text={definition.definition} wrap fontSize={14} />
                {definition.example && (
                  <Label text={`“${definition.example}”`} wrap fontSize={14} color={pal.muted} />
                )}
              </ContentCard>
            ))}
          </>
        ) : (
          <Label
            wrap
            color={state.kind === "error" ? pal.danger : pal.muted}
            fontSize={16}
            text={
              state.kind === "loading"
                ? "Looking up…"
                : state.kind === "error"
                  ? state.message
                  : "Find definitions, pronunciation, and examples. New lookups use the free Dictionary API. Previously opened words are kept on this computer."
            }
          />
        )}
      </ScrollColumn>
      <StatusBar y={props.height - 30} width={props.width} height={30}>
        <Label text={status} color={pal.muted} fontSize={11} overflow="ellipsis" maxLines={1} />
      </StatusBar>
    </Surface>
  );
}
export async function main(): Promise<void> {
  const settings = loadSettings();
  setUiScaleFactor(settings.uiScale);
  const app = new Application();
  const win = new Window({
    title: "Dictionary",
    appId: "org.moire.Dictionary",
    width: Math.round(700 * settings.uiScale),
    height: Math.round(650 * settings.uiScale),
    resizable: true,
  });
  const service = new DictionaryService();
  win.setContent((size) => <DictionaryApp {...size} service={service} />);
  app.addWindow(win);
  await app.run();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch((error) => {
    console.error("[dictionary]", error);
    process.exitCode = 1;
  });
