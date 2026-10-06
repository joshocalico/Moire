import { StorageConflictError, retryStoreCleanup } from "@moire/app-tools/local-store";
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Application,
  Button,
  ConfirmationDialog,
  Dialog,
  Horizontal,
  Measure,
  ModalBarrier,
  ScrollColumn,
  TextBlock,
  Vertical,
  measureColumnContent,
  useWidgetTheme,
  FocusScope,
  Label,
  OverlayHost,
  Pressable,
  ScrollArea,
  SearchField,
  ShortcutManager,
  Surface,
  TextField,
  Toolbar,
  Window,
  usePalette,
  getUiScaleFactor,
  type WindowSize,
} from "@moire/ui";
import {
  CalendarStore,
  dayEvents,
  defaultTimeZone,
  eventFromDraft,
  localDateTime,
  monthDays,
  moveMonth,
  type CalendarEvent,
  type EventDraft,
} from "./events";

type DraftState = { readonly value: EventDraft; readonly original: EventDraft };
type LeaveIntent = "window" | "editor";
const DRAFT_FIELDS: readonly { key: Exclude<keyof EventDraft, "id">; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "date", label: "Date YYYY-MM-DD" },
  { key: "start", label: "Start HH:MM" },
  { key: "end", label: "End HH:MM" },
  { key: "timeZone", label: "Time zone" },
  { key: "notes", label: "Notes" },
];
function draftChanged(state: DraftState | null): boolean {
  return !!state && DRAFT_FIELDS.some(({ key }) => state.value[key] !== state.original[key]);
}
function DraftFields(
  props: WindowSize & {
    draft: EventDraft;
    status: string;
    onChange: (key: Exclude<keyof EventDraft, "id">, value: string) => void;
  },
): ReactNode {
  const theme = useWidgetTheme();
  const [scrollY, setScrollY] = useState(0);
  const children = (
    <>
      {DRAFT_FIELDS.map(({ key, label }, index) => (
        <Vertical key={key} gap={theme.foundations.space.xs}>
          <TextBlock text={label} fontSize={13} color={theme.foundations.palette.muted} wrap />
          <TextField
            width={props.width}
            value={props.draft[key]}
            autoFocus={index === 0}
            onChange={(value) => props.onChange(key, value)}
          />
        </Vertical>
      ))}
      <TextBlock text={props.status} color={theme.foundations.palette.muted} fontSize={11} wrap />
    </>
  );
  const maxScroll = Math.max(
    0,
    measureColumnContent({ width: props.width, gap: theme.foundations.space.md, children }, theme)
      .height - props.height,
  );
  return (
    <ShortcutManager
      width={props.width}
      height={props.height}
      shortcuts={[
        {
          id: "draft-next-page",
          key: "PageDown",
          onInvoke: () => setScrollY((old) => Math.min(maxScroll, old + props.height * 0.8)),
        },
        {
          id: "draft-previous-page",
          key: "PageUp",
          onInvoke: () => setScrollY((old) => Math.max(0, old - props.height * 0.8)),
        },
      ]}
    >
      <ScrollColumn
        width={props.width}
        height={props.height}
        gap={theme.foundations.space.md}
        scrollY={Math.min(maxScroll, scrollY)}
        onScroll={setScrollY}
        smooth={false}
      >
        {children}
      </ScrollColumn>
    </ShortcutManager>
  );
}
export function CalendarEventEditor(
  props: WindowSize & {
    draft: EventDraft;
    status: string;
    onChange: (key: Exclude<keyof EventDraft, "id">, value: string) => void;
    onCancel: () => void;
    onSave: () => void;
  },
): ReactNode {
  const theme = useWidgetTheme(),
    spacing = theme.foundations.space,
    metrics = theme.recipes.dialog.medium.metrics;
  const width = Math.max(1, Math.min(520 * getUiScaleFactor(), props.width - spacing.md * 2));
  const inner = Math.max(1, width - metrics.bodyPaddingX * 2);
  const footer = (
    <Horizontal width={inner} wrap align="center" gap={spacing.sm}>
      <Button label="Cancel" onPress={props.onCancel} />
      <Button label="Save Event" variant="primary" onPress={props.onSave} />
    </Horizontal>
  );
  const footerHeight = measureColumnContent(
    {
      width,
      padding: {
        top: spacing.sm,
        right: metrics.bodyPaddingX,
        bottom: metrics.bodyPaddingBottom,
        left: metrics.bodyPaddingX,
      },
      gap: 0,
      children: footer,
    },
    theme,
  ).height;
  const fields = DRAFT_FIELDS.map(({ key, label }) => (
    <Vertical key={key} gap={spacing.xs}>
      <TextBlock text={label} fontSize={13} wrap />
      <TextField width={inner} value={props.draft[key]} />
    </Vertical>
  ));
  const bodyHeight = measureColumnContent(
    {
      width: inner,
      gap: spacing.md,
      children: [...fields, <TextBlock key="status" text={props.status} fontSize={11} wrap />],
    },
    theme,
  ).height;
  const height = Math.max(
    1,
    Math.min(
      props.height - spacing.md * 2,
      Math.ceil(metrics.titlebarHeight + metrics.bodyPaddingTop + bodyHeight + footerHeight),
    ),
  );
  return (
    <>
      <ModalBarrier width={props.width} height={props.height} visible onDismiss={props.onCancel} />
      <FocusScope
        x={(props.width - width) / 2}
        y={(props.height - height) / 2}
        width={width}
        height={height}
        trap
        onEscape={props.onCancel}
      >
        <ShortcutManager
          width={width}
          height={height}
          shortcuts={[{ id: "save-draft", key: "s", ctrl: true, onInvoke: props.onSave }]}
        >
          <Dialog
            width={width}
            height={height}
            title={props.draft.id ? "Edit event" : "New event"}
            onClose={props.onCancel}
            footer={footer}
          >
            <Measure flexGrow={1} minHeight={1}>
              {(size) => (
                <DraftFields
                  {...size}
                  draft={props.draft}
                  status={props.status}
                  onChange={props.onChange}
                />
              )}
            </Measure>
          </Dialog>
        </ShortcutManager>
      </FocusScope>
    </>
  );
}
function LeaveDraftDialog(
  props: WindowSize & {
    open: boolean;
    error: string;
    onSave: () => void;
    onDiscard: () => void;
    onCancel: () => void;
  },
): ReactNode {
  const theme = useWidgetTheme(),
    spacing = theme.foundations.space,
    metrics = theme.recipes.dialog.medium.metrics;
  if (!props.open) return null;
  const width = Math.max(1, Math.min(480 * getUiScaleFactor(), props.width - spacing.md * 2)),
    inner = Math.max(1, width - metrics.bodyPaddingX * 2);
  const body = (
    <Vertical width={inner} gap={spacing.md}>
      <TextBlock
        text="This event has unsaved changes. Save the event, discard the changes, or keep editing."
        fontSize={13}
        wrap
      />
      {props.error ? (
        <TextBlock text={props.error} color={theme.foundations.palette.danger} fontSize={13} wrap />
      ) : null}
    </Vertical>
  );
  const footer = (
    <Horizontal width={inner} wrap align="center" gap={spacing.sm}>
      <Button label="Save" variant="primary" onPress={props.onSave} />
      <Button label="Discard" variant="danger" onPress={props.onDiscard} />
      <Button label="Cancel" onPress={props.onCancel} />
    </Horizontal>
  );
  const bodyHeight = measureColumnContent({ width: inner, gap: 0, children: body }, theme).height,
    footerHeight = measureColumnContent(
      {
        width,
        padding: {
          top: spacing.sm,
          right: metrics.bodyPaddingX,
          bottom: metrics.bodyPaddingBottom,
          left: metrics.bodyPaddingX,
        },
        gap: 0,
        children: footer,
      },
      theme,
    ).height;
  const height = Math.max(
    1,
    Math.min(
      props.height - spacing.md * 2,
      Math.ceil(metrics.titlebarHeight + metrics.bodyPaddingTop + bodyHeight + footerHeight),
    ),
  );
  return (
    <>
      <ModalBarrier width={props.width} height={props.height} visible />
      <FocusScope
        x={(props.width - width) / 2}
        y={(props.height - height) / 2}
        width={width}
        height={height}
        trap
        onEscape={props.onCancel}
      >
        <Dialog
          width={width}
          height={height}
          title="Save event before leaving?"
          onClose={props.onCancel}
          footer={footer}
        >
          <Measure flexGrow={1} minHeight={1}>
            {(size) => (
              <ScrollColumn {...size} gap={0} smooth={false}>
                {body}
              </ScrollColumn>
            )}
          </Measure>
        </Dialog>
      </FocusScope>
    </>
  );
}

export function CalendarApp(
  props: WindowSize & {
    store: CalendarStore;
    now?: () => number;
    onClose?: () => void;
    onCloseGuard?: (guard: () => boolean) => void;
  },
): ReactNode {
  const pal = usePalette();
  const uiScale = getUiScaleFactor();
  const [loaded, setLoaded] = useState(() => {
    try {
      const snapshot = props.store.load();
      return { events: [...snapshot.items], revision: snapshot.revision, error: "" };
    } catch (error) {
      return { events: [], revision: null, error: String(error) };
    }
  });
  const [savedRevision, setSavedRevision] = useState(loaded.revision);
  const [conflict, setConflict] = useState<{
    kind: "recovery" | "cleanup";
    title: string;
    message: string;
  } | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>(loaded.events);
  const [status, setStatus] = useState(loaded.error || "Events are saved on this computer");
  const [zone] = useState(defaultTimeZone);
  const today = localDateTime((props.now ?? Date.now)(), zone).date;
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<DraftState | null>(null);
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const draft = editing?.value ?? null;
  const [leaving, setLeaving] = useState<LeaveIntent | null>(null);
  const [draftError, setDraftError] = useState("");
  const clearDraft = () => {
    editingRef.current = null;
    setEditing(null);
    setDraftError("");
  };
  const beginDraft = (value: EventDraft) => {
    if (draftChanged(editingRef.current)) {
      setStatus("Save or cancel the current event before opening another draft.");
      return;
    }
    const state = { value, original: value };
    editingRef.current = state;
    setEditing(state);
    setDraftError("");
  };
  const changeDraft = (key: Exclude<keyof EventDraft, "id">, value: string) => {
    const current = editingRef.current;
    if (!current) return;
    const next = { ...current, value: { ...current.value, [key]: value } };
    editingRef.current = next;
    setEditing(next);
    setDraftError("");
  };
  const leave = (intent: LeaveIntent) => {
    if (draftChanged(editingRef.current)) {
      setLeaving(intent);
      return;
    }
    clearDraft();
    if (intent === "window") props.onClose?.();
  };
  useEffect(() => {
    props.onCloseGuard?.(() => {
      if (!draftChanged(editingRef.current)) return true;
      setLeaving("window");
      return false;
    });
  }, [props.onCloseGuard]);
  const [deleting, setDeleting] = useState<CalendarEvent | null>(null);
  const calendarW = Math.max(280, Math.floor((props.width - 52) * 0.48));
  const agendaX = calendarW + 36,
    agendaW = Math.max(180, props.width - agendaX - 16);
  const newEvent = () =>
    beginDraft({ title: "", date, start: "09:00", end: "10:00", timeZone: zone, notes: "" });
  const persist = (next: CalendarEvent[], message: string) => {
    if (loaded.error) {
      setStatus(loaded.error);
      setConflict({
        kind: "recovery",
        title: "Could not save",
        message: loaded.error,
      });
      return null;
    }
    try {
      const saved = props.store.write(next, savedRevision);
      setEvents([...saved.items]);
      setSavedRevision(saved.revision);
      if (saved.cleanup.kind === "pending") {
        console.warn("[calendar] Saved with pending cleanup", saved.cleanup.message);
        setConflict({
          kind: "cleanup",
          title: "Saved; cleanup pending",
          message:
            "Your changes are saved. Cleanup of owned temporary files is pending. Retry cleanup does not save another copy; a later save also retries it.",
        });
      }
      setStatus(saved.cleanup.kind === "pending" ? `${message}. Cleanup pending.` : message);
      return saved;
    } catch (error) {
      setConflict({
        kind: "recovery",
        title: error instanceof StorageConflictError ? "Saved data changed" : "Could not save",
        message: error instanceof Error ? error.message : String(error),
      });
      setStatus(String(error));
      return null;
    }
  };
  const save = (after: LeaveIntent | undefined = leaving ?? undefined) => {
    const value = editingRef.current?.value;
    if (!value) return;
    try {
      const event = eventFromDraft(value);
      const saved = persist(
        [...events.filter((item) => item.id !== event.id), event],
        `Saved ${event.title}`,
      );
      if (saved) {
        clearDraft();
        setLeaving(null);
        if (after === "window" && saved.cleanup.kind === "complete") props.onClose?.();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(message);
      setDraftError(message);
    }
  };
  const retryCleanup = () => {
    const cleanup = retryStoreCleanup();
    if (cleanup.kind === "complete") {
      setConflict(null);
      setStatus("Changes saved; storage cleanup finished.");
    } else {
      console.warn("[calendar] Storage cleanup remains pending", cleanup.message);
      setConflict({
        kind: "cleanup",
        title: "Saved; cleanup pending",
        message:
          "Your changes remain saved. Cleanup could not finish. Retry cleanup does not save another copy.",
      });
    }
  };
  const reloadSaved = () => {
    try {
      const snapshot = props.store.load();
      setLoaded({ events: [...snapshot.items], revision: snapshot.revision, error: "" });
      setEvents([...snapshot.items]);
      setSavedRevision(snapshot.revision);
      setDeleting(null);
      setStatus("Reloaded saved data. Your current draft is kept; review it before retrying.");
      setConflict(null);
    } catch (error) {
      setStatus(String(error));
      setConflict({
        kind: "recovery",
        title: "Could not reload saved data",
        message: `${String(error)}. Your draft is still here.`,
      });
    }
  };
  const visible = query.trim()
    ? events
        .filter((event) =>
          `${event.title} ${event.notes}`.toLowerCase().includes(query.trim().toLowerCase()),
        )
        .sort((a, b) => a.startMs - b.startMs)
    : dayEvents(events, date, zone);
  const edit = (event: CalendarEvent) => {
    const local = localDateTime(event.startMs, event.timeZone);
    beginDraft({
      id: event.id,
      title: event.title,
      date: local.date,
      start: local.time,
      end: localDateTime(event.endMs, event.timeZone).time,
      timeZone: event.timeZone,
      notes: event.notes,
    });
  };
  return (
    <OverlayHost width={props.width} height={props.height}>
      <ShortcutManager
        width={props.width}
        height={props.height}
        shortcuts={[
          { id: "new-event", key: "n", ctrl: true, onInvoke: newEvent },
          { id: "save-event", key: "s", ctrl: true, onInvoke: () => save() },
        ]}
      >
        <Surface width={props.width} height={props.height} fill={pal.bg} clip>
          <Toolbar width={props.width} height={64}>
            <Button
              label="Reload saved"
              onPress={() =>
                setConflict({
                  kind: "recovery",
                  title: "Reload saved data?",
                  message: "Current input is kept. Review it before retrying the save.",
                })
              }
            />
            <Label flexGrow={1} text="Calendar" fontSize={22} fontWeight="bold" />
            <Button
              width={76 * uiScale}
              label="Today"
              onPress={() => {
                setDate(today);
                setMonth(today.slice(0, 7));
              }}
            />
            <Button
              width={112 * uiScale}
              label="New Event"
              variant="primary"
              disabled={!!loaded.error}
              onPress={newEvent}
            />
          </Toolbar>
          <Button
            x={16}
            y={80}
            width={40}
            label="‹"
            onPress={() => setMonth(moveMonth(month, -1))}
          />
          <Label
            x={64}
            y={86}
            width={calendarW - 110}
            text={new Date(`${month}-01T12:00:00Z`).toLocaleDateString(undefined, {
              month: "long",
              year: "numeric",
              timeZone: "UTC",
            })}
            fontSize={18}
          />
          <Button
            x={calendarW - 26}
            y={80}
            width={40}
            label="›"
            onPress={() => setMonth(moveMonth(month, 1))}
          />
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((name, index) => (
            <Label
              key={name}
              x={16 + (index * calendarW) / 7}
              y={125}
              width={calendarW / 7}
              text={name}
              color={pal.muted}
              fontSize={11}
            />
          ))}
          {monthDays(month).map((day, index) => {
            const count = dayEvents(events, day, zone).length;
            return (
              <Pressable
                key={day}
                x={16 + ((index % 7) * calendarW) / 7}
                y={150 + Math.floor(index / 7) * 52}
                width={calendarW / 7 - 3}
                height={49}
                fill={day === date ? pal.selection : pal.surface}
                focusId={`day:${day}`}
                onPress={() => {
                  setDate(day);
                  setQuery("");
                }}
              >
                <Label
                  x={10}
                  y={7}
                  text={String(Number(day.slice(-2)))}
                  color={day === today ? pal.accent : day.startsWith(month) ? pal.text : pal.muted}
                  fontSize={14}
                />
                {count > 0 && (
                  <Label
                    x={10}
                    y={29}
                    text={`${count} event${count === 1 ? "" : "s"}`}
                    color={pal.accent}
                    fontSize={9}
                  />
                )}
              </Pressable>
            );
          })}
          <Label x={16} y={475} width={calendarW} text={zone} color={pal.muted} fontSize={11} />
          <SearchField
            x={agendaX}
            y={80}
            width={agendaW}
            value={query}
            placeholder="Search all events"
            onChange={setQuery}
          />
          <Label
            x={agendaX}
            y={126}
            text={query ? `${visible.length} matching events` : date}
            fontSize={16}
          />
          <ScrollArea
            x={agendaX}
            y={154 + (uiScale - 1) * 16}
            width={agendaW}
            height={Math.max(100, props.height - 202 - (uiScale - 1) * 16)}
            contentHeight={Math.max(70, visible.length * 90 * uiScale)}
          >
            {visible.length === 0 ? (
              <Label
                x={8}
                y={16}
                text={query ? "No events match your search" : "No events this day"}
                color={pal.muted}
              />
            ) : (
              visible.map((event, index) => (
                <Surface
                  key={event.id}
                  y={index * 90 * uiScale}
                  width={agendaW - 16}
                  height={82 * uiScale}
                  fill={pal.panel}
                >
                  <Label
                    x={10}
                    y={8}
                    width={agendaW - 30}
                    text={event.title}
                    fontWeight="bold"
                    overflow="ellipsis"
                    maxLines={1}
                  />
                  <Label
                    x={10}
                    y={8 + 22 * uiScale}
                    text={`${localDateTime(event.startMs, zone).date} · ${localDateTime(event.startMs, zone).time}–${localDateTime(event.endMs, zone).time}`}
                    fontSize={10}
                    color={pal.muted}
                  />
                  <Button
                    x={8}
                    y={8 + 40 * uiScale}
                    width={66 * uiScale}
                    height={28 * uiScale}
                    label="Edit"
                    onPress={() => edit(event)}
                  />
                  <Button
                    x={16 + 66 * uiScale}
                    y={8 + 40 * uiScale}
                    width={76 * uiScale}
                    height={28 * uiScale}
                    label="Delete"
                    variant="ghost"
                    onPress={() => setDeleting(event)}
                  />
                </Surface>
              ))
            )}
          </ScrollArea>
          <Label
            x={16}
            y={props.height - 30}
            width={props.width - 32}
            text={status}
            color={loaded.error ? pal.danger : pal.muted}
            fontSize={10}
            overflow="ellipsis"
            maxLines={1}
          />
        </Surface>
      </ShortcutManager>
      {draft ? (
        <CalendarEventEditor
          {...props}
          draft={draft}
          status={draftError || `${status}. Scroll or use Page Up / Page Down for all fields.`}
          onChange={changeDraft}
          onCancel={() => leave("editor")}
          onSave={() => save()}
        />
      ) : null}
      <LeaveDraftDialog
        {...props}
        open={leaving !== null}
        error={draftError}
        onSave={() => save(leaving ?? undefined)}
        onDiscard={() => {
          const intent = leaving;
          clearDraft();
          setLeaving(null);
          if (intent === "window") props.onClose?.();
        }}
        onCancel={() => setLeaving(null)}
      />
      <ConfirmationDialog
        open={!!deleting}
        viewportWidth={props.width}
        viewportHeight={props.height}
        title="Delete event?"
        message={`Delete ${deleting?.title ?? "this event"} from this calendar?`}
        confirmLabel="Delete"
        danger
        onDismiss={() => setDeleting(null)}
        onConfirm={() => {
          if (
            deleting &&
            persist(
              events.filter((event) => event.id !== deleting.id),
              "Event deleted",
            )
          )
            setDeleting(null);
        }}
      />

      <ConfirmationDialog
        open={!!conflict}
        viewportWidth={props.width}
        viewportHeight={props.height}
        title={conflict?.title ?? "Saved data changed"}
        message={conflict?.message ?? ""}
        confirmLabel={conflict?.kind === "cleanup" ? "Retry" : "Reload saved"}
        cancelLabel={conflict?.kind === "cleanup" ? "Close" : "Keep draft"}
        onDismiss={() => setConflict(null)}
        onConfirm={() => (conflict?.kind === "cleanup" ? retryCleanup() : reloadSaved())}
      />
    </OverlayHost>
  );
}
export async function main(): Promise<void> {
  const app = new Application(),
    window = new Window({
      title: "Calendar",
      appId: "org.moire.Calendar",
      width: 940,
      height: 660,
    });
  const store = new CalendarStore();
  window.setContent((size) => (
    <CalendarApp
      {...size}
      store={store}
      onClose={() => window.requestClose()}
      onCloseGuard={(guard) => window.setCloseGuard(guard)}
    />
  ));
  window.onClose(() => app.quit());
  app.addWindow(window);
  await app.run();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch((error) => {
    console.error("[calendar]", error);
    process.exitCode = 1;
  });
