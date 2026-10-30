/** The window's fixed geometry: rail, top bar, tab strip and the page's margins, scaled. */
const RAIL_WIDTH = 64;
const RAIL_EXPANDED_WIDTH = 200;
const TOP_BAR_HEIGHT = 52;
const TAB_STRIP_HEIGHT = 36;
const PAGE_PADDING = 24;
/** Below this window height the folder page opens with its header already collapsed. */
const COMPACT_HEIGHT = 700;

export function filesLayout(width: number, height: number, ui: number, railExpanded = false) {
  const px = (value: number) => Math.round(value * ui);
  const railW = px(railExpanded ? RAIL_EXPANDED_WIDTH : RAIL_WIDTH);
  const mainW = Math.max(1, width - railW);
  const pad = px(PAGE_PADDING);
  return {
    railW,
    mainW,
    topH: px(TOP_BAR_HEIGHT),
    stripH: px(TAB_STRIP_HEIGHT),
    pad,
    contentW: Math.max(1, mainW - pad * 2),
    compact: height < px(COMPACT_HEIGHT),
  };
}

export type FilesLayout = ReturnType<typeof filesLayout>;
