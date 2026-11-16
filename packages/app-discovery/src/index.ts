export type { DesktopEntry } from "./desktop";
export { parseDesktopFile } from "./desktop";
export { applicationDisplayName, applicationOwnsWindow } from "./names";
export {
  discoverApplications,
  filterApplications,
  resolveApplicationIcon,
  xdgDataDirs,
} from "./applications";

export {
  MimeAssociationDatabase,
  buildDesktopExec,
  buildDesktopExecForUris,
  loadMimeAssociationDatabase,
  type MimeAssociationSnapshot,
} from "./mime";
export {
  ContextActionRegistry,
  type ContextAction,
  type ContextActionPlugin,
  type FileActionContext,
  type FileActionSource,
  type FileActionScope,
} from "./actions";
export {
  FileActivationService,
  type FileActivation,
  type FileActivationLauncher,
  type ApplicationChoiceModelOptions,
  type OpenWithChoice,
  type OpenWithModel,
} from "./open-with";
export { FileActivationPortalClient, type FileChooserResponse } from "./portal-client";
export { enterableFolder, findTerminal, terminalLaunch, type TerminalLaunch } from "./terminal";
