/**
 * What Settings contains: the sidebar's groups and pages, every searchable setting and section
 * with the words people use for it, and the deep links (`page#anchor`) other apps open.
 *
 * Pages build their rows with these ids, and search shows those same rows, so a setting found
 * by search is always the control on its page. A setting whose backend is missing is simply not
 * built, so search can't offer it either.
 */
import type { IconName } from "@moire/ui";

export const TINT = {
  violet: 0xff8b7cf6,
  blue: 0xff5aa2f0,
  green: 0xff3ecf8e,
  orange: 0xffe8915a,
  pink: 0xffe86a9b,
  teal: 0xff2fbfb3,
  yellow: 0xffe3b341,
  red: 0xffef6b6b,
  slate: 0xff8a94a6,
} as const;

export const GROUPS = [
  { id: "connections", label: "Connections" },
  { id: "devices", label: "Devices" },
  { id: "personal", label: "Personal" },
  { id: "system", label: "System" },
] as const;
export type GroupId = (typeof GROUPS)[number]["id"];

export const PAGES = [
  {
    id: "network",
    group: "connections",
    title: "Wi‑Fi & Network",
    icon: "network",
    tint: TINT.blue,
  },
  { id: "bluetooth", group: "connections", title: "Bluetooth", icon: "bluetooth", tint: TINT.blue },
  { id: "displays", group: "devices", title: "Displays", icon: "monitor", tint: TINT.violet },
  { id: "sound", group: "devices", title: "Sound", icon: "volume", tint: TINT.pink },
  {
    id: "keyboard",
    group: "devices",
    title: "Keyboard & Mouse",
    icon: "keyboard",
    tint: TINT.slate,
  },
  { id: "power", group: "devices", title: "Power & Battery", icon: "battery", tint: TINT.green },
  {
    id: "storage",
    group: "devices",
    title: "Storage & Drives",
    icon: "disk-usage",
    tint: TINT.orange,
  },
  { id: "appearance", group: "personal", title: "Appearance", icon: "colors", tint: TINT.violet },
  { id: "desktop", group: "personal", title: "Desktop & Launcher", icon: "panel", tint: TINT.teal },
  { id: "notifications", group: "personal", title: "Notifications", icon: "bell", tint: TINT.red },
  {
    id: "accessibility",
    group: "personal",
    title: "Accessibility",
    icon: "accessibility",
    tint: TINT.blue,
  },
  { id: "apps", group: "system", title: "Apps & Defaults", icon: "apps", tint: TINT.teal },
  { id: "privacy", group: "system", title: "Search & Privacy", icon: "shield", tint: TINT.green },
  { id: "users", group: "system", title: "Users & Login", icon: "user", tint: TINT.yellow },
  {
    id: "datetime",
    group: "system",
    title: "Date, Time & Region",
    icon: "clock",
    tint: TINT.orange,
  },
  { id: "about", group: "system", title: "About & Updates", icon: "desktop", tint: TINT.slate },
] as const satisfies readonly {
  id: string;
  group: GroupId;
  title: string;
  icon: IconName;
  tint: number;
}[];

export type SidebarPageId = (typeof PAGES)[number]["id"];
/** Overview is the identity card at the top of the sidebar rather than a sidebar row. */
export type PageId = "overview" | SidebarPageId;
export type PageInfo = (typeof PAGES)[number];

export function pageInfo(id: SidebarPageId): PageInfo {
  return PAGES.find((page) => page.id === id)!;
}

export function isPageId(value: string): value is PageId {
  return value === "overview" || PAGES.some((page) => page.id === value);
}

/**
 * A searchable entry. A `setting` is one row with a control; a `section` is a list or card
 * (networks, drives) that search links to rather than reproduces.
 */
export type SettingEntry = {
  /** `<page>.<anchor>`; the row or section id on the page, and the deep link anchor. */
  id: string;
  page: SidebarPageId;
  kind: "setting" | "section";
  label: string;
  /** Shown under the label in search results when the page gives no live description. */
  description: string;
  /** Other words for it: "resolution" finds "screen size", "dark mode" finds Color scheme. */
  keywords: readonly string[];
};

const entry = (
  page: SidebarPageId,
  anchor: string,
  kind: SettingEntry["kind"],
  label: string,
  description: string,
  keywords: readonly string[] = [],
): SettingEntry => ({ id: `${page}.${anchor}`, page, kind, label, description, keywords });
const setting = (
  page: SidebarPageId,
  anchor: string,
  label: string,
  description: string,
  keywords?: readonly string[],
) => entry(page, anchor, "setting", label, description, keywords);
const section = (
  page: SidebarPageId,
  anchor: string,
  label: string,
  description: string,
  keywords?: readonly string[],
) => entry(page, anchor, "section", label, description, keywords);

export const SETTINGS: readonly SettingEntry[] = [
  // Connections
  setting("network", "wifi", "Wi‑Fi", "Turn wireless networking on or off", [
    "wifi",
    "wireless",
    "wlan",
    "internet",
    "radio",
  ]),
  section("network", "networks", "Wi‑Fi networks", "Join a network in range", [
    "wifi",
    "ssid",
    "join",
    "connect",
    "password",
    "hotspot",
    "scan",
  ]),
  setting(
    "network",
    "airplane",
    "Airplane mode",
    "Turns off Wi‑Fi, mobile broadband and Bluetooth",
    ["flight mode", "radios", "rfkill", "offline", "wireless"],
  ),
  setting("network", "hidden", "Join another network…", "A network that doesn't show its name", [
    "hidden network",
    "ssid",
    "wifi",
    "manual",
  ]),
  section("network", "vpn", "VPN", "WireGuard and OpenVPN connections", [
    "wireguard",
    "openvpn",
    "tunnel",
    "vpn import",
    "ovpn",
  ]),
  setting("network", "proxy", "Proxy", "Off, automatic (PAC) or manual", [
    "http proxy",
    "pac",
    "wpad",
    "socks",
  ]),
  section("network", "wired", "Wired connections", "Ethernet and its addresses", [
    "ethernet",
    "cable",
    "lan",
    "ip address",
  ]),
  setting("bluetooth", "power", "Bluetooth", "Turn Bluetooth on or off", ["radio", "wireless"]),
  section("bluetooth", "devices", "My devices", "Paired keyboards, mice and headphones", [
    "paired",
    "connect",
    "headphones",
    "keyboard",
    "mouse",
    "forget",
    "trust",
    "battery",
    "rename",
  ]),
  section("bluetooth", "nearby", "Nearby devices", "Pair a new device", [
    "pair",
    "add device",
    "discover",
  ]),
  // Devices
  section("displays", "arrangement", "Arrangement", "Where your displays sit", [
    "monitors",
    "screens",
    "multiple displays",
    "position",
  ]),
  setting("displays", "resolution", "Resolution", "How many pixels the screen shows", [
    "screen size",
    "screen",
    "pixels",
    "mode",
  ]),
  setting("displays", "refresh", "Refresh rate", "How often the screen redraws", [
    "hz",
    "hertz",
    "frame rate",
    "screen",
  ]),
  setting("displays", "scale", "Display scale", "Bigger or smaller everything on this screen", [
    "screen scale",
    "zoom",
    "hidpi",
    "screen",
    "size",
  ]),
  setting("displays", "primary", "Primary display", "Where the panel and new windows go", [
    "main screen",
    "screen",
  ]),
  setting("displays", "brightness", "Brightness", "How bright the built-in screen is", [
    "backlight",
    "dim",
    "brighter",
    "darker",
    "screen",
  ]),
  setting("displays", "night-light", "Night light", "Warmer colours in the evening", [
    "blue light",
    "warm",
    "night shift",
    "redshift",
    "flux",
    "eye strain",
    "colour temperature",
    "color temperature",
  ]),
  setting("displays", "night-schedule", "Night light schedule", "Sunset to sunrise, or set times", [
    "night light",
    "sunset",
    "sunrise",
    "evening",
  ]),
  setting("displays", "night-strength", "Night light warmth", "How warm the colours get", [
    "night light",
    "colour temperature",
    "color temperature",
    "strength",
    "intensity",
  ]),
  setting("sound", "volume", "Volume", "Output volume", ["loudness", "audio", "speakers"]),
  setting("sound", "mute", "Mute", "Silence the output", ["audio", "quiet", "silent"]),
  setting("sound", "input", "Input device", "The microphone apps hear", [
    "microphone",
    "mic",
    "recording",
    "source",
    "headset",
  ]),
  setting("sound", "input-volume", "Input volume", "How loud the microphone is", [
    "microphone",
    "mic",
    "gain",
    "recording level",
  ]),
  setting("sound", "input-mute", "Microphone", "Turn the input on or off", [
    "mute microphone",
    "mic",
    "privacy",
  ]),
  setting("sound", "input-level", "Input level", "Speak to test the microphone", [
    "microphone",
    "mic",
    "meter",
    "test",
  ]),
  section("sound", "apps", "Applications", "Volume for each app playing sound", [
    "per-app volume",
    "app volume",
    "mixer",
    "streams",
    "browser",
    "music",
  ]),
  setting("sound", "output", "Output device", "Where sound plays", [
    "speakers",
    "headphones",
    "sink",
    "audio",
  ]),
  setting("keyboard", "layouts", "Keyboard layouts", "The layouts you type with", [
    "language",
    "input source",
    "qwerty",
    "azerty",
    "dvorak",
    "xkb",
  ]),
  setting("keyboard", "switch", "Switch layouts", "The shortcut that changes layout", [
    "language",
    "input source",
    "shortcut",
  ]),
  setting("keyboard", "repeat-delay", "Repeat delay", "How long a held key waits to repeat", [
    "key repeat",
    "typing",
  ]),
  setting("keyboard", "repeat-rate", "Repeat rate", "How fast a held key repeats", [
    "key repeat",
    "typing",
  ]),
  setting("keyboard", "pointer-speed", "Pointer speed", "How far the pointer moves", [
    "mouse speed",
    "cursor",
    "sensitivity",
    "touchpad",
  ]),
  setting("keyboard", "acceleration", "Pointer acceleration", "Faster moves go further", [
    "mouse",
    "accel",
    "touchpad",
  ]),
  setting("keyboard", "natural-scroll", "Natural scrolling", "The mouse wheel moves the content", [
    "scroll direction",
    "reverse scroll",
    "touchpad",
    "mouse",
  ]),
  setting("keyboard", "caps", "Caps Lock key", "Caps Lock, another Ctrl, or Escape", [
    "capslock",
    "escape",
    "ctrl",
    "remap",
  ]),
  setting("keyboard", "repeat", "Key repeat", "Hold a key to type it again", ["typing", "repeat"]),
  setting("keyboard", "middle-click", "Middle click", "Press both buttons for a middle click", [
    "middle button",
    "paste",
    "emulation",
  ]),
  setting("keyboard", "left-handed", "Left-handed mouse", "Swap the left and right buttons", [
    "primary button",
    "mouse buttons",
  ]),
  section("keyboard", "touchpad", "Touchpad", "Tapping, scrolling and clicking", [
    "trackpad",
    "gestures",
  ]),
  setting("keyboard", "tap-to-click", "Tap to click", "Tap with one, two or three fingers", [
    "touchpad",
    "trackpad",
    "tapping",
    "tap and drag",
  ]),
  setting(
    "keyboard",
    "scroll-method",
    "Scrolling",
    "With two fingers, along the edge, or not at all",
    ["touchpad", "trackpad", "two finger scroll", "edge scroll"],
  ),
  setting(
    "keyboard",
    "touchpad-natural-scroll",
    "Natural scrolling on the touchpad",
    "Content follows your fingers",
    ["touchpad", "trackpad", "scroll direction", "reverse scroll"],
  ),
  setting("keyboard", "kinetic-scroll", "Kinetic scrolling", "Keep scrolling after a flick", [
    "touchpad",
    "trackpad",
    "inertia",
    "momentum",
  ]),
  setting("keyboard", "click-method", "Clicking", "Right-click with two fingers or a corner", [
    "touchpad",
    "clickpad",
    "right click",
    "secondary click",
  ]),
  setting(
    "keyboard",
    "disable-while-typing",
    "Ignore the touchpad while typing",
    "Stops a palm moving the pointer",
    ["touchpad", "trackpad", "palm", "dwt"],
  ),
  section("power", "battery", "Battery", "Charge and time left", ["charge", "charging", "percent"]),
  setting("power", "profile", "Power mode", "Balance performance and battery life", [
    "power profile",
    "performance",
    "power saver",
    "battery saver",
  ]),
  setting("power", "dim", "Dim the screen", "When inactive", ["idle", "screen", "brightness"]),
  setting("power", "screen-off", "Turn the screen off", "When inactive", [
    "idle",
    "screen",
    "blank",
    "sleep",
  ]),
  setting("power", "suspend", "Suspend", "When inactive", ["sleep", "idle", "standby"]),
  setting("power", "lock-after", "Lock after", "How soon after the screen turns off it locks", [
    "lock screen",
    "idle",
    "screen",
  ]),
  setting("power", "lock-on-suspend", "Lock on suspend", "Ask for the password after waking", [
    "lock screen",
    "sleep",
  ]),
  setting("power", "battery-percentage", "Battery percentage", "Show it in the panel", [
    "percent",
    "panel",
  ]),
  setting("power", "lid", "When the lid closes", "What a laptop does when you close it", [
    "laptop",
    "suspend",
  ]),
  setting("power", "power-button", "Power button", "What the power button does", [
    "shutdown",
    "suspend",
  ]),
  section("power", "awake", "Apps that can keep this computer awake", "Off unless you allow one", [
    "sleep",
    "inhibit",
    "caffeine",
    "wake lock",
    "stay awake",
    "lid",
  ]),
  section("storage", "home", "This computer", "Space used and free", [
    "disk",
    "space",
    "free space",
    "capacity",
    "storage",
  ]),
  section("storage", "drives", "Drives", "Mount, unmount and eject drives", [
    "usb",
    "removable",
    "external",
    "eject",
    "mount",
    "disk",
  ]),
  // Personal
  setting("appearance", "scheme", "Color scheme", "Light, dark, or automatic", [
    "dark mode",
    "light mode",
    "dark style",
    "night",
    "theme",
    "colour",
    "auto",
  ]),
  setting("appearance", "auto-schedule", "Automatic dark style", "When Moire switches to dark", [
    "auto dark",
    "sunset",
    "sunrise",
    "schedule",
    "night",
  ]),
  setting("appearance", "accent", "Accent color", "Buttons, selection and focus", [
    "highlight",
    "colour",
    "tint",
    "theme",
  ]),
  setting("appearance", "size", "Interface size", "Bigger text and controls", [
    "scale",
    "zoom",
    "text size",
    "font size",
    "larger",
    "screen",
  ]),
  setting("appearance", "style", "Desktop style", "How apps and windows look", [
    "theme",
    "look",
    "moire",
    "cupertino",
    "redmond",
    "plasmid",
    "gnomish",
  ]),
  setting("appearance", "wallpaper", "Wallpaper", "The desktop background", [
    "background",
    "desktop picture",
    "image",
  ]),
  setting("appearance", "panel", "Panel", "Floating islands or one full-width bar", [
    "taskbar",
    "bar",
    "dock",
    "full width",
  ]),
  setting("appearance", "window-buttons", "Window buttons", "Titles, or icons only", [
    "taskbar",
    "panel",
    "icons only",
  ]),
  setting("appearance", "motion", "Reduce motion", "Calmer transitions in Moire apps", [
    "animation",
    "accessibility",
  ]),
  setting("desktop", "icons", "Desktop icons", "Show files and folders on the desktop", [
    "desktop",
    "files on desktop",
  ]),
  setting("desktop", "look", "Wallpaper and panel", "Change them in Appearance", [
    "background",
    "taskbar",
  ]),
  section("desktop", "pins", "Pinned apps", "Apps the launcher lists first", [
    "launcher",
    "pin",
    "unpin",
    "favorites",
    "favourites",
    "order",
    "reorder",
    "start menu",
    "applications menu",
  ]),
  setting("desktop", "pin-app", "Pin an app", "Add one to the launcher's pinned apps", [
    "launcher",
    "pin",
    "add",
    "favorites",
    "favourites",
    "start menu",
  ]),
  setting("notifications", "dnd", "Do not disturb", "Hold banners and sounds", [
    "quiet",
    "silence",
    "focus",
    "alerts",
    "dnd",
  ]),
  setting("notifications", "schedule", "Scheduled Do not disturb", "Turn it on at set hours", [
    "quiet hours",
    "night",
    "sleep",
    "bedtime",
    "dnd",
    "schedule",
  ]),
  section("notifications", "apps", "App notifications", "Allow, banners and sounds per app", [
    "per app",
    "banners",
    "sounds",
    "mute app",
    "block",
    "alerts",
  ]),
  section("notifications", "history", "Notification history", "Notifications you've had", [
    "alerts",
    "messages",
    "clear",
  ]),
  setting("accessibility", "size", "Interface size", "Bigger text and controls", [
    "scale",
    "zoom",
    "text size",
    "font size",
    "low vision",
  ]),
  setting("accessibility", "motion", "Reduce motion", "Calmer transitions in Moire apps", [
    "animation",
    "vestibular",
  ]),
  // System
  setting("apps", "web", "Web browser", "Opens links", ["default browser", "http", "internet"]),
  setting("apps", "mail", "Mail", "Opens email links", ["email", "default"]),
  setting("apps", "text", "Text", "Opens text files", ["editor", "default", "txt"]),
  setting("apps", "images", "Images", "Opens pictures", ["photos", "viewer", "png", "jpeg"]),
  setting("apps", "music", "Music", "Opens audio files", ["audio", "player", "mp3"]),
  setting("apps", "video", "Video", "Opens videos", ["movies", "player", "mp4"]),
  setting("apps", "pdf", "PDF documents", "Opens PDFs", ["document viewer", "reader"]),
  setting("apps", "archives", "Archives", "Opens zip and tar files", ["zip", "compressed"]),
  section("apps", "installed", "Installed apps", "Every app on this computer", [
    "applications",
    "programs",
    "launch",
  ]),
  section("privacy", "index", "File search", "What the index knows", [
    "search",
    "index",
    "indexing",
    "files",
  ]),
  setting("privacy", "indexing", "Index files for search", "Find files by name and contents", [
    "search",
    "index",
    "privacy",
  ]),
  setting("privacy", "rebuild", "Rebuild index", "Read every folder again", ["search", "reindex"]),
  setting("privacy", "clear", "Clear index", "Delete everything indexed", ["search", "delete"]),
  section("privacy", "excludes", "Excluded folders", "Folders search never reads", [
    "exclude",
    "ignore",
    "skip",
    "privacy",
  ]),
  setting("privacy", "recent", "Recent files", "Apps remember what you opened", [
    "history",
    "clear",
    "privacy",
  ]),
  section("users", "you", "Your account", "Your name and picture", [
    "account",
    "name",
    "avatar",
    "profile",
    "user",
  ]),
  setting("users", "password", "Password", "Change your password", ["account", "login"]),
  setting("users", "name", "Your name", "How you appear on the login screen", [
    "account",
    "real name",
  ]),
  setting("users", "picture", "Your picture", "Your avatar", ["avatar", "photo", "profile"]),
  setting("users", "autologin", "Automatic login", "Start without asking for your password", [
    "auto login",
    "autologin",
    "log in automatically",
    "sign in",
    "startup",
    "boot",
    "password",
  ]),
  section("users", "others", "Other users", "People who use this computer", [
    "accounts",
    "add user",
    "family",
  ]),
  section("datetime", "now", "Date and time", "The time on this computer", [
    "clock",
    "date",
    "time",
  ]),
  setting("datetime", "timezone", "Time zone", "Where you are", ["zone", "location", "utc"]),
  setting("datetime", "automatic", "Set time automatically", "From the network", [
    "ntp",
    "network time",
    "sync",
  ]),
  setting("datetime", "clock24", "24-hour clock", "13:00 instead of 1:00 PM", [
    "time format",
    "am pm",
  ]),
  setting("datetime", "region", "Region formats", "How dates and times are written", [
    "locale",
    "format",
    "language",
  ]),
  setting("datetime", "date-order", "Date order", "Day, month and year", ["date format", "dd/mm"]),
  setting("datetime", "week", "First day of the week", "Where calendars start", [
    "monday",
    "sunday",
    "calendar",
  ]),
  section("about", "system", "This computer", "Name, system, memory and processor", [
    "hostname",
    "version",
    "nixos",
    "memory",
    "ram",
    "cpu",
    "processor",
    "specs",
    "build",
  ]),
  setting("about", "copy", "Copy system info", "For a bug report", ["bug", "report", "support"]),
  setting("about", "updates", "Updates", "How Moire is updated", ["upgrade", "update", "version"]),
  section("about", "diagnostics", "Diagnostics", "Running apps and settings files", [
    "process",
    "task manager",
    "running",
  ]),
];

export function settingEntry(id: string): SettingEntry {
  const found = SETTINGS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unknown setting ${id}`);
  return found;
}

/** Where Settings opens: a page, scrolled to a row or section, or a search. */
export type Route =
  | { kind: "page"; id: PageId; anchor?: string }
  | { kind: "search"; query: string };

/** The old tab order, for desktop actions and scripts that still pass `MOIRE_SETTINGS_TAB`. */
const LEGACY_TABS: readonly SidebarPageId[] = [
  "appearance",
  "displays",
  "sound",
  "privacy",
  "about",
];

/** Older and shorter names other apps may use. */
const PAGE_ALIASES: Readonly<Record<string, PageId>> = {
  home: "overview",
  wifi: "network",
  "wi-fi": "network",
  search: "privacy",
  mouse: "keyboard",
  battery: "power",
  drives: "storage",
  launcher: "desktop",
  defaults: "apps",
  accounts: "users",
  time: "datetime",
  region: "datetime",
};

/**
 * `page`, `page#anchor`, an alias, or a bare legacy tab number. An anchor is kept only when it
 * names a setting or section on that page; anything unknown opens Overview.
 */
export function parseDeepLink(link: string | undefined | null): Route {
  const value = (link ?? "").trim().toLowerCase();
  if (!value) return { kind: "page", id: "overview" };
  if (/^\d+$/.test(value)) {
    const legacy = LEGACY_TABS[Number(value)];
    return { kind: "page", id: legacy ?? "overview" };
  }
  const [name = "", anchor] = value.split("#", 2);
  const id = isPageId(name) ? name : PAGE_ALIASES[name];
  if (!id) return { kind: "page", id: "overview" };
  if (!anchor || id === "overview") return { kind: "page", id };
  const known = SETTINGS.some((candidate) => candidate.id === `${id}.${anchor}`);
  return known ? { kind: "page", id, anchor } : { kind: "page", id };
}

/** The deep link Settings was started with: `MOIRE_SETTINGS_PAGE`, else `MOIRE_SETTINGS_TAB`. */
function startLink(env: NodeJS.ProcessEnv): string | null {
  return env.MOIRE_SETTINGS_PAGE ?? env.MOIRE_SETTINGS_TAB ?? null;
}

/** The route Settings starts on: `MOIRE_SETTINGS_PAGE`, else the legacy `MOIRE_SETTINGS_TAB`. */
export function initialRoute(env: NodeJS.ProcessEnv): Route {
  return parseDeepLink(startLink(env));
}

/** What a second start of Settings hands the running window: its deep link, if any. */
export type SettingsActivation = { link: string | null };

export function settingsActivation(env: NodeJS.ProcessEnv): SettingsActivation {
  return { link: startLink(env) };
}

/** Validate an activation received from another process; links are length-capped. */
export function parseSettingsActivation(value: unknown): SettingsActivation | null {
  if (!value || typeof value !== "object" || !("link" in value)) return null;
  const { link } = value;
  if (link === null) return { link: null };
  return typeof link === "string" && link.length <= 256 ? { link } : null;
}

/** The deep link for a route, the reverse of `parseDeepLink`. */
export function deepLink(route: Route): string {
  if (route.kind === "search") return "overview";
  return route.anchor ? `${route.id}#${route.anchor}` : route.id;
}
