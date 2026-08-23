/**
 * @moire/ui widget suite — OS-agnostic React components on @moire/react-host.
 * No Wayland / koffi / platform imports anywhere in this tree.
 *
 * All interactive widgets are in individual modules; re-exported here.
 */
/* ---------- Re-exports from split modules ---------- */

export { Pressable } from "./pressable.js";
export type { PressableProps } from "./pressable.js";

export { Button } from "./button.js";
export type {
  ButtonProps,
  ButtonVariant,
  ButtonSize,
  ButtonSlot,
} from "./button.js";

export { IconButton } from "./icon-button.js";
export type {
  IconButtonProps,
  IconButtonSlot,
  IconButtonVariant,
} from "./icon-button.js";

export {
  WidgetThemeProvider,
  createWidgetTheme,
  getWidgetTheme,
  resolveStatefulStyle,
  useWidgetTheme,
} from "../widget-theme.js";
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
} from "../widget-theme.js";

export { ScrollArea } from "./scroll.js";
export type { ScrollAreaProps } from "./scroll.js";

export { List, ListItem } from "./list.js";
export type { ListProps, ListItemProps, ListItemSlot } from "./list.js";

export { VirtualList } from "./virtual-list.js";
export type { VirtualListProps } from "./virtual-list.js";

export { Table } from "./table.js";
export type {
  TableProps,
  TableColumn,
  TableSort,
  TableSortDirection,
} from "./table.js";

export { TreeView } from "./tree-view.js";
export type { TreeViewProps, TreeNode } from "./tree-view.js";

export { Grid, GridItem } from "./grid.js";
export type { GridProps, GridItemProps } from "./grid.js";

export { ImageWidget } from "./image-widget.js";
export type { ImageWidgetProps, ImageFit } from "./image-widget.js";

export { Icon } from "./icon.js";
export type { IconProps, IconName } from "./icon.js";

export {
  Draggable,
  DropTarget,
  DropZone,
  DndFeedback,
  setDndBridge,
} from "./dnd.js";
export type {
  DraggableProps,
  DropTargetProps,
  DropZoneProps,
  DragIconSpec,
  DragPreviewSpec,
  DragSourceOptions,
  DragSourceController,
  DndFeedbackKind,
} from "./dnd.js";
export { useDragSource } from "./dnd.js";

export { CollectionItem, ContextMenuTrigger } from "./interaction.js";
export type {
  CollectionItemProps,
  ContextMenuTriggerProps,
} from "./interaction.js";

export { Tabs } from "./tabs.js";
export type { TabsProps, TabItem, TabSlot } from "./tabs.js";

export { Menu, MenuItem } from "./menu.js";
export type {
  MenuProps,
  MenuEntry,
  MenuItemProps,
  MenuItemSlot,
  MenuTrailingSlot,
} from "./menu.js";

export { Checkbox } from "./checkbox.js";
export type { CheckboxProps } from "./checkbox.js";

export { Toggle } from "./toggle.js";
export type { ToggleProps } from "./toggle.js";

export { Slider } from "./slider.js";
export type { SliderProps } from "./slider.js";

export { ProgressBar } from "./progress-bar.js";
export type { ProgressBarProps } from "./progress-bar.js";

export { TextField } from "./text-field.js";
export type { TextFieldProps, TextFieldSlot } from "./text-field.js";

export { SearchField } from "./search-field.js";
export type { SearchFieldProps } from "./search-field.js";

export { Breadcrumbs, PathBar } from "./breadcrumbs.js";
export type {
  BreadcrumbSegment,
  BreadcrumbsProps,
  PathBarProps,
} from "./breadcrumbs.js";

export {
  ContextMenu,
  OpenWithPicker,
  contextMenuSurfaceSize,
} from "./context-menu.js";
export { DisplayArrangement } from "./display-arrangement.js";
export type {
  DisplayArrangementItem,
  DisplayArrangementProps,
} from "./display-arrangement.js";
export type {
  ContextMenuAction,
  ContextMenuProps,
  OpenWithChoice,
  OpenWithPickerProps,
} from "./context-menu.js";

export { Box, Row, Column } from "./layout.js";
export type { BoxProps, RowProps, ColumnProps } from "./layout.js";

export {
  Label,
  Surface,
  Panel,
  Separator,
  Divider,
  usePalette,
} from "./primitives.js";
export type {
  LabelProps,
  SurfaceProps,
  PanelProps,
  SeparatorProps,
} from "./primitives.js";

export { Dialog } from "./dialog.js";
export type { DialogProps } from "./dialog.js";

export { Toolbar } from "./toolbar.js";
export type { ToolbarProps } from "./toolbar.js";

export { Tooltip } from "./tooltip.js";
export type { TooltipProps, TooltipPlacement } from "./tooltip.js";

export { Disclosure } from "./disclosure.js";
export type { DisclosureProps } from "./disclosure.js";

export { ProgressRow } from "./progress-row.js";
export type { ProgressRowProps } from "./progress-row.js";

export { SplitView } from "./split-view.js";
export type { SplitViewProps, SplitViewOrientation } from "./split-view.js";

export { Pagination } from "./pagination.js";
export type { PaginationProps } from "./pagination.js";

export { PropertyList } from "./property-list.js";
export type {
  PropertyListProps,
  PropertyListSection,
  PropertyListItem,
} from "./property-list.js";

export { NavigationSidebar } from "./navigation-sidebar.js";
export type {
  NavigationSidebarProps,
  NavigationSidebarSection,
  NavigationSidebarItem,
} from "./navigation-sidebar.js";

export { SegmentedControl, RadioGroup } from "./controls.js";
export type {
  SegmentedControlProps,
  SegmentedControlOption,
  RadioGroupProps,
  RadioOption,
} from "./controls.js";

export { Badge, Banner, Spinner, EmptyState } from "./feedback.js";
export type {
  BadgeProps,
  BadgeTone,
  BannerProps,
  SpinnerProps,
  EmptyStateProps,
} from "./feedback.js";

export { CodeView } from "./code-view.js";
export type { CodeViewProps, CodeLanguage } from "./code-view.js";

export { RichTextView } from "./rich-text.js";
export type {
  RichTextViewProps,
  RichTextLine,
  RichTextRun,
} from "./rich-text.js";

export { TerminalView } from "./terminal-view.js";
export type {
  TerminalViewProps,
  TerminalCursor,
  TerminalGridMetrics,
} from "./terminal-view.js";
export { measureTerminalGrid } from "./terminal-view.js";

export { StatusBar } from "./status-bar.js";
export type { StatusBarProps } from "./status-bar.js";
