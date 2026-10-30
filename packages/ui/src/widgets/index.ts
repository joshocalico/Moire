/**
 * @moire/ui widget suite — OS-agnostic React components on @moire/react-host.
 * No Wayland / koffi / platform imports anywhere in this tree.
 *
 * All interactive widgets are in individual modules; re-exported here.
 */
/* ---------- Re-exports from split modules ---------- */

export {
  WindowHeader,
  WindowFrame,
  WindowControls,
  WindowMoveArea,
  windowControlSize,
} from "./window-frame";
export type { WindowHeaderProps, WindowFrameProps } from "./window-frame";

export { AdaptivePanes } from "./adaptive-panes";
export type { AdaptivePane, AdaptivePanesProps } from "./adaptive-panes";
export { CollectionList, CollectionRow } from "./collection-list";
export type { CollectionListProps, CollectionRowProps } from "./collection-list";
export { MediaGlyph, PlaybackBar, playbackBarHeight, formatPlaybackTime } from "./playback-bar";
export type { MediaSymbol, PlaybackBarProps } from "./playback-bar";

export { DocumentEditor } from "./document-editor";
export type { DocumentEditorProps, DocumentSelectionGeometry } from "./document-editor";
export {
  SelectionToolbar,
  placeSelectionToolbar,
  layoutSelectionToolbar,
} from "./selection-toolbar";
export type { SelectionToolbarProps, SelectionToolbarAction } from "./selection-toolbar";
export {
  plainDocument,
  parseDocument,
  toggleDocumentMark,
  replaceDocumentRange,
  documentFragments,
  equalDocuments,
  selectionHasDocumentMark,
  documentBoundary,
} from "./document-model";
export type {
  DocumentValue,
  DocumentRun,
  DocumentMarks,
  DocumentMark,
  DocumentSelection,
} from "./document-model";

export { Pressable } from "./pressable";
export type { PressableProps } from "./pressable";
export { PointerArea } from "./pointer-area";
export type { PointerAreaProps } from "./pointer-area";

export { Button } from "./button";
export type { ButtonProps, ButtonVariant, ButtonSize, ButtonSlot } from "./button";

export { IconButton } from "./icon-button";
export type { IconButtonProps, IconButtonSlot, IconButtonVariant } from "./icon-button";

export {
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  createWidgetTheme,
  getWidgetTheme,
  resolveStatefulStyle,
  useWidgetTheme,
} from "#ui/widget-theme";
export type {
  WidgetThemeProviderProps,
  WidgetTheme,
  WidgetFoundations,
  WidgetState,
  StatefulStyle,
  WidgetBoxStyle,
  WidgetTextStyle,
  WidgetIconStyle,
  ButtonRecipe,
  IconButtonRecipe,
  ListItemRecipe,
  GridItemRecipe,
  CollectionItemRecipe,
  TextFieldRecipe,
  TabsRecipe,
  MenuRecipe,
  CheckboxRecipe,
  ToggleRecipe,
  SliderRecipe,
  ProgressBarRecipe,
  ScrollAreaRecipe,
  DialogRecipe,
  ImageWidgetRecipe,
  DndRecipe,
  PathBarRecipe,
} from "#ui/widget-theme";

export { ScrollArea } from "./scroll";
export type { ScrollAreaProps, ScrollMetrics } from "./scroll";

export { List, ListItem } from "./list";
export type { ListProps, ListItemProps, ListItemSlot } from "./list";

export { VirtualList } from "./virtual-list";
export type { VirtualListProps } from "./virtual-list";

export { Table } from "./table";
export type { TableProps, TableColumn, TableSort, TableSortDirection } from "./table";

export { TreeView } from "./tree-view";
export type { TreeViewProps, TreeNode } from "./tree-view";

export { Grid, GridItem } from "./grid";
export type { GridProps, GridItemProps } from "./grid";

export { ImageWidget } from "./image-widget";
export type { ImageWidgetProps, ImageFit } from "./image-widget";

export { Icon, applicationIcon, ICON_NAMES } from "./icon";
export type { IconProps, IconName } from "./icon";

export { Draggable, DropTarget, DropZone, DndFeedback, setDndBridge } from "./dnd";
export type {
  DraggableProps,
  DropTargetProps,
  DropZoneProps,
  DragIconSpec,
  DragPreviewSpec,
  DragSourceOptions,
  DragSourceController,
  DndFeedbackKind,
} from "./dnd";
export { useDragSource } from "./dnd";

export { CollectionItem, ContextMenuTrigger } from "./interaction";
export type { CollectionItemProps, ContextMenuTriggerProps } from "./interaction";

export { Tabs } from "./tabs";
export type { TabsProps, TabItem, TabSlot } from "./tabs";

export { Menu, MenuItem } from "./menu";
export type { MenuProps, MenuEntry, MenuItemProps, MenuItemSlot, MenuTrailingSlot } from "./menu";

export { Checkbox } from "./checkbox";
export type { CheckboxProps } from "./checkbox";

export { Toggle } from "./toggle";
export type { ToggleProps } from "./toggle";

export { Slider } from "./slider";
export type { SliderProps } from "./slider";

export { ProgressBar } from "./progress-bar";
export type { ProgressBarProps } from "./progress-bar";

export { TextField, isEditingText } from "./text-field";
export type { TextFieldProps, TextFieldSlot } from "./text-field";

export { SearchField } from "./search-field";
export type { SearchFieldProps } from "./search-field";

export { Breadcrumbs, PathBar } from "./breadcrumbs";
export type { BreadcrumbSegment, BreadcrumbsProps, PathBarProps } from "./breadcrumbs";

export { ContextMenu, OpenWithPicker, contextMenuSurfaceSize } from "./context-menu";
export { DisplayArrangement } from "./display-arrangement";
export type { DisplayArrangementItem, DisplayArrangementProps } from "./display-arrangement";
export type {
  ContextMenuAction,
  ContextMenuProps,
  OpenWithChoice,
  OpenWithPickerProps,
} from "./context-menu";

export {
  Box,
  Row,
  Column,
  Horizontal,
  Vertical,
  Stack,
  Align,
  Center,
  Inset,
  Padding,
  Spacer,
  Measure,
  useLayoutMetrics,
  registerIntrinsicSize,
  measureColumnContent,
} from "./layout";
export type {
  BoxProps,
  RowProps,
  ColumnProps,
  StackProps,
  StackAlignment,
  AlignProps,
  CenterProps,
  InsetProps,
  SpacerProps,
  Insets,
  MeasureProps,
  LayoutMetrics,
  FlexItemProps,
} from "./layout";

export {
  Label,
  TextBlock,
  measureWrappedText,
  Surface,
  Panel,
  FocusRing,
  Separator,
  Divider,
  usePalette,
} from "./primitives";
export type {
  LabelProps,
  WrappedTextStyle,
  SurfaceProps,
  PanelProps,
  FocusRingProps,
  SeparatorProps,
} from "./primitives";

export { FocusScope, ShortcutManager } from "./focus";
export type { FocusScopeProps, ShortcutManagerProps, Shortcut } from "./focus";

export {
  OverlayHost,
  OverlayPortal,
  ModalBarrier,
  Popover,
  Sheet,
  ConfirmationDialog,
  ToastHost,
} from "./overlay";
export type {
  OverlayHostProps,
  OverlayPortalProps,
  ModalBarrierProps,
  PopoverProps,
  PopoverPlacement,
  SheetProps,
  ConfirmationDialogProps,
  ToastHostProps,
  ToastItem,
} from "./overlay";

export { Select, ComboBox } from "./select";
export type { SelectProps, ComboBoxProps, SelectOption } from "./select";

export { Dialog } from "./dialog";
export type { DialogProps } from "./dialog";

export { Toolbar } from "./toolbar";
export type { ToolbarProps } from "./toolbar";

export { Tooltip } from "./tooltip";
export type { TooltipProps, TooltipPlacement } from "./tooltip";

export { Disclosure } from "./disclosure";
export type { DisclosureProps } from "./disclosure";

export { ProgressRow } from "./progress-row";
export type { ProgressRowProps } from "./progress-row";

export { SplitView } from "./split-view";
export type { SplitViewProps, SplitViewOrientation } from "./split-view";

export { Pagination } from "./pagination";
export type { PaginationProps } from "./pagination";

export { PropertyList } from "./property-list";
export type { PropertyListProps, PropertyListSection, PropertyListItem } from "./property-list";

export { NavigationSidebar } from "./navigation-sidebar";
export type {
  NavigationSidebarProps,
  NavigationSidebarSection,
  NavigationSidebarItem,
} from "./navigation-sidebar";

export { SegmentedControl, IconSegmentedControl, RadioGroup } from "./controls";
export type {
  SegmentedControlProps,
  SegmentedControlOption,
  IconSegmentedControlProps,
  IconSegmentedControlOption,
  RadioGroupProps,
  RadioOption,
} from "./controls";

export { NavigationRail } from "./navigation-rail";
export type {
  NavigationRailProps,
  NavigationRailSection,
  NavigationRailItem,
  NavigationRailAction,
} from "./navigation-rail";

export { FilterChip, ChipGroup, filterChipWidth, filterChipHeight } from "./filter-chip";
export type { FilterChipProps, ChipGroupProps, ChipGroupItem } from "./filter-chip";

export { TokenField } from "./token-field";
export type { TokenFieldProps, TokenFieldToken, TokenFieldCompletion } from "./token-field";

export { SelectionBar, selectionBarHeight } from "./selection-bar";
export type { SelectionBarProps, SelectionBarAction } from "./selection-bar";

export { FileTile, fileTileHeight } from "./file-tile";
export type { FileTileProps } from "./file-tile";

export { ItemCard } from "./item-card";
export type { ItemCardProps } from "./item-card";

export { HoverActions, hoverActionsWidth } from "./hover-actions";
export type { HoverActionsProps, HoverAction } from "./hover-actions";

export { Badge, Banner, Spinner, EmptyState } from "./feedback";
export type { BadgeProps, BadgeTone, BannerProps, SpinnerProps, EmptyStateProps } from "./feedback";

export { CodeView, codeLanguageFor } from "./code-view";
export type { CodeViewProps, CodeLanguage } from "./code-view";
export { MarkdownView, type MarkdownViewProps } from "./markdown-view";

export { RichTextView } from "./rich-text";
export type { RichTextViewProps, RichTextLine, RichTextRun } from "./rich-text";

export { TerminalView } from "./terminal-view";
export type { TerminalViewProps, TerminalCursor, TerminalGridMetrics } from "./terminal-view";
export { measureTerminalGrid } from "./terminal-view";

export { StatusBar } from "./status-bar";
export type { StatusBarProps } from "./status-bar";

export {
  LineChart,
  AreaChart,
  BarChart,
  StackedBarChart,
  ScatterChart,
  Sparkline,
  DonutChart,
  RadialChart,
  HeatmapChart,
  ChartLegend,
} from "./chart";
export type {
  ChartPoint,
  ChartSeries,
  ChartHover,
  CartesianChartProps,
  LineChartProps,
  AreaChartProps,
  BarChartProps,
  ScatterChartProps,
  SparklineProps,
  DonutDatum,
  DonutChartProps,
  RadialChartProps,
  HeatmapCell,
  HeatmapChartProps,
} from "./chart";

export { TextArea, type TextAreaCommand, type TextAreaProps, type TextRange } from "./text-area";

export { ContentCard, ScrollColumn } from "./content-flow";
export type { ContentCardProps, ScrollColumnProps } from "./content-flow";

/* ---------- Inspector parts ---------- */
export { propertyListHeight, type PropertyListDensity } from "./property-list";
export { MetaPill, metaPillWidth, metaPillHeight, type MetaPillProps } from "./meta-pill";
export {
  TagChip,
  tagChipWidth,
  tagChipHeight,
  layoutTagChips,
  type TagChipProps,
  type TagChipVariant,
  type TagChipLayoutItem,
} from "./tag-chip";
export {
  ColourStrip,
  colourStripWidth,
  Histogram,
  type ColourStripProps,
  type HistogramProps,
} from "./colour-strip";
export {
  StackedBar,
  stackedBarHeight,
  type StackedBarProps,
  type StackedBarSegment,
} from "./stacked-bar";
export {
  PageStepper,
  pageStepperWidth,
  pageStepperHeight,
  type PageStepperProps,
} from "./page-stepper";
