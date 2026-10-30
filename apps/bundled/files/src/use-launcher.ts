/** Opening files: the default application, Open With, and the application chooser. */
import path from "node:path";
import { useEffect, useMemo, useState } from "react";
import {
  FileActivationPortalClient,
  FileActivationService,
  findTerminal,
  terminalLaunch,
  type DesktopEntry,
} from "@moire/app-discovery";
import { operationError, type OpenWithApplication } from "@moire/file-operations";
import { FileLauncher, launchFailureNotice } from "./activation";

export type FileAssociation = {
  mime: string;
  /** ".jpg"; empty when the name has none. */
  extension: string;
  applications: ReadonlyArray<{ id: string; name: string }>;
  defaultId: string | null;
};

export function useLauncher(onError: (message: string) => void) {
  const launcher = useMemo(() => new FileLauncher(), []);
  useEffect(
    () =>
      launcher.observeFailures((failure) => {
        console.error("[files] File activation failed", failure);
        onError(launchFailureNotice(failure));
      }),
    [launcher, onError],
  );
  const activation = useMemo(
    () => new FileActivationService((value) => launcher.launchDesktop(value)),
    [launcher],
  );
  const portal = useMemo(() => new FileActivationPortalClient(), []);
  // Scanning the installed applications reads many files; it happens once, after the first frame.
  const [terminal, setTerminal] = useState<DesktopEntry | null>(null);
  useEffect(() => setTerminal(findTerminal()), []);
  return {
    open(file: string) {
      try {
        if (!activation.openDefault(file)) launcher.launchFallback(file);
      } catch (error) {
        onError(`Could not open ${path.basename(file)}. ${operationError(error)}`);
      }
    },
    /** Applications registered for the file's type, for the Open With submenu. */
    applicationsFor(file: string): OpenWithApplication[] {
      const mime = activation.mimeDatabase.mimeTypeForPath(file);
      return activation.mimeDatabase
        .applicationsForMime(mime)
        .map((application) => ({ id: application.id, name: application.name }));
    },
    /**
     * The file's type and the applications for it, with the default, for "Opens with".
     * Null when the type is unknown to the MIME database.
     */
    association(file: string): FileAssociation | null {
      try {
        const mime = activation.mimeDatabase.mimeTypeForPath(file);
        const applications = activation.mimeDatabase
          .applicationsForMime(mime)
          .map((application) => ({ id: application.id, name: application.name }));
        const fallback = activation.mimeDatabase.defaultApplicationForMime(mime);
        return {
          mime,
          extension: path.extname(file).toLowerCase(),
          applications,
          defaultId: fallback?.id ?? null,
        };
      } catch {
        return null;
      }
    },
    /** Make an application the default for a type (written to mimeapps.list). */
    setDefault(mime: string, applicationId: string): boolean {
      try {
        return activation.setDefaultApplication(mime, applicationId);
      } catch (error) {
        onError(`Could not change the default application. ${operationError(error)}`);
        return false;
      }
    },
    /** The name people know an app by, from the id its recent list is filed under. */
    applicationName(appId: string): string {
      return activation.applicationName(appId);
    },
    openWith(file: string, applicationId: string) {
      if (!activation.openWith(file, applicationId))
        onError("That application is no longer installed. Choose another with Open With.");
    },
    chooseApplication(file: string) {
      void portal
        .openWith(file)
        .then((response) => {
          if (response === 1) return;
          if (response === 2) {
            onError(`Could not open the application chooser for ${path.basename(file)}.`);
            return;
          }
          activation.refreshAssociations();
        })
        .catch((error) => {
          console.error("[files] Open With failed", error);
          onError(
            `Could not open the application chooser for ${path.basename(file)}. ${operationError(error)}`,
          );
        });
    },
    /** Opens a terminal in a folder; absent when no terminal emulator is installed. */
    openTerminal: terminal
      ? (directory: string) => {
          launcher.launchTerminal(directory, terminalLaunch(terminal, directory));
        }
      : undefined,
    /** A folder in the system's file manager, when Files cannot open a window itself. */
    openExternally(directory: string) {
      launcher.launchFallback(directory);
    },
  };
}
