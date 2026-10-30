import path from "node:path";
import { discoverApplications, resolveApplicationIcon } from "./applications";
import type { DesktopEntry } from "./desktop";
import { applicationDisplayName } from "./names";
import {
  buildDesktopExec,
  buildDesktopExecForUris,
  loadMimeAssociationDatabase,
  type MimeAssociationDatabase,
} from "./mime";

export type OpenWithChoice = {
  id: string;
  name: string;
  description: string;
  iconPath?: string;
  recommended: boolean;
  isDefault: boolean;
};

export type OpenWithModel = {
  filePath: string;
  fileName: string;
  mimeType: string;
  choices: OpenWithChoice[];
  selectedId: string | null;
};

export type ApplicationChoiceModelOptions = {
  fileName: string;
  mimeType: string;
  applicationIds: string[];
  selectedId?: string | null;
};

export type FileActivation = {
  filePath: string;
  mimeType: string;
  application: DesktopEntry;
  command: string;
};

export type FileActivationLauncher = (activation: FileActivation) => void;

/**
 * Canonical policy for file activation and Open With presentation.
 *
 * This class deliberately owns no process or UI primitives. Native clients can
 * host it directly today, and a session D-Bus/portal service can host the same
 * contract later without changing how choices or defaults are calculated.
 */
export class FileActivationService {
  readonly applications: DesktopEntry[];
  readonly mimeDatabase: MimeAssociationDatabase;

  constructor(
    private readonly launch: FileActivationLauncher,
    applications = discoverApplications(process.env.XDG_CURRENT_DESKTOP ?? "Moire"),
    mimeDatabase = loadMimeAssociationDatabase(applications),
  ) {
    // Normalize desktop-file ids once at the service boundary. Malformed caches
    // must not create duplicate React keys or ambiguous launch targets.
    this.applications = [...new Map(applications.map((app) => [app.id, app] as const)).values()];
    this.mimeDatabase = mimeDatabase;
  }

  refreshAssociations(): void {
    this.mimeDatabase.refresh();
  }

  openWithModel(filePath: string): OpenWithModel {
    const mimeType = this.mimeDatabase.mimeTypeForPath(filePath);
    const recommended = this.mimeDatabase.applicationsForMime(mimeType);
    const recommendedIds = new Set(recommended.map((app) => app.id));
    const ordered = [
      ...new Map(
        [...recommended, ...this.applications].map((app) => [app.id, app] as const),
      ).values(),
    ];
    const defaultId = this.mimeDatabase.defaultApplicationForMime(mimeType)?.id;
    const choices = ordered.map((app) => ({
      id: app.id,
      name: app.name,
      description: app.comment ?? app.genericName ?? app.exec,
      iconPath: resolveApplicationIcon(app.icon),
      recommended: recommendedIds.has(app.id),
      isDefault: app.id === defaultId,
    }));

    return {
      filePath,
      fileName: path.basename(filePath),
      mimeType,
      choices,
      selectedId: defaultId ?? choices[0]?.id ?? null,
    };
  }

  /** Build the same visual model from application ids supplied over D-Bus. */
  applicationChoiceModel(options: ApplicationChoiceModelOptions): OpenWithModel {
    const recommendedIds = new Set(
      this.mimeDatabase.applicationsForMime(options.mimeType).map((app) => app.id),
    );
    const defaultId = this.mimeDatabase.defaultApplicationForMime(options.mimeType)?.id;
    const applicationsById = new Map<string, DesktopEntry>();
    for (const app of this.applications) {
      applicationsById.set(app.id, app);
      applicationsById.set(app.id.replace(/\.desktop$/, ""), app);
    }
    const ids = options.applicationIds.length
      ? options.applicationIds
      : this.mimeDatabase.applicationsForMime(options.mimeType).map((app) => app.id);
    const seen = new Set<string>();
    const choices = ids.flatMap((id): OpenWithChoice[] => {
      if (seen.has(id)) return [];
      seen.add(id);
      const app = applicationsById.get(id);
      if (!app) {
        return [
          {
            id,
            name: id.replace(/\.desktop$/, ""),
            description: "Installed application",
            recommended: true,
            isDefault: id === defaultId || `${id}.desktop` === defaultId,
          },
        ];
      }
      return [
        {
          id,
          name: app.name,
          description: app.comment ?? app.genericName ?? app.exec,
          iconPath: resolveApplicationIcon(app.icon),
          recommended: recommendedIds.has(app.id) || recommendedIds.has(id),
          isDefault: app.id === defaultId,
        },
      ];
    });
    const selectedId =
      options.selectedId && choices.some(({ id }) => id === options.selectedId)
        ? options.selectedId
        : (choices.find(({ isDefault }) => isDefault)?.id ?? choices[0]?.id ?? null);
    return {
      filePath: "",
      fileName: options.fileName,
      mimeType: options.mimeType,
      choices,
      selectedId,
    };
  }

  openDefault(filePath: string): FileActivation | null {
    const mimeType = this.mimeDatabase.mimeTypeForPath(filePath);
    const application = this.mimeDatabase.defaultApplicationForMime(mimeType);
    return application ? this.activate(filePath, mimeType, application) : null;
  }

  openWith(filePath: string, desktopId: string, makeDefault = false): FileActivation | null {
    const mimeType = this.mimeDatabase.mimeTypeForPath(filePath);
    const application = this.applicationForId(desktopId);
    if (!application) return null;
    if (makeDefault) {
      this.mimeDatabase.setDefaultApplication(mimeType, application.id);
    }
    return this.activate(filePath, mimeType, application);
  }

  /** The MIME type that selects a handler for a non-file URI: `x-scheme-handler/<scheme>`. */
  static schemeMimeType(uri: string): string | null {
    const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(uri)?.[1]?.toLowerCase();
    return scheme && scheme !== "file" ? `x-scheme-handler/${scheme}` : null;
  }

  /**
   * Hand a non-file URI (`https:`, `mailto:`) to an application: the given one, else the default
   * for its scheme. The URI is only ever an argument to that application's Exec line.
   */
  openUri(uri: string, desktopId?: string): FileActivation | null {
    const mimeType = FileActivationService.schemeMimeType(uri);
    if (!mimeType) return null;
    const application = desktopId
      ? this.applicationForId(desktopId)
      : this.mimeDatabase.defaultApplicationForMime(mimeType);
    if (!application) return null;
    const activation = {
      filePath: uri,
      mimeType,
      application,
      command: buildDesktopExecForUris(application, [uri]),
    };
    this.launch(activation);
    return activation;
  }

  setDefaultApplication(mimeType: string, applicationId: string): boolean {
    const application = this.applicationForId(applicationId);
    if (!application) return false;
    this.mimeDatabase.setDefaultApplication(mimeType, application.id);
    return true;
  }

  /** The display name for an app id as recent-file lists record it. */
  applicationName(appId: string): string {
    return applicationDisplayName(appId, this.applications);
  }

  private applicationForId(applicationId: string): DesktopEntry | undefined {
    const normalized = applicationId.replace(/\.desktop$/, "");
    return this.applications.find(
      (app) => app.id === applicationId || app.id.replace(/\.desktop$/, "") === normalized,
    );
  }

  private activate(filePath: string, mimeType: string, application: DesktopEntry): FileActivation {
    const activation = {
      filePath,
      mimeType,
      application,
      command: buildDesktopExec(application, [filePath]),
    };
    this.launch(activation);
    return activation;
  }
}
