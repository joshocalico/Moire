/**
 * @moire/ui widget suite — OS-agnostic React components on @moire/react-host.
 * No Wayland / koffi / platform imports anywhere in this tree.
 *
 * All interactive widgets are in individual modules; re-exported here.
 */
/* ---------- Re-exports from split modules ---------- */

export { Pressable } from "./pressable";
export type { PressableProps } from "./pressable";

export { Button } from "./button";
export type { ButtonProps, ButtonVariant, ButtonSize, ButtonSlot } from "./button";

export { IconButton } from "./icon-button";
export type { IconButtonProps, IconButtonSlot, IconButtonVariant } from "./icon-button";

export {
  WidgetThemeProvider,
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
export type { ScrollAreaProps } from "./scroll";

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

export { Icon } from "./icon";
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

export { TextField } from "./text-field";
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
  Surface,
  Panel,
  FocusRing,
  Separator,
  Divider,
  usePalette,
} from "./primitives";
export type {
  LabelProps,
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

export { SegmentedControl, RadioGroup } from "./controls";
export type {
  SegmentedControlProps,
  SegmentedControlOption,
  RadioGroupProps,
  RadioOption,
} from "./controls";

export { Badge, Banner, Spinner, EmptyState } from "./feedback";
export type { BadgeProps, BadgeTone, BannerProps, SpinnerProps, EmptyStateProps } from "./feedback";

export { CodeView } from "./code-view";
export type { CodeViewProps, CodeLanguage } from "./code-view";

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
