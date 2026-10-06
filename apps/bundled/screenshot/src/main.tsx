import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  createInputFixtureTrace,
  type InputFixtureTrace,
  type InputFixtureObservation,
} from "@moire/sys";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Group, Rect, type HitPointerEvent } from "@moire/react-host";
import {
  Application,
  Button,
  Column,
  Dialog,
  FocusScope,
  ImageWidget,
  Label,
  ModalBarrier,
  OverlayHost,
  Row,
  ScrollColumn,
  SegmentedControl,
  ShortcutManager,
  Surface,
  TextField,
  Window,
  usePalette,
  useWidgetTheme,
  getUiScaleFactor,
  type ImageData,
  type WindowSize,
} from "@moire/ui";
import {
  applyEdits,
  captureDesktop,
  cropBounds,
  parseColor,
  readPNG,
  savePNG,
  type Bounds,
  type Edit,
  type Point,
} from "./capture";
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
import { screenshotLayout } from "./layout";

const inputFixtureTrace = createInputFixtureTrace("app");
function observeInputFixture(trace: InputFixtureTrace, observe: () => void): void {
  try {
    if (trace.active()) observe();
  } catch {
    try {
      trace.stop("io-error");
    } catch {
      /* diagnostics remain unavailable */
    }
  }
}

function observeInputGesture(
  trace: InputFixtureTrace,
  phase: Extract<InputFixtureObservation, { layer: "app-gesture" }>["phase"],
  bounds: Bounds,
  image: ImageData,
): void {
  observeInputFixture(trace, () =>
    trace.write({
      layer: "app-gesture",
      phase,
      ...bounds,
      imageWidth: image.width,
      imageHeight: image.height,
    }),
  );
}

type Gesture = { start: Point; points: Point[]; end: Point };
type Intent =
  | { kind: "close" }
  | { kind: "open"; file: string }
  | { kind: "capture"; seconds: number };
type Operation = { kind: "read" | "capture" | "save"; controller: AbortController };
type SaveRequest = { image: ImageData; revision: number; target: string; after: Intent | null };
type Prompt =
  | { kind: "unsaved"; intent: Intent }
  | { kind: "open" }
  | { kind: "crop" }
  | { kind: "overwrite"; save: SaveRequest };
export type ScreenshotProps = WindowSize & {
  window?: Window;
  capture?: () => Promise<ImageData>;
  read?: typeof readPNG;
  save?: typeof savePNG;
  initialFile?: string;
  initialImage?: ImageData;
  initialOutput?: string;
  onDocumentChange?: (document: ScreenshotDocument) => void;
  /** Internal bounded fixture observer; it never owns app state or input delivery. */
  diagnosticTrace?: InputFixtureTrace;
};

/** Existing shared modal/footer contract; exported for independent real-layout hit checks. */
export function ScreenshotDialog(
  props: WindowSize & {
    title: string;
    onDismiss: () => void;
    footer: ReactNode;
    children: ReactNode;
  },
): ReactNode {
  const scale = getUiScaleFactor();
  const width = Math.max(1, Math.min(460 * scale, props.width - 16));
  const height = Math.max(1, Math.min(320 * scale, props.height - 16));
  return (
    <Group width={props.width} height={props.height}>
      <ModalBarrier width={props.width} height={props.height} onDismiss={props.onDismiss} />
      <FocusScope
        x={(props.width - width) / 2}
        y={(props.height - height) / 2}
        width={width}
        height={height}
        trap
        onEscape={props.onDismiss}
      >
        <Dialog
          width={width}
          height={height}
          title={props.title}
          onClose={props.onDismiss}
          footer={props.footer}
        >
          <ScrollColumn flexGrow={1} gap={6 * scale} smooth={false}>
            {props.children}
          </ScrollColumn>
        </Dialog>
      </FocusScope>
    </Group>
  );
}

export function ScreenshotApp(props: ScreenshotProps): ReactNode {
  const trace = props.diagnosticTrace ?? inputFixtureTrace;
  const observeFixture = (observe: () => void) => observeInputFixture(trace, observe);
  const observeGesture = (
    phase: Extract<InputFixtureObservation, { layer: "app-gesture" }>["phase"],
    bounds: Bounds,
    image: ImageData,
  ) => observeInputGesture(trace, phase, bounds, image);
  const pal = usePalette(),
    ui = getUiScaleFactor(),
    theme = useWidgetTheme();
  const [document, setDocument] = useState(() =>
    props.initialImage
      ? replaceDocument(emptyDocument(), props.initialImage, false)
      : emptyDocument(),
  );
  const [mode, setMode] = useState("crop"),
    [color, setColor] = useState("#FF453A");
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [source, setSource] = useState(props.initialFile ?? "");
  const [output, setOutput] = useState(
    props.initialOutput ??
      path.join(
        os.homedir(),
        "Pictures",
        "Screenshots",
        `Screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
      ),
  );
  const [delay, setDelay] = useState("3"),
    [operation, setOperation] = useState<Operation | null>(null);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [status, setStatus] = useState("Capture the primary display, or open a PNG to edit");
  const [crop, setCrop] = useState({ x: "0", y: "0", width: "1", height: "1" });
  const mounted = useRef(true),
    operationRef = useRef<Operation | null>(null);
  const documentRef = useRef(document),
    gestureRef = useRef<Gesture | null>(null);
  const permitClose = useRef(false),
    guard = useRef<() => boolean>(() => true);
  const busy = operation !== null;
  const image = useMemo(() => documentImage(document), [document.original, document.edits]);
  const layout = screenshotLayout(props, ui);
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
      const next = await (props.read ?? readPNG)(path.resolve(file));
      if (!current(op)) return;
      changeDocument(replaceDocument(documentRef.current, next, true));
      clearGesture();
      setStatus(`Opened ${next.width} × ${next.height} PNG`);
    } catch (error) {
      if (current(op)) setStatus(`Open failed; current image kept: ${String(error)}`);
    } finally {
      finishOperation(op);
    }
  };
  const capture = async (seconds: number) => {
    const op = startOperation("capture");
    if (!op) return;
    try {
      for (let remaining = seconds; remaining > 0; remaining--) {
        setStatus(`Capturing in ${remaining}s · arrange the windows now`);
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
      const next = await (props.capture ?? captureDesktop)();
      if (!current(op)) return;
      changeDocument(replaceDocument(documentRef.current, next, false));
      clearGesture();
      setStatus(`Captured primary display · ${next.width} × ${next.height}`);
    } catch (error) {
      if (current(op)) setStatus(`Capture failed; current image kept: ${String(error)}`);
    } finally {
      finishOperation(op);
    }
  };
  const perform = (intent: Intent) => {
    setPrompt(null);
    if (intent.kind === "open") void load(intent.file);
    else if (intent.kind === "capture") void capture(intent.seconds);
    else {
      permitClose.current = true;
      props.window?.requestClose();
    }
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
      setStatus(`Saved ${saveRequest.target}`);
      setPrompt(null);
      succeeded = true;
    } catch (error) {
      if (!current(op)) return;
      if (error instanceof Error && "code" in error && error.code === "EEXIST") {
        setPrompt({ kind: "overwrite", save: saveRequest });
        setStatus("PNG already exists; choose Replace or Cancel");
      } else setStatus(`Save failed; image is still unsaved: ${String(error)}`);
    } finally {
      finishOperation(op);
    }
    if (succeeded && saveRequest.after && mounted.current) perform(saveRequest.after);
  };
  const saveCurrent = (after: Intent | null = null) => {
    if (operationRef.current) return;
    observeFixture(() => trace.value("save", output));
    commitGesture();
    const snapshot = documentRef.current,
      snapshotImage = documentImage(snapshot);
    if (!snapshotImage || !output.trim()) {
      setStatus("Enter a PNG save path");
      return;
    }
    void save({ image: snapshotImage, revision: snapshot.revision, target: output.trim(), after });
  };
  const gestureBounds = (g: Gesture): Bounds => ({
    x: Math.min(g.start.x, g.end.x),
    y: Math.min(g.start.y, g.end.y),
    width: Math.abs(g.end.x - g.start.x),
    height: Math.abs(g.end.y - g.start.y),
  });
  function commitGesture(event?: HitPointerEvent) {
    const pending = gestureRef.current;
    const actualImage = documentImage(documentRef.current);
    if (!pending || !actualImage) return;
    if (event)
      observeGesture("up", { x: event.localX, y: event.localY, width: 0, height: 0 }, actualImage);
    const endpoint = event ? point(event.localX, event.localY) : pending.end;
    const lastPoint = pending.points.at(-1);
    const g = {
      ...pending,
      end: endpoint,
      points:
        mode === "pen" && event && (lastPoint?.x !== endpoint.x || lastPoint.y !== endpoint.y)
          ? [...pending.points, endpoint]
          : pending.points,
    };
    try {
      const edit: Edit =
        mode === "crop"
          ? { kind: "crop", bounds: cropBounds(actualImage, gestureBounds(g)) }
          : mode === "pen"
            ? { kind: "pen", points: g.points, color: parseColor(color), width: 4 }
            : { kind: "rectangle", bounds: gestureBounds(g), color: parseColor(color), width: 4 };
      changeDocument(changeEdits(documentRef.current, [...documentRef.current.edits, edit]));
      observeGesture(
        "commit",
        edit.kind === "crop" ? edit.bounds : gestureBounds(g),
        edit.kind === "crop"
          ? { ...actualImage, width: edit.bounds.width, height: edit.bounds.height }
          : actualImage,
      );
      setStatus(
        mode === "crop" ? "Crop applied · Undo restores the previous image" : "Annotation added",
      );
    } catch (error) {
      observeGesture("reject", gestureBounds(g), actualImage);
      setStatus(String(error));
    }
    clearGesture();
  }
  guard.current = () => {
    if (permitClose.current) return true;
    if (operationRef.current?.kind === "save") {
      setStatus("PNG is being saved. Wait for it to finish before closing.");
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
      observeFixture(() => trace.stop("closed"));
      mounted.current = false;
      operationRef.current?.controller.abort();
      operationRef.current = null;
      props.window?.setCloseGuard(null);
    };
  }, []);
  useEffect(() => {
    props.onDocumentChange?.(document);
  }, [document, props.onDocumentChange]);
  const displayedImage = useMemo(() => {
    if (!image || !gesture || mode !== "pen") return image;
    try {
      return applyEdits(image, [
        { kind: "pen", points: gesture.points, color: parseColor(color), width: 4 },
      ]);
    } catch {
      return image;
    }
  }, [image, gesture, mode, color]);
  const { preview } = layout;
  const scale = image ? Math.min(preview.width / image.width, preview.height / image.height) : 1;
  const paintW = image ? image.width * scale : preview.width,
    paintH = image ? image.height * scale : preview.height;
  const paintX = preview.x + (preview.width - paintW) / 2,
    paintY = preview.y + (preview.height - paintH) / 2;
  const point = (x: number, y: number): Point => ({
    x: Math.max(0, Math.min((image?.width ?? 1) - 1, x / scale)),
    y: Math.max(0, Math.min((image?.height ?? 1) - 1, y / scale)),
  });
  const openCrop = () => {
    if (!image || busy) return;
    setCrop({ x: "0", y: "0", width: String(image.width), height: String(image.height) });
    setPrompt({ kind: "crop" });
  };
  const applyCrop = () => {
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
        changeEdits(documentRef.current, [...documentRef.current.edits, { kind: "crop", bounds }]),
      );
      setPrompt(null);
      setStatus("Crop applied · Undo restores the previous image");
    } catch (error) {
      setStatus(String(error));
    }
  };
  const captureRequested = () => {
    const seconds = Number(delay);
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 30) {
      setStatus("Capture delay must be a whole number from 0 to 30 seconds.");
      return;
    }
    request({ kind: "capture", seconds });
  };
  const dismiss = () => {
    if (operationRef.current?.kind === "save") return;
    if (prompt?.kind === "overwrite" && prompt.save.after)
      setPrompt({ kind: "unsaved", intent: prompt.save.after });
    else setPrompt(null);
  };
  const editingDisabled = busy || !image;
  const undo = () => {
    if (!busy) {
      clearGesture();
      changeDocument(undoDocument(documentRef.current));
    }
  };
  const toolWidth = layout.compact
    ? (layout.tools.width - layout.gap * 2) / 3
    : layout.tools.width - 460 * ui - layout.gap * 3;
  const headerButtonWidth = layout.compact
    ? (layout.header.width - 82 * ui - layout.gap * 3) / 2
    : 100 * ui;
  const dialogBodyWidth = Math.max(
    1,
    Math.min(460 * ui, props.width - 16) - theme.recipes.dialog.medium.metrics.bodyPaddingX * 2,
  );
  const colorOrCrop =
    mode === "crop" ? (
      <Button
        size="small"
        height={layout.row}
        width={toolWidth}
        label="Bounds…"
        focusId="screenshot-crop-bounds"
        disabled={editingDisabled}
        onPress={openCrop}
      />
    ) : (
      <TextField
        height={layout.row}
        width={toolWidth}
        value={color}
        disabled={busy}
        placeholder="#RRGGBB"
        onChange={setColor}
      />
    );
  return (
    <OverlayHost width={props.width} height={props.height}>
      <ShortcutManager
        width={props.width}
        height={props.height}
        shortcuts={[
          { id: "save-png", code: 31, ctrl: true, disabled: busy, onInvoke: () => saveCurrent() },
          {
            id: "open-png",
            code: 24,
            ctrl: true,
            disabled: busy,
            onInvoke: () => setPrompt({ kind: "open" }),
          },
        ]}
      >
        <Surface width={props.width} height={props.height} fill={pal.bg} clip>
          <Row {...layout.header} gap={layout.gap} align="center">
            {!layout.compact && (
              <Label flexGrow={1} text="Screenshot" fontSize={20} fontWeight="bold" />
            )}
            <Button
              size="small"
              height={layout.row}
              width={headerButtonWidth}
              label="Open PNG"
              focusId="screenshot-open"
              disabled={busy}
              onPress={() => setPrompt({ kind: "open" })}
            />
            <Label width={36 * ui} text="Delay" color={pal.muted} fontSize={11} />
            <TextField
              width={46 * ui}
              height={layout.row}
              value={delay}
              disabled={busy}
              onChange={setDelay}
              onSubmit={captureRequested}
            />
            <Button
              size="small"
              height={layout.row}
              width={headerButtonWidth}
              label={operation && operation.kind !== "save" ? "Cancel" : "Capture"}
              focusId="screenshot-capture"
              disabled={operation?.kind === "save"}
              variant="primary"
              onPress={() => (operation ? cancelOperation() : captureRequested())}
            />
          </Row>
          <Column {...layout.tools} gap={layout.gap}>
            <Row height={layout.row} gap={layout.gap}>
              <SegmentedControl
                width={layout.compact ? layout.tools.width : 300 * ui}
                height={layout.row}
                value={mode}
                options={[
                  { id: "crop", label: "Crop" },
                  { id: "pen", label: "Pen" },
                  { id: "rectangle", label: "Box" },
                ]}
                onChange={(next) => {
                  if (!busy) {
                    setMode(next);
                    clearGesture();
                  }
                }}
              />
              {!layout.compact && (
                <>
                  {colorOrCrop}
                  <Button
                    size="small"
                    height={layout.row}
                    width={80 * ui}
                    label="Undo"
                    focusId="screenshot-undo"
                    disabled={!document.undo.length || busy}
                    onPress={undo}
                  />
                  <Button
                    size="small"
                    height={layout.row}
                    width={80 * ui}
                    label="Reset"
                    focusId="screenshot-reset"
                    disabled={!document.edits.length || busy}
                    onPress={() => {
                      clearGesture();
                      changeDocument(changeEdits(documentRef.current, []));
                    }}
                  />
                </>
              )}
            </Row>
            {layout.compact && (
              <Row height={layout.row} gap={layout.gap}>
                {colorOrCrop}
                <Button
                  size="small"
                  height={layout.row}
                  width={toolWidth}
                  label="Undo"
                  focusId="screenshot-undo"
                  disabled={!document.undo.length || busy}
                  onPress={undo}
                />
                <Button
                  size="small"
                  height={layout.row}
                  width={toolWidth}
                  label="Reset"
                  focusId="screenshot-reset"
                  disabled={!document.edits.length || busy}
                  onPress={() => {
                    clearGesture();
                    changeDocument(changeEdits(documentRef.current, []));
                  }}
                />
              </Row>
            )}
          </Column>
          <Surface {...preview} fill={pal.panel} radius={pal.radiusMd} clip>
            {image ? (
              <ImageWidget
                bitmap={displayedImage ?? image}
                width={preview.width}
                height={preview.height}
                fit="contain"
              />
            ) : (
              <Label
                x={12 * ui}
                y={12 * ui}
                width={Math.max(1, preview.width - 24 * ui)}
                text="Capture includes the primary display and visible windows. Use a delay to arrange the desktop first."
                color={pal.muted}
                fontSize={13}
                wrap
              />
            )}
          </Surface>
          {image && (
            <Group x={paintX} y={paintY} width={paintW} height={paintH} clip>
              <Rect
                width={paintW}
                height={paintH}
                fill={0x00000000}
                focusable
                focusId="screenshot-canvas"
                onFocusChange={(focused) =>
                  observeFixture(() =>
                    trace.write({
                      layer: "app-focus",
                      control: "canvas",
                      focused,
                    }),
                  )
                }
                onKeyDown={(event) => {
                  if (event.ctrlKey && event.code === 44) {
                    undo();
                    return true;
                  }
                  return false;
                }}
                onPointerDown={(event) => {
                  if (busy) return;
                  observeGesture(
                    "down",
                    { x: event.localX, y: event.localY, width: 0, height: 0 },
                    image,
                  );
                  const p = point(event.localX, event.localY),
                    g = { start: p, points: [p], end: p };
                  gestureRef.current = g;
                  setGesture(g);
                }}
                onPointerMove={(event) => {
                  const g = gestureRef.current;
                  if (!g) return;
                  observeGesture(
                    "move",
                    { x: event.localX, y: event.localY, width: 0, height: 0 },
                    image,
                  );
                  const p = point(event.localX, event.localY),
                    next = { ...g, end: p, points: mode === "pen" ? [...g.points, p] : g.points };
                  gestureRef.current = next;
                  setGesture(next);
                }}
                onPointerUp={commitGesture}
              />
              {gesture && mode !== "pen" && (
                <Rect
                  x={gestureBounds(gesture).x * scale}
                  y={gestureBounds(gesture).y * scale}
                  width={gestureBounds(gesture).width * scale}
                  height={gestureBounds(gesture).height * scale}
                  fill={0x22000000}
                  stroke={pal.accent}
                  strokeWidth={2}
                />
              )}
            </Group>
          )}
          <Column {...layout.footer} gap={4 * ui}>
            <Row height={layout.row} gap={layout.gap}>
              <TextField
                height={layout.row}
                width={Math.max(1, layout.footer.width - 100 * ui - layout.gap)}
                value={output}
                disabled={busy}
                onFocusChange={(focused) =>
                  observeFixture(() =>
                    trace.write({
                      layer: "app-focus",
                      control: "save-path",
                      focused,
                    }),
                  )
                }
                onChange={(value) => {
                  observeFixture(() => trace.value("change", value));
                  setOutput(value);
                }}
                onSubmit={(value) => {
                  observeFixture(() => trace.value("submit", value));
                  saveCurrent();
                }}
                placeholder="Save PNG path"
              />
              <Button
                size="small"
                height={layout.row}
                width={100 * ui}
                label="Save PNG"
                focusId="screenshot-save"
                disabled={!image || busy || !output.trim()}
                variant="primary"
                onPress={() => saveCurrent()}
              />
            </Row>
            <Label
              height={16 * ui}
              text={
                image
                  ? `${image.width} × ${image.height} · ${isDirty(document) ? "Unsaved" : "Saved"} · Drag to ${mode === "crop" ? "crop" : mode === "pen" ? "draw" : "mark a box"}`
                  : "PNG editing works without desktop capture"
              }
              color={pal.muted}
              fontSize={10}
              overflow="ellipsis"
              maxLines={1}
            />
            <Label
              height={16 * ui}
              text={status}
              color={pal.muted}
              fontSize={10}
              overflow="ellipsis"
              maxLines={1}
            />
          </Column>
        </Surface>
      </ShortcutManager>
      {prompt && (
        <ScreenshotDialog
          {...props}
          title={
            prompt.kind === "open"
              ? "Open PNG"
              : prompt.kind === "crop"
                ? "Crop image"
                : prompt.kind === "overwrite"
                  ? "Replace existing PNG?"
                  : "Save changes first?"
          }
          onDismiss={dismiss}
          footer={
            <Column gap={6 * ui}>
              {prompt.kind === "unsaved" ? (
                <>
                  <Button
                    label="Save"
                    variant="primary"
                    disabled={busy || !image || !output.trim()}
                    focusId="screenshot-prompt-save"
                    onPress={() => saveCurrent(prompt.intent)}
                  />
                  <Button
                    label="Discard"
                    disabled={operation?.kind === "save"}
                    focusId="screenshot-prompt-discard"
                    onPress={() => {
                      cancelOperation();
                      perform(prompt.intent);
                    }}
                  />
                  <Button
                    label="Cancel"
                    autoFocus
                    focusId="screenshot-prompt-cancel"
                    onPress={dismiss}
                  />
                </>
              ) : prompt.kind === "overwrite" ? (
                <>
                  <Button
                    label="Replace"
                    variant="danger"
                    disabled={busy}
                    focusId="screenshot-replace"
                    onPress={() => void save(prompt.save, true)}
                  />
                  <Button
                    label="Cancel"
                    disabled={busy}
                    autoFocus
                    focusId="screenshot-prompt-cancel"
                    onPress={dismiss}
                  />
                </>
              ) : (
                <>
                  <Button
                    label={prompt.kind === "open" ? "Open" : "Apply crop"}
                    variant="primary"
                    disabled={busy || (prompt.kind === "open" && !source.trim())}
                    focusId="screenshot-prompt-apply"
                    onPress={() =>
                      prompt.kind === "open"
                        ? request({ kind: "open", file: source.trim() })
                        : applyCrop()
                    }
                  />
                  <Button
                    label="Cancel"
                    autoFocus
                    focusId="screenshot-prompt-cancel"
                    onPress={dismiss}
                  />
                </>
              )}
            </Column>
          }
        >
          {prompt.kind === "open" ? (
            <>
              <Label
                text="Enter an existing PNG path. Current edits stay intact until a new image is opened."
                color={pal.muted}
                fontSize={12}
                wrap
              />
              <TextField
                width={dialogBodyWidth}
                height={layout.row}
                value={source}
                onChange={setSource}
                placeholder="PNG file path"
                onSubmit={() => source.trim() && request({ kind: "open", file: source.trim() })}
              />
            </>
          ) : prompt.kind === "crop" ? (
            <>
              <Label text="Crop bounds in source pixels" fontSize={12} />
              <Row height={layout.row} gap={6 * ui}>
                <Label width={22 * ui} text="X" fontSize={12} />
                <TextField
                  width={(dialogBodyWidth - 44 * ui - 18 * ui) / 2}
                  height={layout.row}
                  value={crop.x}
                  onChange={(x) => setCrop({ ...crop, x })}
                  onSubmit={applyCrop}
                />
                <Label width={22 * ui} text="Y" fontSize={12} />
                <TextField
                  width={(dialogBodyWidth - 44 * ui - 18 * ui) / 2}
                  height={layout.row}
                  value={crop.y}
                  onChange={(y) => setCrop({ ...crop, y })}
                  onSubmit={applyCrop}
                />
              </Row>
              <Row height={layout.row} gap={6 * ui}>
                <Label width={48 * ui} text="Width" fontSize={12} />
                <TextField
                  width={(dialogBodyWidth - 96 * ui - 18 * ui) / 2}
                  height={layout.row}
                  value={crop.width}
                  onChange={(width) => setCrop({ ...crop, width })}
                  onSubmit={applyCrop}
                />
                <Label width={48 * ui} text="Height" fontSize={12} />
                <TextField
                  width={(dialogBodyWidth - 96 * ui - 18 * ui) / 2}
                  height={layout.row}
                  value={crop.height}
                  onChange={(height) => setCrop({ ...crop, height })}
                  onSubmit={applyCrop}
                />
              </Row>
            </>
          ) : (
            <Label
              text={
                prompt.kind === "overwrite"
                  ? `Replace ${prompt.save.target}? Cancel keeps the image unsaved.`
                  : operation
                    ? "An operation is in progress. Discard cancels it and closes without saving; Cancel keeps this window open."
                    : "The current image has unsaved changes. Save it, discard it, or cancel to keep editing."
              }
              fontSize={12}
              color={pal.muted}
              wrap
            />
          )}
          <Label text={status} fontSize={11} color={pal.muted} wrap />
        </ScreenshotDialog>
      )}
    </OverlayHost>
  );
}
export async function main(): Promise<void> {
  const app = new Application(),
    window = new Window({
      title: "Screenshot",
      appId: "org.moire.Screenshot",
      width: 980,
      height: 720,
    });
  window.setContent((size) => (
    <ScreenshotApp {...size} window={window} initialFile={process.argv[2]} />
  ));
  window.onClose(() => app.quit());
  app.addWindow(window);
  await app.run();
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  void main().catch((error) => {
    console.error("[screenshot]", error);
    process.exitCode = 1;
  });
