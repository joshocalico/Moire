/**
 * Previews for the widgets the Files app is built from: rail, filters, search, file items and
 * the inspector's parts.
 */
import React, { useState, type ReactNode } from "react";
import {
  Box,
  ChipGroup,
  ColourStrip,
  FileTile,
  Histogram,
  HoverActions,
  Icon,
  IconButton,
  IconSegmentedControl,
  ItemCard,
  Label,
  MetaPill,
  NavigationRail,
  PageStepper,
  Pressable,
  PropertyList,
  SelectionBar,
  StackedBar,
  Surface,
  TagChip,
  TokenField,
  colourStripWidth,
  fileTileHeight,
  filterChipHeight,
  getUiScaleFactor,
  hoverActionsWidth,
  layoutTagChips,
  metaPillHeight,
  metaPillWidth,
  pageStepperHeight,
  pageStepperWidth,
  propertyListHeight,
  selectionBarHeight,
  stackedBarHeight,
  usePalette,
  type ChipGroupItem,
  type IconName,
  type NavigationRailSection,
  type PropertyListItem,
  type StackedBarSegment,
  type TokenFieldCompletion,
  type TokenFieldToken,
} from "@moire/ui";

const FILES_SAMPLE_IDS = [
  "navigation-rail",
  "filters-search",
  "file-items",
  "inspector-parts",
] as const;
export type FilesSampleId = (typeof FILES_SAMPLE_IDS)[number];

export function isFilesSample(id: string): id is FilesSampleId {
  return (FILES_SAMPLE_IDS as readonly string[]).includes(id);
}

const GREEN = 0xff4fbf8a;
const BLUE = 0xff6aa6f0;
const PINK = 0xffe0709b;
const AMBER = 0xffd9a441;
const VIOLET = 0xff8b7cf6;
const RED = 0xffe2685a;
const GAP = 8;
const RAIL_HEIGHT = 460;
const ROW_HEIGHT = 46;

const RAIL: NavigationRailSection[] = [
  {
    id: "places",
    items: [
      { id: "home", label: "Home", icon: "home" },
      { id: "recent", label: "Recent", icon: "history" },
      { id: "documents", label: "Documents", icon: "document" },
      { id: "downloads", label: "Downloads", icon: "downloads", badge: 3 },
      { id: "pictures", label: "Pictures", icon: "image" },
      { id: "trash", label: "Trash", icon: "trash" },
    ],
  },
  {
    id: "bookmarks",
    label: "Bookmarks",
    items: [{ id: "projects", label: "Projects", icon: "folder", tint: VIOLET }],
  },
  {
    id: "drives",
    label: "Drives",
    placement: "end",
    items: [{ id: "usb", label: "USB stick", icon: "disk-usage" }],
  },
];

function RailSample(): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState("home");
  const [status, setStatus] = useState("Right-click an item for its menu");
  const height = Math.round(RAIL_HEIGHT * ui);
  return (
    <Box width={560 * ui} height={height}>
      <NavigationRail
        height={height}
        sections={RAIL}
        selectedId={selected}
        expanded={expanded}
        onSelect={(item) => {
          setSelected(item.id);
          setStatus(`Opened ${item.label}`);
        }}
        onContextMenu={(item) => setStatus(`Menu for ${item.label}`)}
        header={
          <IconButton
            x={12 * ui}
            y={12 * ui}
            width={40 * ui}
            height={36 * ui}
            fill={pal.selection}
            tooltip={expanded ? "Hide labels" : "Show labels"}
            tooltipPlacement="right"
            icon={<Icon name="folder-filled" size={20 * ui} color={pal.accentLine} symbolic />}
            onPress={() => setExpanded(!expanded)}
          />
        }
      />
      <Label
        x={(expanded ? 220 : 84) * ui}
        y={16 * ui}
        width={320 * ui}
        height={20 * ui}
        text={status}
        color={pal.muted}
        fontSize={12}
      />
    </Box>
  );
}

const FILTERS: ChipGroupItem[] = [
  { id: "all", label: "All", count: 10 },
  { id: "folders", label: "Folders", count: 3 },
  { id: "images", label: "Images", count: 1 },
  { id: "documents", label: "Documents", count: 4 },
  { id: "audio", label: "Audio", count: 1 },
  { id: "video", label: "Video", count: 2 },
  { id: "archives", label: "Archives", count: 1 },
];

const KINDS: ChipGroupItem[] = [
  { id: "images", label: "Images", count: "1,204", icon: "image", tint: GREEN },
  { id: "documents", label: "Documents", count: 312, icon: "document", tint: BLUE },
  { id: "audio", label: "Audio", count: 88, icon: "music", tint: PINK },
  { id: "video", label: "Video", count: 14, icon: "video", tint: 0xffe39a6a },
  { id: "archives", label: "Archives", count: 12, icon: "archive", tint: AMBER },
];

const KIND_TOKENS: Record<string, TokenFieldToken> = Object.fromEntries(
  KINDS.map((kind) => [
    kind.id,
    { id: `kind:${kind.id}`, label: `kind: ${kind.label.toLowerCase()}`, tint: kind.tint },
  ]),
);

function completionsFor(value: string): TokenFieldCompletion[] {
  if (!value.startsWith("kind:")) return [];
  const typed = value.slice(5).trim().toLowerCase();
  return KINDS.filter((kind) => kind.label.toLowerCase().startsWith(typed)).map((kind) => ({
    id: kind.id,
    label: `kind:${kind.label.toLowerCase()}`,
    detail: `${kind.count} files`,
    icon: kind.icon,
    tint: kind.tint,
    token: KIND_TOKENS[kind.id],
  }));
}

function FiltersSample(props: { width: number }): ReactNode {
  const ui = getUiScaleFactor();
  const [view, setView] = useState("list");
  const [filter, setFilter] = useState("all");
  const [tokens, setTokens] = useState<TokenFieldToken[]>([KIND_TOKENS.images!]);
  const [query, setQuery] = useState("");
  const width = Math.min(560 * ui, props.width);
  const gap = GAP * ui;
  const fieldHeight = 40 * ui;
  const controls = fieldHeight + gap;
  const filters = controls + 32 * ui + gap;
  const kinds = filters + filterChipHeight() + gap;
  return (
    <Box width={width} height={kinds + 2 * filterChipHeight() + gap}>
      <TokenField
        width={width}
        height={fieldHeight}
        tokens={tokens}
        value={query}
        placeholder="Search, or type kind: for a filter"
        completions={completionsFor(query)}
        onChange={setQuery}
        onTokensChange={setTokens}
        onEscape={() => {
          setQuery("");
          setTokens([]);
        }}
      />
      <IconSegmentedControl
        y={controls}
        options={[
          { id: "list", icon: "list", label: "List" },
          { id: "grid", icon: "grid", label: "Grid" },
          { id: "columns", icon: "columns", label: "Columns" },
        ]}
        value={view}
        onChange={setView}
      />
      <ChipGroup
        y={filters}
        width={Math.min(420 * ui, width)}
        chips={FILTERS}
        selectedId={filter}
        onSelect={(chip) => setFilter(chip.id)}
      />
      <ChipGroup
        y={kinds}
        width={width}
        chips={KINDS}
        wrap
        onSelect={(chip) => setTokens((current) => [...current, KIND_TOKENS[chip.id]!])}
      />
    </Box>
  );
}

type SampleFile = {
  id: string;
  name: string;
  detail: string;
  icon: IconName;
  tint: number;
  ext?: string;
};

const FILES: SampleFile[] = [
  { id: "design", name: "Design", detail: "12 items", icon: "folder-filled", tint: VIOLET },
  {
    id: "plan",
    name: "Launch plan.pdf",
    detail: "1.2 MB",
    icon: "document",
    tint: RED,
    ext: "pdf",
  },
  { id: "drive", name: "Night drive.mp3", detail: "4.2 MB", icon: "music", tint: PINK, ext: "mp3" },
  {
    id: "backup",
    name: "site-backup.tar.gz",
    detail: "86 MB",
    icon: "archive",
    tint: AMBER,
    ext: "gz",
  },
];

const ROW_ACTIONS = [
  { id: "open", label: "Open", icon: "forward" as const },
  { id: "copy", label: "Copy", icon: "document" as const },
  { id: "trash", label: "Move to Trash", icon: "trash" as const, tone: "danger" as const },
];

function FileRow(props: { y: number; width: number; file: SampleFile; when: string }): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [actionHovered, setActionHovered] = useState(false);
  const height = ROW_HEIGHT * ui;
  const actionsWidth = hoverActionsWidth(ROW_ACTIONS.length);
  return (
    <Box y={props.y} width={props.width} height={height}>
      <Pressable
        width={props.width}
        height={height}
        radius={10 * ui}
        fill={hovered || actionHovered ? pal.surface : 0x00000000}
        hoverFill={pal.surface}
        onHoverChange={setHovered}
        onFocusChange={setFocused}
        onPress={() => {}}
      />
      <Label
        x={14 * ui}
        width={props.width - actionsWidth - 40 * ui}
        height={height}
        text={props.file.name}
        fontSize={13}
        verticalAlign="center"
      />
      <HoverActions
        x={props.width - actionsWidth - 8 * ui}
        width={actionsWidth}
        height={height}
        active={hovered || focused}
        trailing={props.when}
        actions={ROW_ACTIONS}
        onHoverChange={setActionHovered}
      />
    </Box>
  );
}

function ItemsSample(props: { width: number }): ReactNode {
  const ui = getUiScaleFactor();
  const [selected, setSelected] = useState<string[]>(["plan", "drive"]);
  const width = Math.min(620 * ui, props.width);
  const gap = GAP * ui;
  const tile = Math.min(112 * ui, (width - gap * (FILES.length - 1)) / FILES.length);
  const cardsY = fileTileHeight({ width: tile, detail: "x" }) + gap * 2;
  const cardWidth = (width - gap * 2) / 3;
  const rowsY = cardsY + 84 * ui + gap * 2;
  const barY = rowsY + (ROW_HEIGHT * 2 + 4) * ui + gap * 2;
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  return (
    <Box width={width} height={barY + selectionBarHeight()}>
      {FILES.map((file, index) => (
        <FileTile
          key={file.id}
          x={index * (tile + gap)}
          width={tile}
          name={file.name}
          detail={file.detail}
          icon={file.icon}
          tint={file.tint}
          extension={file.ext}
          selected={selected.includes(file.id)}
          onPress={() => toggle(file.id)}
        />
      ))}
      {(
        [
          ["Projects", "10 items", VIOLET],
          ["Photos", "248 items", GREEN],
        ] as const
      ).map(([title, detail, tint], index) => (
        <ItemCard
          key={title}
          x={index * (cardWidth + gap)}
          y={cardsY}
          width={cardWidth}
          icon="folder-filled"
          tint={tint}
          title={title}
          detail={detail}
        />
      ))}
      <ItemCard
        x={2 * (cardWidth + gap)}
        y={cardsY}
        width={cardWidth}
        layout="stacked"
        icon="folder-filled"
        tint={BLUE}
        title="Music"
        detail="1,204 items"
        onMenu={() => {}}
      />
      <FileRow y={rowsY} width={width} file={FILES[1]!} when="Yesterday" />
      <FileRow y={rowsY + (ROW_HEIGHT + 4) * ui} width={width} file={FILES[2]!} when="28 Sep" />
      {selected.length > 1 ? (
        <SelectionBar
          y={barY}
          width={width}
          count={selected.length}
          detail="selected · 5.4 MB"
          actions={[
            { id: "open", label: "Open", icon: "forward" },
            { id: "copy", label: "Copy", icon: "document" },
            { id: "move", label: "Move to…", icon: "folder" },
            { id: "trash", label: "Trash", icon: "trash", tone: "danger" },
          ]}
          onAction={(action) => {
            if (action.id === "trash") setSelected([]);
          }}
        />
      ) : null}
    </Box>
  );
}

const SWATCHES = [0xff2b2140, 0xff8d6bb8, 0xffd9c4ef, 0xff4d6b3a, 0xfff2e6f7, 0xff1a1a1f];
const HISTOGRAM = Array.from({ length: 48 }, (_, index) =>
  Math.max(0, Math.sin((index / 47) * Math.PI) * 0.8 + Math.cos(index * 0.9) * 0.15),
);
const FOLDER_KINDS: StackedBarSegment[] = [
  { id: "images", label: "Images", value: 185_800, colour: GREEN, detail: "185.8 KB" },
  { id: "documents", label: "Documents", value: 16_400, colour: BLUE, detail: "16.4 KB" },
  { id: "video", label: "Video", value: 5_200, colour: AMBER, detail: "5.2 KB" },
];
const HISTORY: PropertyListItem[] = [
  { id: "created", label: "Created", value: "Today, 04:46 pm" },
  { id: "modified", label: "Modified", value: "Today, 05:41 pm" },
  { id: "opened", label: "Last opened", value: "Image Viewer · 2 h ago", tone: "accent" },
];
const TAG_COLOURS = [BLUE, AMBER, GREEN, PINK, VIOLET];
const PICTURE_HEIGHT = 140;
const PAGE_HEIGHT = 120;

/** Pills over a picture, histogram and swatches, tags, a size bar, a page stepper and facts. */
function InspectorSample(props: { width: number }): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const [tags, setTags] = useState(["Travel", "Lisbon"]);
  const [suggestions, setSuggestions] = useState(["2024", "Fujifilm"]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [page, setPage] = useState(1);
  const width = Math.min(380 * ui, props.width);
  const gap = GAP * ui;
  const picture = Math.round(PICTURE_HEIGHT * ui);
  const pillY = picture - metaPillHeight() - Math.round(10 * ui);
  const statsY = picture + gap;
  const statsH = Math.round(26 * ui);
  const swatches = colourStripWidth(SWATCHES.length);
  const chips = [
    ...tags.map((label) => ({ label, variant: "tag" as const })),
    { label: "Add tag", variant: "add" as const, editing },
    ...suggestions.map((label) => ({ label, variant: "suggestion" as const })),
  ];
  const chipRows = layoutTagChips(chips, width);
  const tagsY = statsY + statsH + gap * 2;
  const barY = tagsY + chipRows.height + gap * 2;
  const pageY = barY + stackedBarHeight() + gap * 2;
  const pageH = Math.round(PAGE_HEIGHT * ui);
  const stepper = pageStepperWidth(12);
  const factsY = pageY + pageH + gap * 2;
  const addTag = (label: string) => {
    const name = label.trim();
    if (name && !tags.includes(name)) setTags([...tags, name]);
  };
  return (
    <Box width={width} height={factsY + propertyListHeight(HISTORY.length)}>
      <Surface width={width} height={picture} radius={10 * ui} fill={0xff2b2140} clip>
        <Surface
          x={width * 0.45}
          y={-picture * 0.4}
          width={picture * 1.6}
          height={picture * 1.6}
          radius={picture * 0.8}
          fill={0xff8d6bb8}
        />
        <MetaPill x={10 * ui} y={pillY} text="600 × 400" />
        <MetaPill
          x={10 * ui + metaPillWidth("600 × 400") + 6 * ui}
          y={pillY}
          text="X-T30 II"
          tone="solid"
        />
      </Surface>
      <Histogram y={statsY} width={width - swatches - 16 * ui} height={statsH} values={HISTOGRAM} />
      <ColourStrip
        x={width - swatches}
        y={statsY + Math.round(4 * ui)}
        colours={SWATCHES}
        onPress={() => {}}
      />
      {chips.map((chip, index) => {
        const at = chipRows.positions[index]!;
        return (
          <TagChip
            key={`${chip.variant}:${chip.label}`}
            x={at.x}
            y={tagsY + at.y}
            maxWidth={at.width}
            label={chip.label}
            variant={chip.variant}
            colour={TAG_COLOURS[index % TAG_COLOURS.length]}
            editing={chip.variant === "add" ? editing : undefined}
            draft={draft}
            onDraft={setDraft}
            onSubmit={() => {
              addTag(draft);
              setDraft("");
              setEditing(false);
            }}
            onCancel={() => {
              setDraft("");
              setEditing(false);
            }}
            onPress={() => {
              if (chip.variant === "add") setEditing(true);
              if (chip.variant === "suggestion") {
                addTag(chip.label);
                setSuggestions(suggestions.filter((label) => label !== chip.label));
              }
            }}
            onRemove={() => setTags(tags.filter((label) => label !== chip.label))}
          />
        );
      })}
      <StackedBar y={barY} width={width} segments={FOLDER_KINDS} />
      <Surface y={pageY} width={width} height={pageH} radius={10 * ui} fill={pal.bg} clip>
        <Surface
          x={Math.round(width / 2 - 45 * ui)}
          y={Math.round(10 * ui)}
          width={Math.round(90 * ui)}
          height={pageH}
          fill={0xfff4f1ea}
        />
        <PageStepper
          x={Math.round((width - stepper) / 2)}
          y={pageH - pageStepperHeight() - Math.round(10 * ui)}
          page={page}
          pages={12}
          onPage={setPage}
        />
      </Surface>
      <PropertyList
        y={factsY}
        width={width}
        height={propertyListHeight(HISTORY.length)}
        density="compact"
        scroll={false}
        sections={[{ id: "history", items: HISTORY }]}
      />
    </Box>
  );
}

export function FilesSample(props: { id: FilesSampleId; width: number }): ReactNode {
  if (props.id === "navigation-rail") return <RailSample />;
  if (props.id === "filters-search") return <FiltersSample width={props.width} />;
  if (props.id === "inspector-parts") return <InspectorSample width={props.width} />;
  return <ItemsSample width={props.width} />;
}
