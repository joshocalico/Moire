# Moire Settings

Out-of-process `@moire/ui` app: a grouped sidebar (Connections, Devices, Personal, System) with
search, Overview behind the name card, and sixteen pages. Below 760px (at the current scale)
the sidebar becomes an icon rail. The design is in `docs/settings-redesign.md`.

| Layer              | Files                                                                                      |
| ------------------ | ------------------------------------------------------------------------------------------ |
| Entry              | `main.tsx` connects the services and opens the window; `app.tsx` composes the window       |
| Registry           | `catalog.ts`: pages, groups, searchable settings and deep links                            |
| Search             | `search-settings.ts` (pure ranking), `search-results.tsx` (the live rows)                  |
| Journal            | `history.ts` (`settings-history.json`), Undo from Overview or Ctrl+Z                       |
| Pages              | `pages/<page>.tsx`, pure builders over the live models; `pages/*-model.ts` for the wording |
| State and services | `services.ts`, `*-state.ts`, `settings-clients.ts`                                         |

Pages build their rows with the catalog's ids, and search shows those same rows, so a setting
found by search is the control on its page. A setting whose backend is missing isn't built, so
search can't offer it either.

Deep links: `MOIRE_SETTINGS_PAGE=<page>[#<setting>]`, for example `appearance#wallpaper` or
`network#wifi`. The old `MOIRE_SETTINGS_TAB` index (0 Appearance, 1 Displays, 2 Sound,
3 Search & Privacy, 4 About) still works.

```bash
pnpm --filter @moire/settings start
pnpm --filter @moire/settings smoke   # SETTINGS_PNG_DIR=<dir> also writes the pages as PNGs
```
