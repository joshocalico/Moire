export type Character = { glyph: string; name: string; category: string };
const groups: Record<string, readonly (readonly [string, string])[]> = {
  Punctuation: [
    ["…", "Ellipsis"],
    ["—", "Em dash"],
    ["–", "En dash"],
    ["“", "Left double quotation mark"],
    ["”", "Right double quotation mark"],
    ["‘", "Left single quotation mark"],
    ["’", "Right single quotation mark"],
    ["•", "Bullet"],
    ["·", "Middle dot"],
    ["§", "Section sign"],
    ["¶", "Pilcrow paragraph sign"],
    ["©", "Copyright"],
    ["®", "Registered trademark"],
    ["™", "Trademark"],
  ],
  Mathematics: [
    ["×", "Multiplication"],
    ["÷", "Division"],
    ["±", "Plus minus"],
    ["−", "Minus"],
    ["≠", "Not equal"],
    ["≈", "Approximately equal"],
    ["≤", "Less than or equal"],
    ["≥", "Greater than or equal"],
    ["∞", "Infinity"],
    ["√", "Square root"],
    ["∑", "Summation"],
    ["∏", "Product"],
    ["∫", "Integral"],
    ["°", "Degree"],
    ["²", "Superscript two"],
    ["³", "Superscript three"],
    ["½", "One half"],
    ["¼", "One quarter"],
    ["¾", "Three quarters"],
  ],
  Arrows: [
    ["←", "Left arrow"],
    ["→", "Right arrow"],
    ["↑", "Up arrow"],
    ["↓", "Down arrow"],
    ["↔", "Left right arrow"],
    ["↕", "Up down arrow"],
    ["↗", "Upper right arrow"],
    ["↘", "Lower right arrow"],
    ["⇒", "Double right arrow"],
    ["⇔", "Double left right arrow"],
    ["↩", "Left arrow with hook"],
  ],
  Currency: [
    ["$", "Dollar"],
    ["€", "Euro"],
    ["£", "Pound sterling"],
    ["¥", "Yen yuan"],
    ["¢", "Cent"],
    ["₹", "Indian rupee"],
    ["₩", "Korean won"],
    ["₽", "Russian ruble"],
    ["₿", "Bitcoin"],
  ],
  Greek: [
    ["α", "Alpha"],
    ["β", "Beta"],
    ["γ", "Gamma"],
    ["δ", "Delta"],
    ["ε", "Epsilon"],
    ["θ", "Theta"],
    ["λ", "Lambda"],
    ["μ", "Mu"],
    ["π", "Pi"],
    ["σ", "Sigma"],
    ["φ", "Phi"],
    ["ω", "Omega"],
    ["Δ", "Capital delta"],
    ["Ω", "Capital omega"],
    ["Σ", "Capital sigma"],
  ],
  Accents: [
    ["á", "A acute"],
    ["é", "E acute"],
    ["í", "I acute"],
    ["ó", "O acute"],
    ["ú", "U acute"],
    ["à", "A grave"],
    ["è", "E grave"],
    ["ñ", "N tilde"],
    ["ü", "U diaeresis"],
    ["ö", "O diaeresis"],
    ["ç", "C cedilla"],
    ["å", "A ring"],
    ["æ", "Ae ligature"],
    ["œ", "Oe ligature"],
    ["ß", "Sharp s"],
  ],
};
export const CHARACTERS: Character[] = Object.entries(groups).flatMap(([category, entries]) =>
  entries.map(([glyph, name]) => ({ glyph, name, category })),
);
export function unicodeCode(glyph: string): string {
  return Array.from(glyph)
    .map(
      (character) => `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`,
    )
    .join(" ");
}
export function findCharacters(query: string, category = "All"): Character[] {
  const needle = query.trim().toLocaleLowerCase();
  return CHARACTERS.filter(
    (item) =>
      (category === "All" || item.category === category) &&
      `${item.glyph} ${item.name} ${item.category} ${unicodeCode(item.glyph)}`
        .toLocaleLowerCase()
        .includes(needle),
  );
}
