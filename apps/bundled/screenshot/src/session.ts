/** Screenshot's state and actions: capture, open, edit history, save, copy and close guard. */
import path from "node:path";
import { useEffect, useMemo, useRef, useState } from "react";
import { writeClipboardText, type ImageData, type Window } from "@moire/ui";
import { errorText, rememberRecentFile, showInFiles } from "@moire/app-tools";
import type { InputFixtureTrace } from "@moire/sys";
import { captureDesktop, defaultSaveDirectory, readPNG, savePNG } from "./backend";
import {
  changeEdits,
  documentImage,
  emptyDocument,
  isDirty,
  markSaved,
  replaceDocument,
  undoDocument,
  type ScreenshotDocument,
} from "./document";
import { cropBounds, type Point } from "./image";
import {
  DEFAULT_CAPTURE,
  SCREENSHOT_APP_ID,
  editedName,
  gestureBounds,
  gestureEdit,
  saveTarget,
  screenshotName,
  type AfterSave,
  type CaptureOptions,
  type Gesture,
  type Intent,
  type Prompt,
  type SaveRequest,
  type Tool,
} from "./model";
import { prepareOwnWindow } from "./own-window";
import { inputFixtureTrace, observe, observeGesture, observePointer } from "./trace";

export type ScreenshotServices = {
  window?: Window;
  capture?: () => Promise<ImageData>;
  read?: typeof readPNG;
  save?: typeof savePNG;
  /** Puts text on the clipboard; defaults to the window's clipboard. */
  copyText?: (text: string) => Promise<void>;
  showInFiles?: (file: string) => Promise<void>;
  initialFile?: string;
  initialImage?: ImageData;
  /** The file name (or path) to save to, instead of a generated name. */
  initialOutput?: string;
  onDocumentChange?: (document: ScreenshotDocument) => void;
  /** Internal bounded fixture observer; it never owns app state or input delivery. */
  diagnosticTrace?: InputFixtureTrace;
};

type Operation = {
  kind: "read" | "capture" | "save";
  controller: AbortController;
};

export function useScreenshotSession(props: ScreenshotServices) {
  const trace = props.diagnosticTrace ?? inputFixtureTrace;
  const [document, setDocument] = useState(() =>
    props.initialImage
      ? replaceDocument(emptyDocument(), props.initialImage, false)
      : emptyDocument(),
  );
  const [tool, setToolState] = useState<Tool>("crop");
  const [color, setColor] = useState("#FF453A");
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [saveName, setSaveName] = useState(props.initialOutput ?? screenshotName(new Date()));
  const [saveDirectory, setSaveDirectory] = useState(defaultSaveDirectory);
  // The file on disk that holds the current image, once there is one.
  const [savedFile, setSavedFile] = useState<string | null>(null);
  const [captureOptions, setCaptureOptions] = useState<CaptureOptions>(DEFAULT_CAPTURE);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [status, setStatus] = useState("Take a screenshot of the whole screen, or open a PNG");
  const [crop, setCrop] = useState({ x: "0", y: "0", width: "1", height: "1" });
  const mounted = useRef(true),
    operationRef = useRef<Operation | null>(null);
  const documentRef = useRef(document),
    gestureRef = useRef<Gesture | null>(null);
  const permitClose = useRef(false),
    guard = useRef<() => boolean>(() => true);
  const busy = operation !== null;
  const image = useMemo(() => documentImage(document), [document.original, document.edits]);
  const target = saveTarget(saveName, saveDirectory);

  const changeDocument = (next: ScreenshotDocument) => {
    documentRef.current = next;
    setDocument(next);
  };
  const clearGesture = () => {
    gestureRef.current = null;
    setGesture(null);
  };
  const startOperation = (kind: Operation["kind"]) => {
    if (operationRef.current) return null;
    const next = { kind, controller: new AbortController() };
    operationRef.current = next;
    setOperation(next);
    return next;
  };
  const current = (op: Operation) =>
    mounted.current && operationRef.current === op && !op.controller.signal.aborted;
  const finishOperation = (op: Operation) => {
    if (operationRef.current !== op) return;
    operationRef.current = null;
    if (mounted.current) setOperation(null);
  };
  const cancelOperation = () => {
    const op = operationRef.current;
    if (!op || op.kind === "save") return;
    op.controller.abort();
    finishOperation(op);
    setStatus("Capture or open cancelled; current image kept");
  };

  const load = async (file: string) => {
    const op = startOperation("read");
    if (!op) return;
    setStatus("Opening PNG…");
    try {
      const resolved = path.resolve(file);
      const next = await (props.read ?? readPNG)(resolved);
      if (!current(op)) return;
      changeDocument(replaceDocument(documentRef.current, next, true));
      clearGesture();
      rememberRecentFile(SCREENSHOT_APP_ID, resolved);
      setSavedFile(resolved);
      setSaveDirectory(path.dirname(resolved));
      setSaveName(editedName(resolved));
      setStatus(`Opened ${path.basename(resolved)} · ${next.width} × ${next.height}`);
    } catch (error) {
      if (current(op))
        setStatus(`Couldn't open ${path.basename(file)}; current image kept: ${errorText(error)}`);
    } finally {
      finishOperation(op);
    }
  };
  const capture = async (options: CaptureOptions) => {
    const op = startOperation("capture");
    if (!op) return;
    try {
      // Now, while the click that asked for it still has the window focused.
      const hidden = await prepareOwnWindow(props.window);
      if (!current(op)) return;
      for (let remaining = options.delay; remaining > 0; remaining--) {
        setStatus(`Taking the screenshot in ${remaining} s · arrange your windows now`);
        await new Promise<void>((resolve, reject) => {
          const abort = () => {
            clearTimeout(timeout);
            reject(new Error("Capture cancelled"));
          };
          const timeout = setTimeout(() => {
            op.controller.signal.removeEventListener("abort", abort);
            resolve();
          }, 1000);
          op.controller.signal.addEventListener("abort", abort, { once: true });
        });
        if (!current(op)) return;
      }
      const next = await hidden(props.capture ?? captureDesktop);
      if (!current(op)) return;
      changeDocument(replaceDocument(documentRef.current, next, false));
      clearGesture();
      setSavedFile(null);
      setSaveName(screenshotName(new Date()));
      if (options.area === "area") {
        setToolState("crop");
        setStatus("Drag over the part of the screen to keep · Ctrl+Z brings the whole screen back");
      } else setStatus(`Captured the screen · ${next.width} × ${next.height}`);
    } catch (error) {
      if (current(op)) setStatus(`Capture failed; current image kept: ${errorText(error)}`);
    } finally {
      finishOperation(op);
    }
  };

  const copyPath = async (file: string) => {
    try {
      await (
        props.copyText ??
        ((text: string) =>
          props.window ? props.window.writeClipboardText(text) : writeClipboardText(text))
      )(file);
      // Only text can go on the clipboard so far, so the saved file stands in for the image.
      if (mounted.current)
        setStatus(`Copied the file path of ${path.basename(file)} (images can't be copied yet)`);
    } catch (error) {
      if (mounted.current) setStatus(`Couldn't copy the path: ${errorText(error)}`);
    }
  };
  const reveal = async (file: string) => {
    try {
      await (props.showInFiles ?? showInFiles)(file);
      if (mounted.current) setStatus(`Showing ${path.basename(file)} in Files`);
    } catch (error) {
      if (mounted.current) setStatus(`Couldn't show the folder: ${errorText(error)}`);
    }
  };

  const perform = (intent: Intent) => {
    setPrompt(null);
    if (intent.kind === "open") void load(intent.file);
    else if (intent.kind === "capture") void capture(intent.options);
    else {
      permitClose.current = true;
      props.window?.requestClose();
    }
  };
  const after = (next: AfterSave, file: string) => {
    if (!next) return;
    if (next.kind === "copy-path") void copyPath(file);
    else if (next.kind === "show-in-files") void reveal(file);
    else perform(next);
  };
  const request = (intent: Intent) => {
    if (operationRef.current) return;
    if (isDirty(documentRef.current)) setPrompt({ kind: "unsaved", intent });
    else perform(intent);
  };
  const save = async (saveRequest: SaveRequest, overwrite = false) => {
    const op = startOperation("save");
    if (!op) return;
    let succeeded = false;
    try {
      await (props.save ?? savePNG)(saveRequest.image, saveRequest.target, overwrite);
      if (!current(op)) return;
      changeDocument(markSaved(documentRef.current, saveRequest.revision));
      rememberRecentFile(SCREENSHOT_APP_ID, saveRequest.target);
      setSavedFile(saveRequest.target);
      setStatus(`Saved ${path.basename(saveRequest.target)}`);
      setPrompt(null);
      succeeded = true;
    } catch (error) {
      if (!current(op)) return;
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        setPrompt({ kind: "overwrite", save: saveRequest });
        setStatus(`${path.basename(saveRequest.target)} already exists; Replace it or Cancel`);
      } else setStatus(`Save failed; the image is still unsaved: ${errorText(error)}`);
    } finally {
      finishOperation(op);
    }
    if (succeeded && mounted.current) after(saveRequest.after, saveRequest.target);
  };
  /** Save to `file` (the name field's target by default), then run `next`. */
  const saveCurrent = (next: AfterSave = null, file = target) => {
    if (operationRef.current) return;
    observe(trace, () => trace.value("save", saveName));
    commitGesture();
    const snapshot = documentRef.current,
      snapshotImage = documentImage(snapshot);
    if (!snapshotImage) return;
    if (!saveName.trim()) {
      setStatus("Enter a file name to save the screenshot");
      return;
    }
    // Saving again over the file this image came from replaces it without asking.
    void save(
      {
        image: snapshotImage,
        revision: snapshot.revision,
        target: file,
        after: next,
      },
      file === savedFile,
    );
  };
  /** Copy (or show) the image's file, saving it first when it has unsaved changes. */
  const withSavedFile = (next: "copy-path" | "show-in-files") => {
    if (operationRef.current || !documentRef.current.original) return;
    if (savedFile && !isDirty(documentRef.current)) after({ kind: next }, savedFile);
    else saveCurrent({ kind: next });
  };

  function commitGesture(endpoint?: { local: Point; image: Point }) {
    const pending = gestureRef.current;
    const actualImage = documentImage(documentRef.current);
    if (!pending || !actualImage) return;
    if (endpoint) observePointer(trace, "up", endpoint.local.x, endpoint.local.y, actualImage);
    const end = endpoint?.image ?? pending.end;
    const lastPoint = pending.points.at(-1);
    const finished = {
      ...pending,
      end,
      points:
        tool === "pen" && endpoint && (lastPoint?.x !== end.x || lastPoint.y !== end.y)
          ? [...pending.points, end]
          : pending.points,
    };
    try {
      const edit = gestureEdit(tool, finished, actualImage, color);
      changeDocument(changeEdits(documentRef.current, [...documentRef.current.edits, edit]));
      observeGesture(
        trace,
        "commit",
        edit.kind === "crop" ? edit.bounds : gestureBounds(finished),
        edit.kind === "crop"
          ? {
              ...actualImage,
              width: edit.bounds.width,
              height: edit.bounds.height,
            }
          : actualImage,
      );
      setStatus(
        tool === "crop" ? "Cropped · Undo brings back the previous image" : "Annotation added",
      );
    } catch (error) {
      observeGesture(trace, "reject", gestureBounds(finished), actualImage);
      setStatus(errorText(error));
    }
    clearGesture();
  }
  const beginGesture = (local: Point, at: Point) => {
    if (busy || !image) return;
    observePointer(trace, "down", local.x, local.y, image);
    const next = { start: at, points: [at], end: at };
    gestureRef.current = next;
    setGesture(next);
  };
  const moveGesture = (local: Point, at: Point) => {
    const pending = gestureRef.current;
    if (!pending || !image) return;
    observePointer(trace, "move", local.x, local.y, image);
    const next = {
      ...pending,
      end: at,
      points: tool === "pen" ? [...pending.points, at] : pending.points,
    };
    gestureRef.current = next;
    setGesture(next);
  };

  guard.current = () => {
    if (permitClose.current) return true;
    if (operationRef.current?.kind === "save") {
      setStatus("The PNG is being saved. Wait for it to finish before closing.");
      return false;
    }
    commitGesture();
    if (isDirty(documentRef.current) || operationRef.current) {
      setPrompt({ kind: "unsaved", intent: { kind: "close" } });
      return false;
    }
    return true;
  };
  useEffect(() => {
    props.window?.setCloseGuard(() => guard.current());
    if (props.initialFile) void load(props.initialFile);
    return () => {
      observe(trace, () => trace.stop("closed"));
      mounted.current = false;
      operationRef.current?.controller.abort();
      operationRef.current = null;
      props.window?.setCloseGuard(null);
    };
  }, []);
  useEffect(() => {
    props.onDocumentChange?.(document);
  }, [document, props.onDocumentChange]);

  return {
    trace,
    document,
    image,
    tool,
    color,
    gesture,
    saveName,
    saveDirectory,
    target,
    savedFile,
    captureOptions,
    operation,
    busy,
    capturing: !!operation && operation.kind !== "save",
    prompt,
    status,
    crop,
    setColor,
    setCrop,
    setCaptureOptions,
    setPrompt,
    setSaveName,
    setTool: (next: Tool) => {
      if (busy) return;
      setToolState(next);
      clearGesture();
    },
    beginGesture,
    moveGesture,
    commitGesture,
    request,
    perform,
    cancelOperation,
    save,
    saveCurrent,
    /** Save As chooses a folder and name, which later saves keep using. */
    saveAs: (file: string, next: AfterSave) => {
      const named = saveTarget(path.basename(file), path.dirname(file));
      setSaveDirectory(path.dirname(named));
      setSaveName(path.basename(named));
      setPrompt(null);
      saveCurrent(next, named);
    },
    copyPath: () => withSavedFile("copy-path"),
    showInFiles: () => withSavedFile("show-in-files"),
    undo: () => {
      if (busy) return;
      clearGesture();
      changeDocument(undoDocument(documentRef.current));
    },
    reset: () => {
      if (busy) return;
      clearGesture();
      changeDocument(changeEdits(documentRef.current, []));
    },
    openCrop: () => {
      if (!image || busy) return;
      setCrop({
        x: "0",
        y: "0",
        width: String(image.width),
        height: String(image.height),
      });
      setPrompt({ kind: "crop" });
    },
    applyCrop: () => {
      const actual = documentImage(documentRef.current);
      if (!actual) return;
      try {
        const bounds = cropBounds(actual, {
          x: Number(crop.x),
          y: Number(crop.y),
          width: Number(crop.width),
          height: Number(crop.height),
        });
        changeDocument(
          changeEdits(documentRef.current, [
            ...documentRef.current.edits,
            { kind: "crop", bounds },
          ]),
        );
        setPrompt(null);
        setStatus("Cropped · Undo brings back the previous image");
      } catch (error) {
        setStatus(errorText(error));
      }
    },
    dismiss: () => {
      if (operationRef.current?.kind === "save") return;
      if (
        prompt?.kind === "overwrite" &&
        prompt.save.after &&
        prompt.save.after.kind !== "copy-path" &&
        prompt.save.after.kind !== "show-in-files"
      )
        setPrompt({ kind: "unsaved", intent: prompt.save.after });
      else setPrompt(null);
    },
  };
}
export type ScreenshotSession = ReturnType<typeof useScreenshotSession>;
