import type { WindowSize } from "@moire/ui";

/** Framebuffer allocations, shared by the app and its independent hit/pixel oracle. */
export function screenshotLayout(size: WindowSize, scale: number) {
  const pad = 12 * scale,
    gap = 6 * scale,
    row = 34 * scale;
  const innerWidth = Math.max(1, size.width - pad * 2);
  const compact = innerWidth < 700 * scale;
  const header = { x: pad, y: pad, width: innerWidth, height: row };
  const tools = {
    x: pad,
    y: header.y + row + gap,
    width: innerWidth,
    height: compact ? row * 2 + gap : row,
  };
  const footerHeight = row + 40 * scale;
  const footer = {
    x: pad,
    y: Math.max(tools.y + tools.height + gap, size.height - pad - footerHeight),
    width: innerWidth,
    height: footerHeight,
  };
  const preview = {
    x: pad,
    y: tools.y + tools.height + gap,
    width: innerWidth,
    height: Math.max(1, footer.y - tools.y - tools.height - gap * 2),
  };
  return { pad, gap, row, compact, header, tools, footer, preview };
}
