export type { DesktopEntry } from "./desktop.js";
export { parseDesktopFile } from "./desktop.js";
export {
  discoverApplications,
  filterApplications,
  resolveApplicationIcon,
  xdgDataDirs,
} from "./applications.js";

export {
  MimeAssociationDatabase,
  buildDesktopExec,
  loadMimeAssociationDatabase,
  type MimeAssociationSnapshot,
} from "./mime.js";
export {
  ContextActionRegistry,
  type ContextAction,
  type ContextActionPlugin,
  type FileActionContext,
  type FileActionSource,
  type FileActionScope,
} from "./actions.js";
export {
  FileActivationService,
  type FileActivation,
  type FileActivationLauncher,
  type ApplicationChoiceModelOptions,
  type OpenWithChoice,
  type OpenWithModel,
} from "./open-with.js";
