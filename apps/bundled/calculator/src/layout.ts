/** Where the display, mode bar, key grids and history sit for a given window size. */
import { SCIENTIFIC_KEYS, SCIENTIFIC_COLUMNS, STANDARD_KEYS, STANDARD_COLUMNS } from "./model";
import type { Mode } from "./model";

export type Box = { x: number; y: number; width: number; height: number };
type CalculatorLayout = {
  gap: number;
  display: Box;
  modeBar: Box;
  /** The function grid, present in scientific mode. */
  scientific: Box | null;
  keypad: Box;
  keyHeight: number;
  history: Box | null;
};

const PAD = 16;
const GAP = 8;
const DISPLAY_HEIGHT = 112;
const MODE_BAR_HEIGHT = 32;
const KEY_MIN = 30;
const KEY_MAX = 56;
/** Below this width history stacks under the keypad instead of taking its own column. */
const SIDE_HISTORY_MIN_WIDTH = 600;
const KEYPAD_MAX_WIDTH = 440;
/** Space kept for stacked history when the keys can still be comfortable without it. */
const STACKED_HISTORY_RESERVE = 150;
const HISTORY_MIN_HEIGHT = 130;

const rows = (count: number, columns: number) => Math.ceil(count / columns);

export function calculatorLayout(
  width: number,
  bodyHeight: number,
  mode: Mode,
  ui: number,
): CalculatorLayout {
  const pad = PAD * ui;
  const gap = GAP * ui;
  const side = width >= SIDE_HISTORY_MIN_WIDTH * ui;
  const columnWidth = side
    ? Math.min(KEYPAD_MAX_WIDTH * ui, (width - pad * 3) * 0.6)
    : Math.max(1, width - pad * 2);
  const display = {
    x: pad,
    y: pad,
    width: columnWidth,
    height: DISPLAY_HEIGHT * ui,
  };
  const modeBar = {
    x: pad,
    y: display.y + display.height + gap,
    width: columnWidth,
    height: MODE_BAR_HEIGHT * ui,
  };
  const keysTop = modeBar.y + modeBar.height + gap;
  const scientificRows =
    mode === "scientific" ? rows(SCIENTIFIC_KEYS.length, SCIENTIFIC_COLUMNS) : 0;
  const keyRows = rows(STANDARD_KEYS.length, STANDARD_COLUMNS) + scientificRows;
  const keyHeightFor = (space: number) =>
    Math.max(KEY_MIN * ui, Math.min(KEY_MAX * ui, (space + gap) / keyRows - gap));
  const keysSpace = bodyHeight - keysTop - pad;
  const reserve = side ? 0 : STACKED_HISTORY_RESERVE * ui;
  const keyHeight =
    reserve && keyHeightFor(keysSpace - reserve) > KEY_MIN * ui
      ? keyHeightFor(keysSpace - reserve)
      : keyHeightFor(keysSpace);
  const block = (count: number) => count * (keyHeight + gap);
  const scientific = scientificRows
    ? {
        x: pad,
        y: keysTop,
        width: columnWidth,
        height: block(scientificRows) - gap,
      }
    : null;
  const keypadTop = keysTop + (scientificRows ? block(scientificRows) : 0);
  const keypad = {
    x: pad,
    y: keypadTop,
    width: columnWidth,
    height: block(rows(STANDARD_KEYS.length, STANDARD_COLUMNS)) - gap,
  };
  const history = side
    ? {
        x: pad * 2 + columnWidth,
        y: pad,
        width: width - columnWidth - pad * 3,
        height: bodyHeight - pad * 2,
      }
    : {
        x: pad,
        y: keypad.y + keypad.height + pad,
        width: columnWidth,
        height: bodyHeight - (keypad.y + keypad.height + pad) - pad,
      };
  return {
    gap,
    display,
    modeBar,
    scientific,
    keypad,
    keyHeight,
    history: history.height >= HISTORY_MIN_HEIGHT * ui ? history : null,
  };
}
