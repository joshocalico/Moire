/**
 * @moire/ui — portable Qt/GTK-style app SDK for Moire (and later other OSes).
 *
 * Widgets / fonts / layout never import Wayland. Window I/O goes through
 * PlatformBackend (wayland | headless; cocoa/win32 later).
 */
export { Application, type ApplicationOpts } from "./application.js";
export {
  Window,
  hitTestDropData,
  type WindowOpts,
  type WindowSize,
  type WindowContent,
  type PopupOptions,
  type PopupHandle,
} from "./window.js";
export {
  createPlatformBackend,
  resolvePlatformKind,
  type PlatformBackend,
  type PlatformWindow,
  type PlatformWindowOpts,
  type PlatformPopupOpts,
  type PlatformKind,
  type UiPointerEvent,
  type UiKeyEvent,
  type UiKeyModifiers,
  type PointerButton,
  type UiDataTransferItem,
  type UiDataTransfer,
  type DndCapable,
  keyFromEvdev,
  modifiersFromPressed,
} from "./platform.js";
export {
  installUiFonts,
  installUiFontsIfReady,
  setUiScaleFactor,
  getUiScaleFactor,
  getFontEngine,
  FontEngine,
  type FontFamily,
  type FontWeight,
  type TextStyle,
} from "./font/index.js";
export { layoutFlex, type FlexChildSpec, type FlexContainerOpts } from "./layout/index.js";
export { themePalette, getTheme, loadTheme, hexToArgb } from "./theme.js";
export type { MoireTheme, ThemePalette, MoireTokens } from "./theme.js";

// Motion system
export {
  createMotionValue,
  useMotionValue,
  easeTo,
  tickAllMotions,
  type MotionValue,
} from "./motion.js";

// Image loading
export { loadImage, getCachedImage, clearImageCache, type ImageData } from "./image/load.js";

// Theme design tokens (re-exported for widget consumers)
export { TYPE_ROLES, SPACE } from "@moire/theme";

export {
  Box,
  Row,
  Column,
  Label,
  Surface,
  Panel,
  Separator,
  Divider,
  Button,
  IconButton,
  Checkbox,
  Toggle,
  Slider,
  TextField,
  Breadcrumbs,
  PathBar,
  ProgressBar,
  ScrollArea,
  List,
  ListItem,
  Grid,
  GridItem,
  Tabs,
  Dialog,
  Menu,
  MenuItem,
  ContextMenu,
  contextMenuSurfaceSize,
  OpenWithPicker,
  Pressable,
  ImageWidget,
  Icon,
  Draggable,
  CollectionItem,
  ContextMenuTrigger,
  DropTarget,
  DropZone,
  setDndBridge,
  useDragSource,
  usePalette,
  DisplayArrangement,
} from "./widgets/index.js";
export type {
  BoxProps,
  LabelProps,
  ButtonProps,
  ButtonVariant,
  SurfaceProps,
  PanelProps,
  RowProps,
  ColumnProps,
  CheckboxProps,
  ToggleProps,
  SliderProps,
  TextFieldProps,
  BreadcrumbSegment,
  BreadcrumbsProps,
  PathBarProps,
  ProgressBarProps,
  ScrollAreaProps,
  ListProps,
  ListItemProps,
  GridProps,
  GridItemProps,
  TabsProps,
  DialogProps,
  MenuProps,
  MenuItemProps,
  ContextMenuAction,
  ContextMenuProps,
  OpenWithChoice,
  OpenWithPickerProps,
  PressableProps,
  ImageWidgetProps,
  ImageFit,
  IconProps,
  IconName,
  DraggableProps,
  DropTargetProps,
  DropZoneProps,
  DragIconSpec,
  DragPreviewSpec,
  DragSourceOptions,
  DragSourceController,
  CollectionItemProps,
  ContextMenuTriggerProps,
  DisplayArrangementItem,
  DisplayArrangementProps,
} from "./widgets/index.js";
