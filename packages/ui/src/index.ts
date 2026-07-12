/**
 * @moire/ui — portable Qt/GTK-style app SDK for Moire (and later other OSes).
 *
 * Widgets / fonts / layout never import Wayland. Window I/O goes through
 * PlatformBackend (wayland | headless; cocoa/win32 later).
 */
export { Application, type ApplicationOpts } from "./application.js";
export { Window, type WindowOpts, type WindowSize, type WindowContent } from "./window.js";
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
  Tabs,
  Dialog,
  Menu,
  MenuItem,
  usePalette,
} from "./widgets/index.js";
export type {
  LabelProps,
  ButtonProps,
  SurfaceProps,
  RowProps,
  ColumnProps,
  CheckboxProps,
  ToggleProps,
  SliderProps,
  TextFieldProps,
  TabsProps,
  DialogProps,
  ListProps,
} from "./widgets/index.js";
