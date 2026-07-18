/**
 * @moire/ui — portable Qt/GTK-style app SDK for Moire (and later other OSes).
 *
 * Widgets / fonts / layout never import Wayland. Window I/O goes through
 * PlatformBackend (wayland | headless; cocoa/win32 later).
 */
export { Application, type ApplicationOpts } from "./application.js";
export { Window, hitTestDropData, type WindowOpts, type WindowSize, type WindowContent } from "./window.js";
export {
  createPlatformBackend,
  resolvePlatformKind,
  type PlatformBackend,
  type PlatformWindow,
  type PlatformWindowOpts,
  type PlatformKind,
  type UiPointerEvent,
  type UiKeyEvent,
  type PointerButton,
  type UiDataTransferItem,
  type UiDataTransfer,
  type DndCapable,
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
export { createMotionValue, easeTo, tickAllMotions, type MotionValue } from "./motion.js";

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
  OpenWithPicker,
  Pressable,
  ImageWidget,
  Icon,
  Draggable,
  DropTarget,
  DropZone,
  setDndBridge,
  usePalette,
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
} from "./widgets/index.js";
