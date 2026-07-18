import path from "node:path";
import {
  discoverApplications,
  resolveApplicationIcon,
} from "./applications.js";
import type { DesktopEntry } from "./desktop.js";
import {
  buildDesktopExec,
  loadMimeAssociationDatabase,
  type MimeAssociationDatabase,
} from "./mime.js";

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
    applications = discoverApplications(
      process.env.XDG_CURRENT_DESKTOP ?? "Moire",
    ),
    mimeDatabase = loadMimeAssociationDatabase(applications),
  ) {
    // Normalize desktop-file ids once at the service boundary. Malformed caches
    // must not create duplicate React keys or ambiguous launch targets.
    this.applications = [
      ...new Map(applications.map((app) => [app.id, app] as const)).values(),
    ];
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
        [...recommended, ...this.applications].map(
          (app) => [app.id, app] as const,
        ),
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
  applicationChoiceModel(
    options: ApplicationChoiceModelOptions,
  ): OpenWithModel {
    const recommendedIds = new Set(
      this.mimeDatabase
        .applicationsForMime(options.mimeType)
        .map((app) => app.id),
    );
    const defaultId = this.mimeDatabase.defaultApplicationForMime(
      options.mimeType,
    )?.id;
    const applicationsById = new Map<string, DesktopEntry>();
    for (const app of this.applications) {
      applicationsById.set(app.id, app);
      applicationsById.set(app.id.replace(/\.desktop$/, ""), app);
    }
    const ids = options.applicationIds.length
      ? options.applicationIds
      : this.mimeDatabase
          .applicationsForMime(options.mimeType)
          .map((app) => app.id);
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
          recommended:
            recommendedIds.has(app.id) || recommendedIds.has(id),
          isDefault: app.id === defaultId,
        },
      ];
    });
    const selectedId =
      options.selectedId && choices.some(({ id }) => id === options.selectedId)
        ? options.selectedId
        : (choices.find(({ isDefault }) => isDefault)?.id ??
          choices[0]?.id ??
          null);
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
    return application
      ? this.activate(filePath, mimeType, application)
      : null;
  }

  openWith(
    filePath: string,
    desktopId: string,
    makeDefault = false,
  ): FileActivation | null {
    const mimeType = this.mimeDatabase.mimeTypeForPath(filePath);
    const application = this.applications.find((app) => app.id === desktopId);
    if (!application) return null;
    if (makeDefault) {
      this.mimeDatabase.setDefaultApplication(mimeType, desktopId);
    }
    return this.activate(filePath, mimeType, application);
  }

  private activate(
    filePath: string,
    mimeType: string,
    application: DesktopEntry,
  ): FileActivation {
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
