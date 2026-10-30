/**
 * The secure prompt surface: renders at desktop and narrow sizes, both schemes and UI scales,
 * each state, the chooser with one, two and eight identities, consent and the notice, and
 * dispatches its controls. Set MOIRE_SECURE_PROMPT_DIR to write PNGs for review (composited over
 * a darkened wallpaper, as the compositor shows them).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { DEFAULT_SETTINGS, themeForSettings } from "@moire/prefs";
import { paintWallpaper, setTheme } from "@moire/theme";
import { installUiFonts, setUiScaleFactor, tickAllMotions } from "@moire/ui";
import { createSecurePromptSurface, type SecurePromptRaster } from "./secure-prompt-surface";
import {
  SECURE_PROMPT_FOCUS,
  SECURE_PROMPT_TEXT,
  securePromptMessage,
  securePromptRequester,
} from "./SecurePrompt";
import type { SecurePromptView } from "./types";

const out = process.env.MOIRE_SECURE_PROMPT_DIR;
if (out) fs.mkdirSync(out, { recursive: true });
await installUiFonts();

const ADMINS = [
  "Ada Lovelace",
  "Grace Hopper",
  "Katherine Johnson",
  "Margaret Hamilton",
  "Barbara Liskov",
  "Frances Allen",
  "Radia Perlman",
  "Maximiliana Wolfeschlegelsteinhausen-Bergerdorff",
].map((displayName, index) => ({ account: `admin${index}`, displayName }));

const base: SecurePromptView = {
  revision: 1,
  id: 1,
  kind: "password",
  headline: "Authentication is required to add a user",
  requester: { name: "Settings", pid: 4242, x11: false },
  identities: ADMINS.slice(0, 1),
  selected: 0,
  needsAdministrator: false,
  details: [
    { label: "Action", value: "org.freedesktop.accounts.user-administration" },
    { label: "Vendor", value: "The AccountsService Project" },
    { label: "Process", value: "4242" },
  ],
  length: 0,
  phase: "entry",
  failures: 0,
  waiting: 0,
  verifications: 0,
  pulsing: false,
  capsLock: false,
  layout: { label: "US", name: "English (US)" },
  reducedMotion: true,
};

type Surface = ReturnType<typeof createSecurePromptSurface>;

/** Settle motion and return the final raster. */
function settle(surface: Surface, view: SecurePromptView, w: number, h: number) {
  let raster: SecurePromptRaster | null = null;
  for (let frame = 0; frame < 40; frame++) {
    raster = surface.raster(view, w, h);
    tickAllMotions(0.05);
  }
  raster = surface.raster(view, w, h);
  assert.ok(raster, "the prompt surface renders");
  assert.equal(raster.width, w);
  assert.equal(raster.height, h);
  return raster;
}

function writePng(name: string, raster: SecurePromptRaster, dark: boolean) {
  if (!out) return;
  const { width, height } = raster;
  const ground = new Uint32Array(width * height);
  paintWallpaper(ground, width, width, height, themeForSettings({ ...DEFAULT_SETTINGS, dark }), 0);
  const png = new PNG({ width, height });
  const src = new Uint32Array(raster.pixels.buffer, raster.pixels.byteOffset, width * height);
  for (let i = 0; i < width * height; i++) {
    const g = ground[i]!;
    const s = src[i]!;
    const a = (s >>> 24) / 255;
    // The compositor's backdrop keeps half the (blurred) wallpaper, toward black or white.
    const under = (shift: number) =>
      dark ? ((g >>> shift) & 255) * 0.5 : 255 - (255 - ((g >>> shift) & 255)) * 0.5;
    const channel = (shift: number) =>
      Math.min(255, Math.round(under(shift) * (1 - a) + ((s >>> shift) & 255)));
    png.data[i * 4] = channel(16);
    png.data[i * 4 + 1] = channel(8);
    png.data[i * 4 + 2] = channel(0);
    png.data[i * 4 + 3] = 255;
  }
  fs.writeFileSync(path.join(out, `${name}.png`), PNG.sync.write(png));
}

/** Every control lies inside the output, whatever the size and scale. */
function assertInside(surface: Surface, ids: string[], w: number, h: number, what: string) {
  for (const id of ids) {
    const rect = surface.control(id);
    assert.ok(rect, `${what}: ${id} is there`);
    assert.ok(
      rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= w && rect.y + rect.height <= h,
      `${what}: ${id} is inside the output`,
    );
  }
}

let cases = 0;
const sizes = [
  [1020, 700],
  [640, 650],
] as const;

// Two sizes, light and dark, two scales: a typed password, and eight administrators to choose
// from (the tallest prompt).
for (const dark of [true, false])
  for (const scale of [1, 1.5])
    for (const [w, h] of sizes) {
      setTheme(themeForSettings({ ...DEFAULT_SETTINGS, dark }));
      setUiScaleFactor(scale);
      const tag = `${dark ? "dark" : "light"}-${w}x${h}-scale${scale}`;
      const prompt = createSecurePromptSurface();
      const typed = { ...base, revision: 2, length: 7, capsLock: true };
      const raster = settle(prompt, typed, w, h);
      writePng(`prompt-${tag}`, raster, dark);
      // Every pixel outside the card is transparent: the compositor's backdrop shows through.
      const words = new Uint32Array(raster.pixels.buffer, raster.pixels.byteOffset, w * h);
      assert.equal(words[0]! >>> 24, 0, "corners stay transparent");
      assert.notEqual(words[(h >> 1) * w + (w >> 1)]! >>> 24, 0, "the card is in the middle");
      assertInside(
        prompt,
        [SECURE_PROMPT_FOCUS.cancel, SECURE_PROMPT_FOCUS.submit, SECURE_PROMPT_FOCUS.details],
        w,
        h,
        tag,
      );
      const eight = createSecurePromptSurface();
      const administrators: SecurePromptView = {
        ...base,
        id: 2,
        identities: ADMINS,
        selected: 2,
        needsAdministrator: true,
        requester: { name: "systemctl", via: "Terminal", x11: false },
      };
      writePng(`prompt-admins-${tag}`, settle(eight, administrators, w, h), dark);
      assertInside(
        eight,
        [
          // Where eight rows do not fit, the list becomes a stepper.
          ...(eight.control(SECURE_PROMPT_FOCUS.next)
            ? [SECURE_PROMPT_FOCUS.previous, SECURE_PROMPT_FOCUS.next]
            : ADMINS.map((_, index) => SECURE_PROMPT_FOCUS.identity(index))),
          SECURE_PROMPT_FOCUS.cancel,
          SECURE_PROMPT_FOCUS.details,
        ],
        w,
        h,
        `${tag} admins`,
      );
      if (scale === 1.5) {
        assert.ok(eight.control(SECURE_PROMPT_FOCUS.next), `${tag}: the stepper stands in`);
        const next = eight.control(SECURE_PROMPT_FOCUS.next)!;
        const x = next.x + next.width / 2;
        const y = next.y + next.height / 2;
        eight.pointer({ x, y, button: 0x110, value: 1 });
        assert.deepEqual(eight.pointer({ x, y, button: 0x110, value: 0 }), {
          type: "identity",
          index: 3,
        });
      } else assert.equal(eight.control(SECURE_PROMPT_FOCUS.next), null, `${tag}: the full list`);
      cases++;
    }

setTheme(themeForSettings({ ...DEFAULT_SETTINGS, dark: true }));
setUiScaleFactor(1);
const W = 1020;
const H = 700;

// Each state, with its fixed sentence.
{
  const states: [string, Partial<SecurePromptView>, string][] = [
    ["wrong", { phase: "wrong", failures: 1 }, "That password didn't work. Try again."],
    ["throttled", { phase: "throttled" }, "Too many attempts. Try again in a minute."],
    ["unavailable", { phase: "unavailable" }, "The password can't be checked right now."],
    ["checking", { phase: "checking" }, "Checking…"],
    ["caps", { capsLock: true, length: 3 }, "Caps Lock is on"],
    ["verified", { pulsing: true, verifications: 1 }, ""],
    ["waiting", { waiting: 2, length: 64 }, ""],
    [
      "x11",
      {
        requester: { name: "xterm", x11: true },
        headline:
          "Authentication is required to manage system services or other units, and this " +
          "sentence keeps going well past what fits on two lines so that the headline has to " +
          "be cut with an ellipsis instead of pushing the buttons off the prompt entirely.",
      },
      "",
    ],
    ["unknown", { requester: null, details: [] }, ""],
  ];
  for (const [name, patch, sentence] of states) {
    const prompt = createSecurePromptSurface();
    const view = { ...base, revision: 3, ...patch };
    assert.equal(securePromptMessage(view), sentence, `${name}: the fixed sentence`);
    writePng(`prompt-state-${name}`, settle(prompt, view, W, H), true);
    assertInside(prompt, [SECURE_PROMPT_FOCUS.cancel], W, H, name);
    cases++;
  }
  assert.equal(securePromptRequester(base), "Requested by Settings");
  assert.equal(
    securePromptRequester({
      ...base,
      requester: { name: "systemctl", via: "Terminal", x11: true },
    }),
    "Requested by systemctl, from Terminal · runs under X11",
  );
  assert.equal(
    securePromptRequester({ ...base, requester: null }),
    "Requested by an unknown program",
  );
  assert.equal(SECURE_PROMPT_TEXT.administrator, "An administrator's password is needed");
  assert.equal(SECURE_PROMPT_TEXT.another, "Use another administrator");
  assert.equal(SECURE_PROMPT_TEXT.notice, "No system password request is open");
}

const click = (surface: Surface, rect: { x: number; y: number; width: number; height: number }) => {
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height / 2;
  surface.pointer({ x, y });
  assert.equal(surface.pointer({ x, y, button: 0x110, value: 1 }), null, "press never acts");
  return surface.pointer({ x, y, button: 0x110, value: 0 });
};

// One identity: no chooser. Cancel and Authenticate dispatch; details open and close.
{
  const prompt = createSecurePromptSurface();
  const first = settle(prompt, base, W, H);
  assert.equal(prompt.raster(base, W, H)?.revision, first.revision, "unchanged: same revision");
  assert.equal(prompt.control(SECURE_PROMPT_FOCUS.chooser), null, "one identity: no chooser");
  assert.equal(prompt.control(SECURE_PROMPT_FOCUS.identity(0)), null);
  assert.equal(prompt.control(SECURE_PROMPT_FOCUS.allow), null, "a password prompt has no Allow");
  assert.equal(
    prompt.control(SECURE_PROMPT_FOCUS.submit),
    null,
    "nothing to authenticate with an empty field",
  );
  const typed = { ...base, revision: 2, length: 5 };
  settle(prompt, typed, W, H);
  assert.deepEqual(click(prompt, prompt.control(SECURE_PROMPT_FOCUS.submit)!), { type: "submit" });
  assert.deepEqual(click(prompt, prompt.control(SECURE_PROMPT_FOCUS.cancel)!), { type: "cancel" });
  assert.equal(click(prompt, { x: 10, y: 10, width: 1, height: 1 }), null, "outside: nothing");
  const closed = prompt.control(SECURE_PROMPT_FOCUS.cancel)!;
  assert.equal(click(prompt, prompt.control(SECURE_PROMPT_FOCUS.details)!), null);
  const open = settle(prompt, typed, W, H);
  writePng("prompt-state-details", open, true);
  assert.notEqual(open.revision, first.revision, "the details redraw");
  assert.notEqual(
    prompt.control(SECURE_PROMPT_FOCUS.cancel)!.y,
    closed.y,
    "the card grew for the details",
  );
  assertInside(prompt, [SECURE_PROMPT_FOCUS.cancel, SECURE_PROMPT_FOCUS.details], W, H, "details");
  click(prompt, prompt.control(SECURE_PROMPT_FOCUS.details)!);
  settle(prompt, typed, W, H);
  assert.equal(prompt.control(SECURE_PROMPT_FOCUS.cancel)!.y, closed.y, "and closed again");
  // While a check runs the button waits.
  settle(prompt, { ...typed, revision: 3, phase: "checking", length: 0 }, W, H);
  assert.equal(prompt.control(SECURE_PROMPT_FOCUS.submit), null);
  cases++;
}

// The session user among two: preselected, with a quiet "Use another administrator".
{
  const prompt = createSecurePromptSurface();
  const two = { ...base, id: 5, identities: ADMINS.slice(0, 2), selected: 0 };
  writePng("prompt-chooser-closed", settle(prompt, two, W, H), true);
  const chooser = prompt.control(SECURE_PROMPT_FOCUS.chooser);
  assert.ok(chooser, "the quiet chooser control is there");
  assert.equal(prompt.control(SECURE_PROMPT_FOCUS.identity(1)), null, "the list starts closed");
  assert.equal(click(prompt, chooser), null, "opening the chooser asks nothing of the compositor");
  writePng("prompt-chooser-open", settle(prompt, two, W, H), true);
  assert.equal(prompt.control(SECURE_PROMPT_FOCUS.chooser), null);
  const other = prompt.control(SECURE_PROMPT_FOCUS.identity(1));
  assert.ok(other && prompt.control(SECURE_PROMPT_FOCUS.identity(0)), "both are listed");
  assert.deepEqual(click(prompt, other), { type: "identity", index: 1 });
  // Another prompt starts with the chooser closed again.
  settle(prompt, { ...two, id: 6 }, W, H);
  assert.ok(prompt.control(SECURE_PROMPT_FOCUS.chooser), "a new prompt starts closed");
  cases++;
}

// A standard user: "An administrator's password is needed" and the administrators, at once.
{
  const prompt = createSecurePromptSurface();
  const needs = {
    ...base,
    id: 7,
    identities: ADMINS,
    selected: 0,
    needsAdministrator: true,
  };
  settle(prompt, needs, W, H);
  assert.equal(prompt.control(SECURE_PROMPT_FOCUS.chooser), null, "listed without asking");
  const rows = ADMINS.map((_, index) => prompt.control(SECURE_PROMPT_FOCUS.identity(index))!);
  assert.ok(rows.every(Boolean), "all eight administrators are listed");
  assert.ok(rows[0]!.y === rows[1]!.y && rows[2]!.y > rows[0]!.y, "two columns past four");
  assert.deepEqual(click(prompt, rows[7]!), { type: "identity", index: 7 });
  // One administrator: named, nothing to choose.
  const single = createSecurePromptSurface();
  writePng(
    "prompt-admin-single",
    settle(single, { ...needs, id: 8, identities: ADMINS.slice(1, 2) }, W, H),
    true,
  );
  assert.equal(single.control(SECURE_PROMPT_FOCUS.identity(0)), null);
  assert.equal(single.control(SECURE_PROMPT_FOCUS.chooser), null);
  cases++;
}

// Consent: Allow and Deny, and no answer field.
{
  const prompt = createSecurePromptSurface();
  const consent: SecurePromptView = {
    ...base,
    id: 9,
    kind: "consent",
    headline: "Allow Mail to use the passwords in the Login keyring?",
    requester: { name: "Mail", x11: false },
    identities: [],
    details: [],
  };
  writePng("prompt-consent", settle(prompt, consent, W, H), true);
  assert.equal(prompt.control(SECURE_PROMPT_FOCUS.cancel), null);
  assert.equal(prompt.control(SECURE_PROMPT_FOCUS.submit), null);
  assert.equal(prompt.control(SECURE_PROMPT_FOCUS.details), null, "no details: no disclosure");
  assert.deepEqual(click(prompt, prompt.control(SECURE_PROMPT_FOCUS.deny)!), { type: "deny" });
  assert.deepEqual(click(prompt, prompt.control(SECURE_PROMPT_FOCUS.allow)!), { type: "allow" });
  cases++;
}

// The notice, and closing: an unmounted surface asks for no frames and takes no clicks.
{
  const prompt = createSecurePromptSurface();
  for (const dark of [true, false]) {
    setTheme(themeForSettings({ ...DEFAULT_SETTINGS, dark }));
    let notice: SecurePromptRaster | null = null;
    for (let frame = 0; frame < 4; frame++) notice = prompt.notice(W, H);
    assert.ok(notice, "the notice renders");
    const words = new Uint32Array(notice.pixels.buffer, notice.pixels.byteOffset, W * H);
    assert.equal(words[0]! >>> 24, 0);
    assert.notEqual(words[(H >> 1) * W + (W >> 1)]! >>> 24, 0, "the notice is in the middle");
    writePng(`notice-${dark ? "dark" : "light"}`, notice, dark);
    prompt.setOpen(false);
  }
  assert.equal(prompt.pointer({ x: W / 2, y: H / 2, button: 0x110, value: 1 }), null);
  settle(prompt, base, W, H);
  prompt.setOpen(false);
  assert.equal(prompt.needsRepaint(false), false, "an unmounted prompt asks for no frames");
  assert.equal(prompt.control(SECURE_PROMPT_FOCUS.cancel), null);
  assert.equal(prompt.pointer({ x: W / 2, y: H / 2, button: 0x110, value: 0 }), null);
  cases++;
}

console.log(`[secure-prompt-view] ${cases} cases PASS${out ? ` (PNGs in ${out})` : ""}`);
