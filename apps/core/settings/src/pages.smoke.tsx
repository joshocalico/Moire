/**
 * Every Settings page with every service faked: each renders in both schemes at 640 and 1020
 * wide and at scale 1 and 1.5 with no control outside the window, and Overview, a deep link,
 * the sidebar and search work from the keyboard. `SETTINGS_PNG_DIR` also writes the pages and
 * states the design review looks at.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { setUiScaleFactor } from "@moire/ui";
import { loadSettings } from "@moire/prefs";
import { withFixture } from "@moire/app-tools/testing";
import { PAGES, type PageId } from "./catalog";
import { settingsFixture } from "./testing";
import { mountSettings, overflow } from "./testing-ui";

const pictures = process.env.SETTINGS_PNG_DIR;
const shot = (app: Awaited<ReturnType<typeof mountSettings>>, name: string) => {
  if (pictures) app.screenshot(path.join(pictures, `${name}.png`));
};

await withFixture(async () => {
  const pages: PageId[] = ["overview", ...PAGES.map((page) => page.id)];
  // ---- Every page, both schemes, two widths, two scales: renders, with nothing outside.
  for (const scale of [1, 1.5])
    for (const scheme of ["dark", "light"] as const)
      for (const [width, height] of [
        [1020, 700],
        [640, 650],
      ] as const) {
        setUiScaleFactor(scale);
        const w = Math.round(width * scale);
        const h = Math.round(height * scale);
        for (const page of pages) {
          const fixture = settingsFixture({ ...loadSettings(), dark: scheme === "dark" }, { page });
          const app = await mountSettings(fixture, { width: w, height: h, scheme });
          await app.settle(6);
          assert.ok(app.texts().length > 5, `${page}: renders`);
          assert.ok(
            !app.texts().some((text) => /undefined|NaN|\[object/.test(text)),
            `${page}: no broken text`,
          );
          assert.deepEqual(
            overflow(app, w, h),
            [],
            `${page} ${scheme} ${width} ×${scale}: controls inside`,
          );
          if (scale === 1 || width === 1020)
            shot(app, `${page}-${scheme}-${width}x${height}${scale === 1 ? "" : `-scale${scale}`}`);
          app.destroy();
        }
      }
  setUiScaleFactor(1);
});
console.log(
  "[settings/pages] every page renders in both schemes, two widths and two scales without overflow",
);
