/**
 * Opening Settings at a page or a setting: the shell runs Settings' command with
 * `MOIRE_SETTINGS_PAGE=<page>[#<setting>]` (see `apps/core/settings/src/catalog.ts`).
 */

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** The shell command that starts Settings (`settingsExec`) on `link`. */
export function settingsCommand(settingsExec: string, link: string): string {
  return `MOIRE_SETTINGS_PAGE=${quote(link)} ${settingsExec}`;
}
