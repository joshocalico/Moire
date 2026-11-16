/**
 * Settings' window: the sidebar, the page or search results beside it, details in a side
 * sheet, and the window controls. It owns the route, the live models every page is built from,
 * and the keyboard: Ctrl+F searches (so does typing on a page), ↑/↓ and Enter move through
 * results, Esc clears, Ctrl+Z undoes the last change, Ctrl+0–4 jump between groups and
 * Alt+←/→ go back and forward.
 */
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Box,
  OverlayHost,
  ShortcutManager,
  SideSheet,
  Surface,
  WindowControls,
  WindowMoveArea,
  getUiScaleFactor,
  isEditingText,
  usePalette,
  windowControlSize,
  type HitKeyEvent,
  type WindowActions,
  type WindowSize,
} from "@moire/ui";
import { errorText, FileChooser } from "@moire/app-tools";
import { readZoneLocation, type DaylightContext, type MoireSettings } from "@moire/prefs";
import { GROUPS, PAGES, pageInfo, type PageId, type Route, type SidebarPageId } from "./catalog";
import { useApps, type AppsBackend } from "./apps-state";
import type { Chooser, PageContext } from "./context";
import { useDesktopStatus } from "./desktop-state";
import type { JournalEntry } from "./history";
import type { SheetRoute } from "./model";
import { PageView, pageColumn } from "./page-view";
import { PAGE_BUILDERS } from "./pages";
import { useBluetoothDiscovery } from "./pages/bluetooth";
import { useDisplaySettings } from "./pages/displays-state";
import { useWifiScanning } from "./pages/network";
import { useRecentFiles } from "./pages/privacy";
import { usePrefs, useJournal } from "./prefs-state";
import { SearchOverlays, useSearchSettings } from "./search";
import { searchResults } from "./search-results";
import { resultSummary, typedSearchText } from "./search-settings";
import type { Launcher, SettingsServices } from "./services";
import { readyStatus, useClientState, useSettingsCalls } from "./settings-clients";
import { SettingsSearchField, Sidebar, sidebarCollapsed, sidebarWidth } from "./sidebar";
import { useStorage } from "./storage-state";
import type { SystemInfo } from "./system-info";

const APP_ID = "org.moire.Settings";
/** How long a deep-linked row stays highlighted. */
const HIGHLIGHT_MS = 1600;

export type SettingsAppProps = WindowSize & {
  initial: MoireSettings;
  services: SettingsServices;
  system: SystemInfo;
  apps: AppsBackend;
  launch: Launcher;
  copyText: (text: string) => Promise<void>;
  route: Route;
  /**
   * Deep links handed to this window after it opened (Settings started again while running);
   * subscribe returns the unsubscribe. Each one navigates like a sidebar or search jump.
   */
  routeRequests?: (listener: (route: Route) => void) => () => void;
  /** The session's reduced-motion save, so open apps follow at once. */
  onReducedMotionChange?: (value: boolean) => Promise<void>;
  /** The zone and location schedules use, and the clock; fixtures pin them. */
  daylight?: () => DaylightContext;
  clock?: () => Date;
  window?: WindowActions | null;
};

type History = { back: Route[]; forward: Route[] };

function sameRoute(a: Route, b: Route): boolean {
  return (
    a.kind === b.kind &&
    (a.kind === "search" ? a.query === (b as typeof a).query : a.id === (b as typeof a).id)
  );
}

export function SettingsApp(props: SettingsAppProps): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const { services } = props;
  const [route, setRoute] = useState<Route>(props.route);
  const [history, setHistory] = useState<History>({ back: [], forward: [] });
  const [query, setQuery] = useState(props.route.kind === "search" ? props.route.query : "");
  const [active, setActive] = useState(0);
  const [sheet, setSheet] = useState<SheetRoute | null>(null);
  const [chooser, setChooser] = useState<Chooser | null>(null);
  const [errors, setErrors] = useState<Partial<Record<PageId, string>>>({});
  const [highlight, setHighlight] = useState<string | null>(null);
  const [searchFocus, setSearchFocus] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  const [zones, setZones] = useState<PageContext["time"]["zones"]>(null);
  const [catalog, setCatalog] = useState<PageContext["input"]["catalog"]>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const journal = useJournal();
  const prefs = usePrefs(props.initial, journal, props.onReducedMotionChange);
  const desktop = useDesktopStatus(services.desktop);
  const display = useDisplaySettings(services.display);
  const search = useSearchSettings(services.index, services.storage, (items, label) =>
    journal.record(items, { label, page: "privacy" }),
  );
  const storage = useStorage(services.storage);
  const apps = useApps(props.apps);
  const recent = useRecentFiles();
  const calls = useSettingsCalls();
  const timeState = useClientState(services.time);
  const accountsState = useClientState(services.accounts);
  const loginState = useClientState(services.login);
  const inputState = useClientState(services.input);
  const powerState = useClientState(services.power);
  const brightnessState = useClientState(services.brightness);
  const timeStatus = readyStatus(timeState);
  const accountsStatus = readyStatus(accountsState);
  const loginStatus = readyStatus(loginState);
  const pageId: PageId | null = route.kind === "page" ? route.id : null;
  useWifiScanning(desktop, pageId === "network");
  useBluetoothDiscovery(desktop, pageId === "bluetooth");
  useEffect(() => {
    if (!highlight) return;
    const timer = setTimeout(() => setHighlight(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlight]);

  const go = (next: Route) => {
    setSheet(null);
    if (next.kind === "page") {
      setQuery("");
      setHighlight(next.anchor ? `${next.id}.${next.anchor}` : null);
    }
    if (!sameRoute(route, next))
      setHistory((current) => ({ back: [...current.back, route].slice(-50), forward: [] }));
    setRoute(next);
  };
  const goRef = useRef(go);
  goRef.current = go;
  const { routeRequests } = props;
  useEffect(() => routeRequests?.((next) => goRef.current(next)), [routeRequests]);
  const report = (page: PageId, message: string | null) =>
    setErrors((current) => ({ ...current, [page]: message ?? undefined }));
  const attempt: PageContext["attempt"] = (page, action) => {
    report(page, null);
    void Promise.resolve()
      .then(action)
      .catch((error: unknown) => errorText(error))
      .then((message) => {
        if (mounted.current && message) report(page, message);
      });
  };
  const undo = (entry: JournalEntry) => {
    if (entry.key === "doNotDisturb") {
      attempt(entry.page, () =>
        desktop.run("dnd", (client) => client.setDoNotDisturb(entry.from === true)),
      );
    } else if (prefs.restore({ [entry.key]: entry.from } as Partial<MoireSettings>)) {
      if (entry.key.startsWith("index")) search.reload();
    } else return;
    journal.remove(entry.id);
  };

  const collapsed = sidebarCollapsed(props.width);
  const side = sidebarWidth(props.width);
  const area = Math.max(1, props.width - side);
  const column = pageColumn(area);
  const controlsWidth = props.window ? windowControlSize() * 3 + 24 * ui : 0;

  const context: PageContext = {
    width: props.width,
    height: props.height,
    columnWidth: column.width,
    palette: pal,
    route,
    go,
    openSheet: (page, id) => setSheet({ page, id }),
    closeSheet: () => setSheet(null),
    report,
    prefs,
    journal,
    desktop,
    display,
    search,
    storage,
    apps,
    recent,
    system: props.system,
    errors,
    launch: props.launch,
    copyText: props.copyText,
    openChooser: setChooser,
    undo,
    attempt,
    calls,
    time: {
      client: services.time,
      state: timeState,
      status: timeStatus?.kind === "ready" ? timeStatus : null,
      zones,
      loadZones() {
        if (zones || !services.time) return;
        void services.time.timeZones().then((result) => {
          if (!mounted.current) return;
          if (result.ok) setZones(result.value);
          else report("datetime", result.message);
        });
      },
    },
    accounts: {
      client: services.accounts,
      state: accountsState,
      status: accountsStatus?.kind === "ready" ? accountsStatus : null,
    },
    login: {
      client: services.login,
      state: loginState,
      status: loginStatus?.kind === "ready" ? loginStatus : null,
    },
    input: {
      client: services.input,
      state: inputState,
      catalog,
      loadCatalog() {
        if (catalog || !services.input) return;
        void services.input
          .availableLayouts()
          .then((next) => mounted.current && setCatalog(next))
          .catch((error: unknown) => report("keyboard", errorText(error)));
      },
    },
    power: { client: services.power, state: powerState },
    brightness: { client: services.brightness, state: brightnessState },
    daylight: { ...(props.daylight ?? readZoneLocation)(), now: props.clock?.() ?? new Date() },
  };
  // The layout names on Keyboard & Mouse come from the catalog.
  useEffect(() => {
    if (pageId === "keyboard") context.input.loadCatalog();
  }, [pageId]);

  const searching = route.kind === "search";
  // Rebuilt every render while searching: the results are live controls.
  const results =
    searching && query.trim()
      ? searchResults(query, (page) => PAGE_BUILDERS[page](context), go, pal.accent)
      : null;
  const activeTarget = results?.targets[Math.min(active, Math.max(0, results.targets.length - 1))];

  const setSearch = (next: string) => {
    setQuery(next);
    setActive(0);
    if (next.trim()) {
      if (route.kind !== "search")
        setHistory((current) => ({ back: [...current.back, route].slice(-50), forward: [] }));
      setRoute({ kind: "search", query: next });
    } else if (route.kind === "search") {
      setRoute(history.back.at(-1) ?? { kind: "page", id: "overview" });
    }
  };
  const searchKey = (event: HitKeyEvent): boolean => {
    const count = results?.targets.length ?? 0;
    if (event.key === "ArrowDown" || event.code === 108) {
      if (count) setActive((current) => (current + 1) % count);
      return true;
    }
    if (event.key === "ArrowUp" || event.code === 103) {
      if (count) setActive((current) => (current - 1 + count) % count);
      return true;
    }
    if (event.key === "Enter" || event.code === 28) {
      if (activeTarget) go(activeTarget.route);
      return true;
    }
    if (event.key === "Escape" || event.code === 1) {
      setSearch("");
      return true;
    }
    return false;
  };
  const back = () => {
    const previous = history.back.at(-1);
    if (!previous) return;
    setHistory({ back: history.back.slice(0, -1), forward: [route, ...history.forward] });
    setSheet(null);
    setRoute(previous);
  };
  const forward = () => {
    const next = history.forward[0];
    if (!next) return;
    setHistory({ back: [...history.back, route], forward: history.forward.slice(1) });
    setSheet(null);
    setRoute(next);
  };
  // Typing on a page (not in a field, a sheet or the chooser) starts a search with that key.
  const typeToSearch = (event: HitKeyEvent): boolean => {
    if (event.repeat || sheet || chooser || isEditingText()) return false;
    const text = typedSearchText(event);
    if (!text) return false;
    setSearch(query + text);
    setSearchFocus((count) => count + 1);
    return true;
  };
  const firstOfGroup = (index: number): SidebarPageId =>
    PAGES.find((page) => page.group === GROUPS[index]!.id)!.id;

  let view: ReactNode;
  if (results || searching) {
    const groups = results?.groups ?? [];
    view = (
      <PageView
        key="search"
        x={side}
        width={area}
        height={props.height}
        controlsWidth={controlsWidth}
        title={`Results for “${query.trim()}”`}
        summary={
          groups.length
            ? `${resultSummary(groups)} · ↑↓ to move, Enter to open, Esc to clear`
            : "Try another word"
        }
        header={
          collapsed ? (
            <SettingsSearchField
              width={Math.min(column.width, area - column.x - controlsWidth) - 4 * ui}
              height={32 * ui}
              query={query}
              focus={searchFocus}
              onQuery={setSearch}
              onKey={searchKey}
              onFocus={setSearchFocused}
            />
          ) : undefined
        }
        sections={results?.sections ?? []}
        empty={
          query.trim() && !groups.length
            ? {
                icon: "search",
                title: "No settings match",
                message: "Search by what a setting does, such as “dark” or “sleep”.",
              }
            : undefined
        }
        highlightedId={activeTarget?.rowId}
      />
    );
  } else {
    const id = route.kind === "page" ? route.id : "overview";
    const content = PAGE_BUILDERS[id](context);
    const error = errors[id];
    view = (
      <PageView
        key={`${id}#${route.kind === "page" ? (route.anchor ?? "") : ""}`}
        x={side}
        width={area}
        height={props.height}
        controlsWidth={controlsWidth}
        title={id === "overview" ? props.system.hostname : pageInfo(id).title}
        summary={content.summary}
        tint={id === "overview" ? undefined : pageInfo(id).tint}
        banners={[
          ...(error
            ? [{ id: "error", title: "That didn't work", message: error, tone: "danger" as const }]
            : []),
          ...(prefs.error
            ? [
                {
                  id: "prefs",
                  title: "Settings couldn't be saved",
                  message: prefs.error,
                  tone: "danger" as const,
                },
              ]
            : []),
          ...(content.banners ?? []),
        ]}
        hero={content.hero}
        sections={content.sections}
        empty={content.empty}
        anchor={route.kind === "page" && route.anchor ? `${id}.${route.anchor}` : null}
        highlightedId={highlight}
      />
    );
  }
  const sheetContent = sheet
    ? (PAGE_BUILDERS[sheet.page](context).sheet?.(sheet.id) ?? null)
    : null;
  const selected = route.kind === "page" ? route.id : null;
  return (
    <OverlayHost width={props.width} height={props.height}>
      <ShortcutManager
        width={props.width}
        height={props.height}
        onKeyDown={typeToSearch}
        shortcuts={[
          {
            id: "search",
            key: "f",
            platformModifier: true,
            onInvoke: () => {
              setSearchFocus((count) => count + 1);
              if (collapsed && route.kind !== "search") setRoute({ kind: "search", query: "" });
            },
          },
          {
            id: "undo",
            key: "z",
            platformModifier: true,
            disabled: searchFocused || !journal.entries.length || !!sheet,
            onInvoke: () => undo(journal.entries[0]!),
          },
          {
            id: "overview",
            key: "0",
            platformModifier: true,
            onInvoke: () => go({ kind: "page", id: "overview" }),
          },
          ...GROUPS.map((_, index) => ({
            id: `group-${index}`,
            key: String(index + 1),
            platformModifier: true,
            onInvoke: () => go({ kind: "page", id: firstOfGroup(index) }),
          })),
          { id: "back", key: "ArrowLeft", alt: true, onInvoke: back },
          { id: "forward", key: "ArrowRight", alt: true, onInvoke: forward },
          {
            id: "clear",
            key: "Escape",
            disabled: !!sheet || route.kind !== "search",
            onInvoke: () => setSearch(""),
          },
        ]}
      >
        <Surface width={props.width} height={props.height} fill={pal.bg}>
          <Sidebar
            height={props.height}
            collapsed={collapsed}
            selected={route.kind === "search" ? null : selected}
            name={
              context.accounts.status?.users.find((user) => user.self)?.realName ||
              props.system.user.name
            }
            picture={
              context.accounts.status?.users.find((user) => user.self)?.iconFile ??
              props.system.user.picture
            }
            hostname={props.system.hostname}
            query={query}
            counts={results ? results.counts : searching ? {} : null}
            searchFocus={searchFocus}
            onQuery={setSearch}
            onSearchKey={searchKey}
            onSearchFocus={setSearchFocused}
            onSearchOpen={() => {
              setSearchFocus((count) => count + 1);
              if (route.kind !== "search") {
                setHistory((current) => ({
                  back: [...current.back, route].slice(-50),
                  forward: [],
                }));
                setRoute({ kind: "search", query });
              }
            }}
            onSelect={(page) => go({ kind: "page", id: page })}
          />
          {props.window ? (
            <WindowMoveArea
              x={side}
              width={area - controlsWidth}
              height={44 * ui}
              actions={props.window}
            />
          ) : null}
          {view}
          {props.window ? (
            <WindowControls
              x={props.width - windowControlSize() * 3 - 12 * ui}
              y={8 * ui + (36 * ui - windowControlSize()) / 2}
              actions={props.window}
            />
          ) : null}
        </Surface>
        <SideSheet
          open={!!sheetContent}
          viewportWidth={props.width}
          viewportHeight={props.height}
          title={sheetContent?.title ?? ""}
          subtitle={sheetContent?.subtitle}
          closeFocusId="sheet:close"
          onClose={() => setSheet(null)}
        >
          {(size) => (sheetContent ? sheetContent.body(size) : null)}
        </SideSheet>
        <SearchOverlays state={search} width={props.width} height={props.height} />
        {chooser ? (
          <Box width={props.width} height={props.height}>
            <FileChooser
              width={props.width}
              height={props.height}
              mode="open"
              appId={APP_ID}
              accept={
                typeof chooser === "object"
                  ? [...chooser.accept]
                  : chooser === "wallpaper"
                    ? ["png", "jpg", "jpeg", "gif"]
                    : ["png", "jpg", "jpeg"]
              }
              title={
                typeof chooser === "object"
                  ? chooser.title
                  : chooser === "wallpaper"
                    ? "Choose a wallpaper picture"
                    : "Choose your picture"
              }
              onChoose={(file) => {
                setChooser(null);
                if (typeof chooser === "object") chooser.onChoose(file);
                else if (chooser === "wallpaper")
                  prefs.set(
                    { wallpaper: { mode: "image", path: file } },
                    { label: "Wallpaper set to a picture", page: "appearance" },
                  );
                else {
                  const self = context.accounts.status?.users.find((user) => user.self);
                  const client = services.accounts;
                  if (self && client)
                    attempt("users", async () => {
                      const result = await calls.run("icon", () => client.setIcon(self.uid, file));
                      return result.ok ? null : result.message;
                    });
                }
              }}
              onCancel={() => setChooser(null)}
            />
          </Box>
        ) : null}
      </ShortcutManager>
    </OverlayHost>
  );
}
