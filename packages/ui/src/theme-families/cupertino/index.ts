import type { PersonalizationProfile } from "#ui/personalization";
import type { WidgetTheme } from "#ui/widget-theme";
import { cupertinoControlRecipes } from "./controls";
import { cupertinoFormRecipes } from "./forms";
import { cupertinoFoundations } from "./foundations";
import { cupertinoSurfaceRecipes } from "./surfaces";

/** Compose the Cupertino family from independently testable recipe groups. */
export function applyCupertinoWidgetTheme(
  source: WidgetTheme,
  profile: PersonalizationProfile,
): WidgetTheme {
  return {
    ...source,
    name: `${source.name}:cupertino`,
    foundations: cupertinoFoundations(source.foundations),
    recipes: {
      ...source.recipes,
      ...cupertinoControlRecipes(source, profile),
      ...cupertinoFormRecipes(source),
      ...cupertinoSurfaceRecipes(source),
    },
  };
}
