import React, { useState, type ReactNode } from "react";
import {
  APP_STATUS_HEIGHT,
  AdaptivePanes,
  AppStatusLine,
  ConfirmationDialog,
  Icon,
  OverlayHost,
  ShortcutManager,
  Surface,
  WindowFrame,
  getUiScaleFactor,
  usePalette,
  type WindowActions,
  type WindowSize,
} from "@moire/ui";
import { FileChooser, errorText, runApp, startMain } from "@moire/app-tools";
import { NotesStore, createNote, createNotebook, exportNote } from "./store";
import {
  NO_OVERLAY,
  exportName,
  exportText,
  initialBrowse,
  notebookForNewNote,
  notebookTitle,
  notesInView,
  parseViewKey,
  removeNote,
  reselect,
  search,
  showView,
  viewKey,
  viewTitle,
  type NoteAction,
  type NotePatch,
  type Overlay,
} from "./model";
import { useNotebook } from "./use-notebook";
import { NotebooksPane } from "./views/notebooks-pane";
import { NotesListPane } from "./views/notes-list-pane";
import { EditorPane } from "./views/editor-pane";
import { NoteMenu } from "./views/note-menu";

const APP_ID = "org.moire.Notes";

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
      icon={<Icon symbolic name="notes" size={20 * getUiScaleFactor()} color={pal.accent} />}
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
  const notebook = useNotebook(props.store, props.onCloseGuard);
  const { book, flush, commit, latest } = notebook;
  const [browse, setBrowse] = useState(() => initialBrowse(book));
  const [activePane, setActivePane] = useState("document");
  const [draftName, setDraftName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [overlay, setOverlay] = useState<Overlay>(NO_OVERLAY);
  const note = book.notes.find((item) => item.id === browse.selected);
  const visible = notesInView(book.notes, browse.view, browse.query);
  const title = viewTitle(book, browse.view);

  // Every change of view or note saves the draft first; a failed save keeps you where you are.
  const browseTo = (next: typeof browse, pane?: string) => {
    setBrowse(next);
    setRenaming(false);
    if (pane) setActivePane(pane);
  };
  const newNote = () => {
    if (!flush()) return;
    const created = createNote(notebookForNewNote(browse.view));
    if (!commit({ ...latest(), notes: [created, ...latest().notes] })) return;
    const view = browse.view.kind === "pinned" ? { kind: "all" as const } : browse.view;
    browseTo({ view, query: "", selected: created.id }, "document");
  };
  const addNotebook = () => {
    if (!draftName?.trim() || !flush()) return;
    const created = createNotebook(draftName);
    if (!commit({ ...latest(), notebooks: [...latest().notebooks, created] })) return;
    setDraftName(null);
    browseTo(showView(latest(), browse, { kind: "notebook", id: created.id }), "collection");
  };
  const edit = (patch: NotePatch) => {
    if (browse.selected) notebook.edit(browse.selected, patch);
  };
  const remove = () => {
    setOverlay(NO_OVERLAY);
    if (note && commit(removeNote(latest(), note.id))) setBrowse(reselect(latest(), browse));
  };
  const reload = () => {
    setOverlay(NO_OVERLAY);
    const next = notebook.reload();
    if (next) browseTo(initialBrowse(next));
  };
  const exportTo = (file: string) => {
    setOverlay(NO_OVERLAY);
    if (!note) return;
    try {
      exportNote(file, exportText(note, file));
      notebook.setStatus(`Exported to ${file}`);
    } catch (error) {
      notebook.setStatus(errorText(error));
    }
  };
  const runAction = (action: NoteAction) => {
    if (action === "rename") setRenaming(true);
    else if (action === "pin" && note) {
      edit({ pinned: !note.pinned });
      // Unpinning in Pinned notes moves the selection to a note that is still listed.
      if (flush()) setBrowse(reselect(latest(), browse));
    } else if (action === "move" && overlay.kind === "menu")
      setOverlay({ ...overlay, menu: "move" });
    else if (action === "export") setOverlay({ kind: "export" });
    else if (action === "reload")
      if (notebook.hasUnsavedChanges()) setOverlay({ kind: "confirm", action: "reload" });
      else reload();
    else if (action === "delete") setOverlay({ kind: "confirm", action: "delete" });
  };
  const moveTo = (notebookId: string) => {
    edit({ notebookId });
    if (flush()) setBrowse(showView(latest(), browse, { kind: "notebook", id: notebookId }));
  };
  const openActions = () =>
    setOverlay({
      kind: "menu",
      menu: "actions",
      x: Math.max(12 * ui, props.width - 260 * ui),
      y: 16 * ui,
    });

  const statusHeight = Math.round(APP_STATUS_HEIGHT * ui);
  const notebookName = note ? notebookTitle(book, note.notebookId) : "Notes";
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
            height={Math.max(0, props.height - statusHeight)}
            activePaneId={activePane}
            onActivePaneChange={setActivePane}
            navigation={{
              id: "navigation",
              title: "Notebooks",
              preferredWidth: 194 * ui,
              minWidth: 160 * ui,
              render: (size) => (
                <NotebooksPane
                  {...size}
                  book={book}
                  selectedKey={viewKey(browse.view)}
                  draftName={draftName}
                  onSelect={(key) => {
                    if (flush())
                      browseTo(showView(latest(), browse, parseViewKey(key)), "collection");
                  }}
                  onDraftName={setDraftName}
                  onCreate={addNotebook}
                />
              ),
            }}
            collection={{
              id: "collection",
              title: "Notes list",
              preferredWidth: 294 * ui,
              minWidth: 232 * ui,
              render: (size) => (
                <NotesListPane
                  {...size}
                  book={book}
                  title={title}
                  notes={visible}
                  query={browse.query}
                  selected={browse.selected}
                  onQuery={(query) => {
                    if (flush()) browseTo(search(latest(), browse, query));
                  }}
                  onNewNote={newNote}
                  onSelect={(item) => {
                    if (flush()) browseTo({ ...browse, selected: item.id });
                  }}
                  onOpen={(item) => {
                    if (flush()) browseTo({ ...browse, selected: item.id });
                    setActivePane("document");
                  }}
                />
              ),
            }}
            content={{
              id: "document",
              title: "Editor",
              minWidth: 300 * ui,
              render: (size) => (
                <EditorPane
                  {...size}
                  note={note}
                  notebook={notebookName}
                  viewTitle={title}
                  emptyMessage={
                    browse.query.trim()
                      ? "No notes match this search. Try another name or phrase."
                      : book.notes.length
                        ? "This notebook is empty. Create a note here."
                        : "A quiet place for your ideas. Create your first note."
                  }
                  renaming={renaming}
                  onRename={setRenaming}
                  onTitle={(value) => edit({ title: value })}
                  onBody={(document) => edit({ body: document.text, runs: document.runs })}
                  onSave={() => flush()}
                  onActions={(event) =>
                    setOverlay({
                      kind: "menu",
                      menu: "actions",
                      x: event?.x ?? 24 * ui,
                      y: event ? event.y - props.contentOffsetY : 20 * ui,
                    })
                  }
                />
              ),
            }}
          />
          <AppStatusLine
            y={props.height - statusHeight}
            width={props.width}
            status={notebook.status}
          />
        </Surface>
      </ShortcutManager>
      {overlay.kind === "menu" ? (
        <NoteMenu
          menu={overlay.menu}
          x={overlay.x}
          y={overlay.y}
          viewportWidth={props.width}
          viewportHeight={props.height}
          note={note}
          notebooks={book.notebooks}
          onAction={runAction}
          onMove={moveTo}
          onDismiss={() => setOverlay(NO_OVERLAY)}
        />
      ) : null}
      <ConfirmationDialog
        open={overlay.kind === "confirm"}
        viewportWidth={props.width}
        viewportHeight={props.height}
        title={
          overlay.kind === "confirm" && overlay.action === "delete"
            ? "Delete this note?"
            : "Discard this draft and reload?"
        }
        message={
          overlay.kind === "confirm" && overlay.action === "delete"
            ? `“${note?.title || "Untitled note"}” will be removed from local Notes storage.`
            : "Another window may have updated your notes. Reload replaces your unsaved draft with the saved notebook."
        }
        confirmLabel={
          overlay.kind === "confirm" && overlay.action === "delete" ? "Delete" : "Reload"
        }
        danger
        onConfirm={overlay.kind === "confirm" && overlay.action === "delete" ? remove : reload}
        onDismiss={() => setOverlay(NO_OVERLAY)}
      />
      {overlay.kind === "export" && note ? (
        <FileChooser
          width={props.width}
          height={props.height}
          mode="save"
          appId={APP_ID}
          title="Export note"
          name={exportName(note)}
          onChoose={exportTo}
          onCancel={() => setOverlay(NO_OVERLAY)}
        />
      ) : null}
    </OverlayHost>
  );
}

startMain(import.meta.url, () => {
  const store = new NotesStore();
  return runApp(
    "Notes",
    APP_ID,
    (size, window) => (
      <NotesApp
        {...size}
        store={store}
        windowActions={window}
        onCloseGuard={(guard) => window.setCloseGuard(guard)}
      />
    ),
    { width: 880, height: 650 },
  );
});
