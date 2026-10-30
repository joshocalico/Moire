/**
 * What the compositor itself draws for a secure prompt when the shell's prompt view is missing or
 * has failed: a shield, the typed length as dots and the check's state as the field's colour.
 *
 * Plain pixel code like the lock screen's fallback (and built from its shapes), with no shell,
 * font or React dependency. It has no buttons: Escape still cancels and Enter still submits, and
 * a consent prompt can only be dismissed. Nothing here reads client buffers.
 */
import { circle, fill, roundRect, type LockRect, type Paint } from "./lock-screen-paint";
import type { SecurePromptPhase } from "./secure-prompt";

const FIELD_COLOURS: Record<SecurePromptPhase, number> = {
  entry: 0xff7aa2f7,
  checking: 0xffe0af68,
  wrong: 0xfff7768e,
  throttled: 0xffff9e64,
  unavailable: 0xfff7768e,
};
const MAX_DOTS = 24;
const GLYPH = 0xe6ffffff;
const INK = 0xff1a1b26;
const ACCENT = 0xff7aa2f7;

/**
 * The compositor's own prompt, centred in `rect`: a shield, then (for a password) a field with
 * one dot per typed character whose outline shows the state. The shield turns blue inside a ring
 * while `pulsing` (the verification key). Deliberately text-free: it must draw with no fonts.
 */
export function paintSecurePromptFallback(
  fb: Uint32Array,
  pitch: number,
  fbWidth: number,
  fbHeight: number,
  rect: LockRect,
  entry: {
    kind: "password" | "consent";
    length: number;
    phase: SecurePromptPhase;
    pulsing: boolean;
  },
): void {
  const s = Math.max(1, Math.min(3, Math.min(rect.width, rect.height) / 700));
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const paint = { fb, pitch, fbWidth, fbHeight };
  const shieldY = cy - 92 * s;
  if (entry.pulsing) {
    circle(paint, cx, shieldY + 32 * s, 50 * s, ACCENT);
    circle(paint, cx, shieldY + 32 * s, 45 * s, INK);
  }
  shield(paint, cx, shieldY, 54 * s, 64 * s, entry.pulsing ? ACCENT : GLYPH);
  // A keyhole, so the badge reads as "the system asks" and not as decoration.
  circle(paint, cx, shieldY + 26 * s, 6 * s, INK);
  roundRect(paint, cx - 2.5 * s, shieldY + 28 * s, 5 * s, 14 * s, 2 * s, INK);
  if (entry.kind !== "password") return;
  const fieldW = Math.min(rect.width - 40 * s, 300 * s);
  const fieldH = 46 * s;
  const fieldX = cx - fieldW / 2;
  const fieldY = cy + 6 * s;
  const colour = FIELD_COLOURS[entry.phase];
  roundRect(paint, fieldX - 2 * s, fieldY - 2 * s, fieldW + 4 * s, fieldH + 4 * s, 13 * s, colour);
  roundRect(paint, fieldX, fieldY, fieldW, fieldH, 11 * s, 0xf0161720);
  const dots = Math.min(entry.length, MAX_DOTS);
  const gap = Math.min(16 * s, (fieldW - 24 * s) / Math.max(1, dots));
  const first = cx - ((dots - 1) * gap) / 2;
  for (let index = 0; index < dots; index++)
    circle(paint, first + index * gap, fieldY + fieldH / 2, 4.5 * s, 0xffe6e6ef);
  if (dots === 0) roundRect(paint, cx - 1 * s, fieldY + 12 * s, 2 * s, fieldH - 24 * s, s, colour);
}

/**
 * The verification key's answer when no prompt is open and the shell cannot draw the sentence:
 * an empty shield outline (nothing is asking).
 */
export function paintSecureNoticeFallback(
  fb: Uint32Array,
  pitch: number,
  fbWidth: number,
  fbHeight: number,
  rect: LockRect,
): void {
  const s = Math.max(1, Math.min(3, Math.min(rect.width, rect.height) / 700));
  const cx = rect.x + rect.width / 2;
  const top = rect.y + rect.height / 2 - 40 * s;
  const paint = { fb, pitch, fbWidth, fbHeight };
  shield(paint, cx, top, 66 * s, 78 * s, 0xb3ffffff);
  shield(paint, cx, top + 6 * s, 54 * s, 64 * s, INK);
}

/** A shield with its top edge at `top`: straight shoulders curving in to a point. */
function shield(
  paint: Paint,
  cx: number,
  top: number,
  width: number,
  height: number,
  colour: number,
): void {
  const half = width / 2;
  const straight = 0.42;
  fill(paint, cx - half - 1, top - 1, cx + half + 1, top + height + 1, colour, (px, py) => {
    const t = (py - top) / height;
    if (t < 0 || t > 1) return Math.min(py - top, top + height - py) + 0.5;
    const taper = t <= straight ? 0 : (t - straight) / (1 - straight);
    const reach = half * Math.sqrt(Math.max(0, 1 - taper * taper));
    return Math.min(reach - Math.abs(px - cx), py - top, top + height - py) + 0.5;
  });
}
