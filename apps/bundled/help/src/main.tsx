import React, { useState, type ReactNode } from "react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Application,
  Window,
  Surface,
  Toolbar,
  Label,
  SearchField,
  NavigationSidebar,
  ScrollColumn,
  ContentCard,
  StatusBar,
  setUiScaleFactor,
  getUiScaleFactor,
  usePalette,
  type WindowSize,
} from "@moire/ui";
import { loadSettings } from "@moire/prefs";
import { HELP_TOPICS, searchHelp } from "./catalog";
export function HelpApp(props: WindowSize): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(HELP_TOPICS[0]!.id);
  const topics = searchHelp(query),
    topic = topics.find((item) => item.id === selected) ?? topics[0];
  const sideW = props.width < 620 ? 170 : 238,
    bodyX = sideW + 20,
    bodyW = Math.max(1, props.width - bodyX - 20);
  return (
    <Surface width={props.width} height={props.height} fill={pal.bg}>
      <Toolbar width={props.width} height={52}>
        <Label text="Moire Help" fontSize={20} fontWeight="medium" />
      </Toolbar>
      <SearchField
        x={16}
        y={64}
        width={Math.max(1, props.width - 32)}
        value={query}
        onChange={setQuery}
        autoFocus
        placeholder="Search help, an action, or a shortcut"
      />
      <NavigationSidebar
        y={112}
        width={sideW}
        height={Math.max(1, props.height - 142)}
        selectedId={topic?.id}
        sections={[
          {
            id: "topics",
            label: `${topics.length} topics`,
            items: topics.map((item) => ({
              id: item.id,
              label: item.title,
              subtitle: item.category,
            })),
          },
        ]}
        onSelect={(item) => setSelected(item.id)}
      />
      <ScrollColumn
        key={topic?.id ?? "empty"}
        x={bodyX}
        y={120}
        width={bodyW}
        height={Math.max(1, props.height - 162)}
        gap={12 * ui}
      >
        {topic ? (
          <>
            <Label text={topic.title} fontSize={22} fontWeight="medium" wrap />
            <Label text={topic.body} fontSize={14} wrap />
            {topic.shortcuts.map((shortcut) => (
              <ContentCard key={shortcut.keys} padding={12 * ui} gap={8 * ui}>
                <Label
                  text={shortcut.keys}
                  fontFamily="mono"
                  fontSize={13}
                  color={pal.accent}
                  wrap
                />
                <Label text={shortcut.action} fontSize={12} wrap />
              </ContentCard>
            ))}
          </>
        ) : (
          <Label
            text="No help topics match. Try an application name, action, or key combination."
            wrap
            fontSize={16}
            color={pal.muted}
          />
        )}
      </ScrollColumn>
      <StatusBar y={props.height - 30} width={props.width} height={30}>
        <Label
          text="Keyboard and workflow guide for the features available in Moire"
          fontSize={11}
          color={pal.muted}
          overflow="ellipsis"
          maxLines={1}
        />
      </StatusBar>
    </Surface>
  );
}
export async function main(): Promise<void> {
  const settings = loadSettings();
  setUiScaleFactor(settings.uiScale);
  const app = new Application();
  const win = new Window({
    title: "Moire Help",
    appId: "org.moire.Help",
    width: Math.round(820 * settings.uiScale),
    height: Math.round(660 * settings.uiScale),
    resizable: true,
  });
  win.setContent((size) => <HelpApp {...size} />);
  app.addWindow(win);
  await app.run();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch((error) => {
    console.error("[help]", error);
    process.exitCode = 1;
  });
