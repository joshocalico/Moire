import React, { useState, type ReactNode } from "react";
import {
  Application,
  Window,
  Surface,
  Toolbar,
  Label,
  Button,
  IconButton,
  TextField,
  SearchField,
  Checkbox,
  Toggle,
  Slider,
  ProgressBar,
  List,
  ListItem,
  Icon,
  NavigationSidebar,
  SegmentedControl,
  RadioGroup,
  Badge,
  Banner,
  Spinner,
  EmptyState,
  Tabs,
  CodeView,
  Row,
  Column,
  Separator,
  ScrollArea,
  themePalette,
  setUiScaleFactor,
  type NavigationSidebarSection,
  type WindowSize,
} from "@moire/ui";
import { loadSettings } from "@moire/prefs";

type Sample = {
  id: string;
  title: string;
  description: string;
  section: string;
  code: string;
};

const SAMPLES: Sample[] = [
  {
    id: "buttons",
    title: "Buttons",
    description: "Variants, icon actions, and disabled state",
    section: "Controls",
    code: `function ButtonSample() {
  return (
    <Row width={640} height={44} gap={12}>
      <Button label="Continue" variant="primary" />
      <Button label="Secondary" variant="secondary" />
      <Button label="Quiet" variant="ghost" />
      <IconButton icon={<Icon name="search" />} />
    </Row>
  );
}`,
  },
  {
    id: "inputs",
    title: "Inputs",
    description: "Editable fields, toggles, and range controls",
    section: "Controls",
    code: `function InputSample() {
  const [query, setQuery] = useState("");
  const [enabled, setEnabled] = useState(true);
  return (
    <Column width={640} gap={12}>
      <SearchField value={query} onChange={setQuery} />
      <Toggle on={enabled} onChange={setEnabled} label="Live preview" />
      <Slider value={0.62} onChange={setLevel} />
    </Column>
  );
}`,
  },
  {
    id: "choice",
    title: "Choice controls",
    description: "Segmented and radio selection",
    section: "Controls",
    code: `const density = [
  { id: "comfortable", label: "Comfortable" },
  { id: "compact", label: "Compact" },
];

<SegmentedControl options={density} value={value} onChange={setValue} />
<RadioGroup options={themes} value={theme} onChange={setTheme} />`,
  },
  {
    id: "list",
    title: "List",
    description: "Scrollable collection rows with artwork and selection",
    section: "Collections",
    code: `<List
  width={640}
  height={280}
  items={projects}
  selectedIndex={selected}
  onSelect={setSelected}
  renderItem={(project, index, active) => (
    <ListItem
      title={project.name}
      subtitle={project.status}
      selected={active}
      leading={<Icon name="folder" />}
    />
  )}
/>`,
  },
  {
    id: "navigation",
    title: "Navigation sidebar",
    description: "Configurable sections and editable rows",
    section: "Collections",
    code: `<NavigationSidebar
  width={260}
  height={420}
  sections={sections}
  selectedId={selected}
  editing={editing}
  onSelect={(item) => setSelected(item.id)}
  onMove={moveFavorite}
  onRemove={removeFavorite}
/>`,
  },
  {
    id: "feedback",
    title: "Feedback",
    description: "Status, progress, banners, and empty states",
    section: "Feedback",
    code: `<Banner
  title="Theme updated"
  message="All native surfaces use the new recipe."
  tone="success"
/>
<Row width={640} gap={12}>
  <Spinner />
  <ProgressBar width={280} value={0.68} />
  <Badge text="Live" tone="accent" />
</Row>`,
  },
  {
    id: "code",
    title: "Code view",
    description: "Scrollable syntax-highlighted TSX",
    section: "Content",
    code: `<CodeView
  width={720}
  height={420}
  language="tsx"
  code={sample.source}
  lineNumbers
/>`,
  },
];

const SECTIONS: NavigationSidebarSection[] = [
  ...new Set(SAMPLES.map((sample) => sample.section)),
].map((section) => ({
  id: section.toLowerCase(),
  label: section,
  items: SAMPLES.filter((sample) => sample.section === section).map((sample) => ({
    id: sample.id,
    label: sample.title,
    subtitle: sample.description,
    icon:
      sample.section === "Controls"
        ? "app"
        : sample.section === "Collections"
          ? "list"
          : sample.section === "Feedback"
            ? "image"
            : "file",
  })),
}));

function Preview(props: { sample: Sample; width: number; height: number }): ReactNode {
  const pal = themePalette();
  const [text, setText] = useState("Taste is a feature");
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [level, setLevel] = useState(0.62);
  const [choice, setChoice] = useState("comfortable");
  const [radio, setRadio] = useState("system");
  const [selected, setSelected] = useState(1);
  const [navSelected, setNavSelected] = useState("desktop");
  const contentW = Math.max(280, props.width - 64);

  let content: ReactNode;
  if (props.sample.id === "buttons") {
    content = (
      <Column width={contentW} gap={16}>
        <Row width={contentW} height={40} gap={12}>
          <Button width={112} height={36} label="Continue" variant="primary" />
          <Button width={112} height={36} label="Secondary" variant="secondary" />
          <Button width={82} height={36} label="Quiet" variant="ghost" />
          <Button width={92} height={36} label="Delete" variant="danger" />
        </Row>
        <Row width={contentW} height={40} gap={10}>
          <IconButton icon={<Icon name="search" />} />
          <IconButton icon={<Icon name="grid" />} variant="ghost" />
          <IconButton icon={<Icon name="trash" />} variant="danger" />
          <Button width={120} height={36} label="Unavailable" disabled />
        </Row>
      </Column>
    );
  } else if (props.sample.id === "inputs") {
    content = (
      <Column width={contentW} gap={14}>
        <TextField width={Math.min(420, contentW)} value={text} onChange={setText} />
        <SearchField width={Math.min(420, contentW)} value={query} onChange={setQuery} placeholder="Filter widgets…" />
        <Checkbox width={260} checked={checked} onChange={setChecked} label="Show focus rings" />
        <Toggle width={260} on={enabled} onChange={setEnabled} label="Live preview" />
        <Slider width={Math.min(420, contentW)} value={level} onChange={setLevel} />
        <ProgressBar width={Math.min(420, contentW)} value={level} />
      </Column>
    );
  } else if (props.sample.id === "choice") {
    content = (
      <Column width={contentW} gap={20}>
        <SegmentedControl width={Math.min(440, contentW)} options={[{ id: "comfortable", label: "Comfortable" }, { id: "compact", label: "Compact" }, { id: "touch", label: "Touch" }]} value={choice} onChange={setChoice} />
        <RadioGroup width={Math.min(440, contentW)} options={[{ id: "system", label: "System", description: "Follow the desktop appearance" }, { id: "dark", label: "Dark", description: "Always use dark recipes" }, { id: "contrast", label: "High contrast", description: "Increase boundaries and focus" }]} value={radio} onChange={setRadio} />
      </Column>
    );
  } else if (props.sample.id === "list") {
    const rows = ["Window effects", "Terminal emulator", "Widget showcase", "File operations", "Desktop React migration"];
    content = (
      <List
        width={Math.min(560, contentW)}
        height={Math.min(320, props.height - 100)}
        items={rows}
        selectedIndex={selected}
        onSelect={setSelected}
        renderItem={(item, index, active) => (
          <ListItem
            width={Math.min(560, contentW)}
            title={item}
            subtitle={index < 3 ? "In progress" : "Queued"}
            selected={active}
            leading={<Icon name={index === 1 ? "app" : "folder"} size={22} color={active ? pal.accent : pal.text} />}
            onPress={() => setSelected(index)}
          />
        )}
      />
    );
  } else if (props.sample.id === "navigation") {
    content = (
      <NavigationSidebar
        width={Math.min(300, contentW)}
        height={Math.min(390, props.height - 80)}
        sections={[{ id: "favorites", label: "Favorites", items: [{ id: "home", label: "Home", icon: "home" }, { id: "desktop", label: "Desktop", icon: "desktop" }, { id: "downloads", label: "Downloads", icon: "downloads" }] }, { id: "locations", label: "Locations", items: [{ id: "projects", label: "Projects", icon: "folder", removable: true }, { id: "shared", label: "Shared", icon: "folder", removable: true }] }]}
        selectedId={navSelected}
        onSelect={(item) => setNavSelected(item.id)}
      />
    );
  } else if (props.sample.id === "feedback") {
    content = (
      <Column width={contentW} gap={16}>
        <Banner width={Math.min(620, contentW)} title="Theme updated" message="All native surfaces are using the current recipe." tone="success" icon="app" />
        <Row width={contentW} height={34} gap={16}>
          <Spinner size={26} />
          <Badge text="Live" tone="accent" />
          <Badge text="Experimental" tone="warning" />
          <Badge text="3 issues" tone="danger" />
        </Row>
        <EmptyState width={Math.min(620, contentW)} height={210} icon="folder" title="Nothing here yet" message="Drop a file or create a new project." action={<Button width={140} height={34} label="New Project" variant="primary" />} />
      </Column>
    );
  } else {
    content = <CodeView width={Math.min(700, contentW)} height={Math.min(420, props.height - 70)} code={props.sample.code} language="tsx" />;
  }

  return (
    <ScrollArea width={props.width} height={props.height} contentHeight={Math.max(props.height, 520)}>
      <Column x={32} y={28} width={contentW} gap={18}>
        <Label text={props.sample.title} fontSize={20} fontWeight="bold" width={contentW} height={28} />
        <Label text={props.sample.description} color={pal.muted} fontSize={12} width={contentW} height={22} />
        <Separator width={contentW} />
        {content}
      </Column>
    </ScrollArea>
  );
}

function ShowcaseApp(props: WindowSize): ReactNode {
  const pal = themePalette();
  const [selectedId, setSelectedId] = useState(SAMPLES[0]!.id);
  const [tab, setTab] = useState(0);
  const sample = SAMPLES.find((entry) => entry.id === selectedId) ?? SAMPLES[0]!;
  const sideW = Math.min(300, Math.max(220, Math.round(props.width * 0.27)));
  const mainW = Math.max(1, props.width - sideW - 1);
  const toolbarH = 54;
  const tabsH = 36;
  const bodyH = Math.max(1, props.height - toolbarH - tabsH - 2);
  return (
    <Surface width={props.width} height={props.height} fill={pal.bg}>
      <NavigationSidebar
        width={sideW}
        height={props.height}
        sections={SECTIONS}
        selectedId={selectedId}
        onSelect={(item) => {
          setSelectedId(item.id);
          setTab(0);
        }}
        header={<Label text="WIDGETS" color={pal.accent} fontSize={11} fontWeight="medium" width={sideW - 32} height={24} />}
      />
      <Separator x={sideW} width={1} height={props.height} />
      <Toolbar x={sideW + 1} width={mainW} height={toolbarH}>
        <Label text="Moire Widget Showcase" fontSize={16} fontWeight="medium" width={mainW - 150} height={24} />
        <Surface width={62} height={24} fill={0x00000000}>
          <Badge text="LIVE" tone="accent" />
        </Surface>
      </Toolbar>
      <Tabs x={sideW + 1} y={toolbarH} width={mainW} height={tabsH} tabs={["Preview", "Code"]} active={tab} onChange={setTab} />
      <Surface x={sideW + 1} y={toolbarH + tabsH + 1} width={mainW} height={bodyH} fill={pal.bg}>
        {tab === 0 ? (
          <Preview sample={sample} width={mainW} height={bodyH} />
        ) : (
          <CodeView x={24} y={20} width={Math.max(1, mainW - 48)} height={Math.max(1, bodyH - 40)} code={sample.code} language="tsx" lineNumbers />
        )}
      </Surface>
    </Surface>
  );
}

async function main(): Promise<void> {
  const settings = loadSettings();
  setUiScaleFactor(settings.uiScale);
  const app = new Application();
  const win = new Window({
    title: "Widget Showcase",
    appId: "org.moire.Showcase",
    width: Math.round(1040 * settings.uiScale),
    height: Math.round(700 * settings.uiScale),
    resizable: true,
  });
  win.setContent((size) => <ShowcaseApp {...size} />);
  win.onClose(() => app.quit());
  app.addWindow(win);
  await app.run();
}

main().catch((error: unknown) => {
  console.error("[showcase] fatal:", error);
  process.exit(1);
});
