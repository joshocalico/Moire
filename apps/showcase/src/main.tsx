import React, { useMemo, useState, type ReactNode } from "react";
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
  VirtualList,
  Table,
  TreeView,
  Icon,
  NavigationSidebar,
  SegmentedControl,
  RadioGroup,
  Select,
  ComboBox,
  Badge,
  Banner,
  Spinner,
  EmptyState,
  Tabs,
  CodeView,
  LineChart,
  AreaChart,
  BarChart,
  StackedBarChart,
  ScatterChart,
  Sparkline,
  DonutChart,
  RadialChart,
  HeatmapChart,
  TerminalView,
  Tooltip,
  Disclosure,
  ProgressRow,
  SplitView,
  Pagination,
  PropertyList,
  Horizontal,
  Vertical,
  Stack,
  Inset,
  Spacer,
  TextBlock,
  Measure,
  Tween,
  FocusScope,
  ShortcutManager,
  OverlayHost,
  Sheet,
  ConfirmationDialog,
  ToastHost,
  Box,
  Row,
  Column,
  Separator,
  ScrollArea,
  themePalette,
  setUiScaleFactor,
  type NavigationSidebarSection,
  type TableSort,
  type ToastItem,
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
      <IconButton width={36} height={36} icon={<Icon name="search" />} />
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
    id: "select-combo",
    title: "Select and combo box",
    description: "Anchored selection and editable filtering",
    section: "Controls",
    code: `<OverlayHost width={window.width} height={window.height}>
  <Select
    width={320}
    viewportWidth={window.width}
    viewportHeight={window.height}
    options={densityOptions}
    value={density}
    onChange={setDensity}
  />
  <ComboBox
    width={320}
    viewportWidth={window.width}
    viewportHeight={window.height}
    options={applicationOptions}
    value={query}
    onValueChange={setQuery}
    onSelect={setApplication}
  />
</OverlayHost>`,
  },
  {
    id: "focus-shortcuts",
    title: "Focus and shortcuts",
    description: "Scoped traversal, Escape handling, and declarative commands",
    section: "Controls",
    code: `<ShortcutManager shortcuts={[
  { id: "search", key: "k", platformModifier: true, onInvoke: openSearch },
]}>
  <FocusScope width={420} height={160} trap onEscape={closePanel}>
    <Column gap={10}>
      <Button width={140} label="First" autoFocus />
      <Button width={140} label="Second" />
    </Column>
  </FocusScope>
</ShortcutManager>`,
  },
  {
    id: "split-view",
    title: "Split view",
    description: "Resizable, keyboard-accessible pane composition",
    section: "Layout",
    code: `<SplitView
  width={760}
  height={420}
  firstSize={sidebarWidth}
  onFirstSizeChange={setSidebarWidth}
  minFirst={180}
  minSecond={280}
  first={<Inspector />}
  second={<Canvas />}
/>`,
  },
  {
    id: "layout-motion",
    title: "Layout and motion",
    description: "Measured flow, consistent insets, overlays, and duration-based tweening",
    section: "Layout",
    code: `<Vertical width={720} height={360} gap={12}>
  <Horizontal flexGrow={1} gap={12}>
    <Inset width={200} padding={16}>
      <Vertical gap={6}>
        <TextBlock text="Inspector" fontWeight="medium" />
        <TextBlock text="Allocated by its parent" color={muted} />
        <Spacer />
        <Button label="Details" />
      </Vertical>
    </Inset>
    <Measure flexGrow={1}>{({ width, height }) => (
      <Stack width={width} height={height} alignX="center" alignY="center">
        <Canvas width={width} height={height} />
        <Tween value={open ? 1 : 0} duration={240} easing="ease-out">
          {(progress) => <PreviewCard x={(1 - progress) * 36} />}
        </Tween>
      </Stack>
    )}</Measure>
  </Horizontal>
</Vertical>`,
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
    id: "virtual-list",
    title: "Virtual list",
    description: "Ten thousand rows with bounded scene cost",
    section: "Collections",
    code: `<VirtualList
  width={640}
  height={360}
  items={tenThousandRows}
  itemHeight={34}
  getKey={(row) => row.id}
  renderItem={(row) => <ResultRow row={row} />}
  overscan={3}
/>`,
  },
  {
    id: "table",
    title: "Table",
    description: "Virtualized rows and controlled sortable headers",
    section: "Collections",
    code: `<Table
  width={720}
  height={420}
  columns={columns}
  rows={files}
  getRowKey={(file) => file.id}
  selectedKey={selected}
  onSelect={(file) => setSelected(file.id)}
  sort={sort}
  onSortChange={setSort}
  striped
/>`,
  },
  {
    id: "charts",
    title: "Charts",
    description: "Interactive Cartesian, categorical, radial, and density visualizations",
    section: "Data",
    code: `const activity = [{
  id: "cpu",
  label: "CPU",
  points: samples.map((value, index) => ({ x: index, y: value })),
}];

<LineChart
  width={720}
  height={260}
  series={activity}
  showAxes
  showGrid
  showLegend
  formatValue={(value) => \`${"${value.toFixed(1)}"}%\`}
  onHover={(point) => setInspector(point)}
/>

<StackedBarChart width={720} height={260} series={workloads} />
<DonutChart width={360} height={220} data={memoryKinds} />
<HeatmapChart width={360} height={220} cells={frameDensity} />`,
  },
  {
    id: "tree",
    title: "Tree view",
    description: "Expandable hierarchy with keyed selection",
    section: "Collections",
    code: `<TreeView
  width={420}
  height={420}
  nodes={workspace}
  expandedIds={expanded}
  onExpandedChange={setExpanded}
  selectedId={selected}
  onSelect={(node) => setSelected(node.id)}
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
    id: "property-list",
    title: "Property list",
    description: "Sectioned metadata and inspector controls",
    section: "Collections",
    code: `<PropertyList
  width={560}
  height={380}
  selectedId={selectedProperty}
  onSelect={(item) => setSelectedProperty(item.id)}
  sections={[{
    id: "file",
    label: "File",
    items: [
      { id: "name", label: "Name", value: file.name },
      { id: "kind", label: "Kind", value: file.mimeType },
    ],
  }]}
/>`,
  },
  {
    id: "pagination",
    title: "Pagination",
    description: "Compact navigation across large result sets",
    section: "Collections",
    code: `<Pagination
  page={page}
  pageCount={42}
  onPageChange={setPage}
  siblingCount={1}
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
    id: "progress-row",
    title: "Progress rows",
    description: "Determinate and indeterminate task feedback",
    section: "Feedback",
    code: `<Column width={640} gap={14}>
  <Box width={640} height={78}>
    <ProgressRow
      width={640}
      title="Copying project assets"
      detail="24 of 80 files"
      value={0.3}
      status="30%"
      action={<Button width={96} label="Cancel" variant="ghost" />}
    />
  </Box>
</Column>`,
  },
  {
    id: "overlays",
    title: "Overlays",
    description: "Modal sheets, confirmation, and durable toast feedback",
    section: "Feedback",
    code: `<OverlayHost width={window.width} height={window.height}>
  <Button label="Open sheet" onPress={() => setSheetOpen(true)} />
  <Sheet
    open={sheetOpen}
    viewportWidth={window.width}
    viewportHeight={window.height}
    title="Inspector"
    onDismiss={() => setSheetOpen(false)}
  >
    <Inspector />
  </Sheet>
  <ToastHost items={toasts} onDismiss={dismissToast} {...window} />
</OverlayHost>`,
  },
  {
    id: "help",
    title: "Help and disclosure",
    description: "Hover context and collapsible secondary content",
    section: "Content",
    code: `<Tooltip width={36} height={36} label="Search" placement="bottom">
  <IconButton width={36} height={36} icon={<Icon name="search" />} />
</Tooltip>

<Disclosure
  width={560}
  title="Advanced options"
  expanded={expanded}
  onExpandedChange={setExpanded}
  contentHeight={120}
>
  {advancedControls}
</Disclosure>`,
  },
  {
    id: "terminal",
    title: "Terminal view",
    description: "Rich text composed with caret and keyboard semantics",
    section: "Content",
    code: `<TerminalView
  width={720}
  height={420}
  lines={terminal.snapshot().lines}
  cursor={{ line: cursor.row, column: cursor.column }}
  onKeyDown={(event) => session.write(keySequence(event))}
  autoFocus
/>`,
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

type SampleGuidance = { about: string; when: string };

const GUIDANCE: Record<string, SampleGuidance> = {
  buttons: {
    about: "Buttons express action hierarchy through consistent size, focus, and feedback recipes.",
    when: "Use for explicit commands; reserve Primary for the clearest next action on a surface.",
  },
  inputs: {
    about: "Editable fields and continuous controls share focus, validation, and disabled semantics.",
    when: "Use when people must enter, filter, enable, or tune a value without leaving context.",
  },
  choice: {
    about: "Exclusive controls make a small, known set of alternatives directly comparable.",
    when: "Use segmented choices for compact peers and radio rows when options need explanation.",
  },
  "select-combo": {
    about: "Select presents a known option set; ComboBox adds text filtering while keeping the same anchored menu contract.",
    when: "Use Select for constrained values and ComboBox when a longer set benefits from direct filtering or free text.",
  },
  "focus-shortcuts": {
    about: "FocusScope contains traversal for transient work, while ShortcutManager maps commands independently of whichever control owns focus.",
    when: "Use scopes for modal or temporary regions and shortcuts for stable window-level commands with discoverable equivalents.",
  },
  "split-view": {
    about: "SplitView owns a clipped two-pane composition and one accessible resize boundary.",
    when: "Use for persistent peer regions such as a sidebar and canvas, inspector, or preview.",
  },
  "layout-motion": {
    about: "Flow, insets, and alignment compose the box model; Measure, Stack, and Tween expose allocation, overlay, and time.",
    when: "Use these primitives before calculating descendant positions or animation frames by hand.",
  },
  list: {
    about: "List presents a modest scrollable collection with reusable row artwork and selection.",
    when: "Use for short-to-medium linear collections where every row may remain mounted.",
  },
  "virtual-list": {
    about: "VirtualList reconciles only visible fixed-height rows while preserving full scroll extent.",
    when: "Use for hundreds or thousands of uniform results, logs, applications, or file records.",
  },
  table: {
    about: "Table combines virtualized keyed rows with controlled, accessible sort headers.",
    when: "Use when several comparable attributes matter and column scanning aids decisions.",
  },
  charts: {
    about: "Charts share one data model, palette, axis rhythm, legend language, and hover feedback across Cartesian, categorical, radial, and density views.",
    when: "Use a line or area for change, bars for category comparison, scatter for relationship, donut for a small composition, radial for one bounded value, and heatmaps for two-dimensional density.",
  },
  tree: {
    about: "TreeView flattens an owned expansion model into a virtualized navigable hierarchy.",
    when: "Use for folders, outlines, scene graphs, or nested resources with stable identities.",
  },
  navigation: {
    about: "NavigationSidebar composes sections, persistent selection, scrolling, and edit controls.",
    when: "Use for durable places or app destinations—not transient commands or contextual actions.",
  },
  "property-list": {
    about: "PropertyList aligns metadata and live controls without inventing an inspector renderer.",
    when: "Use for properties, diagnostics, metadata, and settings with a stable label/value rhythm.",
  },
  pagination: {
    about: "Pagination condenses large ranges while keeping edges, context, and current page visible.",
    when: "Use for discrete server-sized result pages; prefer scrolling for one continuous collection.",
  },
  feedback: {
    about: "Feedback primitives communicate state without each app designing its own visual grammar.",
    when: "Use banners for notable outcomes, badges for compact state, and empty states for next steps.",
  },
  "progress-row": {
    about: "ProgressRow composes task identity, determinate or indeterminate progress, and cancellation.",
    when: "Use for file operations and background work whose ongoing state deserves a durable row.",
  },
  overlays: {
    about: "OverlayHost gives transient surfaces a single topmost layer; sheets, dialogs, and toasts supply focus, dismissal, and motion policy.",
    when: "Use a sheet for substantial secondary work, confirmation for consequential choices, and toasts for non-blocking outcomes.",
  },
  help: {
    about: "Tooltips add terse hover context; Disclosure keeps secondary controls available but quiet.",
    when: "Use tooltips for unlabeled icons and disclosure for optional detail—not essential decisions.",
  },
  terminal: {
    about: "TerminalView composes rich text, grid measurement, caret, focus, and keyboard semantics.",
    when: "Use as the visual/input surface around a PTY or terminal model; it does not own a process.",
  },
  code: {
    about: "CodeView is a syntax adapter over the reusable, renderer-native RichTextView surface.",
    when: "Use for readable source, examples, and diagnostics where editing is not required.",
  },
};

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

function ChartCard(props: {
  width: number;
  height: number;
  title: string;
  subtitle: string;
  children: ReactNode;
}): ReactNode {
  const pal = themePalette();
  return (
    <Surface width={props.width} height={props.height} fill={pal.panel} radius={10} stroke={pal.borderSubtle} strokeWidth={1} clip>
      <Label x={14} y={10} width={props.width - 28} height={16} text={props.title} fontSize={11} fontWeight="medium" overflow="ellipsis" maxLines={1} />
      <Label x={14} y={27} width={props.width - 28} height={13} text={props.subtitle} color={pal.muted} fontSize={8} overflow="ellipsis" maxLines={1} />
      <Surface x={8} y={44} width={props.width - 16} height={props.height - 52} fill={0x00000000}>{props.children}</Surface>
    </Surface>
  );
}

function Preview(props: {
  sample: Sample;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
}): ReactNode {
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
  const [tableSelected, setTableSelected] = useState("terminal");
  const [tableSort, setTableSort] = useState<TableSort>({ columnId: "name", direction: "ascending" });
  const [treeSelected, setTreeSelected] = useState("main");
  const [treeExpanded, setTreeExpanded] = useState<Set<string>>(() => new Set(["src", "packages"]));
  const [disclosureOpen, setDisclosureOpen] = useState(true);
  const [splitSize, setSplitSize] = useState(230);
  const [page, setPage] = useState(7);
  const [propertySelected, setPropertySelected] = useState("name");
  const [motionOpen, setMotionOpen] = useState(true);
  const [selectValue, setSelectValue] = useState("comfortable");
  const [comboValue, setComboValue] = useState("");
  const [shortcutStatus, setShortcutStatus] = useState("Press Ctrl/Meta + K");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const virtualRows = useMemo(
    () => Array.from({ length: 10_000 }, (_, index) => ({ id: `row-${index}`, label: `Renderer sample ${String(index + 1).padStart(5, "0")}` })),
    [],
  );
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
          <IconButton width={36} height={36} icon={<Icon name="search" />} />
          <IconButton width={36} height={36} icon={<Icon name="grid" />} variant="ghost" />
          <IconButton width={36} height={36} icon={<Icon name="trash" />} variant="danger" />
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
  } else if (props.sample.id === "select-combo") {
    const options = [
      { id: "comfortable", label: "Comfortable", description: "Balanced spacing for everyday use" },
      { id: "compact", label: "Compact", description: "More information in the same space" },
      { id: "touch", label: "Touch", description: "Larger targets and more breathing room" },
      { id: "legacy", label: "Legacy", description: "Unavailable compatibility mode", disabled: true },
    ];
    content = (
      <Column width={Math.min(420, contentW)} gap={16}>
        <Select
          width={Math.min(360, contentW)}
          viewportWidth={props.viewportWidth}
          viewportHeight={props.viewportHeight}
          options={options}
          value={selectValue}
          onChange={setSelectValue}
        />
        <ComboBox
          width={Math.min(360, contentW)}
          viewportWidth={props.viewportWidth}
          viewportHeight={props.viewportHeight}
          options={options}
          value={comboValue}
          selectedId={selectValue}
          placeholder="Filter density presets…"
          onValueChange={setComboValue}
          onSelect={setSelectValue}
        />
        <TextBlock height={22} text={`Selected: ${selectValue}`} color={pal.muted} fontSize={11} verticalAlign="center" />
      </Column>
    );
  } else if (props.sample.id === "focus-shortcuts") {
    content = (
      <ShortcutManager
        width={Math.min(520, contentW)}
        height={190}
        shortcuts={[{
          id: "show-search",
          key: "k",
          platformModifier: true,
          onInvoke: () => setShortcutStatus("Shortcut invoked"),
        }]}
      >
        <FocusScope width={Math.min(520, contentW)} height={190} trap onEscape={() => setShortcutStatus("Escape handled by scope")}>
          <Surface width={Math.min(520, contentW)} height={190} elevation="low">
            <Inset width={Math.min(520, contentW)} height={190} padding={18}>
              <Vertical gap={14}>
                <TextBlock height={22} text={shortcutStatus} color={pal.accent} fontSize={12} verticalAlign="center" />
                <Horizontal height={40} gap={10}>
                  <Button width={132} label="First stop" autoFocus onPress={() => setShortcutStatus("First invoked")} />
                  <Button width={132} label="Second stop" onPress={() => setShortcutStatus("Second invoked")} />
                  <Button width={132} label="Third stop" onPress={() => setShortcutStatus("Third invoked")} />
                </Horizontal>
                <TextBlock height={36} text="Tab and Shift+Tab wrap inside this active scope. Escape is handled before the focused button." color={pal.muted} fontSize={11} wrap lineGap={2} />
              </Vertical>
            </Inset>
          </Surface>
        </FocusScope>
      </ShortcutManager>
    );
  } else if (props.sample.id === "split-view") {
    const splitWidth = Math.min(720, contentW);
    const splitHeight = Math.min(390, props.height - 80);
    const secondWidth = Math.max(1, splitWidth - splitSize - 7);
    content = (
      <SplitView
        width={splitWidth}
        height={splitHeight}
        firstSize={splitSize}
        onFirstSizeChange={setSplitSize}
        minFirst={170}
        minSecond={260}
        first={
          <Surface width={splitSize} height={splitHeight} fill={pal.panel}>
            <Label x={18} y={18} text="Inspector" fontSize={14} fontWeight="medium" width={splitSize - 36} height={22} />
            <Label x={18} y={50} text="Drag the divider or use arrow keys" color={pal.muted} fontSize={10} width={splitSize - 36} height={20} />
          </Surface>
        }
        second={
          <Surface width={secondWidth} height={splitHeight} fill={pal.surface}>
            <Label x={24} y={22} text="Renderer canvas" fontSize={16} fontWeight="medium" width={secondWidth - 48} height={24} />
            <Surface x={24} y={64} width={Math.max(1, secondWidth - 48)} height={Math.max(1, splitHeight - 92)} fill={pal.bg} radius={10} stroke={pal.border} strokeWidth={1} />
          </Surface>
        }
      />
    );
  } else if (props.sample.id === "layout-motion") {
    const layoutWidth = Math.min(720, contentW);
    content = (
      <Vertical width={layoutWidth} height={310} gap={12}>
        <Box height={252}>
          <Horizontal gap={12}>
            <Measure width={190}>{({ width, height }) => (
              <Surface width={width} height={height} fill={pal.panel} radius={10} stroke={pal.border} strokeWidth={1}>
                <Inset width={width} height={height} padding={16}>
                  <Vertical gap={6}>
                    <TextBlock height={22} text="Measured inspector" fontSize={13} fontWeight="medium" verticalAlign="center" />
                    <TextBlock height={20} text={`${Math.round(width)} × ${Math.round(height)}`} color={pal.accent} fontSize={11} fontFamily="mono" verticalAlign="center" />
                    <Spacer />
                    <TextBlock height={18} text="Fixed 190 px pane" color={pal.muted} fontSize={10} verticalAlign="center" />
                  </Vertical>
                </Inset>
              </Surface>
            )}</Measure>
            <Measure flexGrow={1}>{({ width, height }) => (
              <Stack width={width} height={height} alignX="center" alignY="center">
                <Surface width={width} height={height} fill={pal.surface} radius={10} stroke={pal.border} strokeWidth={1} />
                <Box width={Math.min(270, width - 32)} height={132}>
                  <Tween value={motionOpen ? 1 : 0} duration={260} easing="ease-out">
                    {(progress) => (
                      <Surface
                        x={Math.round((1 - progress) * 42)}
                        y={Math.round((1 - progress) * 10)}
                        width={Math.min(270, width - 32)}
                        height={132}
                        fill={((Math.round(0x70 + progress * 0x8f) << 24) | (pal.panel & 0x00ffffff)) >>> 0}
                        radius={12}
                        stroke={pal.accent}
                        strokeWidth={1}
                      >
                        <Inset width={Math.min(270, width - 32)} height={132} padding={18}>
                          <Vertical gap={6}>
                            <TextBlock height={22} text="Tweened overlay" fontSize={14} fontWeight="medium" verticalAlign="center" />
                            <TextBlock height={20} text={`progress ${progress.toFixed(2)}`} color={pal.accent} fontSize={11} fontFamily="mono" verticalAlign="center" />
                            <TextBlock height={18} text={`${Math.round(width)} × ${Math.round(height)} allocation`} color={pal.muted} fontSize={10} verticalAlign="center" overflow="ellipsis" maxLines={1} />
                          </Vertical>
                        </Inset>
                      </Surface>
                    )}
                  </Tween>
                </Box>
              </Stack>
            )}</Measure>
          </Horizontal>
        </Box>
        <Box height={38}>
          <Button width={150} height={34} label={motionOpen ? "Tween out" : "Tween in"} onPress={() => setMotionOpen((value) => !value)} />
        </Box>
      </Vertical>
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
  } else if (props.sample.id === "virtual-list") {
    content = (
      <VirtualList
        width={Math.min(620, contentW)}
        height={Math.min(380, props.height - 90)}
        items={virtualRows}
        itemHeight={34}
        getKey={(row) => row.id}
        renderItem={(row, index) => (
          <ListItem
            width={Math.min(620, contentW)}
            height={34}
            size="small"
            title={row.label}
            subtitle={index % 3 === 0 ? "Rendered inside the visible range" : undefined}
          />
        )}
      />
    );
  } else if (props.sample.id === "table") {
    const rows = [
      { id: "terminal", name: "Terminal", kind: "Application", status: "Running", size: 18 },
      { id: "showcase", name: "Widget Showcase", kind: "Application", status: "Running", size: 24 },
      { id: "files", name: "Files", kind: "Application", status: "Ready", size: 31 },
      { id: "renderer", name: "react-host", kind: "Package", status: "Modified", size: 84 },
      { id: "shell", name: "shell", kind: "Package", status: "Ready", size: 62 },
      { id: "theme", name: "theme", kind: "Package", status: "Ready", size: 14 },
    ];
    content = (
      <Table
        width={Math.min(700, contentW)}
        height={Math.min(390, props.height - 80)}
        columns={[
          { id: "name", label: "Name", sortable: true, getValue: (row: typeof rows[number]) => row.name },
          { id: "kind", label: "Kind", width: 130, sortable: true, getValue: (row: typeof rows[number]) => row.kind },
          { id: "status", label: "Status", width: 110, sortable: true, getValue: (row: typeof rows[number]) => row.status },
          { id: "size", label: "Size", width: 74, align: "right", sortable: true, getValue: (row: typeof rows[number]) => row.size },
        ]}
        rows={rows}
        getRowKey={(row) => row.id}
        selectedKey={tableSelected}
        onSelect={(row) => setTableSelected(row.id)}
        sort={tableSort}
        onSortChange={setTableSort}
        striped
      />
    );
  } else if (props.sample.id === "charts") {
    const galleryWidth = Math.min(780, contentW);
    const cardWidth = Math.floor((galleryWidth - 12) / 2);
    const cardHeight = 220;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"];
    const throughput = [
      { id: "egl", label: "EGL", points: [42, 51, 49, 63, 72, 84].map((y, index) => ({ x: months[index]!, y })) },
      { id: "shm", label: "SHM", points: [38, 40, 43, 41, 46, 48].map((y, index) => ({ x: months[index]!, y })) },
    ];
    const frameBudget = [
      { id: "scene", label: "Scene", points: [4.2, 3.8, 3.5, 3.2, 3.0, 2.8].map((y, index) => ({ x: months[index]!, y })) },
    ];
    const workloads = [
      { id: "ui", label: "UI", points: [18, 24, 20, 31, 29, 36].map((y, index) => ({ x: months[index]!, y })) },
      { id: "composite", label: "Composite", points: [12, 16, 15, 19, 22, 25].map((y, index) => ({ x: months[index]!, y })) },
      { id: "idle", label: "Idle", points: [30, 20, 25, 16, 18, 11].map((y, index) => ({ x: months[index]!, y })) },
    ];
    const scatter = [{ id: "frames", label: "Frames", points: [
      { x: 1, y: 54 }, { x: 2, y: 57 }, { x: 3, y: 55 }, { x: 4, y: 59 },
      { x: 5, y: 58 }, { x: 6, y: 60 }, { x: 7, y: 58 }, { x: 8, y: 59 },
    ] }];
    const heatCells = ["Mon", "Tue", "Wed", "Thu", "Fri"].flatMap((row, rowIndex) =>
      ["09", "12", "15", "18", "21"].map((column, columnIndex) => ({
        row,
        column,
        value: ((rowIndex + 2) * (columnIndex + 3) * 11) % 100,
      })),
    );
    content = (
      <Column width={galleryWidth} gap={12}>
        <Row width={galleryWidth} height={cardHeight} gap={12} align="stretch">
          <ChartCard width={cardWidth} height={cardHeight} title="Throughput" subtitle="Line · hover to inspect">
            <LineChart width={cardWidth - 16} height={cardHeight - 52} series={throughput} />
          </ChartCard>
          <ChartCard width={cardWidth} height={cardHeight} title="Frame budget" subtitle="Area · time-series emphasis">
            <AreaChart width={cardWidth - 16} height={cardHeight - 52} series={frameBudget} fillOpacity={0.28} />
          </ChartCard>
        </Row>
        <Row width={galleryWidth} height={cardHeight} gap={12} align="stretch">
          <ChartCard width={cardWidth} height={cardHeight} title="Renderer comparison" subtitle="Grouped bars">
            <BarChart width={cardWidth - 16} height={cardHeight - 52} series={throughput} />
          </ChartCard>
          <ChartCard width={cardWidth} height={cardHeight} title="CPU composition" subtitle="Stacked bars">
            <StackedBarChart width={cardWidth - 16} height={cardHeight - 52} series={workloads} />
          </ChartCard>
        </Row>
        <Row width={galleryWidth} height={cardHeight} gap={12} align="stretch">
          <ChartCard width={cardWidth} height={cardHeight} title="Frame distribution" subtitle="Scatter · relationship and outliers">
            <ScatterChart width={cardWidth - 16} height={cardHeight - 52} series={scatter} showLegend={false} />
          </ChartCard>
          <ChartCard width={cardWidth} height={cardHeight} title="Memory ownership" subtitle="Donut · small composition">
            <DonutChart width={cardWidth - 16} height={cardHeight - 52} data={[
              { id: "textures", label: "Textures", value: 46 },
              { id: "scene", label: "Scene", value: 27 },
              { id: "runtime", label: "Runtime", value: 19 },
              { id: "other", label: "Other", value: 8 },
            ]} />
          </ChartCard>
        </Row>
        <Row width={galleryWidth} height={cardHeight} gap={12} align="stretch">
          <ChartCard width={cardWidth} height={cardHeight} title="Activity density" subtitle="Heatmap · two-dimensional intensity">
            <HeatmapChart width={cardWidth - 16} height={cardHeight - 52} cells={heatCells} />
          </ChartCard>
          <ChartCard width={cardWidth} height={cardHeight} title="Compact indicators" subtitle="Radial progress and sparklines">
            <RadialChart x={10} y={5} width={128} height={128} value={0.78} label="Frame budget" />
            <Sparkline x={150} y={20} width={cardWidth - 184} height={42} values={[18, 22, 19, 28, 31, 29, 38, 35]} fill />
            <Sparkline x={150} y={84} width={cardWidth - 184} height={42} values={[44, 41, 39, 36, 37, 33, 31, 29]} />
          </ChartCard>
        </Row>
      </Column>
    );
  } else if (props.sample.id === "tree") {
    content = (
      <TreeView
        width={Math.min(440, contentW)}
        height={Math.min(390, props.height - 80)}
        nodes={[
          { id: "src", label: "src", icon: "folder", children: [{ id: "main", label: "main.tsx", icon: "file" }, { id: "model", label: "model.ts", icon: "file" }] },
          { id: "packages", label: "packages", icon: "folder", children: [{ id: "ui", label: "ui", icon: "folder", children: [{ id: "widgets", label: "widgets", icon: "folder" }] }, { id: "shell", label: "shell", icon: "folder" }, { id: "terminal-package", label: "terminal", icon: "folder" }] },
          { id: "docs", label: "docs", icon: "folder", children: [{ id: "widget-docs", label: "widgets.md", icon: "file" }] },
          { id: "readme", label: "README.md", icon: "file" },
        ]}
        expandedIds={treeExpanded}
        onExpandedChange={(ids) => setTreeExpanded(new Set(ids))}
        selectedId={treeSelected}
        onSelect={(node) => setTreeSelected(node.id)}
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
  } else if (props.sample.id === "property-list") {
    content = (
      <PropertyList
        width={Math.min(620, contentW)}
        height={Math.min(400, props.height - 80)}
        selectedId={propertySelected}
        onSelect={(item) => setPropertySelected(item.id)}
        striped
        sections={[
          { id: "file", label: "File", items: [
            { id: "name", label: "Name", value: "Widget Showcase" },
            { id: "kind", label: "Kind", value: "Moire application", description: "Resolved through freedesktop MIME metadata" },
            { id: "status", label: "Status", value: <Badge y={10} text="Running" tone="success" /> },
          ] },
          { id: "renderer", label: "Renderer", items: [
            { id: "backend", label: "Backend", value: "Software / EGL" },
            { id: "animations", label: "Animations", value: <Toggle y={7} width={180} on={enabled} onChange={setEnabled} label="Enabled" /> },
          ] },
        ]}
      />
    );
  } else if (props.sample.id === "pagination") {
    content = (
      <Surface width={contentW} height={260} fill={0x00000000}>
        <Pagination x={0} y={0} page={page} pageCount={42} onPageChange={setPage} siblingCount={1} />
        <Pagination x={0} y={70} page={page} pageCount={42} onPageChange={setPage} siblingCount={1} showFirstLast size="small" />
        <Label x={0} y={140} text={`Page ${page} of 42`} color={pal.muted} fontSize={12} width={240} height={22} />
      </Surface>
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
  } else if (props.sample.id === "progress-row") {
    const rowWidth = Math.min(660, contentW);
    content = (
      <Column width={contentW} gap={14}>
        <Box width={rowWidth} height={78}>
          <ProgressRow
            width={rowWidth}
            title="Copying project assets"
            detail="24 of 80 files"
            value={0.3}
            status="30%"
            action={<Button width={96} height={34} label="Cancel" variant="ghost" />}
            actionWidth={96}
          />
        </Box>
        <Box width={rowWidth} height={78}>
          <ProgressRow
            width={rowWidth}
            title="Indexing widget examples"
            detail="Discovering TSX samples…"
            status="WORKING"
            action={<Button width={96} height={34} label="Stop" variant="ghost" />}
            actionWidth={96}
          />
        </Box>
        <Box width={rowWidth} height={78}>
          <ProgressRow
            width={rowWidth}
            title="Renderer conformance"
            detail="Software and EGL scene semantics"
            value={1}
            status="DONE"
          />
        </Box>
      </Column>
    );
  } else if (props.sample.id === "overlays") {
    content = (
      <Column width={contentW} gap={16}>
        <Horizontal width={contentW} height={40} gap={10}>
          <Button width={132} label="Open sheet" variant="primary" onPress={() => setSheetOpen(true)} />
          <Button width={144} label="Ask to remove" onPress={() => setConfirmationOpen(true)} />
          <Button
            width={132}
            label="Show toast"
            variant="ghost"
            onPress={() => setToasts((current) => [...current, {
              id: `toast-${Date.now()}-${current.length}`,
              title: "Preview updated",
              message: "The renderer accepted the new widget recipe.",
            }])}
          />
        </Horizontal>
        <Surface width={Math.min(620, contentW)} height={150} fill={pal.panel} elevation="low">
          <Inset width={Math.min(620, contentW)} height={150} padding={18}>
            <Vertical gap={8}>
              <TextBlock height={22} text="The content remains in ordinary layout" fontSize={14} fontWeight="medium" verticalAlign="center" />
              <TextBlock height={48} text="Transient surfaces register with the nearest OverlayHost, so they paint and hit-test above application chrome without being constrained by this preview pane." color={pal.muted} fontSize={11} wrap lineGap={3} />
            </Vertical>
          </Inset>
        </Surface>
        <Sheet
          open={sheetOpen}
          viewportWidth={props.viewportWidth}
          viewportHeight={props.viewportHeight}
          width={390}
          title="Widget inspector"
          onDismiss={() => setSheetOpen(false)}
        >
          <Vertical gap={12}>
            <TextBlock height={46} text="Sheets keep a focused secondary workflow close to its source without pretending to be a new application window." color={pal.muted} fontSize={12} wrap lineGap={3} />
            <Toggle width={280} on={enabled} onChange={setEnabled} label="Animate transitions" />
            <Checkbox width={280} checked={checked} onChange={setChecked} label="Show focus boundary" />
          </Vertical>
        </Sheet>
        <ConfirmationDialog
          open={confirmationOpen}
          viewportWidth={props.viewportWidth}
          viewportHeight={props.viewportHeight}
          title="Remove this preset?"
          message="This demonstrates a focused, blocking decision. Nothing is removed from the showcase."
          confirmLabel="Remove"
          danger
          onConfirm={() => {
            setConfirmationOpen(false);
            setToasts((current) => [...current, { id: `removed-${Date.now()}`, title: "Preset removed", durationMs: 3500 }]);
          }}
          onDismiss={() => setConfirmationOpen(false)}
        />
        <ToastHost
          viewportWidth={props.viewportWidth}
          viewportHeight={props.viewportHeight}
          items={toasts}
          onDismiss={(id) => setToasts((current) => current.filter((item) => item.id !== id))}
        />
      </Column>
    );
  } else if (props.sample.id === "help") {
    content = (
      <Column width={contentW} gap={24}>
        <Row width={contentW} height={64} gap={12} align="center">
          <Tooltip width={36} height={36} label="Search widgets" placement="bottom" delayMs={150}>
            <IconButton width={36} height={36} icon={<Icon name="search" />} />
          </Tooltip>
          <Tooltip width={36} height={36} label="Grid view" placement="bottom" delayMs={150}>
            <IconButton width={36} height={36} icon={<Icon name="grid" />} variant="ghost" />
          </Tooltip>
          <Label text="Hover the icon controls" color={pal.muted} fontSize={11} width={220} height={22} />
        </Row>
        <Disclosure
          width={Math.min(620, contentW)}
          title="Advanced options"
          description="Secondary controls stay available without dominating the surface"
          expanded={disclosureOpen}
          onExpandedChange={setDisclosureOpen}
          contentHeight={120}
        >
          <Column x={36} y={18} width={Math.min(540, contentW - 72)} gap={12}>
            <Toggle width={280} on={enabled} onChange={setEnabled} label="Animate transitions" />
            <Checkbox width={280} checked={checked} onChange={setChecked} label="Show renderer bounds" />
          </Column>
        </Disclosure>
      </Column>
    );
  } else if (props.sample.id === "terminal") {
    content = (
      <TerminalView
        width={Math.min(700, contentW)}
        height={Math.min(420, props.height - 70)}
        lines={[
          { id: "one", runs: [{ text: "Welcome to Moire Terminal", color: pal.accent, fontWeight: "bold" }] },
          { id: "two", runs: [{ text: "", color: pal.text }] },
          { id: "three", runs: [{ text: "moire", color: 0xff70b77e, fontWeight: "medium" }, { text: "@desktop", color: 0xff639ad6 }, { text: ":~/Projects $ ", color: pal.text }, { text: "pnpm smoke", color: 0xffffd166 }] },
          { id: "four", runs: [{ text: "✓ 42 renderer assertions passed", color: 0xff8fd694 }] },
          { id: "five", runs: [{ text: "moire@desktop:~/Projects $ ", color: pal.text }] },
        ]}
        cursor={{ line: 4, column: 27 }}
        fontSize={13}
        focusId="showcase-terminal"
      />
    );
  } else {
    content = <CodeView width={Math.min(700, contentW)} height={Math.min(420, props.height - 70)} code={props.sample.code} language="tsx" />;
  }

  const guidance = GUIDANCE[props.sample.id] ?? {
    about: props.sample.description,
    when: "Use when its interaction contract matches the task rather than only its appearance.",
  };

  return (
    <ScrollArea width={props.width} height={props.height} contentHeight={Math.max(props.height, props.sample.id === "charts" ? 1240 : 820)}>
      <Column x={32} y={28} width={contentW} gap={18}>
        <Label text={props.sample.title} fontSize={20} fontWeight="bold" width={contentW} height={28} />
        <Label text={props.sample.description} color={pal.muted} fontSize={12} width={contentW} height={36} wrap lineGap={3} overflow="ellipsis" maxLines={2} />
        <Surface width={contentW} height={158} fill={pal.panel} radius={10} stroke={pal.borderSubtle} strokeWidth={1}>
          <Label x={16} y={12} text="ABOUT" color={pal.accent} fontSize={9} fontWeight="medium" width={90} height={16} />
          <Label x={16} y={30} text={guidance.about} color={pal.text} fontSize={11} width={contentW - 32} height={42} wrap lineGap={3} overflow="ellipsis" maxLines={3} />
          <Separator x={16} y={78} width={contentW - 32} color={pal.borderSubtle} />
          <Label x={16} y={90} text="WHEN TO USE" color={pal.accent} fontSize={9} fontWeight="medium" width={100} height={16} />
          <Label x={16} y={110} text={guidance.when} color={pal.muted} fontSize={11} width={contentW - 32} height={38} wrap lineGap={3} overflow="ellipsis" maxLines={3} />
        </Surface>
        <Separator width={contentW} />
        {content}
      </Column>
    </ScrollArea>
  );
}

function ShowcaseApp(
  props: WindowSize & { initialSampleId?: string },
): ReactNode {
  const pal = themePalette();
  const [selectedId, setSelectedId] = useState(() =>
    SAMPLES.some((sample) => sample.id === props.initialSampleId)
      ? props.initialSampleId!
      : SAMPLES[0]!.id,
  );
  const [tab, setTab] = useState(0);
  const sample = SAMPLES.find((entry) => entry.id === selectedId) ?? SAMPLES[0]!;
  const sideW = Math.min(300, Math.max(220, Math.round(props.width * 0.27)));
  const mainW = Math.max(1, props.width - sideW - 1);
  const toolbarH = 54;
  const tabsH = 36;
  const bodyH = Math.max(1, props.height - toolbarH - tabsH - 2);
  return (
    <OverlayHost width={props.width} height={props.height}>
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
            <Preview sample={sample} width={mainW} height={bodyH} viewportWidth={props.width} viewportHeight={props.height} />
          ) : (
            <CodeView x={24} y={20} width={Math.max(1, mainW - 48)} height={Math.max(1, bodyH - 40)} code={sample.code} language="tsx" lineNumbers />
          )}
        </Surface>
      </Surface>
    </OverlayHost>
  );
}

async function main(): Promise<void> {
  const settings = loadSettings();
  setUiScaleFactor(settings.uiScale);
  const app = new Application();
  const sampleIndex = process.argv.indexOf("--sample");
  const initialSampleId = sampleIndex >= 0 ? process.argv[sampleIndex + 1] : undefined;
  const win = new Window({
    title: "Widget Showcase",
    appId: "org.moire.Showcase",
    width: Math.round(1040 * settings.uiScale),
    height: Math.round(700 * settings.uiScale),
    resizable: true,
  });
  win.setContent((size) => (
    <ShowcaseApp {...size} initialSampleId={initialSampleId} />
  ));
  win.onClose(() => app.quit());
  app.addWindow(win);
  await app.run();
}

main().catch((error: unknown) => {
  console.error("[showcase] fatal:", error);
  process.exit(1);
});
