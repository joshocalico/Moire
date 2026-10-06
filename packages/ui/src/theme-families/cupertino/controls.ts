import type { PersonalizationProfile } from "#ui/personalization";
import type { WidgetTheme } from "#ui/widget-theme";
import { cupertinoButtonRecipes } from "./buttons";
import { cupertinoFieldRecipes } from "./fields";

export type CupertinoControlRecipes = Pick<
  WidgetTheme["recipes"],
  "button" | "iconButton" | "textField" | "tabs"
>;

export function cupertinoControlRecipes(
  source: WidgetTheme,
  profile: PersonalizationProfile,
): CupertinoControlRecipes {
  return {
    ...cupertinoButtonRecipes(source, profile),
    ...cupertinoFieldRecipes(source),
  };
}
