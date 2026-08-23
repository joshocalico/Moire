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
} from "../widget-theme.js";

export { ScrollArea } from "./scroll.js";
export type { ScrollAreaProps } from "./scroll.js";

export { List, ListItem } from "./list.js";
export type { ListProps, ListItemProps, ListItemSlot } from "./list.js";

export { Grid, GridItem } from "./grid.js";
export type { GridProps, GridItemProps } from "./grid.js";

export { ImageWidget } from "./image-widget.js";
export type { ImageWidgetProps, ImageFit } from "./image-widget.js";

export { Icon } from "./icon.js";
export type { IconProps, IconName } from "./icon.js";

export { Draggable, DropTarget, DropZone, setDndBridge } from "./dnd.js";
export type {
  DraggableProps,
  DropTargetProps,
  DropZoneProps,
  DragIconSpec,
  DragPreviewSpec,
  DragSourceOptions,
  DragSourceController,
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
