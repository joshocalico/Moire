import React, { useReducer, useState, type ReactNode } from "react";
import {
  AppFrame,
  FileChooser,
  appFrameBody,
  localTimeZone,
  startMain,
  wallClock,
} from "@moire/app-tools";
import {
  Application,
  ContextMenu,
  OverlayHost,
  ShortcutManager,
  Window,
  getUiScaleFactor,
  type Shortcut,
  type WindowActions,
  type WindowSize,
} from "@moire/ui";
import { APP_ID, CalendarStore, loadViewMode, saveViewMode } from "./events";
import {
  draftFromEvent,
  initialView,
  newDraft,
  periodTitle,
  viewReducer,
  type CalendarEvent,
  type ViewMode,
} from "./model";
import { useCalendarStore } from "./use-calendar-store";
import { useEventEditor } from "./use-event-editor";
import { useIcsImport } from "./use-ics-import";
import { CalendarBody } from "./views/body";
import { CalendarPrompts } from "./views/prompts";
import { CalendarToolbar, headerActions } from "./views/toolbar";

/** What is drawn over the calendar besides dialogs: the More menu or the file chooser. */
type Surface = { kind: "none" } | { kind: "menu"; x: number; y: number } | { kind: "chooser" };

export function CalendarApp(
  props: WindowSize & {
    store: CalendarStore;
    now?: () => number;
    onClose?: () => void;
    onCloseGuard?: (guard: () => boolean) => void;
    /** Month or week as last chosen, and where to remember a new choice. */
    viewPreference?: { initial: ViewMode; save: (mode: ViewMode) => string | null };
    /** The window the header bar controls (minimize, maximize, close, move). */
    window?: WindowActions | null;
  },
): ReactNode {
  const ui = getUiScaleFactor();
  const data = useCalendarStore(props.store);
  const [zone] = useState(localTimeZone);
  const nowMs = (props.now ?? Date.now)();
  const today = wallClock(nowMs, zone).date;
  const [view, dispatch] = useReducer(viewReducer, undefined, () =>
    initialView(today, props.viewPreference?.initial ?? "month"),
  );
  const [surface, setSurface] = useState<Surface>({ kind: "none" });
  const [deleting, setDeleting] = useState<CalendarEvent | null>(null);
  const editor = useEventEditor({
    commit: (event) => {
      const saved = data.persist(
        (current) => [...current.filter((item) => item.id !== event.id), event],
        `Saved ${event.title}`,
      );
      return saved && { closeNow: saved.cleanup.kind === "complete" };
    },
    onStatus: data.setStatus,
    onClose: props.onClose,
    onCloseGuard: props.onCloseGuard,
  });
  const ics = useIcsImport({ zone, persist: data.persist, onStatus: data.setStatus });
  const newEvent = () => editor.begin(newDraft(view.selected, zone));
  const goToday = () => dispatch({ type: "today", today });
  const step = (offset: number) => dispatch({ type: "step", offset });
  const chooseFile = () => setSurface({ kind: "chooser" });
  const closeSurface = () => setSurface({ kind: "none" });
  const setMode = (mode: ViewMode) => {
    dispatch({ type: "mode", mode });
    const error = props.viewPreference?.save(mode);
    if (error) data.setStatus(error);
  };
  const editing = editor.state.kind === "open";
  const shortcuts: Shortcut[] = [
    { id: "new-event", key: "n", ctrl: true, onInvoke: newEvent },
    { id: "save-event", key: "s", ctrl: true, onInvoke: editor.save },
    { id: "import", key: "o", ctrl: true, disabled: editing, onInvoke: chooseFile },
    { id: "today", key: "t", ctrl: true, onInvoke: goToday },
    { id: "month-view", key: "1", ctrl: true, onInvoke: () => setMode("month") },
    { id: "week-view", key: "2", ctrl: true, onInvoke: () => setMode("week") },
    { id: "previous", key: "ArrowLeft", alt: true, onInvoke: () => step(-1) },
    { id: "next", key: "ArrowRight", alt: true, onInvoke: () => step(1) },
  ];
  const toolbar = (
    <CalendarToolbar
      width={props.width}
      mode={view.mode}
      title={periodTitle(view)}
      onStep={step}
      onMode={setMode}
    />
  );
  const compact = props.width < 760 * ui;
  const body = appFrameBody({ height: props.height, title: "Calendar", controls: toolbar });
  return (
    <OverlayHost width={props.width} height={props.height}>
      <ShortcutManager
        width={props.width}
        height={props.height}
        enabled={surface.kind !== "chooser"}
        shortcuts={shortcuts}
      >
        <AppFrame
          width={props.width}
          height={props.height}
          title="Calendar"
          icon="calendar"
          window={props.window}
          subtitle={compact ? undefined : zone}
          controls={toolbar}
          actions={headerActions({
            compact,
            canCreate: !data.loadError,
            onToday: goToday,
            onNew: newEvent,
            onMore: (at) =>
              setSurface({ kind: "menu", x: at?.x ?? props.width - 260 * ui, y: at?.y ?? 40 * ui }),
          })}
          status={data.status}
          statusEnd={`${data.events.length} ${data.events.length === 1 ? "event" : "events"}`}
        >
          <CalendarBody
            width={props.width}
            height={body.height}
            view={view}
            events={data.events}
            today={today}
            zone={zone}
            nowMs={nowMs}
            onSelect={(date) => dispatch({ type: "select", date })}
            onQuery={(query) => dispatch({ type: "query", query })}
            onEdit={(event) => editor.begin(draftFromEvent(event))}
            onDelete={setDeleting}
          />
        </AppFrame>
      </ShortcutManager>
      {surface.kind === "menu" ? (
        <ContextMenu
          viewportWidth={props.width}
          viewportHeight={props.height}
          x={surface.x}
          y={surface.y}
          actions={[
            { id: "import", label: "Import .ics file…", onPress: chooseFile },
            { id: "reload", label: "Reload saved events", onPress: data.askReload },
          ]}
          onDismiss={() => setSurface((old) => (old.kind === "menu" ? { kind: "none" } : old))}
        />
      ) : null}
      {surface.kind === "chooser" ? (
        <FileChooser
          width={props.width}
          height={props.height}
          mode="open"
          appId={APP_ID}
          title="Import calendar"
          accept={["ics"]}
          onChoose={(file) => {
            closeSurface();
            void ics.importFile(file);
          }}
          onCancel={closeSurface}
        />
      ) : null}
      <CalendarPrompts
        width={props.width}
        height={props.height}
        status={data.status}
        editor={editor.state}
        onDraftChange={editor.change}
        onDraftSave={editor.save}
        onDraftCancel={() => editor.leave("editor")}
        onDraftDiscard={editor.discard}
        onDraftStay={editor.stay}
        report={ics.report}
        onReportClose={ics.dismissReport}
        deleting={deleting}
        onDeleteDismiss={() => setDeleting(null)}
        onDeleteConfirm={() => {
          const id = deleting?.id;
          const remove = (current: readonly CalendarEvent[]) =>
            current.filter((event) => event.id !== id);
          if (id && data.persist(remove, "Event deleted")) setDeleting(null);
        }}
        storage={data.prompt}
        onStorageDismiss={data.dismissPrompt}
        onStorageConfirm={() => {
          if (data.prompt?.kind === "cleanup") data.retryCleanup();
          else if (data.reloadSaved()) setDeleting(null);
        }}
      />
    </OverlayHost>
  );
}

export async function main(): Promise<void> {
  const app = new Application();
  const window = new Window({
    title: "Calendar",
    appId: APP_ID,
    width: 940,
    height: 660,
    decorated: false,
  });
  const store = new CalendarStore();
  const viewPreference = { initial: loadViewMode(), save: saveViewMode };
  window.setContent((size) => (
    <CalendarApp
      {...size}
      window={window}
      store={store}
      viewPreference={viewPreference}
      onClose={() => window.requestClose()}
      onCloseGuard={(guard) => window.setCloseGuard(guard)}
    />
  ));
  window.onClose(() => app.quit());
  app.addWindow(window);
  await app.run();
}

startMain(import.meta.url, main);
