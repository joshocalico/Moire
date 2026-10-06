import React, { useEffect, useRef, useState, type ReactNode } from "react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Application,
  Window,
  WindowFrame,
  Icon,
  IconButton,
  OverlayHost,
  Surface,
  Row,
  Button,
  Label,
  TextField,
  SearchField,
  NavigationSidebar,
  ConfirmationDialog,
  ContextMenu,
  ShortcutManager,
  AdaptivePanes,
  CollectionList,
  CollectionRow,
  DocumentEditor,
  requestActiveWindowRedraw,
  setUiScaleFactor,
  getUiScaleFactor,
  usePalette,
  type WindowSize,
  type WindowActions,
  type DocumentValue,
} from "@moire/ui";
import { loadSettings } from "@moire/prefs";
import {
  NotesStore,
  createNote,
  createNotebook,
  emptyNotebook,
  filterNotes,
  LOCAL_NOTEBOOK_ID,
  type Notebook,
  type Note,
} from "./store";
export type NotesProps = WindowSize & {
  store: NotesStore;
  onCloseGuard?: (guard: () => boolean) => void;
  windowActions?: WindowActions;
};
export function NotesApp(props: NotesProps): ReactNode {
  const pal = usePalette();
  return (
    <WindowFrame
      {...props}
      title="Notes"
      actions={props.windowActions}
      icon={<Icon symbolic name="notes" size={20} color={pal.accent} />}
    >
      {(size) => (
        <NotesWorkspace {...props} {...size} contentOffsetY={props.height - size.height} />
      )}
    </WindowFrame>
  );
}
function NotesWorkspace(props: NotesProps & { contentOffsetY: number }): ReactNode {
  const pal = usePalette(),
    ui = getUiScaleFactor();
  const noteCount = (count: number) => `${count} ${count === 1 ? "note" : "notes"}`;
  const [initial] = useState(() => {
    try {
      return { book: props.store.load(), error: "" };
    } catch (error) {
      return {
        book: emptyNotebook(),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
  const [book, setBook] = useState(initial.book),
    [selected, setSelected] = useState<string | null>(
      filterNotes(initial.book.notes, "")[0]?.id ?? null,
    ),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [activePane, setActivePane] = useState("document"),
    [notebookName, setNotebookName] = useState<string | null>(null),
    [renaming, setRenaming] = useState(false),
    [moveMenu, setMoveMenu] = useState<{ x: number; y: number; kind: "actions" | "move" } | null>(
      null,
    ),
    [status, setStatus] = useState(initial.error || "Notes stay on this computer"),
    [confirm, setConfirm] = useState<"delete" | "reload" | null>(null);
  const current = useRef(book),
    unsaved = useRef(false);
  const update = (next: Notebook) => {
    current.current = next;
    setBook(next);
  };
  const flush = (): boolean => {
    if (!unsaved.current) return true;
    try {
      update(props.store.save(current.current));
      unsaved.current = false;
      setStatus("Saved locally");
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      return false;
    }
  };
  const commit = (next: Notebook): boolean => {
    try {
      update(props.store.save(next));
      unsaved.current = false;
      setStatus("Saved locally");
      return true;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
      return false;
    }
  };
  const newNote = () => {
    if (!flush()) return;
    const note = createNote(filter.startsWith("notebook:") ? filter.slice(9) : LOCAL_NOTEBOOK_ID);
    if (commit({ ...current.current, notes: [note, ...current.current.notes] })) {
      setSelected(note.id);
      setQuery("");
      setRenaming(false);
      setActivePane("document");
      if (filter === "pinned") setFilter("all");
    }
  };
  const edit = (
    patch: Partial<Pick<Note, "title" | "body" | "runs" | "notebookId" | "pinned">>,
  ) => {
    const next = {
      ...current.current,
      notes: current.current.notes.map((note) =>
        note.id === selected ? { ...note, ...patch, updatedAt: Date.now() } : note,
      ),
    };
    unsaved.current = true;
    update(next);
    setStatus("Saving…");
  };
  useEffect(() => {
    if (!unsaved.current) return;
    const timer = setTimeout(() => {
      flush();
      requestActiveWindowRedraw();
    }, 400);
    return () => clearTimeout(timer);
  }, [book]);
  useEffect(() => {
    props.onCloseGuard?.(() => {
      const accepted = flush();
      requestActiveWindowRedraw();
      return accepted;
    });
  }, [props.onCloseGuard]);
  const note = book.notes.find((item) => item.id === selected);
  const filtered = book.notes.filter(
    (item) =>
      filter === "all" || (filter === "pinned" ? item.pinned : item.notebookId === filter.slice(9)),
  );
  const visible = filterNotes(filtered, query);
  const notesInView = (notes: Note[], view: string, search: string) =>
    filterNotes(
      notes.filter((item) =>
        view === "all" ? true : view === "pinned" ? item.pinned : item.notebookId === view.slice(9),
      ),
      search,
    );
  const changeView = (view: string, search = "") => {
    if (!flush()) return;
    const next = notesInView(current.current.notes, view, search);
    setFilter(view);
    setQuery(search);
    setSelected(next.some((item) => item.id === selected) ? selected : (next[0]?.id ?? null));
    setRenaming(false);
    setActivePane("collection");
  };
  const changeQuery = (search: string) => {
    if (!flush()) return;
    const next = notesInView(current.current.notes, filter, search);
    setQuery(search);
    setSelected(next.some((item) => item.id === selected) ? selected : (next[0]?.id ?? null));
    setRenaming(false);
  };
  const collectionTitle =
    filter === "all"
      ? "All notes"
      : filter === "pinned"
        ? "Pinned notes"
        : (book.notebooks.find((item) => `notebook:${item.id}` === filter)?.title ?? "Notes");
  const select = (item: Note) => {
    if (flush()) {
      setSelected(item.id);
      setRenaming(false);
    }
  };
  const addNotebook = () => {
    if (!notebookName?.trim() || !flush()) return;
    const folder = createNotebook(notebookName);
    if (commit({ ...current.current, notebooks: [...current.current.notebooks, folder] })) {
      setNotebookName(null);
      setFilter(`notebook:${folder.id}`);
      setQuery("");
      setSelected(null);
      setRenaming(false);
      setActivePane("collection");
    }
  };
  const remove = () => {
    if (!note) return;
    const remaining = current.current.notes.filter((item) => item.id !== note.id);
    if (commit({ ...current.current, notes: remaining }))
      setSelected(notesInView(remaining, filter, query)[0]?.id ?? null);
    setConfirm(null);
  };
  const reload = () => {
    try {
      const next = props.store.load();
      update(next);
      unsaved.current = false;
      setSelected(filterNotes(next.notes, "")[0]?.id ?? null);
      setFilter("all");
      setQuery("");
      setRenaming(false);
      setStatus("Reloaded local notes");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
    setConfirm(null);
  };
  const footerHeight = 44 * ui;
  const openActions = () =>
    setMoveMenu({ x: Math.max(12 * ui, props.width - 260 * ui), y: 16 * ui, kind: "actions" });
  return (
    <OverlayHost width={props.width} height={props.height}>
      <ShortcutManager
        width={props.width}
        height={props.height}
        shortcuts={[
          { id: "new-note", code: 49, ctrl: true, onInvoke: newNote },
          { id: "save-note", code: 31, ctrl: true, onInvoke: () => flush() },
          { id: "note-actions", code: 50, ctrl: true, shift: true, onInvoke: openActions },
          { id: "note-context", code: 139, onInvoke: openActions },
        ]}
      >
        <Surface width={props.width} height={props.height} fill={pal.bg}>
          <AdaptivePanes
            width={props.width}
            height={Math.max(0, props.height - footerHeight)}
            activePaneId={activePane}
            onActivePaneChange={setActivePane}
            navigation={{
              id: "navigation",
              title: "Notebooks",
              preferredWidth: 194 * ui,
              minWidth: 160 * ui,
              render: (size) => (
                <Surface {...size} fill={pal.panel} clip>
                  <Label
                    x={18 * ui}
                    y={18 * ui}
                    width={size.width - 36 * ui}
                    height={30 * ui}
                    text="Your notebooks"
                    fontSize={16}
                    fontWeight="medium"
                  />
                  <NavigationSidebar
                    y={58 * ui}
                    width={size.width}
                    height={Math.max(0, size.height - 124 * ui)}
                    selectedId={filter}
                    labelCase="preserve"
                    sections={[
                      {
                        id: "views",
                        items: [
                          { id: "all", label: "All notes", subtitle: noteCount(book.notes.length) },
                          {
                            id: "pinned",
                            label: "Pinned notes",
                            subtitle: `${book.notes.filter((item) => item.pinned).length} pinned`,
                          },
                        ],
                      },
                      {
                        id: "notebooks",
                        label: "Notebooks",
                        items: book.notebooks.map((folder) => ({
                          id: `notebook:${folder.id}`,
                          label: folder.title,
                          subtitle: noteCount(
                            book.notes.filter((item) => item.notebookId === folder.id).length,
                          ),
                        })),
                      },
                    ]}
                    onSelect={(item) => changeView(item.id)}
                  />
                  {notebookName === null ? (
                    <Button
                      x={12 * ui}
                      y={size.height - 52 * ui}
                      label="New notebook"
                      focusId="notes:new-notebook"
                      variant="ghost"
                      onPress={() => setNotebookName("")}
                    />
                  ) : (
                    <TextField
                      x={12 * ui}
                      y={size.height - 52 * ui}
                      width={Math.max(1, size.width - 24 * ui)}
                      value={notebookName}
                      onChange={setNotebookName}
                      autoFocus
                      placeholder="Name, then Enter"
                      onSubmit={addNotebook}
                      onCancel={() => setNotebookName(null)}
                    />
                  )}
                </Surface>
              ),
            }}
            collection={{
              id: "collection",
              title: "Notes list",
              preferredWidth: 294 * ui,
              minWidth: 232 * ui,
              render: (size) => (
                <Surface {...size} fill={pal.panel} clip>
                  <Label
                    x={16 * ui}
                    y={18 * ui}
                    width={size.width - 32 * ui}
                    height={28 * ui}
                    text={collectionTitle}
                    fontSize={18}
                    fontWeight="medium"
                    maxLines={1}
                    overflow="ellipsis"
                  />
                  <SearchField
                    x={14 * ui}
                    y={58 * ui}
                    width={Math.max(1, size.width - 28 * ui)}
                    value={query}
                    onChange={changeQuery}
                    placeholder="Search notes"
                  />
                  <Row
                    x={14 * ui}
                    y={104 * ui}
                    width={size.width - 28 * ui}
                    height={36 * ui}
                    align="center"
                    gap={8 * ui}
                  >
                    <Label
                      flexGrow={1}
                      text={
                        query
                          ? `${visible.length} ${visible.length === 1 ? "match" : "matches"}`
                          : noteCount(visible.length)
                      }
                      fontSize={11}
                      color={pal.muted}
                    />
                    <Button
                      label="New note"
                      focusId="notes:new"
                      variant="primary"
                      onPress={newNote}
                    />
                  </Row>
                  <CollectionList
                    x={0}
                    y={152 * ui}
                    width={size.width}
                    height={Math.max(0, size.height - 152 * ui)}
                    items={visible}
                    getKey={(item) => item.id}
                    selectedKey={selected}
                    onSelect={select}
                    onActivate={(item) => {
                      select(item);
                      setActivePane("document");
                    }}
                    rowHeight={94 * ui}
                    focusId="notes:collection"
                    emptyMessage={
                      query ? "No notes match your search." : "Create a note in this notebook."
                    }
                    renderItem={(item, state) => (
                      <CollectionRow
                        {...state}
                        title={item.title || "Untitled note"}
                        subtitle={
                          item.pinned
                            ? "Pinned"
                            : book.notebooks.find((folder) => folder.id === item.notebookId)?.title
                        }
                        preview={
                          item.body.replace(/\s+/g, " ") || "An empty page, ready for an idea."
                        }
                        metadata={new Date(item.updatedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      />
                    )}
                  />
                </Surface>
              ),
            }}
            content={{
              id: "document",
              title: "Editor",
              minWidth: 300 * ui,
              render: (size) => (
                <Surface {...size} fill={pal.bg} clip>
                  <Row
                    x={18 * ui}
                    y={12 * ui}
                    width={Math.max(1, size.width - 36 * ui)}
                    height={32 * ui}
                    gap={4 * ui}
                    align="center"
                  >
                    <Label
                      text={
                        note
                          ? `${book.notebooks.find((folder) => folder.id === note.notebookId)?.title ?? "Notes"} / ${note.title || "Untitled note"}`
                          : collectionTitle
                      }
                      fontSize={11}
                      color={pal.muted}
                      flexGrow={1}
                      maxLines={1}
                      overflow="ellipsis"
                    />
                    <Button
                      label="Save"
                      size="small"
                      variant="ghost"
                      focusId="notes:save"
                      onPress={() => flush()}
                    />
                    <IconButton
                      width={30 * ui}
                      height={30 * ui}
                      tooltip="Note actions"
                      focusId="notes:more"
                      icon={<Icon symbolic name="more" size={18} color={pal.muted} />}
                      onPress={(event) =>
                        setMoveMenu({
                          x: event?.x ?? 24 * ui,
                          y: event ? event.y - props.contentOffsetY : 20 * ui,
                          kind: "actions",
                        })
                      }
                    />
                  </Row>
                  {note ? (
                    <>
                      {renaming ? (
                        <TextField
                          x={24 * ui}
                          y={64 * ui}
                          width={Math.max(1, size.width - 48 * ui)}
                          height={42 * ui}
                          value={note.title}
                          onChange={(title) => edit({ title })}
                          autoFocus
                          selectAllOnFocus
                          placeholder="Note title"
                          onSubmit={() => setRenaming(false)}
                          onCancel={() => setRenaming(false)}
                        />
                      ) : (
                        <Surface
                          x={24 * ui}
                          y={64 * ui}
                          width={Math.max(1, size.width - 48 * ui)}
                          height={42 * ui}
                          fill={pal.bg}
                          onPress={() => setRenaming(true)}
                        >
                          <Label
                            width={Math.max(1, size.width - 48 * ui)}
                            height={42 * ui}
                            text={note.title || "Untitled note"}
                            fontSize={28}
                            fontWeight="medium"
                            fontFamily="serif"
                            maxLines={1}
                            overflow="ellipsis"
                          />
                        </Surface>
                      )}
                      <Label
                        x={24 * ui}
                        y={112 * ui}
                        width={Math.max(1, size.width - 48 * ui)}
                        height={24 * ui}
                        text={`${book.notebooks.find((folder) => folder.id === note.notebookId)?.title ?? "Notes"} · Edited ${new Date(note.updatedAt).toLocaleDateString()}`}
                        fontSize={11}
                        color={pal.muted}
                        maxLines={1}
                        overflow="ellipsis"
                      />
                      <DocumentEditor
                        key={note.id}
                        x={10 * ui}
                        y={150 * ui}
                        width={Math.max(1, size.width - 20 * ui)}
                        height={Math.max(1, size.height - 190 * ui)}
                        value={{ text: note.body, runs: note.runs }}
                        onChange={(document: DocumentValue) =>
                          edit({ body: document.text, runs: document.runs })
                        }
                        autoFocus
                        focusId={`note:${note.id}`}
                        fontSize={16}
                        padding={14 * ui}
                        placeholder="Write a note…"
                      />
                      <Label
                        x={24 * ui}
                        y={size.height - 30 * ui}
                        width={Math.max(1, size.width - 48 * ui)}
                        height={22 * ui}
                        text={`${note.body.trim() ? note.body.trim().split(/\s+/u).length : 0} words · Ctrl+B bold · Ctrl+U underline`}
                        fontSize={10}
                        color={pal.muted}
                        maxLines={1}
                        overflow="ellipsis"
                      />
                    </>
                  ) : (
                    <Label
                      x={24 * ui}
                      y={64 * ui}
                      width={Math.max(1, size.width - 48 * ui)}
                      height={110 * ui}
                      text={
                        query.trim()
                          ? "No notes match this search. Try another name or phrase."
                          : book.notes.length
                            ? "This notebook is empty. Create a note here."
                            : "A quiet place for your ideas. Create your first note."
                      }
                      fontSize={20}
                      wrap
                      color={pal.muted}
                    />
                  )}
                </Surface>
              ),
            }}
          />
          <Label
            x={14 * ui}
            y={props.height - footerHeight + 6 * ui}
            width={Math.max(1, props.width - 28 * ui)}
            height={footerHeight - 8 * ui}
            text={status}
            fontSize={11}
            color={pal.muted}
            wrap
            maxLines={2}
            overflow="ellipsis"
          />
        </Surface>
      </ShortcutManager>
      {moveMenu ? (
        <ContextMenu
          key={moveMenu.kind}
          viewportWidth={props.width}
          viewportHeight={props.height}
          x={moveMenu.x}
          y={moveMenu.y}
          title={moveMenu.kind === "move" ? "Move to notebook" : "Note actions"}
          actions={
            moveMenu.kind === "move"
              ? book.notebooks.map((folder) => ({
                  id: folder.id,
                  label: folder.title,
                  disabled: folder.id === note?.notebookId,
                  onPress: () => {
                    edit({ notebookId: folder.id });
                    if (flush()) {
                      setFilter(`notebook:${folder.id}`);
                      setQuery("");
                    }
                  },
                }))
              : [
                  {
                    id: "rename",
                    label: "Rename",
                    disabled: !note,
                    onPress: () => setRenaming(true),
                  },
                  {
                    id: "pin",
                    label: note?.pinned ? "Unpin" : "Pin",
                    disabled: !note,
                    onPress: () => {
                      edit({ pinned: !note?.pinned });
                      if (flush() && filter === "pinned" && note?.pinned)
                        setSelected(
                          notesInView(current.current.notes, filter, query)[0]?.id ?? null,
                        );
                    },
                  },
                  {
                    id: "move",
                    label: "Move to notebook",
                    disabled: !note,
                    onPress: () => setMoveMenu({ ...moveMenu, kind: "move" }),
                  },
                  {
                    id: "reload",
                    label: "Reload saved notes",
                    separatorBefore: true,
                    onPress: () => (unsaved.current ? setConfirm("reload") : reload()),
                  },
                  {
                    id: "delete",
                    label: "Delete note",
                    danger: true,
                    disabled: !note,
                    onPress: () => setConfirm("delete"),
                  },
                ]
          }
          onDismiss={() => setMoveMenu(null)}
        />
      ) : null}
      <ConfirmationDialog
        open={confirm !== null}
        viewportWidth={props.width}
        viewportHeight={props.height}
        title={confirm === "delete" ? "Delete this note?" : "Discard this draft and reload?"}
        message={
          confirm === "delete"
            ? `“${note?.title || "Untitled note"}” will be removed from local Notes storage.`
            : "Another window may have updated your notes. Reload replaces your unsaved draft with the saved notebook."
        }
        confirmLabel={confirm === "delete" ? "Delete" : "Reload"}
        danger
        onConfirm={confirm === "delete" ? remove : reload}
        onDismiss={() => setConfirm(null)}
      />
    </OverlayHost>
  );
}
export async function main(): Promise<void> {
  const settings = loadSettings();
  setUiScaleFactor(settings.uiScale);
  const app = new Application();
  const win = new Window({
    title: "Notes",
    appId: "org.moire.Notes",
    width: Math.round(880 * settings.uiScale),
    height: Math.round(650 * settings.uiScale),
    resizable: true,
    decorated: false,
  });
  const store = new NotesStore();
  win.setContent((size) => (
    <NotesApp
      {...size}
      store={store}
      windowActions={win}
      onCloseGuard={(guard) => win.setCloseGuard(guard)}
    />
  ));
  app.addWindow(win);
  await app.run();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch((error) => {
    console.error("[notes]", error);
    process.exitCode = 1;
  });
