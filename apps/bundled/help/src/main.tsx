import React, { useState, type ReactNode } from "react";
import {
  EmptyState,
  Label,
  NavigationSidebar,
  Row,
  ScrollColumn,
  SearchField,
  Separator,
  Surface,
  Vertical,
  getUiScaleFactor,
  measureColumnContent,
  usePalette,
  useWidgetTheme,
  type NavigationSidebarSection,
  type WindowActions,
  type WindowSize,
} from "@moire/ui";
import { AppFrame, appFrameBody, runApp, startMain } from "@moire/app-tools";
import { HELP_TOPICS, searchHelp, type HelpTopic } from "./catalog";

/** Topics grouped under their category, in catalogue order. */
function topicSections(topics: readonly HelpTopic[]): NavigationSidebarSection[] {
  const sections = new Map<
    string,
    { id: string; label: string; items: { id: string; label: string }[] }
  >();
  for (const topic of topics) {
    let section = sections.get(topic.category);
    if (!section) {
      section = { id: topic.category, label: topic.category, items: [] };
      sections.set(topic.category, section);
    }
    // "Archive Manager: inspect and extract…" reads as just the app name in the list.
    section.items.push({ id: topic.id, label: topic.title.split(":")[0]! });
  }
  return [...sections.values()];
}

function ShortcutCard(props: { width: number; shortcuts: HelpTopic["shortcuts"] }): ReactNode {
  const theme = useWidgetTheme();
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const pad = 14 * ui;
  const inner = Math.max(1, props.width - pad * 2);
  const stacked = inner < 360 * ui;
  const keysW = stacked ? inner : Math.min(220 * ui, Math.round(inner * 0.38));
  const actionW = stacked ? inner : Math.max(1, inner - keysW - 12 * ui);
  const rows = props.shortcuts.map((shortcut, index) => {
    const keys = (
      <Label
        width={keysW}
        text={shortcut.keys}
        fontFamily="mono"
        fontSize={12}
        color={pal.accent}
        wrap
      />
    );
    const action = <Label width={actionW} text={shortcut.action} fontSize={13} wrap />;
    return (
      <Vertical key={shortcut.keys} width={inner} gap={0}>
        {index > 0 ? <Separator width={inner} color={pal.borderSubtle} /> : null}
        {stacked ? (
          <Vertical width={inner} padding={{ vertical: 10 * ui }} gap={4 * ui}>
            {keys}
            {action}
          </Vertical>
        ) : (
          <Row width={inner} padding={{ vertical: 10 * ui }} gap={12 * ui} align="start">
            {keys}
            {action}
          </Row>
        )}
      </Vertical>
    );
  });
  const height = measureColumnContent(
    {
      width: props.width,
      padding: { horizontal: pad, vertical: 4 * ui },
      gap: 0,
      children: rows,
    },
    theme,
  ).height;
  return (
    <Surface
      width={props.width}
      height={height}
      fill={pal.surface}
      radius={10 * ui}
      stroke={pal.borderSubtle}
      strokeWidth={1}
    >
      <Vertical
        width={props.width}
        height={height}
        padding={{ horizontal: pad, vertical: 4 * ui }}
        gap={0}
      >
        {rows}
      </Vertical>
    </Surface>
  );
}

function TopicArticle(props: WindowSize & { x: number; topic: HelpTopic }): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const pad = 24 * ui;
  const width = Math.max(1, Math.min(720 * ui, props.width - pad * 2));
  return (
    <ScrollColumn
      key={props.topic.id}
      x={props.x}
      width={props.width}
      height={props.height}
      padding={{ horizontal: pad, top: 20 * ui, bottom: pad }}
      gap={8 * ui}
    >
      <Label
        width={width}
        text={props.topic.category.toUpperCase()}
        fontSize={11}
        fontWeight="medium"
        color={pal.accent}
      />
      <Label width={width} text={props.topic.title} fontSize={20} fontWeight="medium" wrap />
      <Label width={width} text={props.topic.body} fontSize={13} color={pal.text} wrap />
      {props.topic.shortcuts.length ? (
        <>
          <Label
            width={width}
            height={32 * ui}
            text="Keyboard shortcuts"
            fontSize={12}
            fontWeight="medium"
            color={pal.muted}
            verticalAlign="end"
          />
          <ShortcutCard width={width} shortcuts={props.topic.shortcuts} />
        </>
      ) : null}
    </ScrollColumn>
  );
}

export function HelpApp(props: WindowSize & { window?: WindowActions | null }): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(HELP_TOPICS[0]!.id);
  const topics = searchHelp(query);
  const topic = topics.find((item) => item.id === selected) ?? topics[0];
  const body = appFrameBody({ height: props.height, title: "Help" });
  const sideW = Math.round(Math.min(300 * ui, Math.max(180 * ui, props.width * 0.3)));
  const searchW = Math.min(300 * ui, Math.max(140 * ui, props.width - 260 * ui));
  const count = `${topics.length} ${topics.length === 1 ? "topic" : "topics"}`;
  return (
    <AppFrame
      {...props}
      title="Help"
      icon="help"
      actions={
        <SearchField
          width={searchW}
          height={32 * ui}
          value={query}
          onChange={setQuery}
          onClear={() => setQuery("")}
          autoFocus
          placeholder="Search help or a shortcut"
        />
      }
      status={
        query.trim()
          ? `${count} match “${query.trim()}”`
          : "Keyboard and workflow guide for the features available in Moire"
      }
      statusEnd={query.trim() ? undefined : count}
    >
      <NavigationSidebar
        width={sideW}
        height={body.height}
        selectedId={topic?.id}
        labelCase="preserve"
        sections={topicSections(topics)}
        onSelect={(item) => setSelected(item.id)}
      />
      <Separator x={sideW} width={1} height={body.height} color={pal.borderSubtle} />
      {topic ? (
        <TopicArticle
          x={sideW + 1}
          width={Math.max(1, props.width - sideW - 1)}
          height={body.height}
          topic={topic}
        />
      ) : (
        <EmptyState
          x={sideW + 1}
          width={Math.max(1, props.width - sideW - 1)}
          height={body.height}
          icon="search"
          title="No matching topics"
          message="Try an application name, an action, or a key combination."
        />
      )}
    </AppFrame>
  );
}

startMain(import.meta.url, () =>
  runApp("Moire Help", "org.moire.Help", (size, window) => <HelpApp {...size} window={window} />, {
    width: 820,
    height: 660,
  }),
);
