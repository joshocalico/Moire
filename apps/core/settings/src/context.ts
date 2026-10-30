/** Everything a page is built from: the live models, the layout and the app's navigation. */
import type { PageId, Route } from "./catalog";
import type { Apps } from "./apps-state";
import type { DesktopStatus } from "./desktop-state";
import type { DisplaySettings } from "./pages/displays-state";
import type { RecentFiles } from "./pages/privacy";
import type { Layout, Navigation } from "./model";
import type { JournalEntry } from "./history";
import type { Journal, Prefs } from "./prefs-state";
import type { SearchSettings } from "./search";
import type { Launcher } from "./services";
import type { Storage } from "./storage-state";
import type { SystemInfo } from "./system-info";
import type { SettingsCalls } from "./settings-clients";
import type {
  TimeSettingsClient,
  TimeSettingsState,
  TimeStatus,
  TimeZoneEntry,
} from "@moire/system-management/time-settings";
import type {
  InputSettingsClient,
  InputSettingsState,
  KeyboardLayoutCatalog,
} from "@moire/system-management/input-settings";
import type {
  PowerSettingsClient,
  PowerSettingsState,
} from "@moire/system-management/power-settings";
import type {
  AccountsSettingsClient,
  AccountsSettingsState,
  AccountsStatus,
} from "@moire/system-management/accounts-settings";
import type {
  LoginSettingsClient,
  LoginSettingsState,
  LoginStatus,
} from "@moire/system-management/login-settings";

import type { BrightnessClient, BrightnessStatus } from "@moire/system-management/brightness";
import type { ServiceClientState } from "@moire/system-management/settings-service";
import type { DaylightContext } from "@moire/prefs";

/** File choosers the app owns, above every page; a page can ask for one of its own. */
export type Chooser =
  | "wallpaper"
  | "avatar"
  | {
      title: string;
      accept: readonly string[];
      onChoose: (file: string) => void;
    };

export type TimeModel = {
  client: TimeSettingsClient | null;
  state: TimeSettingsState | null;
  status: Extract<TimeStatus, { kind: "ready" }> | null;
  /** The zone catalog once read; `loadZones` reads it. */
  zones: readonly TimeZoneEntry[] | null;
  loadZones(): void;
};

export type InputModel = {
  client: InputSettingsClient | null;
  state: InputSettingsState | null;
  /** The layout catalog once read; `loadCatalog` reads it. */
  catalog: KeyboardLayoutCatalog | null;
  loadCatalog(): void;
};

export type PowerModel = {
  client: PowerSettingsClient | null;
  state: PowerSettingsState | null;
};

export type BrightnessModel = {
  client: BrightnessClient | null;
  state: ServiceClientState<BrightnessStatus> | null;
};

/** What evening schedules are judged by: the zone, where it roughly is, and the time now. */
export type DaylightModel = DaylightContext & { now: Date };

export type AccountsModel = {
  client: AccountsSettingsClient | null;
  state: AccountsSettingsState | null;
  status: Extract<AccountsStatus, { kind: "ready" }> | null;
};

/** Automatic login; changing it raises the system's password prompt. */
export type LoginModel = {
  client: LoginSettingsClient | null;
  state: LoginSettingsState | null;
  status: Extract<LoginStatus, { kind: "ready" }> | null;
};

export type PageContext = Layout &
  Navigation & {
    /** The page on screen; pages that poll or discover only do so while visible. */
    route: Route;
    prefs: Prefs;
    journal: Journal;
    desktop: DesktopStatus;
    display: DisplaySettings;
    search: SearchSettings;
    storage: Storage;
    apps: Apps;
    recent: RecentFiles;
    time: TimeModel;
    accounts: AccountsModel;
    login: LoginModel;
    input: InputModel;
    power: PowerModel;
    brightness: BrightnessModel;
    daylight: DaylightModel;
    /** Calls to the system settings services, by name while they run. */
    calls: SettingsCalls;
    system: SystemInfo;
    /** Failures reported per page, shown as a banner at its top. */
    errors: Partial<Record<PageId, string>>;
    launch: Launcher;
    copyText: (text: string) => Promise<void>;
    openChooser: (chooser: Chooser) => void;
    /** Put a journalled change back. */
    undo: (entry: JournalEntry) => void;
    /** Run an action and report its failure on `page`. */
    attempt: (page: PageId, action: () => Promise<string | null> | string | null) => void;
  };
