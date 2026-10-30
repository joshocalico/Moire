/** Built-in palettes offered beside the user's own. Read-only; "Save as Palette" copies one. */
import type { Palette } from "./palettes";

const preset = (id: string, name: string, colors: ReadonlyArray<[string, string]>): Palette => ({
  id: `preset:${id}`,
  name,
  swatches: colors.map(([swatchName, hex], index) => ({
    id: `preset:${id}:${index}`,
    name: swatchName,
    hex,
  })),
});

export const PRESETS: readonly Palette[] = [
  preset("basics", "Basics", [
    ["Red", "#E5484D"],
    ["Orange", "#F76B15"],
    ["Amber", "#FFC53D"],
    ["Green", "#30A46C"],
    ["Teal", "#12A594"],
    ["Blue", "#0090FF"],
    ["Indigo", "#3E63DD"],
    ["Purple", "#8E4EC6"],
    ["Pink", "#D6409F"],
    ["Slate", "#8B8D98"],
  ]),
  preset("pastel", "Pastel", [
    ["Blush", "#FFD1DC"],
    ["Peach", "#FFE5B4"],
    ["Lemon", "#FFFACD"],
    ["Mint", "#C1F0C1"],
    ["Seafoam", "#B5EAD7"],
    ["Periwinkle", "#C7CEEA"],
    ["Lilac", "#E0BBE4"],
  ]),
  preset("earth", "Earth", [
    ["Terracotta", "#C8553D"],
    ["Ochre", "#CC7722"],
    ["Sand", "#D8C3A5"],
    ["Olive", "#708238"],
    ["Moss", "#4A5D23"],
    ["Umber", "#635147"],
  ]),
  preset("ocean", "Ocean", [
    ["Abyss", "#0B2545"],
    ["Deep", "#13315C"],
    ["Steel", "#134074"],
    ["Lagoon", "#2A9D8F"],
    ["Sky", "#8DA9C4"],
    ["Foam", "#EEF4ED"],
  ]),
  preset("grays", "Grays", [
    ["Black", "#000000"],
    ["Charcoal", "#222222"],
    ["Graphite", "#444444"],
    ["Gray", "#777777"],
    ["Silver", "#AAAAAA"],
    ["Mist", "#DDDDDD"],
    ["White", "#FFFFFF"],
  ]),
];
