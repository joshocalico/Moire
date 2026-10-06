/** Keep every toolbar control inside its allocation as the window narrows. */
export function filesLayout(width: number, height: number, scale: number) {
  const px = (value: number) => Math.round(value * scale);
  const compact = width < px(760);
  const tiny = width < px(360);
  const btn = px(tiny ? 28 : 36);
  const pad = px(12);
  const gap = px(6);
  const navWidth = btn * 3 + gap * 2;
  const viewsWidth = btn * 2 + gap;
  const viewsX = width - pad - viewsWidth;
  const afterNav = pad + navWidth + px(8);
  const searchWidth = tiny ? width - pad * 2 : compact ? viewsX - px(8) - afterNav : px(210);
  const searchX = tiny ? pad : compact ? afterNav : viewsX - px(8) - searchWidth;
  const searchY = tiny ? px(52) : px(12);
  const pathY = compact ? px(tiny ? 92 : 56) : px(12);
  const pathX = compact ? pad : afterNav;
  const pathWidth = compact ? width - pad * 2 : searchX - px(8) - pathX;
  const toolbarH = px(tiny ? 140 : compact ? 104 : 60);
  const statusH = px(30);
  const sideW = width < px(480) ? 0 : px(width < px(760) ? 168 : 196);
  const inspectorW = width >= px(960) ? px(240) : 0;
  return {
    btn,
    pad,
    gap,
    viewsX,
    searchX,
    searchY,
    searchWidth,
    pathX,
    pathY,
    pathWidth,
    toolbarH,
    statusH,
    sideW,
    inspectorW,
    bodyH: Math.max(1, height - toolbarH - statusH - 1),
    contentW: Math.max(1, width - sideW - (sideW > 0 ? 1 : 0) - inspectorW),
  };
}
