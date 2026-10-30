import { appFrameBody } from "@moire/app-tools";
import type { WindowSize } from "@moire/ui";

/** Footer button widths, before UI scale. */
export const SAVE_ROW = { save: 84, saveAs: 104, copyPath: 112, tool: 32 } as const;
/** The file name keeps at least this much room (before UI scale) beside the footer actions. */
const NAME_MIN = 300;

/** Framebuffer allocations, shared by the app and its independent hit/pixel oracle. */
export function screenshotLayout(size: WindowSize, scale: number) {
  const pad = 12 * scale,
    gap = 8 * scale,
    row = 34 * scale;
  const innerWidth = Math.max(1, size.width - pad * 2);
  const compact = innerWidth < 700 * scale;
  // Save As, Copy Path and Show in Files sit beside the name while it keeps room; else a menu.
  const inlineActions =
    (SAVE_ROW.copyPath + SAVE_ROW.tool + SAVE_ROW.saveAs + SAVE_ROW.save) * scale + gap * 3;
  const saveActionsInline = innerWidth - inlineActions - gap >= NAME_MIN * scale;
  // The tool band under the title bar holds one row of editing tools, or two when compact.
  const toolsHeight = compact ? row * 2 + gap : row;
  const toolBand = toolsHeight + 16 * scale;
  const body = appFrameBody({
    height: size.height,
    title: "Screenshot",
    controls: true,
    controlsHeight: toolBand,
  });
  const header = { x: 0, y: 0, width: size.width, height: body.y - toolBand };
  const tools = {
    x: pad,
    y: header.height + 8 * scale,
    width: innerWidth,
    height: toolsHeight,
  };
  const footer = {
    x: pad,
    y: Math.max(body.y + pad, body.y + body.height - pad - row),
    width: innerWidth,
    height: row,
  };
  const preview = {
    x: pad,
    y: body.y + pad,
    width: innerWidth,
    height: Math.max(1, footer.y - gap - body.y - pad),
  };
  return {
    pad,
    gap,
    row,
    compact,
    saveActionsInline,
    toolBand,
    body,
    header,
    tools,
    footer,
    preview,
  };
}
export type ScreenshotLayout = ReturnType<typeof screenshotLayout>;
