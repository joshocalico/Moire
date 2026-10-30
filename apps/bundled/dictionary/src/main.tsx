import React, { useEffect, useRef, useState, type ReactNode } from "react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Application,
  Window,
  Surface,
  SearchField,
  Button,
  EmptyState,
  Label,
  ScrollColumn,
  ContentCard,
  setUiScaleFactor,
  getUiScaleFactor,
  getFontEngine,
  usePalette,
  type WindowActions,
  type WindowSize,
  APP_HEADER_HEIGHT,
  APP_STATUS_HEIGHT,
  AppHeaderBar,
  AppStatusLine,
} from "@moire/ui";
import { loadSettings } from "@moire/prefs";
import { DictionaryService, type Definition, type DictionaryEntry } from "./dictionary";

type State =
  | { kind: "empty" }
  | { kind: "loading" }
  | { kind: "entry"; entry: DictionaryEntry }
  | { kind: "error"; message: string };

export type DictionaryProps = WindowSize & {
  service: DictionaryService;
  /** The window the header bar controls (minimize, maximize, close, move). */
  window?: WindowActions | null;
};

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
  const pad = 16 * ui;
  const toolY = APP_HEADER_HEIGHT * ui + 12 * ui;
  const buttonW = 96 * ui;
  const bodyY = toolY + 36 * ui + 12 * ui;
  const bodyH = Math.max(1, props.height - bodyY - APP_STATUS_HEIGHT * ui);
  // Definitions read best at a moderate measure, so very wide windows centre the column.
  const columnW = Math.min(props.width - pad * 2, 720 * ui);
  return (
    <Surface width={props.width} height={props.height} fill={pal.bg}>
      <AppHeaderBar
        width={props.width}
        title="Dictionary"
        icon="dictionary"
        subtitle={state.kind === "entry" ? state.entry.word : undefined}
        window={props.window}
      />
      <SearchField
        x={pad}
        y={toolY}
        width={Math.max(1, props.width - pad * 2 - buttonW - 8 * ui)}
        height={36 * ui}
        value={query}
        onChange={setQuery}
        onSubmit={() => void lookup()}
        autoFocus
        placeholder="English word or phrase"
      />
      <Button
        x={props.width - pad - buttonW}
        y={toolY}
        width={buttonW}
        height={36 * ui}
        label="Look up"
        variant="primary"
        disabled={!query.trim() || state.kind === "loading"}
        onPress={() => void lookup()}
      />
      {state.kind === "entry" ? (
        <ScrollColumn
          key={`entry:${state.entry.word}`}
          x={(props.width - columnW) / 2}
          y={bodyY}
          width={columnW}
          height={bodyH}
          gap={10 * ui}
          padding={{ top: 16 * ui, bottom: 16 * ui }}
          fill={0x00000000}
        >
          <Label text={state.entry.word} fontSize={34} fontFamily="display" wrap />
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
            fontSize={13}
          />
          {groupBySense(state.entry.definitions).map(([partOfSpeech, definitions]) => (
            <ContentCard
              key={partOfSpeech || "other"}
              padding={14 * ui}
              gap={10 * ui}
              radius={12 * ui}
            >
              <Label
                text={(partOfSpeech || "Definition").toLocaleUpperCase()}
                color={pal.accent}
                fontSize={11}
                fontWeight="medium"
              />
              {definitions.flatMap((definition, index) => [
                <Label
                  key={`d${index}`}
                  text={
                    definitions.length > 1
                      ? `${index + 1}.  ${definition.definition}`
                      : definition.definition
                  }
                  wrap
                  fontSize={14}
                />,
                ...(definition.example
                  ? [
                      <Label
                        key={`e${index}`}
                        text={`“${definition.example}”`}
                        wrap
                        fontSize={13}
                        color={pal.muted}
                      />,
                    ]
                  : []),
              ])}
            </ContentCard>
          ))}
        </ScrollColumn>
      ) : (
        <EmptyState y={bodyY} width={props.width} height={bodyH} {...emptyContent(state)} />
      )}
      <AppStatusLine
        y={props.height - APP_STATUS_HEIGHT * ui}
        width={props.width}
        status={status}
      />
    </Surface>
  );
}

/** Definitions grouped by part of speech, in the order the dictionary gave them. */
function groupBySense(definitions: readonly Definition[]): Array<[string, Definition[]]> {
  const groups = new Map<string, Definition[]>();
  for (const definition of definitions) {
    const group = groups.get(definition.partOfSpeech) ?? [];
    group.push(definition);
    groups.set(definition.partOfSpeech, group);
  }
  return [...groups];
}

function emptyContent(state: Exclude<State, { kind: "entry" }>) {
  if (state.kind === "loading")
    return {
      icon: "search",
      title: "Looking up…",
      message: "Checking saved words first.",
    } as const;
  if (state.kind === "error")
    return state.message.startsWith("No definition found")
      ? ({
          icon: "search",
          title: "No definition found",
          message: "Check the spelling, or try the simplest form of the word.",
        } as const)
      : ({ icon: "dictionary", title: "Couldn’t look that up", message: state.message } as const);
  return {
    icon: "dictionary",
    title: "Look up a word",
    message:
      "Definitions, pronunciation and examples. Words you have looked up stay available offline.",
  } as const;
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
    decorated: false,
  });
  const service = new DictionaryService();
  win.setContent((size) => <DictionaryApp {...size} window={win} service={service} />);
  app.addWindow(win);
  await app.run();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch((error) => {
    console.error("[dictionary]", error);
    process.exitCode = 1;
  });
