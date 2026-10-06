# Characters

`@moire/characters` provides a curated Unicode collection with name/category/code
search and native text clipboard copying. Its launcher entry is
`moire-characters.desktop`, command `moire-characters`, and app ID
`org.moire.Characters`.

Search a name such as "copyright", a symbol, or a code such as `U+03C0`. Select
a category to restrict results. Choose a character to inspect its name and
Unicode code, then choose Copy. Clipboard failure produces a visible status
instead of claiming success.

The collection covers punctuation, mathematics, arrows, currency, Greek letters,
and accented Latin letters. It is intentionally curated rather than a complete
Unicode database. Characters missing from the bundled font show their Unicode
code instead of a missing-glyph box; Copy still copies the actual character. Clipboard ownership
follows the active platform backend and normally lasts while the app remains open.

Run `pnpm --filter @moire/characters smoke` for catalog search, code formatting,
category selection by keyboard, and actual Window selection/Copy into the private
headless clipboard.
