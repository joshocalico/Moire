/** The editor's state and actions: the open document, prompts, find/replace and save flow. */
import fs from "node:fs";
import path from "node:path";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  requestActiveWindowRedraw,
  type DocumentSelection,
  type TextAreaCommand,
  type TextRange,
} from "@moire/ui";
import {
  errorText,
  loadAppSettings,
  loadRecentFiles,
  rememberRecentFile,
  saveAppSettings,
} from "@moire/app-tools";
import {
  blankDocument,
  documentDirty,
  documentPath,
  openDocument,
  saveDocument,
  type TextDocument,
} from "./backend";
import {
  EDITOR_APP_ID,
  MAX_MATCHES,
  closedFind,
  documentName,
  findMatches,
  lineOffset,
  matchAt,
  replaceAll,
  stepMatch,
  type Action,
  type FindState,
  type Prompt,
} from "./model";

type EditorSessionOptions = {
  initialDocument?: TextDocument;
  initialError?: string;
  onClose: () => void;
  onTitleChange?: (title: string) => void;
  onCloseGuard?: (guard: () => boolean) => void;
};

type Settings = { wrap: boolean };
/** Long lines wrap unless the person turned wrapping off. */
const parseSettings = (data: unknown): Settings => ({
  wrap: !(data && typeof data === "object" && "wrap" in data && data.wrap === false),
});

const START: TextAreaCommand = { select: { anchor: 0, focus: 0 } };
const range = (selection: DocumentSelection): TextRange => ({
  from: Math.min(selection.anchor, selection.focus),
  to: Math.max(selection.anchor, selection.focus),
});

export function useEditorSession(options: EditorSessionOptions) {
  const [document, setDocument] = useState(options.initialDocument ?? blankDocument());
  const current = useRef(document);
  // A new identity remounts the text area, so one document's Undo never reaches another.
  const [buffer, setBuffer] = useState(0);
  const [command, setCommand] = useState<TextAreaCommand>(START);
  const selectionRef = useRef<DocumentSelection>(START.select);
  const [selection, setSelectionState] = useState<DocumentSelection>(START.select);
  const [status, setStatus] = useState(options.initialError ?? "UTF-8 text · Ctrl+S to save");
  const [prompt, setPromptState] = useState<Prompt>({ kind: "none" });
  const [problem, setProblem] = useState("");
  const [find, setFind] = useState<FindState>(closedFind);
  const [findFocus, setFindFocus] = useState(0);
  // Bumped to hand keyboard focus back to the document after the find row closes.
  const [documentFocus, setDocumentFocus] = useState(0);
  const [wrap, setWrap] = useState(() => loadAppSettings(EDITOR_APP_ID, parseSettings).wrap);

  const setPrompt = (next: Prompt) => {
    setPromptState(next);
    setProblem("");
  };
  const fail = (error: unknown, context?: string) => {
    const message = errorText(error);
    setStatus(context ? `${context}: ${message}` : message);
    setProblem(message);
  };
  const update = (next: TextDocument) => {
    current.current = next;
    setDocument(next);
  };
  const select = (next: DocumentSelection) => setCommand({ select: next });

  const perform = (action: Action) => {
    try {
      if (action.kind === "close") {
        options.onClose();
        return;
      }
      const next = action.kind === "new" ? blankDocument() : openDocument(action.path);
      update(next);
      if (next.path) rememberRecentFile(EDITOR_APP_ID, next.path);
      setBuffer((identity) => identity + 1);
      setCommand({ select: { anchor: 0, focus: 0 } });
      setPrompt({ kind: "none" });
      setStatus(action.kind === "new" ? "New document" : `Opened ${documentName(next.path)}`);
    } catch (error) {
      setPrompt({ kind: "none" });
      fail(error, action.kind === "open" ? `Couldn't open ${path.basename(action.path)}` : "");
    }
  };
  const request = (action: Action) => {
    if (documentDirty(current.current)) setPrompt({ kind: "discard", after: action });
    else perform(action);
  };
  /** Save to `target` (the document's own file by default), asking where when it has none. */
  const save = (target = current.current.path, overwrite = false, after: Action | null = null) => {
    if (!target) {
      setPrompt({ kind: "choose-save", after });
      return;
    }
    try {
      const file = documentPath(target);
      if (file !== current.current.path && fs.existsSync(file) && !overwrite) {
        setPrompt({ kind: "overwrite", path: file, after });
        return;
      }
      update(saveDocument(current.current, file, overwrite));
      rememberRecentFile(EDITOR_APP_ID, file);
      setStatus(`Saved ${path.basename(file)}`);
      setPrompt({ kind: "none" });
      if (after) perform(after);
    } catch (error) {
      fail(error, "Couldn't save");
    }
  };

  // Find and replace work on the text as the text area last reported it.
  const matches = useMemo(
    () => (find.mode === "closed" ? [] : findMatches(document.text, find.query, find.matchCase)),
    [document.text, find.mode, find.query, find.matchCase],
  );
  const currentMatch = matchAt(matches, range(selection));
  const count = matches.length >= MAX_MATCHES ? `${MAX_MATCHES}+` : String(matches.length);
  const findSummary = !matches.length
    ? "No results"
    : currentMatch >= 0
      ? `${currentMatch + 1} of ${count}`
      : `${count} found`;
  const openFind = (mode: "find" | "replace") => {
    // A short single-line selection is what people usually want to search for.
    const selected = document.text.slice(
      range(selectionRef.current).from,
      range(selectionRef.current).to,
    );
    setFind((previous) => ({
      ...previous,
      mode,
      query:
        selected && !selected.includes("\n") && selected.length <= 200 ? selected : previous.query,
    }));
    setFindFocus((request) => request + 1);
  };
  const closeFind = () => {
    setFind((previous) => ({ ...previous, mode: "closed" }));
    setDocumentFocus((request) => request + 1);
  };
  const changeFind = (next: FindState) => {
    setFind(next);
    if (next.query === find.query && next.matchCase === find.matchCase) return;
    // Search as you type, from where the selection starts.
    const found = findMatches(current.current.text, next.query, next.matchCase);
    const from = range(selectionRef.current).from;
    const match = found.find((candidate) => candidate.from >= from) ?? found[0];
    if (match) select({ anchor: match.from, focus: match.to });
  };
  const step = (direction: 1 | -1) => {
    const index = stepMatch(matches, range(selectionRef.current), direction);
    if (index < 0) {
      setStatus(find.query ? `No results for “${find.query}”` : "Type something to find");
      return;
    }
    select({ anchor: matches[index]!.from, focus: matches[index]!.to });
  };
  const replaceOne = () => {
    const selected = range(selectionRef.current);
    if (matchAt(matches, selected) < 0) {
      step(1);
      return;
    }
    const text = current.current.text;
    const next = text.slice(0, selected.from) + find.replacement + text.slice(selected.to);
    const after = {
      from: selected.from,
      to: selected.from + find.replacement.length,
    };
    const following = findMatches(next, find.query, find.matchCase);
    const target = following[stepMatch(following, after, 1)];
    setCommand({
      replace: { ...selected, text: find.replacement },
      select: target
        ? { anchor: target.from, focus: target.to }
        : { anchor: after.to, focus: after.to },
    });
  };
  const replaceEverything = () => {
    const text = current.current.text;
    const result = replaceAll(text, find.query, find.replacement, find.matchCase);
    if (!result.count) {
      setStatus(`No results for “${find.query}”`);
      return;
    }
    const caret = Math.min(range(selectionRef.current).from, result.text.length);
    setCommand({
      replace: { from: 0, to: text.length, text: result.text },
      select: { anchor: caret, focus: caret },
    });
    setStatus(`Replaced ${result.count} ${result.count === 1 ? "match" : "matches"}`);
  };
  const goToLine = (input: string) => {
    const offset = lineOffset(current.current.text, input);
    if (typeof offset !== "number") {
      setPromptState({ kind: "go-to-line", input, error: offset.error });
      return;
    }
    setPrompt({ kind: "none" });
    select({ anchor: offset, focus: offset });
  };

  const dirty = documentDirty(document);
  useEffect(() => {
    options.onTitleChange?.(`${dirty ? "• " : ""}${documentName(document.path)} · Text Editor`);
  }, [dirty, document.path, options.onTitleChange]);
  useEffect(() => {
    options.onCloseGuard?.(() => {
      if (!documentDirty(current.current)) return true;
      setPrompt({ kind: "discard", after: { kind: "close" } });
      requestActiveWindowRedraw();
      return false;
    });
  }, [options.onCloseGuard]);

  return {
    document,
    dirty,
    buffer,
    command,
    selection,
    status,
    prompt,
    problem,
    find,
    findFocus,
    findSummary,
    matches,
    documentFocus,
    wrap,
    recentFiles: () => loadRecentFiles(EDITOR_APP_ID),
    edit: (text: string) => update({ ...current.current, text }),
    selectionChanged: (next: DocumentSelection) => {
      selectionRef.current = next;
      setSelectionState(next);
    },
    setPrompt,
    request,
    perform,
    save,
    saveAs: (after: Action | null = null) => setPrompt({ kind: "choose-save", after }),
    open: () => setPrompt({ kind: "choose-open" }),
    openFind,
    closeFind,
    changeFind,
    step,
    replaceOne,
    replaceEverything,
    goToLine,
    toggleWrap: () => {
      const next = !wrap;
      setWrap(next);
      try {
        saveAppSettings(EDITOR_APP_ID, { wrap: next });
      } catch (error) {
        setStatus(
          `Line wrapping is ${next ? "on" : "off"} for now; it couldn't be remembered: ${errorText(error)}`,
        );
      }
    },
  };
}
export type EditorSession = ReturnType<typeof useEditorSession>;
