# Help

`@moire/help` searches the desktop's implemented workflows and keyboard commands.
Its launcher entry is `moire-help.desktop`, command `moire-help`, and app ID
`org.moire.Help`.

Search an application name, an action, or a key combination such as Ctrl+Shift+S.
Choose a topic in the navigation list to read the workflow and its shortcuts.
No matching topic produces a clear empty state.

The catalog covers the launcher, taskbar/window controls, desktop icons, Files
navigation/actions, and all twenty apps in the utility suite. Topics explain
local storage, backend requirements and unsupported workflows as well as
available controls. Each entry records its source document or implementation.
The smoke check verifies those sources exist and every suite app can be found
by its name. This coverage does not imply native acceptance of every workflow.

Help is a curated local catalog. It has no web search, command execution, or
support chat. When an app's shortcuts change, update its topic in
`apps/bundled/help/src/catalog.ts` in the same change.

Run `pnpm --filter @moire/help smoke` for source-reference checks, action/key
search, empty matches, and actual Window search input.
