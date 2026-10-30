import path from "node:path";
import React, { useMemo, useState, type ReactNode } from "react";
import {
  Application,
  ContextMenu,
  ImageWidget,
  OverlayHost,
  ShortcutManager,
  Surface,
  Window,
  getUiScaleFactor,
  usePalette,
  type WindowSize,
} from "@moire/ui";
import { AppFrame, appFrameBody, isMain } from "@moire/app-tools";
import { openImage, saveImageAs, saveMenu, screenshotShortcuts } from "./commands";
import { isDirty } from "./document";
import { applyEdits, parseColor } from "./image";
import { screenshotLayout } from "./layout";
import { PEN_WIDTH, SCREENSHOT_APP_ID, displayFolder, toolHint } from "./model";
import { useScreenshotSession, type ScreenshotServices } from "./session";
import { observe } from "./trace";
import { CanvasOverlay, placeImage } from "./views/canvas";
import { CapturePanel } from "./views/capture-options";
import { headerActions } from "./views/header-actions";
import { ScreenshotPrompts } from "./views/prompts";
import { SaveRow } from "./views/save-row";
import { ToolRow } from "./views/tools";

export { ScreenshotDialog } from "./views/dialogs";
export type ScreenshotProps = WindowSize & ScreenshotServices;

const PREVIEW_RADIUS = 10;
// Where the compact save menu opens: above the footer's right end.
const MENU_WIDTH = 240;
const MENU_HEIGHT = 150;

export function ScreenshotApp(props: ScreenshotProps): ReactNode {
  const pal = usePalette(),
    ui = getUiScaleFactor();
  const session = useScreenshotSession(props);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const { image, trace, tool, gesture } = session;
  const layout = screenshotLayout(props, ui);
  const { body, preview } = layout;
  // While drawing, the stroke so far is painted into the preview.
  const displayed = useMemo(() => {
    if (!image || !gesture || tool !== "pen") return image;
    try {
      return applyEdits(image, [
        {
          kind: "pen",
          points: gesture.points,
          color: parseColor(session.color),
          width: PEN_WIDTH,
        },
      ]);
    } catch {
      return image;
    }
  }, [image, gesture, tool, session.color]);
  const placement = image ? placeImage(preview, image) : null;
  return (
    <OverlayHost width={props.width} height={props.height}>
      <ShortcutManager
        width={props.width}
        height={props.height}
        shortcuts={screenshotShortcuts(session)}
      >
        <Surface width={props.width} height={props.height} clip>
          <AppFrame
            width={props.width}
            height={props.height}
            title="Screenshot"
            icon="screenshot"
            window={props.window}
            subtitle={
              image && !layout.compact
                ? `${image.width} × ${image.height}${isDirty(session.document) ? " · Unsaved" : ""}`
                : undefined
            }
            actions={headerActions(session, layout.compact, layout.row)}
            controls={
              image ? (
                <ToolRow
                  layout={layout}
                  tool={tool}
                  color={session.color}
                  busy={session.busy}
                  hasImage={!!image}
                  canUndo={session.document.undo.length > 0}
                  canReset={session.document.edits.length > 0}
                  onTool={session.setTool}
                  onColor={session.setColor}
                  onBounds={session.openCrop}
                  onUndo={session.undo}
                  onReset={session.reset}
                />
              ) : undefined
            }
            controlsHeight={image ? layout.toolBand : undefined}
            status={session.status}
            statusEnd={
              image
                ? `${toolHint(tool)} · Saves to ${displayFolder(path.dirname(session.target))}`
                : undefined
            }
          >
            {displayed ? (
              <Surface
                {...preview}
                y={preview.y - body.y}
                fill={pal.panel}
                radius={PREVIEW_RADIUS * ui}
                stroke={pal.borderSubtle}
                strokeWidth={1}
                clip
              >
                <ImageWidget
                  bitmap={displayed}
                  width={preview.width}
                  height={preview.height}
                  fit="contain"
                />
              </Surface>
            ) : (
              <CapturePanel
                width={props.width}
                height={appFrameBody({ height: props.height, title: "Screenshot" }).height}
                options={session.captureOptions}
                busy={session.busy}
                onChange={session.setCaptureOptions}
                onTake={() =>
                  session.request({
                    kind: "capture",
                    options: session.captureOptions,
                  })
                }
                onOpen={() => openImage(session)}
              />
            )}
            {image ? (
              <SaveRow
                layout={{
                  ...layout,
                  footer: { ...layout.footer, y: layout.footer.y - body.y },
                }}
                name={session.saveName}
                busy={session.busy}
                hasImage
                onName={(value) => {
                  observe(trace, () => trace.value("change", value));
                  session.setSaveName(value);
                }}
                onNameFocus={(focused) =>
                  observe(trace, () =>
                    trace.write({
                      layer: "app-focus",
                      control: "save-path",
                      focused,
                    }),
                  )
                }
                onSubmit={(value) => {
                  observe(trace, () => trace.value("submit", value));
                  session.saveCurrent();
                }}
                onSave={() => session.saveCurrent()}
                onSaveAs={() => saveImageAs(session)}
                onCopyPath={session.copyPath}
                onShowInFiles={session.showInFiles}
                onMore={() =>
                  setMenu({
                    x: layout.footer.x + layout.footer.width - MENU_WIDTH * ui,
                    y: layout.footer.y - MENU_HEIGHT * ui,
                  })
                }
              />
            ) : null}
          </AppFrame>
          {image && placement ? (
            <CanvasOverlay
              placement={placement}
              image={image}
              tool={tool}
              gesture={gesture}
              busy={session.busy}
              onFocus={(focused) =>
                observe(trace, () =>
                  trace.write({
                    layer: "app-focus",
                    control: "canvas",
                    focused,
                  }),
                )
              }
              onBegin={session.beginGesture}
              onMove={session.moveGesture}
              onEnd={(local, at) => session.commitGesture({ local, image: at })}
              onUndo={session.undo}
            />
          ) : null}
        </Surface>
      </ShortcutManager>
      {menu ? (
        <ContextMenu
          viewportWidth={props.width}
          viewportHeight={props.height}
          x={menu.x}
          y={menu.y}
          actions={saveMenu(session)}
          onDismiss={() => setMenu(null)}
        />
      ) : null}
      <ScreenshotPrompts width={props.width} height={props.height} session={session} />
    </OverlayHost>
  );
}

export async function main(): Promise<void> {
  const app = new Application(),
    window = new Window({
      title: "Screenshot",
      appId: SCREENSHOT_APP_ID,
      width: 980,
      height: 720,
      decorated: false,
    });
  window.setContent((size) => (
    <ScreenshotApp {...size} window={window} initialFile={process.argv[2]} />
  ));
  window.onClose(() => app.quit());
  app.addWindow(window);
  await app.run();
}
if (isMain(import.meta.url))
  void main().catch((error) => {
    console.error("[screenshot]", error);
    process.exitCode = 1;
  });
