import assert from "node:assert/strict";
import {
  DISCOVERABLE_ACCENTS,
  THEME_FAMILIES,
  discoverPersonalization,
  mergePersonalization,
  personalizeTheme,
} from "./personalization";
import { createPersonalizedWidgetTheme } from "./widget-theme";
import { IMPLEMENTED_WIDGET_THEME_FAMILIES } from "./theme-families/index";

const discovered = discoverPersonalization("darwin", {
  source: "platform",
  colorScheme: "light",
  reducedMotion: true,
});
assert.equal(discovered.themeFamily, "cupertino");
assert.equal(discovered.accent, "#0a84ff");
assert.equal(discovered.availableThemeFamilies, THEME_FAMILIES);
assert.equal(discovered.availableAccents, DISCOVERABLE_ACCENTS);

const overridden = mergePersonalization(discovered, {
  source: "application",
  themeFamily: "plasmid",
  accent: "#bf5af2",
  fontScale: 8,
});
assert.equal(overridden.source, "application");
assert.equal(overridden.fontScale, 2);

const tokens = personalizeTheme(overridden).tokens;
assert.equal(tokens.accent, "#bf5af2");
assert.equal(tokens.focusRing, "#bf5af2");
assert.equal(tokens.radiusSm, 3);

const widgetTheme = createPersonalizedWidgetTheme(overridden);
assert.equal(widgetTheme.foundations.motion.fastMs, 0);
assert.equal(widgetTheme.foundations.palette.accent, 0xffbf5af2);

const cupertinoProfile = mergePersonalization(discovered, {
  source: "application",
  accent: "#0a84ff",
  reducedMotion: false,
});
const cupertino = createPersonalizedWidgetTheme(cupertinoProfile);
assert.ok(IMPLEMENTED_WIDGET_THEME_FAMILIES.includes("cupertino"));
assert.match(cupertino.name, /cupertino/);
assert.equal(cupertino.foundations.controlHeights.medium, 28);
assert.equal(cupertino.foundations.motion.normalMs, 180);
assert.equal(cupertino.recipes.button.primary.medium.root.base.radius, 7);
assert.equal(cupertino.recipes.button.primary.medium.root.base.fill, 0xff0a84ff);
assert.equal(cupertino.recipes.iconButton.standard.medium.root.base.radius, 14);
assert.equal(cupertino.recipes.tabs.medium.indicator.fill, 0x00000000);
assert.equal(cupertino.recipes.toggle.medium.metrics.trackWidth, 38);
assert.equal(cupertino.recipes.menu.medium.surface.radius, 12);

console.log("[ui/personalization-smoke] ok");
