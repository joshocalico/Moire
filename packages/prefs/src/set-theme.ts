/** Recovery-console helper for exercising the same preferences as Settings. */
import { THEME_FAMILIES, parseThemeFamily } from "@moire/theme";
import { loadSettings, saveSettings } from "./store";
import { writeActiveTheme } from "./apply";

const [familyArg, scheme = "dark"] = process.argv.slice(2);
if (!THEME_FAMILIES.some((family) => family === familyArg) || !["dark", "light"].includes(scheme)) {
  console.error(
    "Usage: tsx packages/prefs/src/set-theme.ts <moire|cupertino|redmond|plasmid|gnomish> [dark|light]",
  );
  process.exit(1);
}
const settings = {
  ...loadSettings(),
  themeFamily: parseThemeFamily(familyArg),
  dark: scheme === "dark",
};
saveSettings(settings);
const theme = writeActiveTheme(settings);
console.log(
  `[theme] ${theme.name} titlebar=${theme.tokens.titlebarHeight} panel=${theme.tokens.panelHeight}`,
);
